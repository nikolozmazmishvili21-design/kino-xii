import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createBookingRuntime } from "../src/booking/bookingRuntime.js";
import { ApiError } from "../src/api/client.js";
import { HOLD_COPY } from "../src/booking/holdLifecycle.js";

beforeEach((t) => t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected real fetch in fixture-only test"); }));
const ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const START = Date.parse("2026-10-07T12:00:00Z");
const USER = { id: 12, profileComplete: true };
const OPTIONS = { maxSeatsPerOrder: 3, ticketTypes: [
  { id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null },
  { id: 2, slug: "student", name: "Student", priceRatio: 0.75, blockedFromRatingAge: null },
] };
const session = (id = 10) => ({ id, price: 19, date: "2026-10-07", time: "19:30",
  movie: { title: "Synthetic Film", ageRating: { minAge: 12 } }, venue: { name: "Synthetic Venue" },
  hall: { id: 1, name: "B" }, format: { name: "2D" }, language: { name: "Georgian" } });
const map = (sessionId = 10, own = [], sold = []) => ({ sessionId, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [1, 2, 3].map((id) => ({
  id, code: `A${id}`, label: String(id), state: sold.includes(id) ? "sold" : own.includes(id) ? "held" : "available", isMine: own.includes(id), aisleAfter: false,
})) }] }] });
const hold = (sessionId = 10, ids = [1, 2], overrides = {}) => ({ holdId: ID, sessionId, isLive: true,
  expiresAt: new Date(START + 60000).toISOString(), subtotal: 14.26,
  seats: ids.map((id) => ({ seatId: id, code: `A${id}`, price: 7.13, ticketType: { slug: id === 2 ? "student" : "adult", name: "Server type" } })), ...overrides });
const order = (sessionId = 10) => ({ id: 7, reference: "SYNTHETIC-ORDER", status: "paid", totalPrice: 123.45, session: session(sessionId),
  tickets: [{ seatCode: "SERVER-SEAT", ticketType: { slug: "adult", name: "Server ticket" }, price: 123.45 }] });
const response = (value = order()) => ({ status: 201, data: { data: value } });
const failure = (status, body = {}) => new ApiError(body.message ?? "Synthetic server feedback", { status, data: body });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness() {
  let user = USER, token = "synthetic-auth-a", now = START, reference = null, nextId = ID;
  const maps = new Map(), holds = new Map();
  const calls = { orders: 0, creates: 0, gets: [], deletes: [], maps: 0, reauth: [] };
  const api = {
    async createHold(sessionId, assignments) {
      calls.creates++;
      const value = hold(sessionId, assignments.map((entry) => entry.seatId), { holdId: nextId,
        seats: assignments.map((entry) => ({ seatId: entry.seatId, code: `A${entry.seatId}`, price: 7.13,
          ticketType: { slug: entry.ticketType, name: "Server type" } })) });
      holds.set(value.holdId, value);
      maps.set(sessionId, map(sessionId, assignments.map((entry) => entry.seatId)));
      return value;
    },
    async getHold(id) { calls.gets.push(id); return holds.get(id); },
    async releaseHold(id, auth) { calls.deletes.push({ id, token: auth.token }); },
  };
  const storage = { read: () => reference, write: (value) => { reference = { holdId: value.holdId, sessionId: value.sessionId }; }, clear: () => { reference = null; } };
  const runtime = createBookingRuntime({ api, storage, now: () => now, getUser: () => user, getToken: () => token,
    isCurrentUser: (expected) => expected === user && user !== null, options: () => OPTIONS,
    getSession: async (id) => session(id),
    getSessionSeats: async (id) => { calls.maps++; return maps.get(id) ?? map(id); },
    reauthenticate: (id) => { calls.reauth.push(id); user = null; token = null; },
  });
  return { runtime, api, calls, storage, user: () => user, token: () => token,
    setUser(value, auth = token) { user = value; token = auth; }, setNow(value) { now = value; },
    setMap(value) { maps.set(value.sessionId, value); }, setHold(value) { holds.set(value.holdId, value); },
    async ready(sessionId = 10, id = ID) {
      nextId = id;
      await runtime.enter(sessionId, user);
      runtime.edit("TOGGLE_SEAT", { seatId: 1 }); runtime.edit("TOGGLE_SEAT", { seatId: 2 });
      runtime.edit("SET_TICKET", { seatId: 2, slug: "student" });
      await runtime.submit();
      assert.equal(runtime.state().step, "checkout");
    },
    submit(promise, options = { valid: true }) {
      return runtime.submitOrder((context) => {
        calls.orders++;
        assert.deepEqual(Object.keys(context), ["holdId", "token"]);
        assert.equal(context.holdId, runtime.state().hold.data.holdId);
        assert.equal(context.token, token);
        return promise;
      }, options);
    },
  };
}
const privateSnapshot = (h) => JSON.stringify({ state: h.runtime.state(), info: h.runtime.orderSnapshot() });
function assertNoSensitive(h) {
  assert.doesNotMatch(privateSnapshot(h), /"(?:cardNumber|expiry|cvv|buyerDraft|payload|callback|promise)"|synthetic-auth-/);
}

