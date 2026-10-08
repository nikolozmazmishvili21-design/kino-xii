import test from "node:test";
import assert from "node:assert/strict";
import {
  captureRefundIdentity, matchesRefundIdentity, matchesRefundReference,
  refundEligible, readableRefundOrder, classifyRefundResponse, classifyRefundError,
  verificationPrerequisites, classifyRefundVerification, reconfirmationEligible,
} from "../src/tickets/refundLifecycle.js";

const order = (extra = {}) => ({ id: 7, reference: "SYNTHETIC-R", status: "paid",
  isUpcoming: true, isRefundable: true, totalPrice: 19,
  session: { id: 10, date: "2000-01-01", time: "19:30", movie: { title: "Synthetic film" },
    venue: { name: "Venue" }, hall: { name: "Hall" }, format: { name: "2D" }, language: { name: "Georgian" } },
  tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 19 }], ...extra });
const identity = captureRefundIdentity(order());
const response = (value, status = 200) => ({ status, data: { data: value } });
const refunded = (extra = {}) => order({ status: "refunded", isUpcoming: false, isRefundable: false, ...extra });

test("server flags and coherent paid/Upcoming status own eligibility, regardless of dates", () => {
  assert.equal(refundEligible(order()), true); // Past calendar date is still server eligible.
  assert.equal(refundEligible(order({ session: { ...order().session, date: "2099-01-01" }, isRefundable: false })), false);
  for (const extra of [{ isRefundable: false }, { isRefundable: "true" }, { isUpcoming: false },
    { status: "refunded" }, { status: "held" }, { isRefundable: undefined }, { isUpcoming: 1 }]) {
    assert.equal(refundEligible(order(extra)), false);
  }
  assert.equal(readableRefundOrder(refunded()), true);
  assert.equal(refundEligible(refunded()), false);
  assert.equal(readableRefundOrder(order({ isUpcoming: false, isRefundable: false })), true);
});

test("identity capture is minimal, exact and immutable", () => {
  const original = order({ reference: "  Synthetic/Ref  " });
  const captured = captureRefundIdentity(original);
  assert.deepEqual(captured, { reference: original.reference, orderId: 7, sessionId: 10 });
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(matchesRefundReference(order({ reference: captured.reference }), captured), true);
  assert.equal(matchesRefundReference(order({ reference: captured.reference.trim() }), captured), false);
  assert.equal(matchesRefundReference(order({ reference: captured.reference.toUpperCase() }), captured), false);
  assert.equal(matchesRefundIdentity(order(), identity), true);
  for (const extra of [{ id: "7" }, { id: 8 }, { id: undefined }, { session: { id: 11 } },
    { session: { id: "10" } }, { session: null }, { reference: "other" }]) {
    assert.equal(matchesRefundIdentity(order(extra), identity), false);
  }
  for (const value of [null, [], { reference: 7 }, { reference: " " }, order({ id: "7" })]) {
    assert.equal(captureRefundIdentity(value), null);
  }
  assert.equal(matchesRefundIdentity(order({ id: "7" }), { reference: "SYNTHETIC-R", orderId: "7" }), false);
});

test("matching 200/refunded reports success separately from complete returned card adoption", () => {
  const complete = refunded();
  assert.deepEqual(classifyRefundResponse(response(complete), identity),
    { kind: "succeeded", reportedRefunded: true, displayStatus: "ready", order: complete });
  for (const value of [
    { reference: identity.reference, status: "refunded" },
    refunded({ totalPrice: NaN }), refunded({ tickets: [] }), refunded({ session: null }),
    refunded({ isUpcoming: true }), refunded({ isRefundable: true }),
    refunded({ isUpcoming: undefined }), refunded({ id: 8 }), refunded({ id: "7" }),
  ]) {
    assert.deepEqual(classifyRefundResponse(response(value), identity),
      { kind: "succeeded", reportedRefunded: true, displayStatus: "refreshing", order: null });
  }
});

