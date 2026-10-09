import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefundRuntime, REFUND_WAIT_MS, REFUND_RECONFIRMATION_WARNING } from "../src/tickets/refundRuntime.js";

const order = (extra = {}) => ({ id: 7, reference: "EXACT / R", status: "paid", isUpcoming: true,
  isRefundable: true, totalPrice: 19, session: { id: 10, date: "2000-01-01", time: "19:30",
    movie: { title: "Synthetic Film" }, venue: { name: "Venue" }, hall: { name: "B" },
    format: { name: "2D" }, language: { name: "Georgian" } },
  tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 19 }], ...extra });
const refunded = (extra = {}) => order({ status: "refunded", isUpcoming: false, isRefundable: false, ...extra });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
function harness(t, additionalOrders = []) {
  let auth = { accountId: 12, generation: 1, token: "synthetic-original" }, context = true, time = 0, nextTimer = 0;
  let post = () => response({ message: "Unknown backend outcome" }, 500), read = () => response({ data: [order()] });
  const posts = [], gets = [], timers = new Map(), timerHistory = new Map(), expiry = [], delivered = [], observerErrors = [];
  const refundPaths = new Set([order(), ...additionalOrders].map(value => "/api/orders/" + encodeURIComponent(value.reference) + "/refund"));
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    if (options.method === "POST" && refundPaths.has(target.pathname)) {
      assert.equal(target.search, ""); assert.equal(options.body, undefined); posts.push(options); return post(options);
    }
    if (options.method === "GET" && target.pathname === "/api/tickets") {
      assert.equal(target.search, "", "Recovery GET is unfiltered"); gets.push(options); return read(options);
    }
    throw new Error("Unmocked HTTP forbidden: " + options.method + " " + target.pathname);
  });
  const runtime = createRefundRuntime({ getAuth: () => auth, isContextCurrent: () => context, now: () => time,
    setTimer(callback) { const id = ++nextTimer; timers.set(id, callback); timerHistory.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); }, onObserverError: error => observerErrors.push(error),
    onUnauthorized(expected) {
      assert.equal(expected.accountId, auth.accountId); assert.equal(expected.generation, auth.generation);
      expiry.push(expected); auth = null; runtime.syncAuth(); return true;
    },
  });
  runtime.subscribeOutcome(event => delivered.push(event));
  t.after(() => { time += REFUND_WAIT_MS; runtime.checkDeadline(); assert.equal(timers.size, 0); assert.deepEqual(observerErrors, []); });
  return { runtime, posts, gets, timers, timerHistory, expiry, delivered,
    post(value) { post = value; }, read(value) { read = value; },
    data(value) { read = () => response({ data: value }); },
    authorize(warned = false, value = order()) { return runtime.createConsent(value, { confirmed: true, warningAcknowledged: warned }); },
    start(warned = false) { const consent = this.authorize(warned); assert.ok(consent); return runtime.submit(consent, order()); },
    check() { return runtime.checkStatus(order().reference); },
    record() { return runtime.snapshot().records[0]; },
    authenticate(id = 12, generation = 3) { auth = { accountId: id, generation, token: "synthetic-new-" + generation }; runtime.syncAuth(); },
    leave() { context = false; runtime.leaveContext(); }, return() { context = true; },
    timeout() { time += REFUND_WAIT_MS; runtime.checkDeadline(); },
  };
}

for (const [name, post] of [
  ["network failure", () => { throw new Error("Network lost"); }],
  ["body loss", () => ({ ok: true, status: 200, headers: new Headers(), text: async () => { throw new Error("Body lost"); } })],
  ["HTTP 500", () => response({}, 500)], ["unclassified HTTP 409", () => response({}, 409)],
  ["unclassified HTTP 429", () => response({}, 429)], ["unexpected success status", () => response({ data: refunded() }, 201)],
  ["unusable success", () => response({ data: order() })], ["unreadable JSON", () => new Response("{", { headers: { "content-type": "application/json" } })],
  ["abort ambiguity", () => { throw new DOMException("Aborted", "AbortError"); }],
]) test(name + " preserves uncertainty and requires a new fresh read", async t => {
  const h = harness(t); h.post(post);
  assert.equal((await h.start()).kind, "uncertain");
  assert.equal(h.record().disposition, "settled"); assert.equal(h.record().priorUncertainty, true);
  assert.equal(h.authorize(true), null); assert.equal(h.gets.length, 0);
  assert.equal((await h.check()).kind, "retry_available");
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
});