test("readiness requires local validation and current verified numeric/auth/Profile/Hold authority", async () => {
  const h = harness();
  assert.equal(h.runtime.canSubmitOrder(), false);
  await h.ready();
  // A fresh Hold's authoritative 201 does not require a pre-Pay GET/map refresh.
  assert.equal(h.runtime.canSubmitOrder(), true);
  assert.equal((await h.submit(response(), { valid: false })).kind, "blocked");
  assert.equal((await h.submit(response(), {})).kind, "blocked");
  h.setUser({ ...USER, profileComplete: false });
  assert.equal((await h.submit(response())).kind, "blocked");
  h.setUser(USER, "replacement-auth");
  assert.equal(h.runtime.canSubmitOrder(), false);
  h.setUser(USER, "synthetic-auth-a");
  h.setNow(START + 60000);
  assert.equal((await h.submit(response())).kind, "blocked");
  assert.equal(h.calls.orders, 0);
  assert.deepEqual(h.calls.gets, []);
});

test("same-turn duplicate submits, repeated reads, Back and conflicting HOLD actions stay locked", async () => {
  const h = harness(); await h.ready();
  const pending = deferred();
  const first = h.submit(pending.promise);
  assert.equal((await h.submit(response())).kind, "blocked");
  const selection = h.runtime.state().selection;
  for (let i = 0; i < 5; i++) { h.runtime.state(); h.runtime.orderSnapshot(); h.runtime.canSubmitOrder(); }
  h.runtime.back(); h.runtime.edit("REMOVE_SEAT", { seatId: 1 });
  await h.runtime.startOver(); await h.runtime.submit();
  assert.equal(h.runtime.state().selection, selection);
  assert.equal(h.runtime.state().order.phase, "submitting");
  assert.equal(h.calls.orders, 1); assert.equal(h.calls.creates, 1);
  pending.resolve(response()); await first;
  assertNoSensitive(h);
});

for (const change of ["close", "expiry", "auth", "profile"]) {
  test(`synchronous ${change} during lock notification prevents dispatch`, async () => {
    const h = harness(); await h.ready();
    const unsubscribe = h.runtime.subscribe(() => {
      if (h.runtime.state().order.phase !== "submitting") return;
      unsubscribe();
      if (change === "close") h.runtime.close();
      if (change === "expiry") h.setNow(START + 60001);
      if (change === "auth") h.setUser(null, null);
      if (change === "profile") h.setUser({ ...USER, profileComplete: false });
    });
    assert.deepEqual(await h.submit(response()), { kind: "blocked", clearPayment: true });
    assert.equal(h.calls.orders, 0);
    assert.notEqual(h.runtime.state().order.phase, "submitting");
    assert.equal(h.runtime.orderSnapshot().notice, null);
    assert.deepEqual(h.calls.deletes, []);
  });
}

test("current success adopts server Order, ends timer/reference authority and permanently blocks repeat Pay", async () => {
  const h = harness(); await h.ready(); const originalHold = h.runtime.state().hold.data;
  const returned = order();
  assert.deepEqual(await h.submit(response(returned)), { kind: "success", clearPayment: true });
  assert.deepEqual(h.runtime.state().order, { phase: "success", data: returned, feedback: null });
  assert.equal(h.runtime.state().order.data, returned);
  assert.equal(h.runtime.state().step, "confirmation");
  assert.equal(h.runtime.state().hold.data, null); assert.equal(h.storage.read(), null);
  assert.equal(h.runtime.expire(originalHold), false);
  h.runtime.clearOrderError(); await h.runtime.startOver();
  assert.equal((await h.submit(response())).kind, "blocked");
  await h.runtime.restore({ holdId: ID, sessionId: 10 });
  assert.equal(h.calls.orders, 1); assert.deepEqual(h.calls.gets, []);
  h.runtime.close(); assert.deepEqual(h.calls.deletes, []);
});

