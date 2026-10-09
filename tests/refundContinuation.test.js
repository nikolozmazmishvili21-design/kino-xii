import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefundRuntime, REFUND_WAIT_MS } from "../src/tickets/refundRuntime.js";

const order = (extra = {}) => ({ id: 7, reference: "EXACT / R", status: "paid", isUpcoming: true,
  isRefundable: true, totalPrice: 19, session: { id: 10, date: "2000-01-01", time: "19:30",
    movie: { title: "Synthetic Film" }, venue: { name: "Venue" }, hall: { name: "B" },
    format: { name: "2D" }, language: { name: "Georgian" } },
  tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 19 }], ...extra });
const refunded = () => order({ status: "refunded", isUpcoming: false, isRefundable: false });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(t, { first = 401, second = 200, data = [order()], getStatus = 200, pauseGet = false, pausePost = false, pauseReplay = false } = {}) {
  let auth = { accountId: 12, generation: 1, token: "synthetic-original" }, context = true, time = 0;
  let nextGetStatus = getStatus, nextData = data;
  const gets = [], posts = [], expiry = [], timers = new Map(), readDeferred = deferred(), postDeferred = deferred();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname, query = new URL(url).search;
    if (options.method === "POST" && path === "/api/orders/EXACT%20%2F%20R/refund") {
      posts.push(options);
      assert.equal(options.body, undefined);
      if ((pausePost && posts.length === 1) || (pauseReplay && posts.length === 2)) return postDeferred.promise;
      const status = posts.length === 1 ? first : second;
      return response(status === 200 ? { data: refunded() } : { message: "Synthetic rejection" }, status);
    }
    if (options.method === "GET" && path === "/api/tickets") {
      assert.equal(query, ""); gets.push(options);
      if (pauseGet) return readDeferred.promise;
      return response(nextGetStatus === 200 ? { data: nextData } : { message: "Read error" }, nextGetStatus);
    }
    throw new Error("Unmocked HTTP is forbidden: " + options.method + " " + path);
  });
  const runtime = createRefundRuntime({ getAuth: () => auth, isContextCurrent: () => context, now: () => time,
    setTimer: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimer: (id) => timers.delete(id),
    onUnauthorized(expected) {
      assert.equal(expected.accountId, auth.accountId); assert.equal(expected.generation, auth.generation);
      expiry.push(expected); auth = null; runtime.syncAuth(); return true;
    },
  });
  return { runtime, posts, gets, expiry, timers, readDeferred, postDeferred,
    start() { const consent = runtime.createConsent(order(), { confirmed: true }); return runtime.submit(consent, order()); },
    authenticate(id = 12, generation = 3) { auth = { accountId: id, generation, token: "synthetic-new-" + generation }; runtime.syncAuth(); },
    complete(id = 1) { return runtime.authenticationSucceeded(id); },
    setRead(value, status = 200) { nextData = value; nextGetStatus = status; },
    leave() { context = false; runtime.leaveContext(); },
    return() { context = true; },
    timeout() { time += REFUND_WAIT_MS; runtime.checkDeadline(); },
  };
}

test("definite 401 expires guarded auth and waits for explicit success; same account uses new credentials and replays once", async t => {
  const h = harness(t);
  assert.equal((await h.start()).kind, "unauthenticated");
  assert.deepEqual(h.expiry, [{ accountId: 12, generation: 1 }]);
  assert.equal(h.runtime.authSnapshot().loginRequired, true);
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 0);
  h.authenticate();
  for (let i = 0; i < 10; i++) { h.runtime.syncAuth(); const off = h.runtime.subscribe(() => h.runtime.snapshot()); off(); }
  assert.equal(h.gets.length, 0); assert.equal(h.posts.length, 1);
  assert.equal((await h.complete()).kind, "succeeded");
  assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 2);
  assert.equal(h.gets[0].headers.get("Authorization"), "Bearer synthetic-new-3");
  assert.equal(h.posts[1].headers.get("Authorization"), "Bearer synthetic-new-3");
  assert.notEqual(h.posts[0].signal, h.posts[1].signal);
  assert.equal(h.runtime.snapshot().records[0].replayCount, 1);
  assert.equal((await h.complete()).kind, "blocked");
  assert.equal(h.posts.length, 2); assert.equal(h.expiry.length, 1);
  assert.doesNotMatch(JSON.stringify(h.runtime.snapshot()), /synthetic-|token|movie|tickets|totalPrice/);
});

