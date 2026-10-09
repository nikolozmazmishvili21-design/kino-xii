import { test } from "node:test";
import assert from "node:assert/strict";
import { refundFeedback, sameRefundConfirmation } from "../src/tickets/refundPresentation.js";

test("pending and verification presentation cannot show a preceding server refusal", () => {
  for (const phase of ["submitting", "verifying"]) {
    const feedback = refundFeedback({ phase, message: "Previous 422 refusal", reason: "refused" });
    assert.equal(feedback.tone, "status");
    assert.doesNotMatch(feedback.message, /Previous|refused/);
  }
});
test("reported refund remains factual while details refresh or fail", () => {
  for (const displayStatus of ["ready", "refreshing", "error"]) {
    const feedback = refundFeedback({ phase: "succeeded", reportedRefunded: true, displayStatus });
    assert.match(feedback.message, /^Refund confirmed/);
    assert.equal(feedback.viewPast, true);
    assert.notEqual(feedback.action, "confirm");
  }
});
test("refusal preserves the exact business message while uncertainty offers factual reads", () => {
  assert.equal(refundFeedback({ phase: "rejected", message: "Already refunded on the server" }).message, "Already refunded on the server");
  const unknown = refundFeedback({ phase: "uncertain", reason: "inconclusive" });
  assert.match(unknown.message, /couldn't confirm/); assert.match(unknown.message, /cannot proceed/);
  assert.equal(unknown.action, "check");
  assert.equal(refundFeedback({ phase: "verification_retry" }).action, "retry");
  assert.equal(refundFeedback({ phase: "retry_available" }).action, "confirm");
});
test("a confirmation presentation is obsolete after auth, read, intent, warning or identity changes", () => {
  const initial = { accountId: 12, authGeneration: 1, intentGeneration: 2, readGeneration: 3,
    warning: "Required warning", identity: { reference: "EXACT / REF", orderId: 7, sessionId: 10 } };
  assert.equal(sameRefundConfirmation(initial, structuredClone(initial)), true);
  for (const change of [{ accountId: 13 }, { authGeneration: 2 }, { intentGeneration: 3 }, { readGeneration: 4 },
    { warning: null }, { identity: { ...initial.identity, reference: "exact / ref" } },
    { identity: { ...initial.identity, orderId: 8 } }, { identity: { reference: initial.identity.reference } },
    { identity: { ...initial.identity, sessionId: 11 } }]) {
    assert.equal(sameRefundConfirmation(initial, { ...initial, ...change }), false);
  }
  assert.equal(sameRefundConfirmation(null, initial), false);
});