test("uncertain POST -> fresh paid GET -> new warned consent -> exactly one separately confirmed POST", async t => {
  const h = harness(t); await h.start();
  const firstId = h.record().requestId, before = h.runtime.readGuard();
  assert.equal((await h.check()).kind, "retry_available");
  assert.equal(h.runtime.isReadCurrent(before), false);
  for (let i = 0; i < 4; i++) { h.runtime.syncAuth(); const off = h.runtime.subscribe(() => h.runtime.snapshot()); off(); }
  assert.equal(h.posts.length, 1); assert.equal(h.authorize(), null);
  assert.equal(h.runtime.createConsent(order(), { warningAcknowledged: true }), null);
  const consent = h.authorize(true);
  assert.equal(consent.warning, REFUND_RECONFIRMATION_WARNING); assert.equal(h.posts.length, 1);
  h.post(() => response({ data: refunded() }));
  const next = h.runtime.submit(consent, order()), duplicate = h.runtime.submit(consent, order());
  assert.equal((await duplicate).kind, "blocked"); assert.equal((await next).kind, "succeeded");
  assert.equal(h.posts.length, 2); assert.ok(h.record().requestId > firstId);
  assert.equal(h.record().priorUncertainty, true); assert.equal(h.record().reportedRefunded, true);
  assert.equal(h.authorize(true), null);
  assert.doesNotMatch(JSON.stringify(h.runtime.snapshot()), /synthetic-|token|totalPrice|tickets|movie|promise|callback/);
});

for (const preceding of ["settled", "deadline-retired"]) {
  for (const ending of ["settled", "deadline-retired"]) test("renewed POST clears " + preceding + " metadata until its own " + ending, async t => {
    const h = harness(t), earlier = deferred(), newer = deferred();
    if (preceding === "deadline-retired") {
      h.post(() => earlier.promise);
      const first = h.start(); h.timeout(); await first;
    } else await h.start();
    const previous = h.record();
    assert.equal(previous.disposition, preceding);
    assert.equal(previous.priorUncertainty, true);
    await h.check();
    const consent = h.authorize(true);
    assert.ok(consent);
    assert.equal(consent.warning, REFUND_RECONFIRMATION_WARNING);
    h.post(() => newer.promise);
    const observed = [];
    const off = h.runtime.subscribe(() => {
      if (h.record().phase === "submitting") observed.push({ record: h.record(), busy: h.runtime.hasActivePost() });
    });
    const next = h.runtime.submit(consent, order());
    off();
    assert.ok(observed.length > 0, "Subscribers see accurate pending metadata from the first notification");
    for (const { record, busy } of observed) {
      assert.equal(busy, true);
      assert.equal(record.disposition, null);
      assert.equal(record.settledGeneration, null);
      assert.equal(record.priorUncertainty, true);
      assert.equal(record.accountId, consent.accountId);
      assert.deepEqual(record.identity, consent.identity);
      assert.ok(record.requestId > previous.requestId);
    }
    const requestId = h.record().requestId;
    assert.equal((await h.check()).kind, "blocked");
    assert.equal(h.gets.length, 1, "No verification GET while the renewed POST owns the slot");
    assert.equal((await h.runtime.submit(consent, order())).kind, "blocked");
    assert.equal(h.posts.length, 2);
    if (ending === "deadline-retired") h.timeout();
    else newer.resolve(response({}, 500));
    assert.equal((await next).kind, "uncertain");
    const terminal = h.record();
    assert.equal(terminal.requestId, requestId);
    assert.equal(terminal.disposition, ending);
    assert.ok(Number.isSafeInteger(terminal.settledGeneration));
    assert.ok(terminal.settledGeneration > previous.settledGeneration);
    assert.equal(terminal.settledGeneration, h.runtime.readGuard().generation);
    assert.equal(terminal.priorUncertainty, true);
    assert.equal(h.runtime.hasActivePost(), false);
    assert.equal(h.timers.size, 0);
    if (ending === "deadline-retired") {
      assert.equal(h.posts[1].signal.aborted, true);
      newer.resolve(response({ data: refunded() }));
    }
    if (preceding === "deadline-retired") earlier.resolve(response({ data: refunded() }));
    await flush();
    assert.equal(h.record(), terminal, "Retired callbacks cannot alter this attempt's final metadata");
    assert.equal((await h.check()).kind, "retry_available");
    assert.equal(h.gets.length, 2);
    assert.equal(h.posts.length, 2);
    assert.equal(h.record().priorUncertainty, true);
  });
}

