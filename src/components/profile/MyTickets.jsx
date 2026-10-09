import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ROUTES, ticketsGroup, ticketsGroupSearch } from "../../routing/routes.js";
import { findRecoveredOrder, groupTicketOrders } from "../../tickets/ticketGroups.js";
import { useBooking } from "../../booking/BookingContext.js";
import useTickets from "../../tickets/useTickets.js";
import { formatGEL } from "../../booking/seatSelection.js";
import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";
import MovieImage from "../home/MovieImage.jsx";
import AgeBadge from "../home/AgeBadge.jsx";
import { useAuth } from "../../auth/AuthContext.js";
import { useRefund } from "../../tickets/RefundContext.js";
import { matchesRefundIdentity, refundEligible } from "../../tickets/refundLifecycle.js";
import { sameRefundConfirmation } from "../../tickets/refundPresentation.js";
import RefundDialog from "./RefundDialog.jsx";
import RefundFeedback from "./RefundFeedback.jsx";

function TicketOrder({ order, recovered, claimRecoveryFocus, refund }) {
  const id = useId(), element = useRef(null);
  useEffect(() => {
    if (recovered && element.current?.isConnected && claimRecoveryFocus(order.reference)) {
      element.current.focus();
    }
  }, [recovered, claimRecoveryFocus, order.reference]);
  const { session } = order;
  const rating = typeof session.movie.ageRating?.code === "string" && session.movie.ageRating.code.trim() ? session.movie.ageRating : null;
  const runtime = Number.isInteger(session.movie.runtimeMinutes) ? session.movie.runtimeMinutes : null;
  const poster = typeof session.movie.posterUrl === "string" && session.movie.posterUrl.trim() ? session.movie.posterUrl : null;
  const showRefund = refund && order.status === "paid" && order.isUpcoming === true;
  const canRefund = showRefund && Boolean(refund.runtime.confirmationDetails(order));
  const refundHelp = refund?.snapshot.busy ? "A refund request is in progress."
    : order.isRefundable === false ? "This order is not refundable. Refunds are available until 2 hours before the session."
      : !refundEligible(order) ? "Refund unavailable because ticket details could not be verified."
        : !canRefund ? "Check refund status before confirming another refund." : null;
  return <article ref={element} tabIndex={-1} className={`my-tickets__order${recovered ? " my-tickets__order--recovered" : ""}`} aria-labelledby={`${id}-title ${id}-reference`}>
    <div className="my-tickets__details">
      <MovieImage src={poster} title={session.movie.title} />
      <div className="my-tickets__movie">
        <div className="my-tickets__title-row">
          <h3 id={`${id}-title`}>{session.movie.title}</h3>
          <AgeBadge rating={rating} />
          {runtime !== null && <span className="my-tickets__runtime">{runtime} min</span>}
        </div>
        <dl className="my-tickets__metadata">
          <div><dt>Date</dt><dd>{formatMovieDate(session.date, { weekday: "short", day: "numeric", month: "short" })} · {session.time}</dd></div>
          <div><dt>Venue</dt><dd>{session.venue.name} · Hall {session.hall.name}</dd></div>
          <div><dt>Format</dt><dd>{session.format.name} · {session.language.name}</dd></div>
        </dl>
        <div className="my-tickets__seat-row">
          <span className="my-tickets__label">Seats</span>
          <ul className="my-tickets__seats" aria-label="Purchased tickets">
            {order.tickets.map((ticket, index) => <li key={index}>
              <span className="visually-hidden">Seat </span>{ticket.seatCode} · {ticket.ticketType.name}
              <span className="visually-hidden"> · Ticket price {formatGEL(ticket.price * 100)}</span>
            </li>)}
          </ul>
        </div>
      </div>
    </div>
    <div className="my-tickets__stub">
      <div><span className="my-tickets__label">Order</span><p id={`${id}-reference`}>#{order.reference}</p></div>
      <div className="my-tickets__amount">
        <div className="my-tickets__total"><span>Total paid</span><strong>{formatGEL(order.totalPrice * 100)}</strong></div>
        <p className={`my-tickets__status my-tickets__status--${order.status}`}>{order.status === "paid" ? "Paid" : "Refunded"}</p>
        {showRefund && <>
          <button type="button" className="my-tickets__refund" disabled={!canRefund}
            aria-label={`Refund order ${order.reference}`} aria-describedby={refundHelp ? id + "-refund-help" : undefined}
            title={refundHelp ?? undefined} onClick={event => refund.open(order, event.currentTarget)}>Refund</button>
          {refundHelp && <p className="my-tickets__refund-help" id={id + "-refund-help"}>{refundHelp}</p>}
        </>}
      </div>
    </div>
  </article>;
}

