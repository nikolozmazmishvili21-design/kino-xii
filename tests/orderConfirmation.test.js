import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createBookingRuntime } from "../src/booking/bookingRuntime.js";
import { bookingReducer } from "../src/booking/bookingReducer.js";

beforeEach((t) => t.mock.method(globalThis, "fetch", async () => { throw new Error("Real fetch forbidden in Confirmation fixtures"); }));
const user = { id: 12, profileComplete: true };
const start = Date.parse("2026-10-07T12:00:00Z");
const session = { id: 10, price: 19, date: "2026-10-07", time: "19:30", movie: { title: "Returned Film", ageRating: { minAge: 12 } },
  venue: { name: "Venue" }, hall: { id: 1, name: "B" }, format: { name: "2D" }, language: { name: "English" } };
const order = { id: 7, reference: "SERVER-REFERENCE", status: "paid", totalPrice: 87.65, session,
  tickets: [{ seatCode: "Z9", ticketType: { slug: "student", name: "Returned Student" }, price: 11.27 }] };
const options = { maxSeatsPerOrder: 3, ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
async function harness() {
  let currentUser = user, token = "fixture-auth", reference = null, now = start;
  const calls = { deletes: 0, orders: 0, storage: 0 };
  const runtime = createBookingRuntime({ getUser: () => currentUser, getToken: () => token, isCurrentUser: (value) => value === currentUser && Boolean(value),
    options: () => options, now: () => now, storage: {
      read: () => reference, clear: () => { calls.storage++; reference = null; },
      write: (value) => { calls.storage++; reference = { holdId: value.holdId, sessionId: value.sessionId }; },
    }, getSession: async () => session,
    getSessionSeats: async () => ({ sessionId: 10, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [{ id: 1, code: "A1", label: "1", state: "available", isMine: false, aisleAfter: false }] }] }] }),
    api: { createHold: async () => ({ holdId: "11111111-2222-3333-4444-555555555555", sessionId: 10, isLive: true,
      expiresAt: new Date(start + 60000).toISOString(), subtotal: 7.13, seats: [{ seatId: 1, code: "A1", ticketType: { slug: "adult", name: "Old type" }, price: 7.13 }] }),
      releaseHold: async () => { calls.deletes++; } },
  });
  await runtime.enter(10, user); runtime.edit("TOGGLE_SEAT", { seatId: 1 }); await runtime.submit();
  assert.equal(runtime.state().step, "checkout");
  return { runtime, calls, setAuth(value, nextToken = token) { currentUser = value; token = nextToken; }, expire() { now = start + 60001; },
    async success() {
      const hold = runtime.state().hold.data;
      await runtime.submitOrder(() => { calls.orders++; return Promise.resolve({ status: 201, data: { data: order } }); }, { valid: true });
      assert.equal(runtime.state().order.phase, "success");
      return { identity: { instanceId: runtime.state().instanceId, sessionId: 10, order: runtime.state().order.data }, hold };
    } };
}

test("explicit current success completion clears presentation once without storage or mutations", async () => {
  const h = await harness(), { identity } = await h.success(), storage = h.calls.storage;
  assert.equal(h.runtime.completeOrderFlow(identity), true);
  assert.equal(h.runtime.state().sessionId, null); assert.equal(h.runtime.state().order.data, null);
  assert.equal(h.runtime.completeOrderFlow(identity), false);
  assert.equal(h.calls.storage, storage); assert.equal(h.calls.deletes, 0); assert.equal(h.calls.orders, 1);
});

test("completion rejects non-success and wrong instance/session/Order without side effects", async () => {
  const h = await harness(); assert.equal(h.runtime.completeOrderFlow(), false);
  const { identity } = await h.success(), before = h.runtime.state(), storage = h.calls.storage;
  for (const wrong of [{ ...identity, instanceId: identity.instanceId + 1 }, { ...identity, sessionId: 11 }, { ...identity, order: { ...order } }, {}]) {
    assert.equal(h.runtime.completeOrderFlow(wrong), false); assert.equal(h.runtime.state(), before);
  }
  assert.equal(h.calls.storage, storage); assert.equal(h.calls.deletes, 0);
});

test("completion rejects changed auth/account/Profile before cleanup effects run", async () => {
  for (const [nextUser, token] of [[null, null], [{ ...user, id: 13 }, "fixture-auth"], [user, "changed-auth"], [{ ...user, profileComplete: false }, "fixture-auth"]]) {
    const h = await harness(), { identity } = await h.success(), before = h.runtime.state();
    h.setAuth(nextUser, token); assert.equal(h.runtime.completeOrderFlow(identity), false); assert.equal(h.runtime.state(), before);
    assert.equal(h.calls.deletes, 0);
  }
});

test("an old completion or success action cannot reset or populate a newer booking", async () => {
  const h = await harness(), { identity } = await h.success();
  h.runtime.completeOrderFlow(identity); await h.runtime.enter(10, user);
  const newer = h.runtime.state(); assert.notEqual(newer.instanceId, identity.instanceId);
  assert.equal(h.runtime.completeOrderFlow(identity), false); assert.equal(h.runtime.state(), newer);
  assert.equal(bookingReducer(newer, { type: "ORDER_SUCCESS", ...identity, order }), newer);
  assert.equal(newer.order.phase, "idle"); assert.equal(newer.order.data, null);
});

test("success consumes Hold authority: old expiry and mutation controls cannot change Confirmation", async () => {
  const h = await harness(), { hold } = await h.success(), before = h.runtime.state();
  h.expire(); assert.equal(h.runtime.expire(hold), false);
  h.runtime.back(); h.runtime.edit("TOGGLE_SEAT", { seatId: 1 }); await h.runtime.submit(); await h.runtime.startOver();
  assert.equal((await h.runtime.submitOrder(() => { h.calls.orders++; }, { valid: true })).kind, "blocked");
  assert.equal(h.runtime.state(), before); assert.equal(h.calls.orders, 1); assert.equal(h.calls.deletes, 0);
});