test("paid target recovery requires the whole list to preserve another known refunded fact", async t => {
  const otherPaid = order({ id: 8, reference: "KNOWN / REFUND", session: { ...order().session, id: 11 } });
  const otherRefunded = { ...otherPaid, status: "refunded", isUpcoming: false, isRefundable: false };
  const h = harness(t, [otherPaid]);
  h.post(() => response({ data: otherRefunded }));
  const otherConsent = h.authorize(false, otherPaid);
  assert.ok(otherConsent);
  assert.equal((await h.runtime.submit(otherConsent, otherPaid)).kind, "succeeded");
  const knownFact = h.runtime.snapshot().records.find(record => record.identity.reference === otherPaid.reference);
  assert.equal(knownFact.reportedRefunded, true);
  h.post(() => response({}, 500));
  assert.equal((await h.start()).kind, "uncertain");
  const targetRecord = () => h.runtime.snapshot().records.find(record => record.identity.reference === order().reference);
  const deliveries = h.delivered.length;
  h.data([order(), otherPaid]);
  assert.equal((await h.check()).kind, "inconclusive");
  assert.equal(targetRecord().phase, "uncertain");
  assert.equal(targetRecord().priorUncertainty, true);
  assert.equal(h.authorize(true), null);
  assert.equal((await h.runtime.submit(null, order())).kind, "blocked");
  assert.equal(h.posts.length, 2);
  assert.equal(h.gets.length, 1);
  assert.equal(h.delivered.length, deliveries, "A contradictory list is not adopted");
  assert.equal(h.runtime.snapshot().records.find(record => record.identity.reference === otherPaid.reference), knownFact);
  // The same eligible target may be confirmed only after a coherent fresh list.
  h.data([order(), otherRefunded]);
  assert.equal((await h.check()).kind, "retry_available");
  assert.equal(targetRecord().phase, "retry_available");
  assert.equal(h.posts.length, 2, "A coherent GET still cannot automatically POST");
  assert.equal(h.authorize(), null);
  const renewed = h.authorize(true);
  assert.ok(renewed);
  assert.equal(renewed.warning, REFUND_RECONFIRMATION_WARNING);
  h.post(() => response({ data: refunded() }));
  assert.equal((await h.runtime.submit(renewed, order())).kind, "succeeded");
  assert.equal(h.posts.length, 3);
  assert.equal(targetRecord().priorUncertainty, true);
  assert.equal(h.runtime.snapshot().records.find(record => record.identity.reference === otherPaid.reference), knownFact);
});

test("ordinary pending POST, headers-only and abort callbacks cannot authorize verification before completed retirement", async t => {
  const h = harness(t), body = deferred();
  h.post(() => ({ ok: true, status: 200, headers: new Headers(), text: () => body.promise }));
  const post = h.start(); await flush();
  assert.equal((await h.check()).kind, "blocked"); assert.equal(h.gets.length, 0);
  let reentrant;
  h.posts[0].signal.addEventListener("abort", () => { reentrant = h.check(); });
  h.timeout(); assert.equal((await post).kind, "uncertain");
  assert.equal((await reentrant).kind, "blocked"); assert.equal(h.gets.length, 0);
  assert.equal(h.record().disposition, "deadline-retired"); assert.equal(h.posts[0].signal.aborted, true);
  assert.equal((await h.check()).kind, "retry_available");
  body.resolve(JSON.stringify({ data: refunded() })); await flush();
  assert.equal(h.record().reportedRefunded, false); assert.equal(h.posts.length, 1);
});

for (const [name, data, kind] of [
  ["refunded", [refunded()], "succeeded"], ["partial refunded", [{ reference: order().reference, status: "refunded" }], "succeeded"],
  ["refunded ID contradiction", [refunded({ id: 999 })], "succeeded"],
  ["paid Past", [order({ isUpcoming: false, isRefundable: false })], "ineligible"],
  ["non-refundable", [order({ isRefundable: false })], "ineligible"], ["missing", [], "inconclusive"],
  ["duplicate", [order(), order()], "inconclusive"], ["Order mismatch", [order({ id: 8 })], "inconclusive"],
  ["Session mismatch", [order({ session: { ...order().session, id: 11 } })], "inconclusive"],
  ["contradictory flags", [order({ isUpcoming: false })], "inconclusive"],
  ["unreadable display", [order({ tickets: [] })], "inconclusive"],
]) test("fresh recovery: " + name + " never automatically POSTs", async t => {
  const h = harness(t); await h.start(); h.data(data);
  assert.equal((await h.check()).kind, kind); assert.equal(h.posts.length, 1);
  assert.equal(h.authorize(true), null);
  assert.equal(h.record().reportedRefunded, kind === "succeeded");
  if (name === "refunded") assert.deepEqual(h.delivered.at(-1).orders, data);
  if (["partial refunded", "refunded ID contradiction"].includes(name)) {
    assert.equal(h.record().displayStatus, "refreshing"); assert.equal(h.delivered.length, 0);
  }
});

