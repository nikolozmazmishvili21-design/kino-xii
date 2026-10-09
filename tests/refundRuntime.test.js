import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRefundRuntime, REFUND_WAIT_MS } from "../src/tickets/refundRuntime.js";
import { refundOrder } from "../src/api/ticketsApi.js";

beforeEach((t) => t.mock.method(globalThis, "fetch", async () => {
  throw new Error("Unexpected transport: all Refund HTTP must be mocked.");
}));
const order = (reference = "SYNTHETIC-R") => ({ id: 7, reference, status: "paid",
  isUpcoming: true, isRefundable: true, totalPrice: 19,
  session: { id: 10, date: "2000-01-01", time: "19:30", movie: { title: "Synthetic film" },
    venue: { name: "Venue" }, hall: { name: "Hall" }, format: { name: "2D" }, language: { name: "Georgian" } },
  tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 19 }] });
const success = (reference = "SYNTHETIC-R", partial = false) => ({ status: 200,
  data: { data: partial ? { reference, status: "refunded" }
    : { ...order(reference), status: "refunded", isUpcoming: false, isRefundable: false } } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function harness(initialPost) {
  let auth = { accountId: 12, generation: 1, token: "synthetic-auth-A" }, time = 0;
  let nextTimer = 0, context = true, post = initialPost ?? (() => new Promise(() => {}));
  const activeTimers = new Map(), timerHistory = new Map(), requests = [], observerErrors = [];
  const runtime = createRefundRuntime({
    getAuth: () => auth, now: () => time, isContextCurrent: () => context,
    post(reference, options) { requests.push({ reference, ...options }); return post(reference, options); },
    setTimer(callback, delay) {
      const id = ++nextTimer, timer = { callback, delay };
      activeTimers.set(id, timer); timerHistory.set(id, timer);
      return id;
    },
    clearTimer: (id) => activeTimers.delete(id),
    onObserverError: (error) => observerErrors.push(error),
  });
  return { runtime, requests, activeTimers, timerHistory, observerErrors,
    setPost: (value) => { post = value; }, setTime: (value) => { time = value; },
    setContext: (value) => { context = value; },
    switch(accountId, generation = (auth?.generation ?? 1) + 1) {
      auth = accountId === null ? null : { accountId, generation, token: "synthetic-auth-" + accountId };
      runtime.syncAuth();
    },
    fire(id) { activeTimers.delete(id); timerHistory.get(id).callback(); },
    authorize(value = order()) { return runtime.createConsent(value, { confirmed: true }); },
    start(value = order()) {
      const consent = runtime.createConsent(value, { confirmed: true });
      assert.ok(consent, "fixture needs an eligible fresh explicit intent");
      return runtime.submit(consent, value);
    },
    records() { return runtime.snapshot().records; },
  };
}
function privateSafe(h) {
  assert.doesNotMatch(JSON.stringify(h.runtime.snapshot()),
    /synthetic-auth-|token|totalPrice|tickets|movie|contact|cardLastFour|callback|promise/);
}

test("explicit eligible consent and one synchronous slot block double-click-equivalent submits", async () => {
  const done = deferred(), h = harness(() => done.promise), value = order();
  assert.equal(h.runtime.createConsent(value), null);
  const consent = h.authorize(value);
  assert.equal(h.runtime.snapshot().phase, "confirming");
  const first = h.runtime.submit(consent, value);
  assert.equal(h.runtime.hasActivePost(), true);
  assert.equal(h.runtime.snapshot().phase, "submitting");
  assert.equal((await h.runtime.submit(consent, value)).kind, "blocked");
  assert.equal(h.authorize(order("OTHER")), null);
  assert.equal(h.requests.length, 1);
  done.resolve(success());
  assert.equal((await first).kind, "succeeded");
  assert.equal(h.runtime.hasActivePost(), false);
  assert.equal(h.records()[0].reportedRefunded, true);
  assert.equal(h.records()[0].displayStatus, "ready");
  assert.equal(h.activeTimers.size, 0);
  assert.equal(h.authorize(value), null); // Known success cannot be re-enabled by stale paid data.
  privateSafe(h);
});

test("reentrant subscriber and transport factory cannot duplicate the dispatch", async () => {
  const done = deferred(), h = harness(), value = order(), consent = h.authorize(value);
  const repeats = [];
  h.runtime.subscribe(() => {
    if (h.runtime.hasActivePost()) repeats.push(h.runtime.submit(consent, value));
  });
  h.setPost(() => { repeats.push(h.runtime.submit(consent, value)); return done.promise; });
  const result = h.runtime.submit(consent, value);
  assert.equal(h.requests.length, 1);
  for (const repeat of repeats) assert.equal((await repeat).kind, "blocked");
  done.resolve(success());
  assert.equal((await result).kind, "succeeded");
});

for (const change of ["cancel", "account", "context", "eligibility"]) {
  test("subscriber " + change + " before dispatch prevents transport without leaking the provisional slot", async () => {
    const h = harness(), value = order(), consent = h.authorize(value);
    const unsubscribe = h.runtime.subscribe(() => {
      if (!h.runtime.hasActivePost()) return;
      if (change === "cancel") h.runtime.cancelIntent();
      if (change === "account") h.switch(99);
      if (change === "context") h.setContext(false);
      if (change === "eligibility") value.isRefundable = false;
    });
    assert.equal((await h.runtime.submit(consent, value)).kind, "blocked");
    unsubscribe();
    assert.equal(h.requests.length, 0);
    assert.equal(h.runtime.hasActivePost(), false);
    assert.equal(h.activeTimers.size, 0);
    assert.deepEqual(h.records(), []);
  });
}

test("subscriber exceptions do not leak a lock or create unhandled operation rejection", async () => {
  const h = harness(() => success()), value = order(), consent = h.authorize(value);
  h.runtime.subscribe(() => { throw new Error("Synthetic observer error"); });
  assert.equal((await h.runtime.submit(consent, value)).kind, "succeeded");
  assert.ok(h.observerErrors.length > 0);
  assert.equal(h.runtime.hasActivePost(), false);
});

test("two accounts share one slot; A completion cannot populate B or obsolete B's read guard", async () => {
  const done = deferred(), h = harness(() => done.promise), first = h.start();
  h.switch(99);
  const bRead = h.runtime.readGuard();
  assert.equal(h.authorize(order("B-ORDER")), null);
  assert.deepEqual(h.records(), []);
  done.resolve(success());
  assert.equal((await first).kind, "stale");
  assert.deepEqual(h.records(), []);
  assert.equal(h.runtime.isReadCurrent(bRead), true);
  assert.equal(h.runtime.snapshot().phase, "idle");
  assert.equal(h.runtime.hasActivePost(), false);
  const second = h.start(order("B-ORDER"));
  h.setTime(REFUND_WAIT_MS);
  h.runtime.checkDeadline();
  assert.equal((await second).kind, "uncertain");
  privateSafe(h);
});

test("A deadline preserves B's active Tickets read generation without cross-account exposure", async () => {
  const h = harness(), first = h.start(), aRead = h.runtime.readGuard();
  h.switch(99);
  const bRead = h.runtime.readGuard();
  h.setTime(REFUND_WAIT_MS); h.fire(1);
  assert.equal((await first).kind, "stale");
  assert.equal(h.runtime.isReadCurrent(bRead), true);
  assert.equal(h.runtime.isReadCurrent(aRead), false);
  assert.deepEqual(h.records(), []);
  h.switch(12, 3);
  assert.equal(h.records()[0].phase, "uncertain");
  assert.equal(h.records()[0].priorUncertainty, true);
  assert.equal(h.records()[0].disposition, "deadline-retired");
  assert.equal(h.authorize(order()), null); // Factual verification integration is deferred.
});

test("deadline before headers retires never-settling Fetch without awaiting abort", async (t) => {
  const transport = deferred();
  t.mock.method(globalThis, "fetch", () => transport.promise);
  const h = harness(refundOrder), result = h.start();
  const signal = h.requests[0].signal;
  h.setTime(REFUND_WAIT_MS); h.fire(1);
  assert.equal((await result).kind, "uncertain");
  assert.equal(signal.aborted, true);
  assert.equal(h.runtime.hasActivePost(), false);
  assert.equal(h.records()[0].reason, "deadline");
  transport.resolve(new Response(JSON.stringify(success().data), {
    headers: { "Content-Type": "application/json" },
  }));
  await flush();
  assert.equal(h.records()[0].phase, "uncertain");
  assert.equal(h.requests.length, 1);
});

test("deadline includes pending response.text() after headers", async (t) => {
  const body = deferred();
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200, ok: true, headers: new Headers({ "Content-Type": "application/json" }),
    text: () => body.promise,
  }));
  const h = harness(refundOrder), result = h.start();
  await flush();
  assert.equal(h.runtime.snapshot().phase, "submitting");
  h.setTime(REFUND_WAIT_MS); h.fire(1);
  assert.equal((await result).kind, "uncertain");
  body.resolve(JSON.stringify(success().data));
  await flush();
  assert.equal(h.records()[0].reportedRefunded, false);
});

