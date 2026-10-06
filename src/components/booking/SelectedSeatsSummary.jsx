import { useBooking } from "../../booking/BookingContext.js";
import { formatGEL, selectedSeatPreviews, subtotalCents } from "../../booking/seatSelection.js";
import TicketTypeSelect from "./TicketTypeSelect.jsx";
import removeIcon from "../../assets/icons/seat-remove.svg";

export default function SelectedSeatsSummary() {
  const { state, filterOptions, config, removeSeat, setTicket } = useBooking();
  const previews = selectedSeatPreviews(state.selection, state.seatMapRead.data, state.sessionRead.data, filterOptions);
  const max = filterOptions?.maxSeatsPerOrder;
  return (
    <aside className="seat-summary" aria-label="Selected seats">
      <div className="seat-summary__selections">
        <h3>Your seats{Number.isSafeInteger(max) ? ` · Max ${max}` : ""}</h3>
        {previews.length === 0 && <p className="seat-summary__helper">{Number.isSafeInteger(max) ? `Pick up to ${max} seats from the map. ` : ""}Each seat can carry its own ticket type.</p>}
        <div className="seat-summary__cards">
          {previews.map(({ seat, type, cents }) => (
            <div className="seat-summary__card" key={seat.id}>
              <div className="seat-summary__card-heading">
                <span className="seat-summary__seat-label">Seat <strong>{seat.code}</strong></span>
                <span className="seat-summary__price">{formatGEL(cents)}</span>
                <button className="seat-summary__remove" type="button" onClick={() => {
                  removeSeat(seat.id);
                  document.getElementById(`booking-seat-${seat.id}`)?.focus();
                }} aria-label={`Remove seat ${seat.code}`}><img src={removeIcon} alt="" /></button>
              </div>
              <div className="seat-summary__card-divider" />
              <TicketTypeSelect seat={seat} types={config.types} selectedSlug={type.slug} onChange={(slug) => setTicket(seat.id, slug)} />
            </div>
          ))}
        </div>
      </div>
      <div className="seat-summary__checkout">
        <div className="seat-summary__subtotal" role="status" aria-live="polite" aria-atomic="true">
          <span>SUBTOTAL</span><strong>{formatGEL(subtotalCents(previews))}</strong>
        </div>
        <button type="button" className="button button--primary" disabled>Next: Checkout</button>
      </div>
    </aside>
  );
}
