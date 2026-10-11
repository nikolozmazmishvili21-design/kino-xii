import { test } from "node:test";
import assert from "node:assert/strict";
import { createNowPlayingPreviews } from "../src/home/nowPlayingPreviews.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test("Now Playing deduplicates pending and cached reads without invoking visit recording", async () => {
  const request = deferred(), calls = [], changes = [];
  const cache = createNowPlayingPreviews({ readMovie: (slug, options) => { calls.push({ slug, ...options }); return request.promise; }, onChange: (...args) => changes.push(args) });
  const first = cache.load("alpha");
  assert.equal(cache.load("alpha"), first);
  await Promise.resolve(); assert.equal(calls.length, 1);
  request.resolve({ slug: "alpha", synopsis: " API story " }); await first;
  assert.equal(cache.load("alpha"), first);
  assert.deepEqual(changes.at(-1), ["alpha", { status: "success", synopsis: "API story" }]);
  assert.equal(calls.length, 1); cache.dispose();
});
test("Now Playing out-of-order A B C reads stay keyed to their own movies", async () => {
  const pending = new Map(), changes = [];
  const cache = createNowPlayingPreviews({ readMovie: slug => { const value = deferred(); pending.set(slug, value); return value.promise; }, onChange: (...args) => changes.push(args) });
  const work = ["a", "b", "c"].map(slug => cache.load(slug)); await Promise.resolve();
  for (const slug of ["c", "a", "b"]) pending.get(slug).resolve({ slug, synopsis: `Story ${slug}` });
  await Promise.all(work);
  for (const slug of ["a", "b", "c"]) assert.deepEqual(changes.findLast(value => value[0] === slug), [slug, { status: "success", synopsis: `Story ${slug}` }]);
  cache.dispose();
});
for (const synopsis of [undefined, null, "", "  "]) test(`Now Playing missing synopsis ${String(synopsis)} is cached without fabricated copy`, async () => {
  let count = 0, state;
  const cache = createNowPlayingPreviews({ readMovie: async slug => { count++; return { slug, synopsis }; }, onChange: (_, next) => { state = next; } });
  await cache.load("a"); await cache.load("a"); assert.equal(count, 1); assert.deepEqual(state, { status: "success", synopsis: "" }); cache.dispose();
});
for (const status of [401, 403, 404, 409, 422, 500, "network"]) test(`Now Playing ${status} error needs explicit retry and never storms`, async () => {
  let count = 0, state;
  const cache = createNowPlayingPreviews({ readMovie: async slug => { if (++count === 1) throw Object.assign(new Error("Unavailable"), { status }); return { slug, synopsis: "Recovered" }; }, onChange: (_, next) => { state = next; } });
  await cache.load("a"); await cache.load("a"); assert.equal(count, 1); assert.equal(state.status, "error");
  const retry = cache.load("a", { retry: true }); assert.equal(cache.load("a", { retry: true }), retry);
  await retry; assert.equal(count, 2); assert.equal(state.synopsis, "Recovered"); cache.dispose();
});
test("Now Playing rejects mismatched movie detail identity", async () => {
  let state;
  const cache = createNowPlayingPreviews({ readMovie: async () => ({ slug: "wrong", synopsis: "Wrong story" }), onChange: (_, next) => { state = next; } });
  await cache.load("right"); assert.deepEqual(state, { status: "error" }); cache.dispose();
});
test("Now Playing unmount aborts reads and fences transports that ignore cancellation", async () => {
  const pending = deferred(); let signal; const changes = [];
  const cache = createNowPlayingPreviews({ readMovie: (_, options) => { signal = options.signal; return pending.promise; }, onChange: (...args) => changes.push(args) });
  const work = cache.load("a"); await Promise.resolve(); cache.dispose(); assert.equal(signal.aborted, true);
  pending.resolve({ slug: "a", synopsis: "Too late" }); await work; await cache.load("b"); assert.equal(changes.length, 1);
});
test("Now Playing StrictMode disposal before dispatch prevents abandoned duplicate reads", async () => {
  let reads = 0; const changes = [];
  const options = { readMovie: async slug => { reads++; return { slug, synopsis: "Current" }; }, onChange: (...args) => changes.push(args) };
  const abandoned = createNowPlayingPreviews(options); const first = abandoned.load("a"); abandoned.dispose();
  const current = createNowPlayingPreviews(options); await Promise.all([first, current.load("a")]);
  assert.equal(reads, 1); assert.equal(changes.filter(([, state]) => state.status === "success").length, 1); current.dispose();
});
