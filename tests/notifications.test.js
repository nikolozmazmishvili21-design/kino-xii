import { test } from "node:test";
import assert from "node:assert/strict";
import { getComingSoonMovies, notifyMovie } from "../src/api/moviesApi.js";
import { createNotifyAction, createBookingAction, isSamePendingAction, normalizePendingAction } from "../src/auth/pendingAction.js";
import { createNotificationRuntime } from "../src/notifications/notificationRuntime.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const movie = (id = 29, extra = {}) => ({ id, slug: `exact-server-${id}`, title: `Server title ${id}`, ...extra });
const auth = { accountId: 12, generation: 1, token: "synthetic-notify" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("Notify uses exact encoded server slug, POST, captured Bearer and no invented body/content type", async t => {
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/movies/server%20%2F%20%3F%20%E1%83%A5/notify");
    assert.equal(options.method, "POST"); assert.equal(options.headers.get("Authorization"), "Bearer synthetic-notify");
    assert.equal(options.body, undefined); assert.equal(options.headers.has("Content-Type"), false); assert.equal(options.signal, signal);
    return json({ data: { movieId: 29, subscribed: true } }, 201);
  });
  assert.deepEqual(await notifyMovie("server / ? ქ", { token: auth.token, signal, movieId: 29 }), { movieId: 29, subscribed: true });
});

test("only 201, subscribed=true and a valid matching movieId confirms success", async t => {
  for (const [status, data] of [[200, { movieId: 29, subscribed: true }], [201, { movieId: 29, subscribed: false }],
    [201, { movieId: 29, subscribed: "true" }], [201, {}], [201, { movieId: "29", subscribed: true }],
    [201, { movieId: 30, subscribed: true }], [201, { movieId: 0, subscribed: true }]]) {
    t.mock.method(globalThis, "fetch", async () => json({ data }, status));
    await assert.rejects(notifyMovie("exact-slug", { token: auth.token, movieId: 29 }), /could not be confirmed/);
  }
});
for (const status of [401, 403, 404, 409, 422, 500]) test(`Notify propagates HTTP ${status} without automatic transport retry`, async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json({ message: "Server refusal" }, status); });
  await assert.rejects(notifyMovie("exact-slug", { token: auth.token }), error => error.status === status && error.message === "Server refusal");
  assert.equal(calls, 1);
});
test("Notify propagates offline and aborted transport without success", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline"); });
  await assert.rejects(notifyMovie("slug", { token: auth.token }), /Network request failed/);
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("aborted", "AbortError"); });
  await assert.rejects(notifyMovie("slug", { token: auth.token }), { name: "AbortError" });
});
test("Coming Soon sends explicit current credentials and limit, allowing optional isNotified without inventing it", async t => {
  const data = [movie(), movie(32, { isNotified: true })];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/movies/coming-soon"); assert.equal(new URL(url).search, "?limit=4");
    assert.equal(options.headers.get("Authorization"), "Bearer synthetic-notify");
    assert.equal(options.body, undefined); return json({ data });
  });
  assert.deepEqual(await getComingSoonMovies({ limit: 4, token: auth.token }), data);
});
test("NOTIFY_MOVIE retains one bounded exact slug and discards everything else", () => {
  const action = normalizePendingAction({ type: "NOTIFY_MOVIE", payload: { movieSlug: "exact / key", token: "discard", movie: movie() }, callback() {} });
  assert.deepEqual(action, { type: "NOTIFY_MOVIE", payload: { movieSlug: "exact / key" } });
  assert.ok(Object.isFrozen(action) && Object.isFrozen(action.payload));
  for (const slug of [null, undefined, 29, {}, "", "  ", "x".repeat(513)]) assert.equal(createNotifyAction(slug), null);
  assert.equal(isSamePendingAction(action, createNotifyAction("exact / key")), true);
  assert.equal(isSamePendingAction(action, createNotifyAction("other")), false);
  assert.equal(isSamePendingAction(action, createBookingAction(29)), false);
});