test("abort rejection and abort-listener reentry are fenced before owner-only release", async () => {
  const transport = deferred(), h = harness(), attempts = [];
  h.setPost((reference, { signal }) => {
    signal.addEventListener("abort", () => {
      assert.equal(h.runtime.hasActivePost(), true);
      attempts.push(h.runtime.submit(null, order("REENTRANT")));
      assert.equal(h.authorize(order("REENTRANT")), null);
      h.runtime.checkDeadline(); // Terminal guard prevents recursive retirement.
      transport.reject(new DOMException("Synthetic abort", "AbortError"));
    });
    return transport.promise;
  });
  const result = h.start();
  h.setTime(REFUND_WAIT_MS); h.fire(1);
  assert.equal((await result).kind, "uncertain");
  assert.equal((await attempts[0]).kind, "blocked");
  await flush();
  assert.equal(h.records()[0].disposition, "deadline-retired");
  assert.equal(h.requests.length, 1);
  assert.equal(h.observerErrors.length, 0);
});

for (const late of ["200", "401", "422", "500", "rejection", "body-loss"]) {
  test("late " + late + " after retirement cannot change outcome, continuation, or a newer lock", async () => {
    const old = deferred(), newer = deferred(), h = harness(() => old.promise);
    const first = h.start();
    h.setTime(REFUND_WAIT_MS); h.fire(1);
    await first;
    h.setPost(() => newer.promise);
    const second = h.start(order("NEW"));
    const saved = h.runtime.snapshot();
    if (late === "200") old.resolve(success());
    else old.reject(late === "rejection" || late === "body-loss"
      ? new TypeError("Synthetic late loss") : { status: Number(late), data: { message: "Late server message" } });
    await flush();
    assert.deepEqual(h.runtime.snapshot(), saved);
    assert.equal(h.runtime.hasActivePost(), true);
    assert.equal(h.records()[0].phase, "uncertain");
    assert.equal(h.records()[0].continuation, null);
    newer.resolve(success("NEW"));
    assert.equal((await second).kind, "succeeded");
    assert.equal(h.records()[0].priorUncertainty, true);
    assert.equal(h.requests.length, 2);
  });
}

