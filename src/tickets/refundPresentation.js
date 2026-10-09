import { matchesRefundIdentity } from "./refundLifecycle.js";

export function sameRefundConfirmation(expected, current) {
  return Boolean(expected && current && expected.accountId === current.accountId
    && expected.authGeneration === current.authGeneration
    && expected.intentGeneration === current.intentGeneration
    && expected.readGeneration === current.readGeneration && expected.warning === current.warning
    && matchesRefundIdentity({ reference: current.identity.reference, id: current.identity.orderId,
      session: { id: current.identity.sessionId } }, expected.identity));
}

export function refundFeedback(record) {
  if (!record) return null;
  if (record.phase === "submitting") return { tone: "status", message: "Refund request in progress. Closing does not cancel the submitted request." };
  if (record.phase === "verifying") return { tone: "status", message: "Checking refund status…" };
  if (record.reportedRefunded) return { tone: "status", message: record.displayStatus === "refreshing"
    ? "Refund confirmed. Updating ticket details…" : record.displayStatus === "error"
      ? "Refund confirmed. Ticket details could not be loaded." : "Refund confirmed.",
  action: record.displayStatus === "error" ? "details" : null, viewPast: true };
  if (record.phase === "reauth") return { tone: "status", message: "Sign in with the same account to continue this refund." };
  if (record.phase === "verification_retry") return { tone: "alert", message: "Refund status could not be checked. Retry verification to read your tickets again.", action: "retry" };
  if (record.phase === "rejected") return { tone: "alert", message: record.message || "The refund request was refused.", action: "check" };
  if (record.phase === "retry_available") return { tone: "status", message: "Your tickets currently show this order as paid and refundable. The earlier request may still complete. A new refund requires a new confirmation.", action: "confirm" };
  if (record.phase === "uncertain") return { tone: "status", message: "We couldn't confirm whether your refund was completed."
    + (["ineligible", "inconclusive"].includes(record.reason) ? " Another refund cannot proceed from the current ticket details." : " Check status before considering another refund."), action: "check" };
  if (record.phase === "blocked") return { tone: "alert", message: record.reason === "unauthenticated"
    ? "Sign in to check this refund. The previous confirmation cannot continue."
    : "The previous confirmation cannot continue. Check current ticket details before starting another refund.", action: "check" };
  if (record.phase === "idle") return { tone: "status", message: "Ticket status checked. A new refund requires a new confirmation.", action: "confirm" };
  return null;
}