for (const [name, create] of [
  ["network failure", () => Promise.reject(new Error("Synthetic transport failure"))],
  ["body-read ambiguity", () => Promise.reject(new ApiError("Network request failed."))],
  ["unknown server 500", () => Promise.reject(failure(500, { message: "Synthetic server failure" }))],
  ["malformed 201", () => Promise.resolve(response({ id: 7, reference: "SYNTHETIC-PARTIAL", session: {} }))],
  ["201 without Order identity", () => Promise.resolve(response({ sessionId: 10, seatCodes: ["A1"] }))],
]) {
  test(`${name} settles uncertain without DELETE, replay, restoration or later timer transition`, async () => {
    const h = harness(); await h.ready(); const originalHold = h.runtime.state().hold.data;
    assert.equal((await h.submit(create())).kind, "uncertain");
    assert.equal(h.runtime.state().order.phase, "uncertain");
    assert.equal(h.runtime.state().order.data, null);
    assert.equal(h.runtime.state().order.feedback, "We couldn't confirm whether your order was completed.");
    assert.equal(h.storage.read(), null); assert.equal(h.runtime.state().hold.data, null);
    const identity = h.runtime.orderSnapshot().recovery.identity;
    assert.deepEqual(identity, name === "malformed 201" ? { id: 7, reference: "SYNTHETIC-PARTIAL" } : null);
    await h.runtime.restore({ holdId: ID, sessionId: 10 });
    await h.runtime.startOver(); await h.runtime.retry();
    assert.equal((await h.submit(response())).kind, "blocked");
    h.setNow(START + 60001); assert.equal(h.runtime.expire(originalHold), false);
    assert.equal(h.runtime.state().order.phase, "uncertain");
    assert.deepEqual(h.calls.gets, []); assert.deepEqual(h.calls.deletes, []); assert.equal(h.calls.orders, 1);
    assertNoSensitive(h);
    h.runtime.close(); assert.deepEqual(h.calls.deletes, []);
  });
}

test("404 is terminal context error, clears invalid Hold/reference, and never claims uncertainty", async () => {
  const h = harness(); await h.ready();
  assert.equal((await h.submit(Promise.reject(failure(404, { message: "Synthetic context unavailable" })))).kind, "context-error");
  assert.equal(h.runtime.state().order.phase, "error");
  assert.equal(h.runtime.state().order.feedback, "Synthetic context unavailable");
  assert.equal(h.runtime.state().hold.data, null); assert.equal(h.storage.read(), null);
  assert.equal(h.runtime.state().step, "seats"); assert.deepEqual(h.calls.deletes, []);
});

test("403 returns immediate payment-clear signal and blocks Pay until guarded Hold verification", async () => {
  const h = harness(); await h.ready(); const check = deferred();
  h.api.getHold = async () => check.promise;
  assert.deepEqual(await h.submit(Promise.reject(failure(403, { message: "Exact forbidden feedback" }))), { kind: "forbidden", clearPayment: true });
  assert.equal(h.runtime.state().order.phase, "error");
  assert.equal(h.runtime.state().order.feedback, "Exact forbidden feedback");
  assert.equal(h.runtime.canSubmitOrder(), false);
  check.resolve(hold()); await flush();
  assert.equal(h.runtime.state().hold.phase, "active");
  assert.equal(h.runtime.canSubmitOrder(), true);
  assert.equal(h.calls.orders, 1); assert.deepEqual(h.calls.deletes, []);
});

test("403 ownership verification failure remains definite blocked recovery", async () => {
  const h = harness(); await h.ready();
  h.api.getHold = async () => { throw failure(403, { message: "Hold forbidden" }); };
  await h.submit(Promise.reject(failure(403, { message: "Exact original feedback" }))); await flush();
  assert.equal(h.runtime.state().order.phase, "error"); assert.equal(h.runtime.state().order.feedback, "Exact original feedback");
  assert.equal(h.storage.read(), null); assert.equal(h.runtime.canSubmitOrder(), false);
});

test("422 fields remain local structured results; shared state has no field errors or payment draft", async () => {
  const h = harness(); await h.ready();
  const errors = { cvv: ["Server field feedback"], holdId: ["Server hold feedback"], "contact.email": ["Unknown feedback"] };
  const returned = await h.submit(Promise.reject(failure(422, { message: "Server validation", errors })));
  assert.deepEqual(returned, { kind: "validation", clearPayment: false, message: "Server validation",
    fields: { cvv: ["Server field feedback"] }, general: [
      { field: "holdId", messages: ["Server hold feedback"] }, { field: "contact.email", messages: ["Unknown feedback"] },
    ] });
  assert.deepEqual(h.runtime.state().order, { phase: "error", data: null, feedback: null });
  assert.deepEqual(h.runtime.state().fieldErrors, {});
  assert.equal(h.runtime.canSubmitOrder(), true); assert.ok(h.storage.read()); assertNoSensitive(h);
});