test("reported refund survives incomplete restoration, contradictory paid data and failed GET; only complete facts become ready", async t => {
  const h = harness(t); await h.start(); h.data([{ reference: order().reference, status: "refunded" }]); await h.check();
  await h.check(); assert.equal(h.record().displayStatus, "error");
  h.data([order()]); await h.check();
  assert.equal(h.record().reportedRefunded, true); assert.equal(h.record().phase, "succeeded"); assert.equal(h.authorize(true), null);
  h.read(() => { throw new Error("Read failed"); }); await h.check();
  assert.equal(h.record().displayStatus, "error"); assert.equal(h.record().reportedRefunded, true);
  h.data([refunded()]); assert.equal((await h.runtime.retryVerification()).kind, "succeeded");
  assert.equal(h.record().displayStatus, "ready"); assert.equal(h.posts.length, 1);
});

test("network read failure exposes explicit GET-only retry without retaining POST consent", async t => {
  const h = harness(t); await h.start(); h.read(() => { throw new Error("Read lost"); });
  assert.equal((await h.check()).kind, "verification_retry");
  assert.equal(h.record().phase, "verification_retry"); assert.equal(h.record().continuation, null);
  assert.equal(h.authorize(true), null); assert.equal(h.posts.length, 1);
  h.data([order()]); assert.equal((await h.runtime.retryVerification()).kind, "retry_available");
  assert.equal(h.gets.length, 2); assert.equal(h.posts.length, 1);
});

test("read 401 gets one same-account Login/GET continuation and never POSTs on authentication", async t => {
  const h = harness(t); await h.start(); h.read(() => response({}, 401)); await h.check();
  const requestId = h.runtime.authSnapshot().requestId;
  assert.equal(h.runtime.authSnapshot().loginRequired, true); assert.equal(h.expiry.length, 1);
  h.authenticate(); assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 1);
  h.data([order()]);
  assert.equal((await h.runtime.authenticationSucceeded(requestId)).kind, "retry_available");
  assert.equal(h.gets.length, 2); assert.equal(h.posts.length, 1);
  assert.equal(h.gets.at(-1).headers.get("Authorization"), "Bearer synthetic-new-3");
  assert.equal((await h.runtime.authenticationSucceeded(requestId)).kind, "blocked");
  assert.equal(h.authorize(), null); assert.ok(h.authorize(true));
});

test("second read 401 exhausts the read-auth budget without a Login loop or resetting the POST budget", async t => {
  const h = harness(t); await h.start(); h.read(() => response({}, 401)); await h.check();
  const requestId = h.runtime.authSnapshot().requestId; h.authenticate();
  assert.equal((await h.runtime.authenticationSucceeded(requestId)).kind, "blocked");
  assert.equal(h.expiry.length, 2); assert.equal(h.runtime.authSnapshot().loginRequired, false);
  assert.equal(h.runtime.authSnapshot().suppressProfileGate, true);
  h.authenticate(12, 5); await h.runtime.authenticationSucceeded(requestId); await h.runtime.retryVerification();
  assert.equal(h.gets.length, 2); assert.equal(h.posts.length, 1); assert.equal(h.record().phase, "blocked");
});

for (const action of ["different account", "logout", "navigation", "auth replacement", "cancel"]) {
  for (const result of ["paid", "401"]) test(action + " fences stale recovery " + result, async t => {
    const h = harness(t), pending = deferred(); await h.start(); h.read(() => pending.promise);
    const verification = h.check(); await flush();
    if (action === "different account") h.authenticate(99);
    if (action === "logout") h.runtime.logout();
    if (action === "navigation") { h.leave(); h.return(); }
    if (action === "auth replacement") h.authenticate(12, 4);
    if (action === "cancel") h.runtime.cancelIntent();
    assert.equal(h.gets[0].signal.aborted, true);
    pending.resolve(result === "401" ? response({}, 401) : response({ data: [order()] }));
    assert.equal((await verification).kind, "stale"); assert.equal(h.expiry.length, 0); assert.equal(h.posts.length, 1);
    if (action === "different account" || action === "logout") assert.deepEqual(h.runtime.snapshot().records, []);
    else assert.equal(h.authorize(true), null);
  });
}

