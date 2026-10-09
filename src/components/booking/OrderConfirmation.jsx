import { useLayoutEffect, useRef } from "react";
import { useBooking } from "../../booking/BookingContext.js";
import { formatGEL } from "../../booking/seatSelection.js";
import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";
import MovieImage from "../home/MovieImage.jsx";
import confirmedIcon from "../../assets/icons/order-confirmed.svg";

export default function OrderConfirmation({ headingId }) {
  const { state, completeOrderFlow } = useBooking();
  const order = state.order.data;
  const heading = useRef(null);
  useLayoutEffect(() => {
    if (heading.current?.isConnected) heading.current.focus();
  }, [order]);
  const { session, tickets } = order;
  const ticketCounts = new Map();
  for (const ticket of tickets) {
    const name = ticket.ticketType.name;
    ticketCounts.set(name, (ticketCounts.get(name) ?? 0) + 1);
  }
  const ticketSummary = [...ticketCounts].map(([name, count]) => `${count} x ${name}`).join(", ");
  const poster = typeof session.movie.posterUrl === "string" && session.movie.posterUrl.trim() ? session.movie.posterUrl : null;
  const metadata = [session.venue.name, `Hall ${session.hall.name}`,
    formatMovieDate(session.date, { weekday: "short", day: "numeric", month: "short" }), session.time,
    session.format.name, session.language.name].join(" · ");
  return <section className="order-confirmation" aria-labelledby={headingId}>
    <header className="order-confirmation__header">
      <span className="order-confirmation__success" aria-hidden="true"><img src={confirmedIcon} alt="" /></span>
      <div className="order-confirmation__message">
        <h2 id={headingId} ref={heading} tabIndex={-1}>Booking confirmed!</h2>
        <p className="order-confirmation__description">Your tickets are ready.</p>
      </div>
      <p className="order-confirmation__reference">ORDER #{order.reference}</p>
    </header>
    <div className="order-confirmation__summary">
      <div className="order-confirmation__movie">
        <MovieImage src={poster} title={session.movie.title} />
        <div><h3>{session.movie.title}</h3><p>{metadata}</p></div>
      </div>
      <div className="order-confirmation__divider" role="separator" />
      <dl className="order-confirmation__details">
        <div className="order-confirmation__detail"><dt>Seats</dt><dd className="order-confirmation__seats">{tickets.map((ticket) => ticket.seatCode).join(", ")}</dd></div>
        <div className="order-confirmation__detail"><dt>Tickets</dt><dd>{ticketSummary}</dd></div>
      </dl>
      <div className="order-confirmation__divider" role="separator" />
      <div className="order-confirmation__total"><span>TOTAL PAID</span><strong>{formatGEL(order.totalPrice * 100)}</strong></div>
    </div>
    {/* Retain each server-returned price for assistive technology without changing the Figma card layout. */}
    <ul className="visually-hidden" aria-label="Purchased tickets">
      {tickets.map((ticket, index) => <li key={index}>
        <span>Seat {ticket.seatCode} · {ticket.ticketType.name}</span><strong>{formatGEL(ticket.price * 100)}</strong>
      </li>)}
    </ul>
    <footer className="order-confirmation__actions">
      <button type="button" className="button button--primary" onClick={() => completeOrderFlow("tickets")}>View my tickets</button>
      <button type="button" className="button button--secondary" onClick={() => completeOrderFlow("home")}>Back to home</button>
    </footer>
  </section>;
}
