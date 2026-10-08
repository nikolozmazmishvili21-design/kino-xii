import { useEffect, useId, useRef } from "react";
import { useBooking } from "../../booking/BookingContext.js";
import useTickets from "../../tickets/useTickets.js";
import { formatGEL } from "../../booking/seatSelection.js";
import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";
import MovieImage from "../home/MovieImage.jsx";

function matches(order, identity) {
  const fields = Object.entries(identity ?? {}).filter(([field]) => field === "id" || field === "reference");
  return fields.length > 0 && fields.every(([field, value]) => order[field] === value);
}

function TicketOrder({ order, recovered }) {
  const id = useId(), element = useRef(null), focused = useRef(false);
  useEffect(() => {
    if (recovered && !focused.current && element.current?.isConnected) {
      focused.current = true;
      element.current.focus();
    }
  }, [recovered]);
  const { session } = order;
  const poster = typeof session.movie.posterUrl === "string" && session.movie.posterUrl.trim() ? session.movie.posterUrl : null;
  return <article ref={element} tabIndex={-1} className={`my-tickets__order${recovered ? " my-tickets__order--recovered" : ""}`} aria-labelledby={`${id}-title ${id}-reference`}>
    <div className="my-tickets__details">
      <MovieImage src={poster} title={session.movie.title} />
      <div className="my-tickets__movie">
        <h3 id={`${id}-title`}>{session.movie.title}</h3>
        <dl className="my-tickets__metadata">
          <div><dt>Date</dt><dd>{formatMovieDate(session.date, { weekday: "short", day: "numeric", month: "short" })} · {session.time}</dd></div>
          <div><dt>Venue</dt><dd>{session.venue.name} · Hall {session.hall.name}</dd></div>
          <div><dt>Format / language</dt><dd>{session.format.name} · {session.language.name}</dd></div>
        </dl>
        <ul className="my-tickets__seats" aria-label="Purchased tickets">
          {order.tickets.map((ticket, index) => <li key={index}>Seat {ticket.seatCode} · {ticket.ticketType.name} · {formatGEL(ticket.price * 100)}</li>)}
        </ul>
      </div>
    </div>
    <div className="my-tickets__stub">
      <div><span className="my-tickets__label">Order</span><p id={`${id}-reference`}>#{order.reference}</p></div>
      <p className={`my-tickets__status my-tickets__status--${order.status}`}>{order.status === "paid" ? "Paid" : "Refunded"}</p>
      <div className="my-tickets__total"><span>Total paid</span><strong>{formatGEL(order.totalPrice * 100)}</strong></div>
    </div>
  </article>;
}

export function TicketsContent({ read, identity = null }) {
  return <section className="my-tickets" aria-labelledby="my-tickets-title">
    <h2 id="my-tickets-title" className="visually-hidden">My Tickets</h2>
    {read.status === "loading" && <p role="status">Loading your tickets…</p>}
    {read.status === "unauthenticated" && <p role="status">Please sign in to view your tickets.</p>}
    {read.status === "empty" && <p>No tickets yet.</p>}
    {read.status === "error" && <div className="my-tickets__error"><p role="alert">{read.error}</p><button type="button" className="button button--secondary" onClick={read.retry}>Retry tickets</button></div>}
    {read.status === "success" && read.data.map((order, index) => <TicketOrder key={index} order={order} recovered={matches(order, identity)} />)}
  </section>;
}

export default function MyTickets() {
  const { consumeTicketsRecovery } = useBooking();
  const read = useTickets(consumeTicketsRecovery);
  return <TicketsContent read={read} identity={read.identity} />;
}