for (const action of ["different account", "logout", "navigation", "cancel"]) test(action + " cancels read-only Login permission", async t => {
  const h = harness(t); await h.start(); h.read(() => response({}, 401)); await h.check();
  const requestId = h.runtime.authSnapshot().requestId;
  if (action === "different account") h.authenticate(99);
  if (action === "logout") h.runtime.logout();
  if (action === "navigation") { h.leave(); h.return(); }
  if (action === "cancel") h.runtime.cancelIntent();
  h.authenticate(12, 5); h.data([order()]); await h.runtime.authenticationSucceeded(requestId);
  assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 1); assert.equal(h.authorize(true), null);
});

for (const action of ["new Tickets read", "new verification", "auth replacement", "navigation"]) test(action + " invalidates renewed consent before dispatch", async t => {
  const h = harness(t); await h.start(); await h.check(); const consent = h.authorize(true);
  assert.ok(consent);
  if (action === "new Tickets read") h.runtime.invalidateEligibility();
  if (action === "new verification") await h.check();
  if (action === "auth replacement") h.authenticate();
  if (action === "navigation") { h.leave(); h.return(); }
  assert.equal((await h.runtime.submit(consent, order())).kind, "blocked"); assert.equal(h.posts.length, 1);
  assert.equal(h.record().priorUncertainty, true);
});

test("renewed cancellation, reentrant invalidation and a new refusal retain old uncertainty", async t => {
  const h = harness(t); await h.start(); await h.check(); h.authorize(true); h.runtime.cancelIntent();
  assert.equal(h.record().phase, "retry_available"); assert.equal(h.record().priorUncertainty, true);
  let once = false;
  const off = h.runtime.subscribe(() => { if (h.runtime.hasActivePost() && !once) { once = true; h.runtime.invalidateEligibility(); } });
  assert.equal((await h.start(true)).kind, "blocked"); off();
  assert.equal(h.record().priorUncertainty, true); assert.equal(h.posts.length, 1);
  await h.check(); h.post(() => response({ message: "Actual refusal, not parsed" }, 422));
  assert.equal((await h.start(true)).kind, "rejected");
  assert.equal(h.record().message, "Actual refusal, not parsed"); assert.equal(h.record().priorUncertainty, true);
  assert.equal(h.authorize(true), null); await h.check(); assert.equal(h.authorize(), null); assert.ok(h.authorize(true));
});

for (const late of [200, 401, 422, 500, "rejection"]) test("retired earlier backend work and late " + late + " cannot affect a renewed owner", async t => {
  const h = harness(t), earlier = deferred(), newer = deferred(); h.post(() => earlier.promise);
  const first = h.start(); h.timeout(); await first; await h.check();
  h.post(() => newer.promise); const second = h.start(true), ownerId = h.record().requestId;
  if (late === "rejection") earlier.reject(new Error("Late transport rejection"));
  else earlier.resolve(response(late === 200 ? { data: refunded() } : {}, late));
  await flush();
  assert.equal(h.runtime.hasActivePost(), true); assert.equal(h.record().requestId, ownerId);
  assert.equal(h.record().phase, "submitting"); assert.equal(h.record().priorUncertainty, true);
  assert.equal(h.expiry.length, 0); assert.equal(h.posts.length, 2);
  newer.resolve(response({}, 500)); await second;
  assert.equal(h.record().priorUncertainty, true); assert.equal(h.record().reportedRefunded, false);
  await h.check(); assert.ok(h.authorize(true));
});

test("verification owns its read before reentrant callbacks and never duplicates GET or POST", async t => {
  const h = harness(t), pending = deferred(); await h.start(); h.read(() => pending.promise);
  const repeats = [];
  const off = h.runtime.subscribe(() => { if (h.runtime.isRecovering()) repeats.push(h.check()); });
  const first = h.check(); await flush(); assert.equal(h.gets.length, 1);
  pending.resolve(response({ data: [order()] })); await first; off();
  for (const result of repeats) assert.equal((await result).kind, "blocked");
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
});

for (const status of [403, 404, 422]) test("definite " + status + " refusal requires fresh authority but no invented uncertainty", async t => {
  const h = harness(t); h.post(() => response({ message: "Exact refusal" }, status)); await h.start();
  assert.equal(h.record().phase, "rejected"); assert.equal(h.record().priorUncertainty, false); assert.equal(h.authorize(), null);
  await h.check(); assert.equal(h.record().phase, "idle"); assert.ok(h.authorize()); assert.equal(h.posts.length, 1);
});