test("second POST 401 terminates consent, guarded auth, and automatic Profile/Login recovery", async t => {
  const h = harness(t, { second: 401 }); await h.start(); h.authenticate();
  assert.equal((await h.complete()).kind, "unauthenticated");
  assert.equal(h.posts.length, 2); assert.equal(h.expiry.length, 2);
  assert.deepEqual(h.runtime.authSnapshot(), { loginRequired: false, suppressProfileGate: true, requestId: null });
  h.authenticate(12, 5); assert.equal(h.runtime.snapshot().phase, "blocked");
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
  await h.complete(); await h.runtime.retryVerification();
  assert.equal(h.posts.length, 2); assert.equal(h.gets.length, 1);
});

for (const [name, data] of [
  ["already refunded", [refunded()]], ["paid Past", [order({ isUpcoming: false, isRefundable: false })]],
  ["non-refundable", [order({ isRefundable: false })]], ["missing", []], ["duplicate", [order(), order()]],
  ["Order ID mismatch", [order({ id: 8 })]], ["session ID mismatch", [order({ session: { ...order().session, id: 11 } })]],
  ["missing captured ID", [order({ id: undefined })]], ["missing flags", [order({ isRefundable: undefined })]],
  ["incomplete display", [order({ tickets: [] })]], ["malformed Order", [null]], ["malformed envelope", null],
  ["contradictory flags", [order({ status: "refunded" })]],
]) test("fresh verification " + name + " cannot replay", async t => {
  const h = harness(t, { data }); await h.start(); h.authenticate(); await h.complete();
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
  assert.equal(h.runtime.snapshot().phase, name === "already refunded" || name === "contradictory flags" ? "succeeded" : "blocked");
});

test("verification 500 retains unused consent for explicit GET retry only", async t => {
  const h = harness(t, { getStatus: 500 }); await h.start(); h.authenticate();
  assert.equal((await h.complete()).kind, "verification_retry");
  assert.equal(h.runtime.snapshot().records[0].continuation.replayCount, 0);
  h.runtime.syncAuth(); await h.complete(); assert.equal(h.gets.length, 1);
  h.setRead([order()]);
  assert.equal((await h.runtime.retryVerification()).kind, "succeeded");
  assert.equal(h.gets.length, 2); assert.equal(h.posts.length, 2);
});

test("verification 401 blocks and expires only its new auth without another Login cycle", async t => {
  const h = harness(t, { getStatus: 401 }); await h.start(); h.authenticate(); await h.complete();
  assert.equal(h.posts.length, 1); assert.equal(h.expiry.length, 2);
  assert.equal(h.runtime.authSnapshot().loginRequired, false);
  assert.equal(h.runtime.authSnapshot().suppressProfileGate, true);
  h.authenticate(12, 5); await h.complete(); await h.runtime.retryVerification();
  assert.equal(h.gets.length, 1); assert.equal(h.runtime.snapshot().phase, "blocked");
});

for (const cancel of ["different account", "logout", "dismiss", "navigation"]) test(cancel + " revokes retained 401 permission", async t => {
  const h = harness(t); await h.start();
  if (cancel === "different account") h.authenticate(99);
  if (cancel === "logout") h.runtime.logout();
  if (cancel === "dismiss") h.runtime.cancelIntent();
  if (cancel === "navigation") { h.leave(); h.return(); }
  h.authenticate(); await h.complete(); await h.runtime.retryVerification();
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 0);
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
});

for (const cancel of ["different account", "new same-account generation", "logout", "dismiss", "navigation"]) test(cancel + " during verification fences non-aborting old GET", async t => {
  const h = harness(t, { pauseGet: true }); await h.start(); h.authenticate(); const completion = h.complete();
  await flush(); assert.equal(h.gets.length, 1);
  if (cancel === "different account") h.authenticate(99, 4);
  if (cancel === "new same-account generation") h.authenticate(12, 4);
  if (cancel === "logout") h.runtime.logout();
  if (cancel === "dismiss") h.runtime.cancelIntent();
  if (cancel === "navigation") { h.leave(); h.return(); }
  h.readDeferred.resolve(response({ data: [order()] })); await completion;
  assert.equal(h.posts.length, 1); assert.equal(h.expiry.length, 1);
});