test("an old queued timer cannot release or abort a newer attempt", async () => {
  const old = deferred(), newer = deferred(), h = harness(() => old.promise);
  const first = h.start();
  h.setTime(REFUND_WAIT_MS); h.fire(1); await first;
  h.setPost(() => newer.promise);
  const second = h.start(order("NEW"));
  h.setTime(REFUND_WAIT_MS + 1000); h.fire(1);
  assert.equal(h.runtime.hasActivePost(), true);
  assert.equal(h.requests[1].signal.aborted, false);
  assert.equal(h.activeTimers.size, 1);
  newer.resolve(success("NEW")); await second;
});

test("early timer reschedules remaining monotonic budget without changing the deadline", async () => {
  const h = harness(), result = h.start();
  h.setTime(100); h.fire(1);
  assert.equal(h.timerHistory.get(2).delay, REFUND_WAIT_MS - 100);
  assert.equal(h.runtime.hasActivePost(), true);
  h.setTime(REFUND_WAIT_MS - 1); h.fire(2);
  assert.equal(h.timerHistory.get(3).delay, 1);
  h.setTime(REFUND_WAIT_MS); h.fire(3);
  assert.equal((await result).kind, "uncertain");
  assert.equal(h.requests.length, 1);
});

test("paused monotonic time during sleep causes only remaining-budget scheduling", async () => {
  const h = harness(), result = h.start();
  h.fire(1); // Timer woke but the injected elapsed clock did not advance.
  assert.equal(h.timerHistory.get(2).delay, REFUND_WAIT_MS);
  assert.equal(h.activeTimers.size, 1);
  assert.equal(h.runtime.hasActivePost(), true);
  h.setTime(REFUND_WAIT_MS); h.fire(2); await result;
});

