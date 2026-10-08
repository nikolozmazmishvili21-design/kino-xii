import { useCallback, useEffect, useId, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ROUTES, ticketsGroup, ticketsGroupSearch } from "../../routing/routes.js";
import { findRecoveredOrder, groupTicketOrders } from "../../tickets/ticketGroups.js";
import { useBooking } from "../../booking/BookingContext.js";
import useTickets from "../../tickets/useTickets.js";
import { formatGEL } from "../../booking/seatSelection.js";
import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";
import MovieImage from "../home/MovieImage.jsx";

function TicketOrder({ order, recovered, claimRecoveryFocus }) {
  const id = useId(), element = useRef(null);
  useEffect(() => {
    if (recovered && element.current?.isConnected && claimRecoveryFocus(order.reference)) {
      element.current.focus();
    }
  }, [recovered, claimRecoveryFocus, order.reference]);
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

const GROUPS = [{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }];

export function TicketsContent({ read, identity = null, group = "upcoming", onSelectGroup }) {
  const id = useId(), tabs = useRef({}), focusedRecovery = useRef(null);
  const ready = read.status === "success" || read.status === "empty";
  const groups = ready ? read.groups ?? groupTicketOrders(read.data ?? []) : null;
  const orders = groups?.[group] ?? [];
  const recovered = ready ? findRecoveredOrder(read.data ?? [], identity) : null;
  const claimRecoveryFocus = useCallback((reference) => {
    const key = JSON.stringify([identity, reference]);
    if (focusedRecovery.current === key) return false;
    focusedRecovery.current = key;
    return true;
  }, [identity]);
  const select = (value) => onSelectGroup?.(value);
  function navigateTabs(event) {
    const next = event.key === "ArrowLeft" || event.key === "ArrowRight" ? (group === "upcoming" ? "past" : "upcoming")
      : event.key === "Home" ? "upcoming" : event.key === "End" ? "past" : null;
    if (!next) return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }
  const recoveredGroup = recovered ? (recovered.isUpcoming ? "upcoming" : "past") : null;
  return <section className="my-tickets" aria-labelledby={id + "-title"}>
    <h2 id={id + "-title"} className="visually-hidden">My Tickets</h2>
    <div className="my-tickets__tabs" role="tablist" aria-label="Ticket groups" onKeyDown={navigateTabs}>
      {GROUPS.map(({ value, label }) => <button key={value} ref={(element) => { tabs.current[value] = element; }}
        id={id + "-tab-" + value} type="button" role="tab" aria-selected={group === value}
        aria-controls={id + "-panel"} tabIndex={group === value ? 0 : -1} onClick={() => select(value)}>
        <span>{label}</span><span className="my-tickets__count">{groups ? groups[value].length : "—"}</span>
      </button>)}
    </div>
    <div id={id + "-panel"} className="my-tickets__panel" role="tabpanel" aria-labelledby={id + "-tab-" + group} aria-busy={read.status === "loading"} tabIndex={0}>
      {read.status === "loading" && <p role="status">Loading your tickets…</p>}
      {read.status === "unauthenticated" && <p role="status">Please sign in to view your tickets.</p>}
      {read.status === "error" && <div className="my-tickets__error"><p role="alert">{read.error}</p><button type="button" className="button button--secondary" onClick={read.retry}>Retry tickets</button></div>}
      {ready && !orders.length && <div className="my-tickets__empty">
        <p>{group === "upcoming" ? "No upcoming tickets yet." : "No past tickets yet."}</p>
        {group === "upcoming" ? <Link to={ROUTES.sessions}>Browse sessions</Link> : <p>Completed and refunded orders will appear here.</p>}
      </div>}
      {recoveredGroup && recoveredGroup !== group && <div className="my-tickets__recovery" role="status">
        <p>The order matching your recovery details is in {recoveredGroup === "past" ? "Past" : "Upcoming"}.</p>
        <button type="button" className="button button--secondary" onClick={() => select(recoveredGroup)}>View matching order in {recoveredGroup === "past" ? "Past" : "Upcoming"}</button>
      </div>}
      {orders.map((order) => <TicketOrder key={order.reference} order={order} recovered={order === recovered} claimRecoveryFocus={claimRecoveryFocus} />)}
    </div>
  </section>;
}

export default function MyTickets() {
  const { consumeTicketsRecovery } = useBooking();
  const read = useTickets(consumeTicketsRecovery);
  const [search, setSearch] = useSearchParams();
  const group = ticketsGroup(search);
  const selectGroup = (value) => {
    if (value !== group) setSearch((current) => ticketsGroupSearch(current, value));
  };
  return <TicketsContent read={read} identity={read.identity} group={group} onSelectGroup={selectGroup} />;
}