test("reentrant replay observers see consumed budget and cannot double-dispatch or restart auth", async t => {
  const h = harness(t); await h.start(); h.authenticate();
  const attempts = [];
  const off = h.runtime.subscribe(() => {
    if (h.runtime.snapshot().phase === "submitting") {
      assert.equal(h.runtime.snapshot().records[0].replayCount, 1);
      assert.equal(h.runtime.snapshot().records[0].continuation, null);
      attempts.push(h.complete(), h.runtime.retryVerification());
    }
  });
  await Promise.all([h.complete(), h.complete(), h.complete()]); off(); await Promise.all(attempts);
  assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 2);
});

for (const cancel of ["dismiss", "navigation", "account"]) test("replay pre-dispatch observer " + cancel + " prevents the second POST", async t => {
  const h = harness(t); await h.start(); h.authenticate();
  const off = h.runtime.subscribe(() => {
    if (h.runtime.snapshot().phase !== "submitting") return;
    if (cancel === "dismiss") h.runtime.cancelIntent();
    if (cancel === "navigation") h.leave();
    if (cancel === "account") h.authenticate(99, 4);
  });
  await h.complete(); off(); assert.equal(h.posts.length, 1); assert.equal(h.runtime.hasActivePost(), false);
});

test("old successful auth callback cannot use a newer continuation's prior request identity", async t => {
  const h = harness(t); await h.start(); h.runtime.cancelIntent(); h.authenticate();
  h.setRead([order()]); await h.complete(999); await h.complete(1);
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 0);
});

for (const first of [500, 200]) test("ambiguous " + first + " outcome never gains automatic auth replay", async t => {
  const h = harness(t, { first });
  if (first === 200) t.mock.method(globalThis, "fetch", async () => response({ data: { reference: "WRONG", status: "refunded" } }));
  await h.start(); h.authenticate(); await h.complete();
  assert.equal(h.expiry.length, 0); assert.equal(h.gets.length, 0);
  assert.equal(h.runtime.snapshot().phase, "uncertain");
});

test("deadline retirement fences late definite 401 and never preserves continuation", async t => {
  const h = harness(t, { pausePost: true }); const completion = h.start();
  h.timeout(); assert.equal((await completion).kind, "uncertain");
  h.postDeferred.resolve(response({ message: "Expired" }, 401)); await flush();
  h.authenticate(); await h.complete();
  assert.equal(h.expiry.length, 0); assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 0);
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
});


test("stale definite 401 from account A cannot expire account B or present Login", async t => {
  const h = harness(t, { pausePost: true }); const completion = h.start();
  h.authenticate(99, 2);
  h.postDeferred.resolve(response({ message: "Expired A" }, 401)); await completion;
  assert.equal(h.expiry.length, 0); assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 0);
  assert.deepEqual(h.runtime.snapshot().records, []);
  assert.equal(h.runtime.authSnapshot().loginRequired, false);
});

test("old successful auth callback is bound to the prior request and cannot consume a newer Order intent", async () => {
  let auth = { accountId: 12, generation: 1, token: "synthetic-one" };
  const runtime = createRefundRuntime({ getAuth: () => auth, post: async () => { throw { status: 401 }; },
    onUnauthorized: () => { auth = null; runtime.syncAuth(); return true; }, read: async () => { throw Error("Wrong prior request must never read"); } });
  const original = order(), newer = order({ reference: "NEWER" });
  await runtime.submit(runtime.createConsent(original, { confirmed: true }), original);
  runtime.cancelIntent(); auth = { accountId: 12, generation: 3, token: "synthetic-two" }; runtime.syncAuth();
  await runtime.submit(runtime.createConsent(newer, { confirmed: true }), newer);
  auth = { accountId: 12, generation: 5, token: "synthetic-three" }; runtime.syncAuth();
  assert.equal((await runtime.authenticationSucceeded(1)).kind, "blocked");
  assert.equal(runtime.snapshot().records.at(-1).continuation.requestId, 2);
  runtime.cancelIntent();
});

