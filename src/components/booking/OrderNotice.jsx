import { useBooking } from "../../booking/BookingContext.js";

export default function OrderNotice({ inline = false }) {
  const { orderNotice: notice, dismissOrderNotice, openOrderTickets } = useBooking();
  if (!notice) return null;
  return <aside className={`order-notice${inline ? " order-notice--inline" : ""}`} aria-label="Order notice">
    <p role="status">{notice.message}</p>
    <div className="order-notice__actions">
      <button type="button" className="button button--secondary" onClick={() => openOrderTickets({ noticeId: notice.id })}>
        {notice.kind === "success" ? "View my tickets" : "Check my tickets"}
      </button>
      <button type="button" className="button button--secondary" onClick={() => dismissOrderNotice(notice.id)}>Dismiss</button>
    </div>
  </aside>;
}
