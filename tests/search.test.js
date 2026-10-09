import test from "node:test";
import assert from "node:assert/strict";
import { searchMovies } from "../src/api/moviesApi.js";
import { ApiError } from "../src/api/client.js";
import { movieDetailPath } from "../src/routing/routes.js";
import { searchMovieMetadata, searchMoviePrice, searchTitleParts } from "../src/search/searchPresentation.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const movie = index => ({ id: index, slug: `server-movie-${index}`, title: `Server Movie ${index}` });

test("Search uses GET /search with one correctly encoded q, no body, and the supplied AbortSignal", async t => {
  const query = "Ba & + / ? # % ქართული", signal = new AbortController().signal;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (target, options) => {
    calls++;
    const url = new URL(target);
    assert.equal(url.pathname, "/api/search");
    assert.deepEqual([...url.searchParams], [["q", query]]);
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.signal, signal);
    return json({ data: [movie(1)] });
  });
  assert.deepEqual(await searchMovies(query, { signal }), [movie(1)]);
  assert.equal(calls, 1);
});

test("Search preserves the blank-query empty server response rather than substituting catalogue data", async t => {
  t.mock.method(globalThis, "fetch", async target => {
    assert.equal(new URL(target).searchParams.get("q"), "");
    return json({ data: [] });
  });
  assert.deepEqual(await searchMovies(""), []);
});

test("Search preserves all six server results and their order without client filtering or pagination", async t => {
  const data = [6, 2, 4, 1, 5, 3].map(movie);
  t.mock.method(globalThis, "fetch", async () => json({ data }));
  assert.deepEqual(await searchMovies("not-a-local-title-match"), data);
});

test("Search safely rejects unusable envelopes/navigation fields and a response exceeding the documented six-result limit", async t => {
  for (const body of [null, {}, { data: {} }, { data: [null] }, { data: [[]] },
    { data: [{ title: "Missing slug" }] }, { data: [{ slug: "missing-title" }] },
    { data: [{ title: " ", slug: "blank-title" }] }, { data: [{ title: "Movie", slug: " " }] },
    { data: Array.from({ length: 7 }, (_, index) => movie(index)) }]) {
    t.mock.method(globalThis, "fetch", async () => json(body));
    await assert.rejects(searchMovies("Ba"), error => error instanceof ApiError && error.message === "The search response could not be read.");
  }
});

test("Search accepts usable title/slug without inventing required optional display fields", async t => {
  const data = [{ title: "Minimal returned movie", slug: "minimal" }];
  t.mock.method(globalThis, "fetch", async () => json({ data }));
  assert.deepEqual(await searchMovies("Minimal"), data);
});

for (const status of [401, 403, 404, 422, 500]) test(`Search preserves HTTP ${status} errors and never retries automatically`, async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json({ message: "Synthetic Search refusal" }, status); });
  await assert.rejects(searchMovies("Ba"), error => error instanceof ApiError && error.status === status && error.message === "Synthetic Search refusal");
  assert.equal(calls, 1);
});

test("Search propagates network/abort failures without retry", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Synthetic offline"); });
  await assert.rejects(searchMovies("Ba"), error => error instanceof ApiError && error.cause.message === "Synthetic offline");
  assert.equal(calls, 1);
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new DOMException("Synthetic abort", "AbortError"); });
  await assert.rejects(searchMovies("Batman"), { name: "AbortError" });
  assert.equal(calls, 2);
});

test("Search treats a malformed JSON success as unavailable data", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("{bad-json", { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(searchMovies("Ba"), { message: "The search response could not be read." });
});

test("Search metadata uses only available server kind/rating/runtime fields", () => {
  assert.equal(searchMovieMetadata({ kind: "film", ageRating: { code: "12+" }, runtimeMinutes: 134 }), "Film · 12+ · 134 min");
  assert.equal(searchMovieMetadata({ kind: "event", runtimeMinutes: 90 }), "Live event · 90 min");
  for (const data of [{}, { kind: "unknown", ageRating: null, runtimeMinutes: null }, { ageRating: { code: " " }, runtimeMinutes: "90" }]) {
    assert.equal(searchMovieMetadata(data), "");
  }
});

test("Search Coming Soon overrides the available server price; missing/invalid prices stay absent", () => {
  assert.equal(searchMoviePrice({ isComingSoon: true, fromPrice: 19 }), "Coming Soon");
  assert.equal(searchMoviePrice({ fromPrice: 0 }), "from ₾0");
  assert.equal(searchMoviePrice({ fromPrice: 14.5 }), "from ₾14.5");
  for (const fromPrice of [undefined, null, "19", NaN, Infinity, -1]) assert.equal(searchMoviePrice({ fromPrice }), null);
});

test("Search title highlighting uses literal text without interpreting regex or markup", () => {
  assert.deepEqual(searchTitleParts("The Batman", " bat "), { before: "The ", match: "Bat", after: "man" });
  assert.deepEqual(searchTitleParts("[Ba]+ <img>", "[Ba]+"), { before: "", match: "[Ba]+", after: " <img>" });
  assert.deepEqual(searchTitleParts("Other server match", "Batman"), { before: "Other server match", match: "", after: "" });
});

test("Search navigation uses the established encoded movie slug route for films and Coming Soon titles", () => {
  assert.equal(movieDetailPath("server/title #ქართული"), "/movies/server%2Ftitle%20%23%E1%83%A5%E1%83%90%E1%83%A0%E1%83%97%E1%83%A3%E1%83%9A%E1%83%98");
});
