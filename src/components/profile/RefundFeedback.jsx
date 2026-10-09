import { refundFeedback } from "../../tickets/refundPresentation.js";

export default function RefundFeedback({ record, busy, canConfirm, onConfirm, onCheck, onRetry, onViewPast, group }) {
  const feedback = refundFeedback(record);
  if (!feedback) return null;
  return <div className="refund-feedback" data-refund-reference={record.identity.reference}>
    <p className="refund-feedback__reference">Order #{record.identity.reference}</p>
    <p role={feedback.tone} aria-atomic="true">{feedback.message}</p>
    {record.priorUncertainty && !record.reportedRefunded && !["uncertain", "retry_available"].includes(record.phase)
      && <p className="refund-feedback__uncertainty">The outcome of an earlier refund request is still unconfirmed.</p>}
    <div className="refund-feedback__actions">
      {["check", "details"].includes(feedback.action) && <button type="button" className="button button--secondary" disabled={busy} onClick={onCheck}>
        {feedback.action === "details" ? "Retry ticket details" : "Check refund status"}</button>}
      {feedback.action === "retry" && <button type="button" className="button button--secondary" disabled={busy} onClick={onRetry}>Retry verification</button>}
      {feedback.action === "confirm" && <button type="button" className="button button--secondary" disabled={busy || !canConfirm} onClick={onConfirm}>
        {record.priorUncertainty ? "Refund again" : "Confirm a new refund"}</button>}
      {feedback.action === "confirm" && <button type="button" className="button button--secondary" disabled={busy} onClick={onCheck}>Check refund status</button>}
      {feedback.viewPast && group !== "past" && <button type="button" className="button button--secondary" onClick={onViewPast}>View past tickets</button>}
    </div>
  </div>;
}
