import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecentlyViewed, recordRecentlyViewed, pruneRecentlyViewed, recentlyViewedKey, RECENTLY_VIEWED_LIMIT } from "../src/utils/recentlyViewedStorage.js";
import { loadRecentlyViewed } from "../src/recently-viewed/loadRecentlyViewed.js";

function storage(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map();
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  t.after(() => { if (original) Object.defineProperty(globalThis, "localStorage", original); else delete globalThis.localStorage; });
  return { values, store };
}
const movie = slug => ({ slug, title: `Returned ${slug}`, genres: [], runtimeMinutes: 101 });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };

test("guest and existing numeric account keys are separate; invalid owners cannot alias a partition", t => {
  storage(t);
  assert.equal(recentlyViewedKey(null), "kino-xii:recently-viewed:guest");
  assert.equal(recentlyViewedKey(12), "kino-xii:recently-viewed:12");
  recordRecentlyViewed(null, "guest-a"); recordRecentlyViewed(12, "account-a"); recordRecentlyViewed(13, "account-b");
  assert.deepEqual(readRecentlyViewed(null), ["guest-a"]); assert.deepEqual(readRecentlyViewed(12), ["account-a"]);
  assert.deepEqual(readRecentlyViewed(13), ["account-b"]);
  for (const owner of [undefined, "guest", "12", 0, -1, NaN, {}, 1.5]) {
    assert.equal(recordRecentlyViewed(owner, "wrong"), false); assert.deepEqual(readRecentlyViewed(owner), []);
  }
});
test("visits deduplicate, move to front, survive storage reads and retain only bounded slugs", t => {
  const { values } = storage(t);
  for (const slug of ["a", "b", "a", "c"]) recordRecentlyViewed(null, slug);
  assert.deepEqual(readRecentlyViewed(null), ["c", "a", "b"]);
  for (let i = 0; i < 30; i++) recordRecentlyViewed(null, `server-${i}`);
  const saved = JSON.parse(values.get(recentlyViewedKey(null)));
  assert.equal(saved.length, RECENTLY_VIEWED_LIMIT); assert.equal(saved[0], "server-29"); assert.ok(saved.every(value => typeof value === "string"));
});
test("malformed, nonarray, duplicate and invalid stored history is safely normalized", t => {
  const { values } = storage(t), key = recentlyViewedKey(12);
  for (const raw of ["{", "null", "12", '{"slug":"a"}']) { values.set(key, raw); assert.deepEqual(readRecentlyViewed(12), []); }
  values.set(key, JSON.stringify([{}, null, "", " ", "a", "a", "x".repeat(513), "b"]));
  assert.deepEqual(readRecentlyViewed(12), ["a", "b"]);
  assert.deepEqual(readRecentlyViewed(12, { repair: true }), ["a", "b"]);
  assert.deepEqual(JSON.parse(values.get(key)), ["a", "b"]);
  for (const slug of [undefined, null, 12, {}, "", " ", "x".repeat(513)]) assert.equal(recordRecentlyViewed(12, slug), false);
});
test("blocked storage reads and writes never throw or prevent navigation", t => {
  const { store } = storage(t);
  store.getItem = () => { throw new Error("Storage denied"); }; store.setItem = () => { throw new Error("Quota denied"); };
  assert.deepEqual(readRecentlyViewed(null), []); assert.equal(recordRecentlyViewed(null, "a"), false);
  assert.equal(pruneRecentlyViewed(null, ["a"]), false);
});
test("pruning reads the latest partition and preserves newer visits and other accounts", t => {
  storage(t); recordRecentlyViewed(12, "missing"); recordRecentlyViewed(12, "new"); recordRecentlyViewed(13, "missing");
  pruneRecentlyViewed(12, ["missing"]);
  assert.deepEqual(readRecentlyViewed(12), ["new"]); assert.deepEqual(readRecentlyViewed(13), ["missing"]);
});
test("empty history performs no API reads", async t => {
  storage(t); let calls = 0;
  assert.deepEqual(await loadRecentlyViewed(null, { loadMovie: () => { calls++; } }), { movies: [], failed: false, hasHistory: false });
  assert.equal(calls, 0);
});
test("display re-fetches only the two newest usable movies in stored order", async t => {
  storage(t); for (const slug of ["a", "b", "c"]) recordRecentlyViewed(null, slug);
  const reads = [], controller = new AbortController();
  const result = await loadRecentlyViewed(null, { signal: controller.signal, loadMovie: async (slug, options) => {
    reads.push(slug); assert.equal(options.signal, controller.signal); return movie(slug);
  } });
  assert.deepEqual(reads, ["c", "b"]); assert.deepEqual(result.movies.map(item => item.slug), ["c", "b"]);
  assert.deepEqual(readRecentlyViewed(null), ["c", "b", "a"]);
});
test("404 prunes missing movies and backfills the second visible card", async t => {
  storage(t); for (const slug of ["a", "b", "missing"]) recordRecentlyViewed(12, slug);
  const result = await loadRecentlyViewed(12, { loadMovie: async slug => {
    if (slug === "missing") throw { status: 404 }; return movie(slug);
  } });
  assert.deepEqual(result.movies.map(item => item.slug), ["b", "a"]); assert.deepEqual(readRecentlyViewed(12), ["b", "a"]);
});
test("all 404s hide the section after pruning", async t => {
  storage(t); recordRecentlyViewed(null, "missing");
  assert.deepEqual(await loadRecentlyViewed(null, { loadMovie: async () => { throw { status: 404 }; } }), { movies: [], failed: false, hasHistory: false });
  assert.deepEqual(readRecentlyViewed(null), []);
});
for (const status of [undefined, 401, 403, 422, 500]) test(`transient/HTTP ${status} read failures remain retryable without pruning history`, async t => {
  storage(t); recordRecentlyViewed(null, "a");
  const result = await loadRecentlyViewed(null, { loadMovie: async () => { throw { status }; } });
  assert.deepEqual(result, { movies: [], failed: true, hasHistory: true }); assert.deepEqual(readRecentlyViewed(null), ["a"]);
});
test("unusable or mismatched API data never fabricates display metadata or deletes history", async t => {
  storage(t); recordRecentlyViewed(null, "a");
  for (const data of [null, {}, { slug: "a", title: " " }, movie("b")]) {
    const result = await loadRecentlyViewed(null, { loadMovie: async () => data });
    assert.equal(result.failed, true); assert.deepEqual(result.movies, []); assert.deepEqual(readRecentlyViewed(null), ["a"]);
  }
});
for (const outcome of ["success", "404"]) test(`late ${outcome} after owner change cannot expose data or prune history`, async t => {
  storage(t); recordRecentlyViewed(12, "a"); let current = true; const pending = deferred();
  const task = loadRecentlyViewed(12, { isCurrent: () => current, loadMovie: async () => {
    await pending.promise; if (outcome === "404") throw { status: 404 }; return movie("a");
  } });
  current = false; pending.resolve(); await assert.rejects(task, { name: "AbortError" });
  assert.deepEqual(readRecentlyViewed(12), ["a"]); assert.deepEqual(readRecentlyViewed(13), []);
});
test("an abort-ignoring transport cannot settle stale history or launch the next read", async t => {
  storage(t); recordRecentlyViewed(null, "a"); recordRecentlyViewed(null, "b");
  const controller = new AbortController(), pending = deferred(); let calls = 0;
  const task = loadRecentlyViewed(null, { signal: controller.signal, loadMovie: async slug => { calls++; await pending.promise; return movie(slug); } });
  controller.abort(); pending.resolve(); await assert.rejects(task, { name: "AbortError" }); assert.equal(calls, 1);
});