test("422 fields arriving after expiry cannot retain old Checkout authority", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.setNow(START + 60001); pending.reject(failure(422, { errors: { cvv: ["Server validation"] } })); await first; await flush();
  assert.equal(h.runtime.state().step, "seats"); assert.equal(h.runtime.state().hold.data, null);
  assert.equal(h.storage.read(), null); assert.deepEqual(h.calls.deletes, []);
});

test("message-only 422 uses shape, preserves server feedback, clears draft/reference and refreshes map", async () => {
  const h = harness(); await h.ready(); const maps = h.calls.maps;
  assert.deepEqual(await h.submit(Promise.reject(failure(422, { message: "Exact expiry feedback" }))), { kind: "expired", clearPayment: true });
  await flush();
  assert.equal(h.runtime.state().order.phase, "error"); assert.equal(h.runtime.state().feedback, "Exact expiry feedback");
  assert.equal(h.runtime.state().step, "seats"); assert.deepEqual(h.runtime.state().selection, {});
  assert.equal(h.runtime.state().hold.data, null); assert.equal(h.storage.read(), null);
  assert.equal(h.calls.maps, maps + 1); assert.deepEqual(h.calls.deletes, []);
});

test("message-less received 422 uses accepted expiry fallback without text parsing", async () => {
  const h = harness(); await h.ready();
  await h.submit(Promise.reject(failure(422))); await flush();
  assert.equal(h.runtime.state().feedback, HOLD_COPY.expired); assert.deepEqual(h.calls.deletes, []);
});

test("409 drops captured contested IDs only, keeps unaffected choices and temporary blocking until map refresh", async () => {
  const h = harness(); await h.ready(); const mapRead = deferred();
  h.runtime.configureDependencies({ getSessionSeats: async () => mapRead.promise });
  const returned = await h.submit(Promise.reject(failure(409, { message: "Exact conflict", contested: ["A1", "UNKNOWN"] })));
  assert.deepEqual(returned, { kind: "conflict", clearPayment: true });
  assert.deepEqual(h.runtime.state().selection, { 2: { ticketTypeSlug: "student" } });
  assert.deepEqual(h.runtime.state().contested, ["A1"]);
  assert.equal(h.runtime.state().step, "seats"); assert.equal(h.runtime.canSubmitOrder(), false);
  h.setHold(hold(10, [2])); mapRead.resolve(map(10, [2], [1])); await flush();
  assert.deepEqual(h.runtime.state().contested, []);
  assert.deepEqual(h.runtime.state().selection, { 2: { ticketTypeSlug: "student" } });
  assert.equal(h.runtime.state().hold.phase, "active");
  assert.match(h.runtime.state().feedback, /Exact conflict.*A1.*UNKNOWN/);
  await h.runtime.submit(); assert.equal(h.runtime.state().step, "checkout");
  assert.equal(h.calls.creates, 1); assert.equal(h.calls.orders, 1); assert.equal(h.runtime.canSubmitOrder(), true);
});

test("409 terminal previous-Hold failure clears authority and preserves only factual available choices", async () => {
  const h = harness(); await h.ready(); h.setMap(map(10, [], [1]));
  h.api.getHold = async () => { throw failure(404, { message: "Hold unavailable" }); };
  await h.submit(Promise.reject(failure(409, { message: "Conflict", contested: ["A1"] }))); await flush();
  assert.equal(h.storage.read(), null); assert.equal(h.runtime.state().hold.data, null);
  assert.deepEqual(h.runtime.state().selection, { 2: { ticketTypeSlug: "student" } });
  assert.equal(h.runtime.state().step, "seats"); assert.equal(h.calls.orders, 1);
});

test("409 transient Hold verification supports guarded Retry without another Order POST", async () => {
  const h = harness(); await h.ready(); const originalGet = h.api.getHold;
  h.setHold(hold(10, [2])); h.setMap(map(10, [2], [1]));
  h.api.getHold = async () => { throw failure(500); };
  const before = h.calls.maps;
  await h.submit(Promise.reject(failure(409, { message: "Conflict", contested: ["A1"] }))); await flush();
  assert.equal(h.runtime.state().hold.phase, "error"); assert.equal(h.runtime.state().recovery.order, true);
  assert.ok(h.calls.maps > before); assert.equal(h.runtime.canSubmitOrder(), false);
  h.api.getHold = originalGet; await h.runtime.retry();
  assert.equal(h.runtime.state().hold.phase, "active"); assert.equal(h.runtime.state().step, "seats");
  assert.equal(h.calls.orders, 1);
});