test("wall-clock jumps have no effect on the monotonic deadline", async (t) => {
  const h = harness(), result = h.start();
  t.mock.method(Date, "now", () => Number.MAX_SAFE_INTEGER);
  h.setTime(1000); h.runtime.checkDeadline();
  assert.equal(h.runtime.hasActivePost(), true);
  t.mock.method(Date, "now", () => -Number.MAX_SAFE_INTEGER);
  h.setTime(REFUND_WAIT_MS); h.runtime.checkDeadline();
  assert.equal((await result).kind, "uncertain");
});

test("delayed timer cannot admit an overdue response or a new dispatch", async () => {
  const transport = deferred(), h = harness(() => transport.promise), result = h.start();
  h.setTime(REFUND_WAIT_MS + 5000);
  transport.resolve(success());
  await flush();
  assert.equal((await result).kind, "uncertain");
  assert.equal(h.records()[0].reportedRefunded, false);
  assert.equal(h.requests.length, 1);
  h.fire(1);
  assert.equal(h.records()[0].reason, "deadline");
});

test("a new-dispatch path processes an overdue owner before assessing new consent", async () => {
  const h = harness(), first = h.start();
  h.setTime(REFUND_WAIT_MS);
  const consent = h.authorize(order("NEXT"));
  assert.ok(consent);
  assert.equal((await first).kind, "uncertain");
  assert.equal(h.requests.length, 1); // Retiring the old attempt never POSTs.
  const second = h.runtime.submit(consent, order("NEXT"));
  h.setTime(REFUND_WAIT_MS * 2); h.runtime.checkDeadline(); await second;
  assert.equal(h.requests.length, 2);
});

test("confirmation wait/subscriber work does not spend the POST wait budget", async () => {
  const h = harness(), value = order(), consent = h.authorize(value);
  h.setTime(100000);
  let changed = false;
  h.runtime.subscribe(() => {
    if (h.runtime.hasActivePost() && !changed) { changed = true; h.setTime(200000); }
  });
  const result = h.runtime.submit(consent, value);
  assert.equal(h.timerHistory.get(1).delay, REFUND_WAIT_MS);
  h.setTime(200000 + REFUND_WAIT_MS); h.fire(1);
  await result;
});

test("normal complete and partial successes retain reported authority and obsolete reads during POST", async () => {
  for (const partial of [false, true]) {
    const transport = deferred(), h = harness(() => transport.promise);
    const before = h.runtime.readGuard(), result = h.start(), during = h.runtime.readGuard();
    assert.equal(h.runtime.isReadCurrent(before), false);
    h.setTime(REFUND_WAIT_MS - 1);
    transport.resolve(success("SYNTHETIC-R", partial));
    assert.equal((await result).kind, "succeeded");
    assert.equal(h.runtime.isReadCurrent(during), false);
    assert.equal(h.records()[0].displayStatus, partial ? "refreshing" : "ready");
    h.setTime(REFUND_WAIT_MS); h.fire(1);
    assert.equal(h.records()[0].reportedRefunded, true);
    assert.equal(h.runtime.hasActivePost(), false);
  }
});

test("normal 401 retains bounded identity only; it performs no auth effect or replay", async () => {
  const h = harness(() => Promise.reject({ status: 401, data: { message: "Unauthenticated" } }));
  assert.equal((await h.start()).kind, "unauthenticated");
  assert.equal(h.records()[0].phase, "reauth");
  assert.deepEqual(h.records()[0].continuation, {
    type: "REFUND_REAUTH", accountId: 12, identity: { reference: "SYNTHETIC-R", orderId: 7, sessionId: 10 },
    consentGeneration: 1, replayCount: 0, purpose: "definite-401",
  });
  h.switch(null); h.switch(12, 3);
  await flush();
  assert.equal(h.requests.length, 1);
  h.runtime.cancelIntent();
  assert.equal(h.records()[0].phase, "blocked");
  assert.equal(h.records()[0].continuation, null);
  privateSafe(h);
});