for (const late of [200, 401]) test("replay deadline retires its new attempt and fences late " + late + " without restoring auth consent", async t => {
  const h = harness(t, { pauseReplay: true }); await h.start(); h.authenticate();
  const completion = h.complete(); await flush(); assert.equal(h.posts.length, 2);
  h.timeout(); assert.equal((await completion).kind, "uncertain");
  h.postDeferred.resolve(response(late === 200 ? { data: refunded() } : { message: "Expired" }, late)); await flush();
  assert.equal(h.expiry.length, 1); assert.equal(h.runtime.snapshot().phase, "uncertain");
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
  assert.equal(h.runtime.snapshot().records[0].reportedRefunded, false);
  assert.equal(h.runtime.snapshot().records[0].replayCount, 1);
});

test("transient network verification requires explicit GET retry and cancellation erases that consent", async t => {
  const h = harness(t, { pauseGet: true }); await h.start(); h.authenticate(); const completion = h.complete();
  h.readDeferred.reject(new TypeError("Synthetic disconnected read"));
  assert.equal((await completion).kind, "verification_retry");
  h.runtime.cancelIntent(); await h.runtime.retryVerification();
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
});

test("explicit sign-in after exhaustion removes only auth presentation suppression and never restores old consent", async t => {
  const h = harness(t, { second: 401 }); await h.start(); h.authenticate(); await h.complete();
  assert.equal(h.runtime.authSnapshot().suppressProfileGate, true);
  h.runtime.beginExplicitAuthentication(); h.authenticate(12, 5); await h.complete();
  assert.equal(h.runtime.authSnapshot().suppressProfileGate, false);
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
  assert.equal(h.posts.length, 2); assert.equal(h.gets.length, 1);
});


for (const data of [ { reference: "EXACT / R", status: "refunded" }, { ...refunded(), id: 999 } ]) {
  test("fresh " + (data.id === 999 ? "contradictory" : "partial") + " refunded reference retains outcome separately from card adoption", async t => {
    const h = harness(t, { data: [data] }); await h.start(); h.authenticate(); await h.complete();
    const record = h.runtime.snapshot().records[0];
    assert.equal(record.phase, "succeeded"); assert.equal(record.reportedRefunded, true);
    assert.equal(record.displayStatus, "refreshing"); assert.equal(record.continuation, null);
    assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
  });
}

for (const failure of ["reauth", "replay", "verification"]) test("N3: account B does not inherit A auth suppression after " + failure, async t => {
  const h = harness(t, { second: failure === "replay" ? 401 : 200, getStatus: failure === "verification" ? 401 : 200 });
  await h.start();
  if (failure !== "reauth") { h.authenticate(); await h.complete(); }
  assert.equal(h.runtime.authSnapshot().suppressProfileGate, true);
  if (failure !== "reauth") {
    h.authenticate(12, 5);
    assert.equal(h.runtime.authSnapshot().suppressProfileGate, true);
    await h.complete(); await h.runtime.retryVerification();
  }
  const posts = h.posts.length, gets = h.gets.length;
  h.authenticate(99, 7);
  assert.deepEqual(h.runtime.authSnapshot(), { loginRequired: false, suppressProfileGate: false, requestId: null });
  assert.deepEqual(h.runtime.snapshot().records, []);
  await h.complete(); await h.runtime.retryVerification();
  assert.equal(h.posts.length, posts); assert.equal(h.gets.length, gets);
  h.runtime.logout(); h.runtime.syncAuth();
  assert.equal(h.runtime.authSnapshot().suppressProfileGate, false);
  h.authenticate(12, 9);
  assert.equal(h.runtime.snapshot().records[0].continuation, null);
  await h.complete(); await h.runtime.retryVerification();
  assert.equal(h.posts.length, posts); assert.equal(h.gets.length, gets);
});

test("N3: account switch clears suppression before reentrant subscribers inspect the new account", async t => {
  const h = harness(t); await h.start();
  const gates = [];
  const off = h.runtime.subscribe(() => gates.push(h.runtime.authSnapshot().suppressProfileGate));
  h.authenticate(99);
  off();
  assert.ok(gates.length);
  assert.ok(gates.every(value => value === false));
});