test("repeated booking entry retains Order conflict verification policy and feedback", async () => {
  const h = harness(); await h.ready(); const originalGet = h.api.getHold;
  h.setHold(hold(10, [2])); h.setMap(map(10, [2], [1]));
  h.api.getHold = async () => { throw failure(500); };
  await h.submit(Promise.reject(failure(409, { message: "Exact conflict", contested: ["A1"] }))); await flush();
  h.api.getHold = originalGet;
  await h.runtime.enter(10, h.user());
  assert.equal(h.runtime.state().step, "seats");
  assert.equal(h.runtime.state().hold.phase, "active");
  assert.equal(h.runtime.state().feedback, "Exact conflict A1");
  assert.deepEqual(h.runtime.state().selection, { 2: { ticketTypeSlug: "student" } });
  assert.equal(h.calls.orders, 1);
});

test("contradictory Hold/map recovery stays blocked with Retry / Start over", async () => {
  const h = harness(); await h.ready(); h.setMap(map(10, [], [1]));
  await h.submit(Promise.reject(failure(409, { message: "Conflict", contested: ["A1"] }))); await flush();
  assert.equal(h.runtime.state().hold.phase, "error"); assert.ok(h.runtime.state().recovery.retryable);
  assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.canSubmitOrder(), false);
  await h.runtime.startOver(); assert.equal(h.runtime.state().recovery, null); assert.equal(h.storage.read(), null);
  assert.equal(h.calls.orders, 1);
});

test("malformed contested data invents no IDs and final draft follows refreshed availability", async () => {
  const h = harness(); await h.ready(); h.setMap(map(10, [], [1]));
  h.api.getHold = async () => { throw failure(404); };
  await h.submit(Promise.reject(failure(409, { message: "Conflict", contested: [123] }))); await flush();
  assert.deepEqual(h.runtime.state().contested, []);
  assert.deepEqual(h.runtime.state().selection, { 2: { ticketTypeSlug: "student" } });
});

test("stale Order recovery cannot adopt or clear newer booking/reference", async () => {
  const h = harness(); await h.ready(); const check = deferred(), originalGet = h.api.getHold;
  h.api.getHold = async () => check.promise;
  await h.submit(Promise.reject(failure(403, { message: "Forbidden" }))); await flush();
  h.runtime.newIntent(11); h.api.getHold = originalGet; await h.ready(11, OTHER_ID);
  const newer = h.runtime.state(); check.resolve(hold()); await flush();
  assert.equal(h.runtime.state(), newer); assert.equal(h.storage.read().holdId, OTHER_ID);
});

test("401 keeps only bounded ORDER_REAUTH context and verifies same-account Login without Order replay", async () => {
  const h = harness(); await h.ready();
  assert.deepEqual(await h.submit(Promise.reject(failure(401, { message: "Unauthenticated" }))), { kind: "auth-required", clearPayment: true });
  assert.deepEqual(h.runtime.orderSnapshot().reauth, { kind: "ORDER_REAUTH", instanceId: 1, sessionId: 10, holdId: ID, accountId: 12, replayCount: 1 });
  assert.equal(h.runtime.state().sessionId, null); assert.equal(h.calls.orders, 1); assertNoSensitive(h);
  h.setUser({ ...USER }, "synthetic-auth-b"); h.runtime.syncAuth(h.user(), true);
  await h.runtime.enter(10, h.user());
  assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.runtime.state().hold.phase, "active");
  assert.deepEqual(h.calls.gets, [ID]); assert.equal(h.runtime.orderSnapshot().reauth, null);
  assert.equal(h.calls.orders, 1); assert.equal(h.runtime.canSubmitOrder(), true); assertNoSensitive(h);
  await h.submit(response()); assert.equal(h.calls.orders, 2);
});

test("a second rejected explicit Pay exhausts Order reauthentication without an automatic loop", async () => {
  const h = harness(); await h.ready(); await h.submit(Promise.reject(failure(401, { message: "Unauthenticated" })));
  h.setUser(USER, "synthetic-auth-b"); h.runtime.syncAuth(h.user(), true); await h.runtime.enter(10, h.user());
  await h.submit(Promise.reject(failure(401, { message: "Unauthenticated" })));
  assert.deepEqual(h.calls.reauth, [10]); assert.equal(h.runtime.orderSnapshot().reauth, null);
  assert.equal(h.runtime.canSubmitOrder(), false); assert.equal(h.storage.read(), null); assert.equal(h.calls.orders, 2);
});