test("normal 422 and ordinary ambiguity remain distinct without retry or invented success", async () => {
  for (const error of [{ status: 422, data: { message: "Already refunded" } },
    { status: 403, data: { message: "Forbidden" } }, { status: 500 },
    new TypeError("Synthetic network"), new DOMException("Synthetic abort", "AbortError")]) {
    const h = harness(() => Promise.reject(error));
    const result = await h.start();
    assert.equal(result.kind, [422, 403].includes(error.status) ? "rejected" : "uncertain");
    assert.equal(h.records()[0].disposition, "settled");
    assert.equal(h.records()[0].reportedRefunded, false);
    assert.equal(h.authorize(order()), null);
    assert.equal(h.requests.length, 1);
    assert.equal(h.activeTimers.size, 0);
  }
});

test("logout immediately masks lagging auth, revokes consent, and retains the old timer/slot", async () => {
  const done = deferred(), h = harness(() => done.promise), result = h.start();
  h.runtime.logout(); // Simulate auth getter not yet updated during synchronous logout notification.
  assert.equal(h.runtime.snapshot().phase, "idle");
  assert.deepEqual(h.records(), []);
  assert.equal(h.runtime.hasActivePost(), true);
  assert.equal(h.authorize(order("NEXT")), null);
  assert.equal(h.requests[0].signal.aborted, false);
  assert.equal(h.activeTimers.size, 1);
  done.reject({ status: 401 });
  assert.equal((await result).kind, "stale");
  h.switch(12, 2);
  assert.equal(h.records()[0].continuation, null);
  assert.equal(h.records()[0].phase, "uncertain");
  assert.equal(h.requests.length, 1);
});

test("pending dismissal/route departure revokes continuation without aborting or resetting the timer", async () => {
  const done = deferred(), h = harness(() => done.promise), result = h.start();
  h.runtime.cancelIntent(); h.setContext(false);
  assert.equal(h.requests[0].signal.aborted, false);
  assert.equal(h.activeTimers.size, 1);
  done.reject({ status: 401 });
  await result;
  assert.equal(h.records()[0].phase, "blocked");
  assert.equal(h.records()[0].continuation, null);
  assert.equal(h.requests.length, 1);
});

test("unsubscribe/remount only observes the same owned operation; snapshots carry no full Orders", async () => {
  const done = deferred(), h = harness(() => done.promise);
  let notifications = 0;
  const unsubscribe = h.runtime.subscribe(() => { notifications++; });
  const result = h.start();
  unsubscribe();
  const before = notifications;
  const detachAgain = h.runtime.subscribe(() => { notifications++; });
  assert.equal(h.runtime.snapshot().phase, "submitting");
  assert.equal(h.requests.length, 1);
  assert.equal(h.activeTimers.size, 1);
  done.resolve(success()); await result;
  assert.ok(notifications > before);
  assert.strictEqual(h.runtime.snapshot(), h.runtime.snapshot());
  detachAgain();
  privateSafe(h);
});

test("stale/canceled confirmation and changed auth/identity cannot dispatch", async () => {
  const h = harness(), value = order(), consent = h.authorize(value);
  h.runtime.cancelIntent();
  assert.equal((await h.runtime.submit(consent, value)).kind, "blocked");
  const newer = h.authorize(value);
  assert.equal((await h.runtime.submit(newer, { ...value, id: 8 })).kind, "blocked");
  h.switch(12, 2);
  assert.equal((await h.runtime.submit(newer, value)).kind, "blocked");
  assert.equal(h.requests.length, 0);
});

test("synchronous transport failure settles uncertainty and observes rejection", async () => {
  const h = harness(() => { throw new TypeError("Synthetic dispatch failure"); });
  assert.equal((await h.start()).kind, "uncertain");
  assert.equal(h.runtime.hasActivePost(), false);
  assert.equal(h.activeTimers.size, 0);
  assert.equal(h.requests.length, 1);
});

test("a newer explicit intent supersedes the only retained definite-401 continuation", async () => {
  const h = harness(() => Promise.reject({ status: 401 }));
  await h.start();
  assert.equal(h.records()[0].continuation.replayCount, 0);
  const consent = h.authorize(order("NEXT"));
  assert.ok(consent);
  assert.equal(h.records()[0].continuation, null);
  assert.equal(h.records()[0].phase, "blocked");
  h.runtime.cancelIntent();
  assert.equal(h.requests.length, 1);
});