test("missing/mismatched identity-status envelopes and undocumented success are ambiguous", () => {
  for (const value of [null, [], {}, order(), { reference: "other", status: "refunded" },
    { reference: identity.reference, status: "unknown" }, { status: "refunded" }]) {
    assert.equal(classifyRefundResponse(response(value), identity).kind, "uncertain");
  }
  assert.equal(classifyRefundResponse(response(refunded(), 201), identity).kind, "uncertain");
  assert.equal(classifyRefundResponse({ status: 200, data: "invalid" }, identity).kind, "uncertain");
});

test("Refund errors preserve refusals, distinguish 401 and never borrow Checkout 409 behavior", () => {
  const errors = { synthetic: ["Server validation detail"] };
  assert.deepEqual(classifyRefundError({ status: 422, data: { message: "Refused", errors } }),
    { kind: "rejected", status: 422, message: "Refused", reason: "refused", errors });
  assert.equal(classifyRefundError({ status: 401 }).kind, "unauthenticated");
  for (const status of [403, 404, 422]) assert.equal(classifyRefundError({ status }).kind, "rejected");
  for (const error of [undefined, new Error("401 Unauthenticated"), { status: 500 }, { status: 409 },
    { name: "AbortError" }, { status: 429 }]) assert.equal(classifyRefundError(error).kind, "uncertain");
});

function proof(disposition = "deadline-retired") {
  return {
    attempt: { accountId: 12, identity, phase: "uncertain", disposition, settledGeneration: 2 },
    read: { accountId: 12, authGeneration: 3, generation: 2, requestId: 8, unfiltered: true },
    current: { accountId: 12, authGeneration: 3, generation: 2, readRequestId: 8, hasActivePost: false },
  };
}
test("actual settlement and completed deadline retirement permit fresh verification prerequisites", () => {
  for (const disposition of ["settled", "deadline-retired"]) {
    const p = proof(disposition);
    assert.equal(verificationPrerequisites(p.attempt, p.read, p.current), true);
    assert.equal(reconfirmationEligible([order()], p.attempt, p.read, p.current), true);
  }
});

test("pending/aborted-only attempts, stale/filtered reads, auth/account changes and an active POST fail closed", () => {
  const p = proof();
  for (const change of [{ disposition: "pending" }, { disposition: "aborted" }, { phase: "submitting" },
    { settledGeneration: 3 }, { accountId: 99 }]) {
    assert.equal(verificationPrerequisites({ ...p.attempt, ...change }, p.read, p.current), false);
  }
  for (const change of [{ unfiltered: false }, { generation: 1 }, { generation: 3 }, { accountId: 99 },
    { authGeneration: 2 }, { requestId: 7 }]) {
    assert.equal(verificationPrerequisites(p.attempt, { ...p.read, ...change }, p.current), false);
  }
  assert.equal(verificationPrerequisites(p.attempt, p.read, { ...p.current, hasActivePost: true }), false);
  assert.equal(verificationPrerequisites(null, null, null), false);
});

test("factual verification distinguishes reported refund, warned retry availability, and inconclusive/ineligible data", () => {
  const p = proof();
  const classify = (orders) => classifyRefundVerification(orders, p.attempt, p.read, p.current);
  assert.equal(classify([order()]).kind, "retry_available");
  assert.equal(classify([{ reference: identity.reference, status: "refunded" }]).kind, "succeeded");
  assert.equal(classify([{ reference: identity.reference, status: "refunded" }]).order, null);
  assert.equal(classify([refunded()]).kind, "succeeded");
  assert.equal(classify([order({ isRefundable: false })]).kind, "ineligible");
  assert.equal(classify([order({ isUpcoming: false, isRefundable: false })]).kind, "ineligible");
  for (const orders of [[], [order(), order()], [order({ id: 8 })], [order({ totalPrice: Infinity })],
    [order({ isUpcoming: false })], [order({ reference: "other" })]]) {
    assert.equal(classify(orders).kind, "inconclusive");
  }
  assert.equal(classifyRefundVerification([order()], p.attempt, p.read,
    { ...p.current, hasActivePost: true }).kind, "blocked");
});