for (const scenario of ["cancel", "account change", "new intent", "terminal Hold"]) {
  test(`Order reauthentication is discarded on ${scenario}`, async () => {
    const h = harness(); await h.ready(); await h.submit(Promise.reject(failure(401, { message: "Unauthenticated" })));
    if (scenario === "cancel") h.runtime.cancelContinuation();
    if (scenario === "account change") { h.setUser({ id: 99, profileComplete: true }, "synthetic-auth-other"); h.runtime.syncAuth(h.user(), true); }
    if (scenario === "new intent") h.runtime.newIntent(11);
    if (scenario === "terminal Hold") {
      h.setUser(USER, "synthetic-auth-b"); h.setHold(hold(10, [1, 2], { isLive: false }));
      h.runtime.syncAuth(h.user(), true); await h.runtime.enter(10, h.user());
      assert.equal(h.runtime.canSubmitOrder(), false);
    }
    assert.equal(h.runtime.orderSnapshot().reauth, null); assert.equal(h.calls.orders, 1);
  });
}

test("reauth transient verification failure blocks Checkout until guarded read Retry", async () => {
  const h = harness(); await h.ready(); await h.submit(Promise.reject(failure(401, { message: "Unauthenticated" })));
  const originalGet = h.api.getHold; h.api.getHold = async () => { throw failure(500); };
  h.setUser(USER, "synthetic-auth-b"); h.runtime.syncAuth(h.user(), true); await h.runtime.enter(10, h.user());
  assert.equal(h.runtime.state().recovery.purpose, "reauth"); assert.equal(h.runtime.canSubmitOrder(), false);
  h.api.getHold = originalGet; await h.runtime.retry();
  assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.calls.orders, 1);
});

test("401 during Order reauth verification consumes the bound without reopening Login", async () => {
  const h = harness(); await h.ready(); await h.submit(Promise.reject(failure(401, { message: "Unauthenticated" })));
  h.api.getHold = async () => { throw failure(401, { message: "Unauthenticated" }); };
  h.setUser(USER, "synthetic-auth-b"); h.runtime.syncAuth(h.user(), true); await h.runtime.enter(10, h.user());
  assert.deepEqual(h.calls.reauth, [10]); assert.equal(h.runtime.orderSnapshot().reauth, null); assert.equal(h.runtime.canSubmitOrder(), false);
});

test("pending Close promptly clears reference without DELETE and late success becomes a bounded notice", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.close(); assert.equal(h.runtime.state().sessionId, null); assert.equal(h.storage.read(), null);
  assert.deepEqual(h.calls.deletes, []);
  pending.resolve(response()); assert.equal((await first).kind, "stale");
  assert.equal(h.runtime.state().sessionId, null);
  const notice = h.runtime.orderSnapshot().notice;
  assert.deepEqual(Object.keys(notice), ["id", "kind", "message", "action", "accountId"]);
  assert.equal(notice.kind, "success"); assert.equal(notice.message, "Your order was completed.");
  assert.equal(notice.action, "tickets"); assert.equal(notice.accountId, USER.id); assertNoSensitive(h);
  h.runtime.dismissOrderNotice(notice.id + 1); assert.equal(h.runtime.orderSnapshot().notice, notice);
  h.runtime.dismissOrderNotice(notice.id); assert.equal(h.runtime.orderSnapshot().notice, null);
  assert.deepEqual(h.calls.deletes, []);
});

test("detached uncertainty surfaces factual recovery intent without modal restoration or mutation", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.close(); pending.reject(failure(500)); await first;
  assert.equal(h.runtime.orderSnapshot().notice.kind, "uncertain");
  assert.equal(h.runtime.orderSnapshot().notice.action, "tickets");
  assert.equal(h.runtime.orderSnapshot().notice.message, "We couldn't confirm whether your order was completed.");
  assert.equal(h.runtime.state().sessionId, null); assert.deepEqual(h.calls.deletes, []); assert.equal(h.calls.orders, 1);
});

test("late success cannot overwrite newer booking or release a reused Hold ID", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.newIntent(11); await h.ready(11, ID); const newer = h.runtime.state();
  assert.equal(h.runtime.canSubmitOrder(), false); // Same account still has unresolved Order.
  pending.resolve(response()); await first;
  assert.equal(h.runtime.state(), newer); assert.deepEqual(h.storage.read(), { holdId: ID, sessionId: 11 });
  assert.deepEqual(h.calls.deletes, []); assert.equal(h.runtime.canSubmitOrder(), true);
  h.runtime.close(); assert.deepEqual(h.calls.deletes.map((entry) => entry.id), [ID]); // New verified Hold abandonment still works.
});

test("detached definite rejection verifies the captured live Hold before best-effort release", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.close(); assert.deepEqual(h.calls.deletes, []);
  pending.reject(failure(422, { errors: { cvv: ["Server field feedback"] } })); await first;
  assert.deepEqual(h.calls.gets, [ID]); assert.deepEqual(h.calls.deletes, [{ id: ID, token: "synthetic-auth-a" }]);
  assert.equal(h.runtime.state().sessionId, null);
});

