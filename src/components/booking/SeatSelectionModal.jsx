import { useId, useLayoutEffect } from "react";
import Modal from "../Modal.jsx";
import { useBooking } from "../../booking/BookingContext.js";
import SeatMap from "./SeatMap.jsx";
import SelectedSeatsSummary from "./SelectedSeatsSummary.jsx";
import closeIcon from "../../assets/icons/close.svg";
import HoldTimer from "./HoldTimer.jsx";
import CheckoutHandoff from "./CheckoutHandoff.jsx";
import { HOLD_COPY } from "../../booking/holdLifecycle.js";

function ReadStatus({ read, label, onRetry }) {
  if (read.status !== "error") return null;
  return <div className="seat-selection__error" role="alert"><p>{read.error?.message ?? `Unable to load ${label}. Try again.`}</p><button type="button" className="button button--secondary" onClick={onRetry}>Retry {label}</button></div>;
}

function sessionMetadata(session) {
  if (!session) return "";
  const date = typeof session.date === "string" ? new Date(`${session.date}T12:00:00`) : null;
  const dateText = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date) : null;
  return [session.venue?.name, session.hall?.name && `Hall ${session.hall.name}`, dateText, session.time,
    session.format?.name, session.language?.name].filter(Boolean).join(" · ");
}

export default function SeatSelectionModal() {
  const id = useId();
  const { state, config, close, retry, toggleSeat, openerRef, startOver, expire, changed, unknownOwn, verifiedIds } = useBooking();
  const session = state.sessionRead.data;
  const terminal = [state.sessionRead, state.seatMapRead].some((read) => read.error?.status === 404);
  const pending = ["creating", "restoring", "releasing", "uncertain"].includes(state.hold.phase) || Boolean(state.recovery);
  const blocked = pending || terminal || state.sessionRead.status !== "ready" || state.seatMapRead.status !== "ready" || !config.ready;
  const checkout = state.step === "checkout" && state.hold.phase === "active" && Boolean(state.hold.data);
  useLayoutEffect(() => {
    // Move focus only when a transition removed the focused control.
    if (document.activeElement !== document.body) return;
    const target = checkout ? document.getElementById("booking-back")
      : document.getElementById(`booking-seat-${Object.keys(state.selection)[0]}`);
    (target && !target.disabled ? target : document.querySelector(".seat-selection__close"))?.focus();
  }, [checkout, state.selection]);
  const configurationFailure = !config.ready && config.recovery === "reload";
  const contextFailure = state.sessionRead.status === "ready" && !config.ready && config.recovery === "retry";
  const loadingStatus = terminal ? "" : [
    state.sessionRead.status === "loading" && "Loading booking details…",
    state.seatMapRead.status === "loading" && "Loading seat map…",
  ].filter(Boolean).join(" ");
  return (
    <Modal className="seat-selection" labelledBy={`${id}-title`} describedBy={`${id}-description`}
      onClose={close} openerRef={openerRef} focusKey={state.instanceId}>
      <div className="seat-selection__content">
        <header className="seat-selection__header">
          <div>
            <h2 id={`${id}-title`}>{session?.movie?.title ?? "Seat Selection"}</h2>
            <p className="seat-selection__metadata">{sessionMetadata(session)}</p>
          </div>
          <div className="seat-selection__header-actions">
            {state.hold.data && <HoldTimer hold={state.hold.data} onExpire={expire} />}
            <button type="button" className="seat-selection__close" data-initial-focus onClick={() => close()} aria-label="Close Seat Selection"><img src={closeIcon} alt="" /></button>
          </div>
        </header>
        <p id={`${id}-description`} className="visually-hidden">Choose seats and ticket types. Seats are reserved only after a successful booking hold.</p>
        <div className="seat-selection__body">
          {checkout ? <CheckoutHandoff /> : <>
          <div className="seat-selection__map-column">
            <ol className="seat-selection__progress" aria-label="Booking steps"><li aria-current="step">SEATS</li><li>CHECKOUT</li></ol>
            <div className="seat-selection__map-content">
              <div className="seat-selection__map-state">
                {terminal ? <p role="alert">This session is unavailable.</p> : <>
                  {state.recovery && <div className="seat-selection__error">
                    {state.recovery.retryable && <button type="button" className="button button--secondary" disabled={state.hold.phase === "restoring"} onClick={() => retry()}>Retry</button>}
                    <button type="button" className="button button--secondary" onClick={startOver}>Start over</button>
                  </div>}
                  <ReadStatus read={state.sessionRead} label="booking details" onRetry={() => retry("sessionRead")} />
                  <ReadStatus read={state.seatMapRead} label="seat map" onRetry={() => retry("seatMapRead")} />
                  {(configurationFailure || contextFailure) && <div className="seat-selection__error" role="alert">
                    <p>{config.error}</p>
                    <button type="button" className="button button--secondary" onClick={configurationFailure ? () => window.location.reload() : () => retry("sessionRead")}>
                      {configurationFailure ? "Reload page" : "Retry booking details"}
                    </button>
                  </div>}
                  {state.seatMapRead.data && !state.recovery && <SeatMap map={state.seatMapRead.data}
                    selection={state.selection} blocked={blocked} onToggle={toggleSeat} verifiedIds={verifiedIds} contested={state.contested} />}
                </>}
              </div>
              <p id="booking-selection-status" className="seat-selection__feedback" role="status" aria-live="polite" aria-atomic="true">
                {state.hold.phase === "creating" ? "Holding seats…" : state.feedback ?? (state.hold.phase === "restoring" ? "Restoring your seat hold…" : loadingStatus || (blocked ? "Seat selection is unavailable until booking details, seat map, and configuration are ready." : ""))}
              </p>
              {changed && !pending && <p className="seat-selection__feedback">{HOLD_COPY.changed}</p>}
              {unknownOwn && <p className="seat-selection__feedback">{HOLD_COPY.unknown}</p>}
              {state.releaseWarning && <p className="seat-selection__feedback" role="status">{state.releaseWarning}</p>}
            </div>
          </div>
          <div className="seat-selection__divider" aria-hidden="true" />
          <SelectedSeatsSummary />
          </>}
        </div>
      </div>
    </Modal>
  );
}
