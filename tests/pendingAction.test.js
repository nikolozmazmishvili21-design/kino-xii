import test from "node:test";
import assert from "node:assert/strict";
import { createBookingAction, isSamePendingAction, normalizePendingAction } from "../src/auth/pendingAction.js";

test("only positive safe integer session IDs produce a booking descriptor", () => {
  for (const id of [0, -1, 1.5, NaN, Infinity, "809", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(createBookingAction(id), null);
  }
  assert.deepEqual(createBookingAction(809), { type: "OPEN_BOOKING", payload: { sessionId: 809 } });
});

test("normalization bounds payload and rejects unsupported actions", () => {
  const action = normalizePendingAction({
    type: "OPEN_BOOKING", payload: { sessionId: 809, session: { id: 809 }, token: "discarded" }, callback: () => {},
  });
  assert.equal(JSON.stringify(action), '{"type":"OPEN_BOOKING","payload":{"sessionId":809}}');
  assert.ok(Object.isFrozen(action) && Object.isFrozen(action.payload));
  for (const invalid of [null, {}, [], () => {},
    { type: "OTHER", payload: { sessionId: 809 } }, { type: "OPEN_BOOKING" },
    { type: "OPEN_BOOKING", payload: [] }]) {
    assert.equal(normalizePendingAction(invalid), null);
  }
});

test("identity compares supported booking descriptors without coercing IDs", () => {
  assert.equal(isSamePendingAction(createBookingAction(809), createBookingAction(809)), true);
  assert.equal(isSamePendingAction(createBookingAction(809), createBookingAction(810)), false);
  assert.equal(isSamePendingAction(null, null), false);
  assert.equal(isSamePendingAction(createBookingAction(809), { type: "OPEN_BOOKING", payload: { sessionId: "809" } }), false);
});