test("detached expiry/401/403/404 rejections never release by assuming valid ownership or live time", async () => {
  for (const status of [401, 403, 404, 422]) {
    const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
    h.runtime.close(); pending.reject(failure(status, { message: "Server feedback" })); await first;
    assert.deepEqual(h.calls.deletes, []); assert.equal(h.runtime.state().sessionId, null);
  }
});

test("old rejection cannot release a newer reused Hold or keep provider readiness stale", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.newIntent(11); await h.ready(11, ID);
  let notifications = 0; const unsubscribe = h.runtime.subscribeOrder(() => notifications++);
  pending.reject(failure(422, { errors: { cvv: ["Server feedback"] } })); await first;
  assert.deepEqual(h.calls.deletes, []); assert.equal(h.storage.read().sessionId, 11);
  assert.ok(notifications > 0); assert.equal(h.runtime.canSubmitOrder(), true); unsubscribe();
});

for (const settlement of ["success", "rejection", "uncertain"]) {
  test(`pending expiry runs once and late ${settlement} cannot resurrect Checkout`, async () => {
    const h = harness(); await h.ready(); const originalHold = h.runtime.state().hold.data;
    const pending = deferred(); const first = h.submit(pending.promise); const before = h.calls.maps;
    h.setNow(START + 60001);
    assert.equal(h.runtime.expire(originalHold), true); assert.equal(h.runtime.expire(originalHold), false);
    await flush(); assert.equal(h.calls.maps, before + 1); assert.equal(h.runtime.state().step, "seats");
    assert.deepEqual(h.runtime.state().selection, {}); assert.equal(h.storage.read(), null); assert.equal(h.runtime.state().feedback, HOLD_COPY.expired);
    if (settlement === "success") pending.resolve(response());
    else pending.reject(failure(settlement === "uncertain" ? 500 : 409, { message: "Server feedback", contested: ["A1"] }));
    await first;
    assert.equal(h.runtime.state().step, "seats"); assert.equal(h.runtime.state().hold.data, null);
    assert.equal(h.runtime.orderSnapshot().notice?.kind ?? null, settlement === "rejection" ? null : settlement);
    assert.deepEqual(h.calls.deletes, []);
  });
}

test("logout detaches pending Order without release and suppresses even same-account later Login evidence", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.logout(); assert.equal(h.runtime.state().sessionId, null); assert.deepEqual(h.calls.deletes, []);
  h.setUser(null, null); h.runtime.syncAuth(null, false);
  h.setUser(USER, "synthetic-auth-a"); h.runtime.syncAuth(USER, true);
  pending.resolve(response()); await first;
  assert.equal(h.runtime.orderSnapshot().notice, null); assert.deepEqual(h.calls.deletes, []); assertNoSensitive(h);
});

test("account switch isolates old settlement from newer Order lock and never borrows credentials", async () => {
  const h = harness(); await h.ready(); const old = deferred(); const first = h.submit(old.promise);
  h.setUser({ id: 99, profileComplete: true }, "synthetic-auth-other"); h.runtime.syncAuth(h.user(), true);
  await h.ready(11, OTHER_ID); const next = deferred(); const second = h.submit(next.promise);
  const newer = h.runtime.state(); old.resolve(response()); await first;
  assert.equal(h.runtime.state(), newer); assert.equal(h.runtime.state().order.phase, "submitting");
  assert.equal((await h.submit(response(order(11)))).kind, "blocked");
  assert.equal(h.runtime.orderSnapshot().notice, null); assert.deepEqual(h.calls.deletes, []);
  next.resolve(response(order(11))); await second; assert.equal(h.runtime.state().order.phase, "success");
});

test("old account rejection skips cleanup instead of using newer auth", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.close(); h.setUser({ id: 99, profileComplete: true }, "synthetic-auth-other"); h.runtime.syncAuth(h.user(), true);
  pending.reject(failure(422, { errors: { cvv: ["Server feedback"] } })); await first;
  assert.deepEqual(h.calls.gets, []); assert.deepEqual(h.calls.deletes, []);
});

test("notices are hidden immediately on auth change and cleared by account synchronization", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.close(); pending.resolve(response()); await first; assert.ok(h.runtime.orderSnapshot().notice);
  h.setUser({ id: 99, profileComplete: true }, "synthetic-auth-other");
  assert.equal(h.runtime.orderSnapshot().notice, null);
  h.runtime.syncAuth(h.user(), true); assert.equal(h.runtime.orderSnapshot().notice, null);
});

