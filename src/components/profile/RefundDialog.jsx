import { useId } from "react";
import Modal from "../Modal.jsx";
import RefundFeedback from "./RefundFeedback.jsx";
import { formatGEL } from "../../booking/seatSelection.js";
import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";
import closeIcon from "../../assets/icons/close.svg";

export default function RefundDialog({ order, warning, record, confirming, canConfirm, busy, onConfirm,
  onClose, openerRef, getFallbackFocus, onCheck, onRetry, onRenew, onViewPast, group }) {
  const id = useId(), pending = record?.phase === "submitting";
  return <Modal className="refund-dialog" labelledBy={id + "-title"} describedBy={id + "-description"}
    onClose={onClose} openerRef={openerRef} getFallbackFocus={getFallbackFocus}>
    <div className="refund-dialog__header">
      <h2 id={id + "-title"}>{confirming ? "Confirm refund" : "Refund status"}</h2>
      <button type="button" className="refund-dialog__close" aria-label="Close refund dialog" onClick={onClose}><img src={closeIcon} alt="" /></button>
    </div>
    <p id={id + "-description"}>Refunding this order is a real action and cannot be undone.</p>
    <div className="refund-dialog__order">
      <h3>{order.session.movie.title}</h3>
      <p>Order #{order.reference}</p>
      <p>{formatMovieDate(order.session.date, { weekday: "short", day: "numeric", month: "short" })} · {order.session.time}</p>
      <p>{order.session.venue.name} · Hall {order.session.hall.name} · {order.session.format.name} · {order.session.language.name}</p>
      <ul aria-label="Tickets to refund">{order.tickets.map((ticket, index) => <li key={index}>Seat {ticket.seatCode} · {ticket.ticketType.name}</li>)}</ul>
      <p>Total paid: {formatGEL(order.totalPrice * 100)}</p>
    </div>
    {confirming ? <form onSubmit={event => { event.preventDefault(); if (canConfirm && !busy) onConfirm(); }}>
      {warning && <p className="refund-dialog__warning" id={id + "-warning"}>{warning}</p>}
      {!canConfirm && <p role="alert">Ticket details changed. Close this dialog and check refund status before starting a new confirmation.</p>}
      <div className="refund-dialog__actions">
        <button type="button" className="button button--secondary" data-initial-focus onClick={onClose}>Cancel</button>
        <button type="submit" className="button button--primary" disabled={!canConfirm || busy} aria-describedby={warning ? id + "-warning" : undefined}>Confirm refund</button>
      </div>
    </form> : <>
      <div aria-busy={pending}>
        <RefundFeedback record={record} busy={busy} canConfirm={canConfirm} onConfirm={onRenew}
          onCheck={onCheck} onRetry={onRetry} onViewPast={onViewPast} group={group} />
      </div>
      <div className="refund-dialog__actions">
        <button type="button" className="button button--secondary" data-initial-focus onClick={onClose}>Close</button>
        {pending && <button type="button" className="button button--primary" disabled>Refunding…</button>}
      </div>
    </>}
  </Modal>;
}