test("B's actual mocked Tickets GET can complete after A's deadline retirement", async (t) => {
  const tickets = deferred(), h = harness(), first = h.start();
  h.switch(99);
  const guard = h.runtime.readGuard();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/tickets");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.get("Authorization"), "Bearer synthetic-auth-99");
    return tickets.promise;
  });
  const { getTickets } = await import("../src/api/ticketsApi.js");
  let adopted = null;
  const read = getTickets({ token: "synthetic-auth-99" }).then((data) => {
    if (h.runtime.isReadCurrent(guard)) adopted = data;
  });
  h.setTime(REFUND_WAIT_MS); h.fire(1); await first;
  const bOrders = [order("B-ONLY")];
  tickets.resolve(new Response(JSON.stringify({ data: bOrders }), {
    headers: { "Content-Type": "application/json" },
  }));
  await read;
  assert.deepEqual(adopted, bOrders);
  assert.deepEqual(h.records(), []);
});

test("default deadline clock uses performance.now rather than Date.now", async (t) => {
  let time = 500, callback;
  t.mock.method(performance, "now", () => time);
  t.mock.method(Date, "now", () => Number.MAX_SAFE_INTEGER);
  const runtime = createRefundRuntime({
    getAuth: () => ({ accountId: 12, generation: 1, token: "synthetic-auth" }),
    post: () => new Promise(() => {}),
    setTimer(fn, delay) { callback = fn; assert.equal(delay, REFUND_WAIT_MS); return 1; },
    clearTimer: () => {},
  });
  const value = order(), consent = runtime.createConsent(value, { confirmed: true });
  const result = runtime.submit(consent, value);
  runtime.checkDeadline();
  assert.equal(runtime.hasActivePost(), true);
  time += REFUND_WAIT_MS; callback();
  assert.equal((await result).kind, "uncertain");
});

test("earlier subscribers observe listener-triggered cancellation in a coalesced follow-up", () => {
  const h = harness(), seen = [];
  h.runtime.subscribe(() => { seen.push(h.runtime.snapshot().phase); });
  let calls = 0;
  h.runtime.subscribe(() => { calls++; h.runtime.cancelIntent(); });
  assert.equal(h.authorize(), null);
  assert.deepEqual(seen, ["confirming", "idle"]);
  assert.equal(calls, 2); // Idempotent cancel does not create recursive notification loops.
  assert.equal(h.runtime.snapshot().confirmation, null);
  assert.equal(h.requests.length, 0);
});

test("nested cancellation notification cannot revive consent or send reentrant POST", async () => {
  const h = harness(), consent = h.authorize(), phases = [], repeats = [];
  h.runtime.subscribe(() => { phases.push(h.runtime.snapshot().confirmation); });
  h.runtime.subscribe(() => { h.runtime.cancelIntent(); repeats.push(h.runtime.submit(consent, order())); });
  h.runtime.cancelIntent();
  assert.ok(phases.every((value) => value === null));
  for (const repeat of repeats) assert.equal((await repeat).kind, "blocked");
  assert.equal(h.requests.length, 0);
});

test("complete outcome delivery is transient, guarded and contains no credentials", async () => {
  const h = harness(() => success()), events = [], attempts = [];
  h.runtime.subscribeOutcome((event) => {
    events.push(event);
    attempts.push(h.start); // No effect from merely receiving a result.
    assert.equal(h.runtime.isReadCurrent(event.guard), true);
    assert.equal(h.authorize(order("REENTRANT")), null);
    assert.doesNotMatch(JSON.stringify(event), /token|synthetic-auth/);
  });
  assert.equal((await h.start()).kind, "succeeded");
  assert.equal(events.length, 1);
  assert.equal(events[0].order.status, "refunded");
  assert.equal(h.runtime.snapshot().records[0].reportedRefunded, true);
  privateSafe(h);
  h.runtime.subscribeOutcome(() => { throw new Error("Subscription must not replay an Order"); });
  assert.equal(events.length, 1);
});

test("partial, obsolete-auth and deadline-retired outcomes never deliver complete Orders", async () => {
  for (const mode of ["partial", "account", "deadline"]) {
    const done = deferred(), h = harness(() => done.promise), events = [];
    h.runtime.subscribeOutcome((event) => events.push(event));
    const result = h.start();
    if (mode === "account") h.switch(99);
    if (mode === "deadline") { h.setTime(REFUND_WAIT_MS); h.runtime.checkDeadline(); }
    done.resolve(success("SYNTHETIC-R", mode === "partial"));
    await result; await flush();
    assert.deepEqual(events, []);
  }
});