test("older detached settlement cannot overwrite or recreate a newer dismissed notice", async () => {
  const h = harness(); await h.ready(); const old = deferred(); const first = h.submit(old.promise);
  h.runtime.close(); h.setUser({ id: 99, profileComplete: true }, "synthetic-auth-other"); h.runtime.syncAuth(h.user(), true);
  await h.ready(11, OTHER_ID); const recent = deferred(); const second = h.submit(recent.promise);
  h.runtime.close(); recent.resolve(response(order(11))); await second;
  const newerNotice = h.runtime.orderSnapshot().notice; h.runtime.dismissOrderNotice(newerNotice.id);
  old.resolve(response()); await first; assert.equal(h.runtime.orderSnapshot().notice, null);
});

test("configuration invalidation detaches unresolved Order without HOLD uncertainty or release", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  h.runtime.configureDependencies({ options: () => ({ ...OPTIONS, ticketTypes: [] }) });
  assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().step, "seats");
  assert.equal(h.storage.read(), null); assert.deepEqual(h.calls.deletes, []);
  pending.resolve(response()); await first; assert.equal(h.runtime.orderSnapshot().notice.kind, "success");
});

test("normal HOLD Back, replacement and logout release remain unchanged without Order", async () => {
  const h = harness(); await h.ready(); const retained = h.runtime.state().hold.data;
  h.runtime.back(); assert.equal(h.runtime.state().hold.data, retained); assert.ok(h.storage.read());
  await h.runtime.submit(); assert.equal(h.calls.creates, 1);
  h.runtime.back(); h.runtime.edit("REMOVE_SEAT", { seatId: 1 }); await h.runtime.submit(); assert.equal(h.calls.creates, 2);
  h.runtime.logout(); assert.deepEqual(h.calls.deletes, [{ id: ID, token: "synthetic-auth-a" }]);
});

test("tickets handoff preserves exact evidence through Close and consumes once without persistence", async () => {
  const h = harness(); await h.ready();
  await h.submit(response({ id: 7, reference: "SYNTHETIC-PARTIAL", session: session(), contact: { email: "buyer@example.test" }, cardLastFour: "4242" }));
  assert.equal(h.runtime.prepareTicketsRecovery(), true);
  h.runtime.close();
  assert.deepEqual(h.runtime.orderSnapshot().ticketsIntent, { accountId: 12, identity: { id: 7, reference: "SYNTHETIC-PARTIAL" } });
  assert.equal(h.storage.read(), null);
  assert.deepEqual(h.runtime.consumeTicketsRecovery(), { accountId: 12, identity: { id: 7, reference: "SYNTHETIC-PARTIAL" } });
  assert.equal(h.runtime.consumeTicketsRecovery(), null); assert.deepEqual(h.calls.deletes, []);
  assertNoSensitive(h);
});

test("tickets handoff with no trustworthy identifier never invents one and cannot cross accounts", async () => {
  const h = harness(); await h.ready(); await h.submit(Promise.reject(failure(500)));
  assert.equal(h.runtime.prepareTicketsRecovery(), true); h.runtime.close();
  assert.deepEqual(h.runtime.orderSnapshot().ticketsIntent, { accountId: 12, identity: null });
  h.setUser({ id: 99, profileComplete: true }, "synthetic-auth-other");
  assert.equal(h.runtime.orderSnapshot().ticketsIntent, null); assert.equal(h.runtime.consumeTicketsRecovery(), null);
  h.runtime.syncAuth(h.user(), true); assert.equal(h.runtime.orderSnapshot().ticketsIntent, null);
});

test("notice handoff is explicit and guarded; the same-session pending read exposes no request internals", async () => {
  const h = harness(); await h.ready(); const pending = deferred(); const first = h.submit(pending.promise);
  assert.equal(h.runtime.hasPendingOrderForSession(), true);
  assert.equal(h.runtime.prepareTicketsRecovery({ noticeId: 123 }), false);
  h.runtime.close(); assert.equal(h.runtime.hasPendingOrderForSession(), false);
  await h.runtime.enter(10, h.user()); assert.equal(h.runtime.hasPendingOrderForSession(), true);
  pending.resolve(response()); await first;
  assert.equal(h.runtime.hasPendingOrderForSession(), false);
  const notice = h.runtime.orderSnapshot().notice;
  assert.equal(h.runtime.prepareTicketsRecovery({ noticeId: notice.id + 1 }), false);
  assert.equal(h.runtime.prepareTicketsRecovery({ noticeId: notice.id }), true);
  h.runtime.logout(); assert.equal(h.runtime.consumeTicketsRecovery(), null);
});