const GROUPS = [{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }];

export function TicketsContent({ read, identity = null, group = "upcoming", onSelectGroup, refund = null }) {
  const id = useId(), tabs = useRef({}), focusedRecovery = useRef(null), requestedRecovery = useRef(null);
  const entryFocus = useRef(typeof document === "undefined" ? null : document.activeElement), focusMoved = useRef(false);
  useEffect(() => {
    // Capture the focus restored by the departing Checkout dialog.
    entryFocus.current = document.activeElement;
    const preserveFocus = (event) => { if (event.target !== entryFocus.current) focusMoved.current = true; };
    document.addEventListener("focusin", preserveFocus);
    return () => document.removeEventListener("focusin", preserveFocus);
  }, []);
  const ready = read.status === "success" || read.status === "empty";
  const groups = ready ? read.groups ?? groupTicketOrders(read.data ?? []) : null;
  const orders = groups?.[group] ?? [];
  const recovered = ready ? findRecoveredOrder(read.data ?? [], identity) : null;
  const claimRecoveryFocus = useCallback((reference) => {
    const key = JSON.stringify([identity, reference]);
    const requested = requestedRecovery.current === reference;
    if (requested) requestedRecovery.current = null;
    if (!requested && focusedRecovery.current === key) return false;
    focusedRecovery.current = key;
    // A late read or ordinary tab navigation must preserve the user’s focus.
    // The explicit recovery action may still reveal and focus its matching card.
    if (requested) return true;
    if (focusMoved.current) return false;
    const active = document.activeElement;
    return !active?.isConnected || active === document.body || active === document.documentElement
      || (active === entryFocus.current && !active.closest(".my-tickets"));
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
  return <section ref={refund?.elementRef} className="my-tickets" aria-labelledby={id + "-title"}>
    <h2 id={id + "-title"} className="visually-hidden">My Tickets</h2>
    <div className="my-tickets__tabs" role="tablist" aria-label="Ticket groups" onKeyDown={navigateTabs}>
      {GROUPS.map(({ value, label }) => <button key={value} ref={(element) => { tabs.current[value] = element; }}
        id={id + "-tab-" + value} type="button" role="tab" aria-selected={group === value}
        aria-controls={id + "-panel"} tabIndex={group === value ? 0 : -1} onClick={() => select(value)}>
        <span>{label}</span><span className="my-tickets__count" aria-hidden={groups ? undefined : true}>{groups ? groups[value].length : "—"}</span>
      </button>)}
    </div>
    {refund?.snapshot.busy && !refund.snapshot.records.some(record => record.phase === "submitting")
      && <p role="status">A refund request is still in progress. New refunds are unavailable until it settles.</p>}
    {refund?.snapshot.records.map(record => <RefundFeedback key={record.identity.reference} record={record}
      busy={refund.snapshot.busy || refund.runtime.isVerifying()}
      canConfirm={Boolean(refund.findOrder(record) && refund.runtime.confirmationDetails(refund.findOrder(record)))}
      onConfirm={event => refund.open(refund.findOrder(record), event.currentTarget)}
      onCheck={() => { void refund.runtime.checkStatus(record.identity.reference); }}
      onRetry={() => { void refund.runtime.retryVerification(); }} onViewPast={refund.viewPast} group={group} />)}
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
        <button type="button" className="button button--secondary" onClick={() => { requestedRecovery.current = recovered.reference; select(recoveredGroup); }}>View matching order in {recoveredGroup === "past" ? "Past" : "Upcoming"}</button>
      </div>}
      {orders.map((order) => <TicketOrder key={order.reference} order={order} recovered={order === recovered} claimRecoveryFocus={claimRecoveryFocus} refund={refund} />)}
    </div>
  </section>;
}

const NO_REFUND = Object.freeze({ busy: false, records: [] });
const noSubscribe = () => () => {};
const noSnapshot = () => NO_REFUND;

export default function MyTickets() {
  const { consumeTicketsRecovery } = useBooking();
  const read = useTickets(consumeTicketsRecovery);
  const runtime = useRefund(), { getSessionIdentity } = useAuth();
  const snapshot = useSyncExternalStore(runtime?.subscribe ?? noSubscribe, runtime?.snapshot ?? noSnapshot, noSnapshot);
  const [selection, setSelection] = useState(null);
  const openerRef = useRef(null), elementRef = useRef(null);
  const requestedGroupFocus = useRef(null);
  const getFallbackFocus = useCallback(() => elementRef.current?.querySelector('[role="tab"][aria-selected="true"]'), []);
  const [search, setSearch] = useSearchParams();
  const group = ticketsGroup(search);
  useLayoutEffect(() => {
    const requested = requestedGroupFocus.current;
    if (!requested || requested.group !== group) return;
    requestedGroupFocus.current = null;
    const current = getSessionIdentity?.(), active = document.activeElement;
    // Only the explicit View past action requests this handoff. A later user
    // focus move or account change cancels it; ordinary tab changes never focus.
    if (current?.accountId === requested.accountId && current.generation === requested.authGeneration
      && (active === requested.previous || active === document.body || !active?.isConnected)) getFallbackFocus()?.focus();
  }, [group, getSessionIdentity, getFallbackFocus]);
  const selectGroup = (value) => {
    if (value !== group) setSearch((current) => ticketsGroupSearch(current, value));
  };
  const findOrder = record => ["success", "empty"].includes(read.status)
    ? read.data.find(order => matchesRefundIdentity(order, record.identity)) : null;
  function open(order, opener) {
    const details = runtime?.confirmationDetails(order);
    if (!details) return;
    if (!opener?.closest("dialog")) openerRef.current = opener;
    setSelection({ order, details, requestId: null });
  }
  const session = getSessionIdentity?.();
  const ownsSelection = selection && session?.accountId === selection.details.accountId
    && session.generation === selection.details.authGeneration;
  const record = ownsSelection ? snapshot.records.find(value => value.identity.reference === selection.order.reference) : null;
  const visible = ownsSelection && (selection.requestId === null || record?.requestId === selection.requestId);
  const confirming = selection?.requestId === null;
  const canConfirm = visible && !selection.invalid && (confirming
    ? sameRefundConfirmation(selection.details, runtime.confirmationDetails(selection.order))
    : Boolean(findOrder(record) && runtime.confirmationDetails(findOrder(record))));
  function confirm() {
    // A stale handler must independently revalidate the dialog's read authority.
    if (!visible || !confirming || !sameRefundConfirmation(selection.details, runtime.confirmationDetails(selection.order))) return;
    const consent = runtime.createConsent(selection.order, { confirmed: true,
      warningAcknowledged: Boolean(selection.details.warning) });
    if (!consent) { setSelection({ ...selection, invalid: true }); return; }
    void runtime.submit(consent, selection.order);
    const submitted = runtime.snapshot().records.find(value => value.identity.reference === selection.order.reference);
    setSelection(submitted?.phase === "submitting" && submitted.consentGeneration === consent.consentGeneration
      ? { ...selection, requestId: submitted.requestId } : { ...selection, invalid: true });
  }
  function close() {
    if (visible && selection.requestId !== null && record?.requestId === selection.requestId) runtime.cancelIntent();
    setSelection(null);
  }
  function viewPast() {
    requestedGroupFocus.current = { group: "past", accountId: session?.accountId,
      authGeneration: session?.generation, previous: getFallbackFocus() };
    close(); selectGroup("past");
  }
  return <>
    <TicketsContent read={read} identity={read.identity} group={group} onSelectGroup={selectGroup}
      refund={runtime ? { runtime, snapshot, open, findOrder, elementRef, viewPast } : null} />
    {visible && <RefundDialog order={record?.reportedRefunded && findOrder(record) ? findOrder(record) : selection.order} warning={selection.details.warning} record={record}
      confirming={confirming} canConfirm={canConfirm} busy={snapshot.busy || runtime.isVerifying()}
      onConfirm={confirm} onClose={close} openerRef={openerRef} getFallbackFocus={getFallbackFocus}
      onCheck={() => { void runtime.checkStatus(selection.order.reference); }}
      onRetry={() => { void runtime.retryVerification(); }}
      onRenew={event => open(findOrder(record), event.currentTarget)}
      onViewPast={viewPast} group={group} />}
  </>;
}