function harness({ guest = false, catalogue = [movie(), movie(32)] } = {}) {
  let session = guest ? null : auth, pending = null;
  const posts = [], logins = [], reads = [];
  const runtime = createNotificationRuntime({
    getAuth: () => session,
    requestAuthentication(action, expired, options) {
      logins.push({ action, expired, options });
      if (expired) { session = null; runtime.syncAuth(); }
      pending = options?.replay ? null : action;
      return true;
    },
    notify(slug, options) { const task = deferred(); posts.push({ slug, options, ...task }); return task.promise; },
    getCatalogue(options) { reads.push(options); return Promise.resolve(catalogue); },
  });
  return { runtime, posts, logins, reads, pending: () => pending,
    setAuth(next) { session = next; runtime.syncAuth(); },
    async replay() { const action = pending; pending = null; return action && runtime.request(action.payload.movieSlug, { replay: true }); },
  };
}
test("pending lock prevents duplicate dispatch; confirmed result is persistent and independent per card", async () => {
  const h = harness(); await h.runtime.loadCatalogue();
  const first = h.runtime.request(movie().slug);
  assert.equal(h.runtime.state().cards[movie().slug].phase, "pending");
  await h.runtime.request(movie().slug); assert.equal(h.posts.length, 1);
  const second = h.runtime.request(movie(32).slug); assert.equal(h.posts.length, 2);
  h.posts[0].resolve({ movieId: 29, subscribed: true }); await first;
  assert.equal(h.runtime.state().cards[movie().slug].phase, "success");
  assert.equal(h.runtime.state().cards[movie(32).slug].phase, "pending");
  h.posts[1].reject({ status: 500 }); await second;
  assert.equal(h.runtime.state().cards[movie(32).slug].phase, "error");
  await h.runtime.request(movie().slug); assert.equal(h.posts.length, 2);
  await h.runtime.loadCatalogue(); assert.equal(h.runtime.state().cards[movie().slug].phase, "success");
});
test("guest retains slug, opens existing auth and replays once with new credentials", async () => {
  const h = harness({ guest: true });
  await h.runtime.request(movie().slug); assert.equal(h.posts.length, 0);
  assert.deepEqual(h.pending(), createNotifyAction(movie().slug));
  h.setAuth({ ...auth, generation: 3 }); const replay = h.replay();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].options.token, auth.token);
  await h.replay(); assert.equal(h.posts.length, 1);
  h.posts[0].resolve({ movieId: 29, subscribed: true }); await replay;
  assert.equal(h.pending(), null); assert.equal(h.runtime.state().cards[movie().slug].phase, "success");
});
test("expired auth continues once; replayed 401 terminates and never loops", async () => {
  const h = harness(); const first = h.runtime.request(movie().slug);
  h.posts[0].reject({ status: 401 }); await first;
  assert.ok(h.pending()); assert.equal(h.logins[0].expired, true);
  h.setAuth({ ...auth, generation: 3, token: "new-synthetic" }); const replay = h.replay();
  assert.equal(h.posts[1].options.token, "new-synthetic");
  h.posts[1].reject({ status: 401 }); await replay;
  assert.equal(h.pending(), null); assert.equal(h.posts.length, 2);
  assert.equal(h.runtime.state().cards[movie().slug].phase, "error");
  await h.replay(); assert.equal(h.posts.length, 2);
});
test("cancel resets auth-wait state without POST", async () => {
  const h = harness({ guest: true }); await h.runtime.request(movie().slug); h.runtime.cancelContinuation();
  assert.equal(h.runtime.state().cards[movie().slug].phase, "idle"); assert.equal(h.posts.length, 0);
});
for (const error of [{}, { status: 404 }, { status: 403 }, { status: 409, message: "Conflict rule" },
  { status: 422, message: "Business rule" }, { status: 500 }]) test(`failure ${error.status ?? "network"} remains recoverable without changing another card`, async () => {
  const h = harness(); const task = h.runtime.request(movie().slug); h.posts[0].reject(error); await task;
  assert.equal(h.runtime.state().cards[movie().slug].phase, "error"); assert.ok(h.runtime.state().cards[movie().slug].message);
  assert.equal(h.runtime.state().cards[movie(32).slug], undefined);
  const retry = h.runtime.request(movie().slug); assert.equal(h.posts.length, 2);
  h.posts[1].resolve({ movieId: 29, subscribed: true }); await retry;
  assert.equal(h.runtime.state().cards[movie().slug].phase, "success");
});
for (const next of [null, { ...auth, accountId: 13 }, { ...auth, generation: 2 }]) test(`auth transition ${next?.accountId ?? "logout"}/${next?.generation ?? "none"} discards stale success and stale 401`, async () => {
  for (const outcome of ["success", "401"]) {
    const h = harness(); const task = h.runtime.request(movie().slug); h.setAuth(next);
    assert.equal(h.posts[0].options.signal.aborted, true);
    if (outcome === "success") h.posts[0].resolve({ movieId: 29, subscribed: true }); else h.posts[0].reject({ status: 401 });
    await task; assert.deepEqual(h.runtime.state().cards, {}); assert.equal(h.logins.length, 0);
  }
});
test("only explicit server boolean true from current authenticated GET restores subscription", async () => {
  const catalogue = [movie(), movie(30, { isNotified: "true" }), movie(31, { isNotified: false }), movie(32, { isNotified: true })];
  const h = harness({ catalogue }); await h.runtime.loadCatalogue();
  assert.deepEqual(h.runtime.state().cards, { [movie(32).slug]: { phase: "success" } });
  assert.equal(h.reads[0].token, auth.token);
  const guest = harness({ guest: true, catalogue }); await guest.runtime.loadCatalogue();
  assert.deepEqual(guest.runtime.state().cards, {}); assert.equal(guest.reads[0].token, null);
});
test("a catalogue that settles after an account switch cannot restore the former account", async () => {
  let session = auth; const read = deferred();
  const runtime = createNotificationRuntime({ getAuth: () => session, getCatalogue: () => read.promise });
  const task = runtime.loadCatalogue(); session = { ...auth, accountId: 13 }; runtime.syncAuth();
  read.resolve([movie(32, { isNotified: true })]); await assert.rejects(task, { name: "AbortError" });
  assert.deepEqual(runtime.state().cards, {});
});
