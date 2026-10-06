import { useBooking } from "../../booking/BookingContext.js";
import { formatGEL } from "../../booking/seatSelection.js";

export default function CheckoutHandoff() {
  const { state, back } = useBooking();
  const hold = state.hold.data;
  if (!hold) return null;
  return <>
    <div className="seat-selection__map-column">
      <ol className="seat-selection__progress" aria-label="Booking steps"><li>SEATS</li><li aria-current="step">CHECKOUT</li></ol>
      <div className="seat-selection__checkout-content"><button type="button" id="booking-back" className="button button--secondary" onClick={back}>Back</button></div>
    </div>
    <div className="seat-selection__divider" aria-hidden="true" />
    <aside className="seat-summary" aria-label="Held seats">
      <div className="seat-summary__selections">
        <h3>Your seats</h3>
        <div className="seat-summary__cards">{hold.seats.map((seat) => <div className="seat-summary__card seat-summary__card--held" key={seat.seatId}>
          <div className="seat-summary__card-heading"><span className="seat-summary__seat-label">Seat <strong>{seat.code}</strong></span><span className="seat-summary__price">{formatGEL(seat.price * 100)}</span></div>
          <div className="seat-summary__card-divider" /><p>{seat.ticketType.name}</p>
        </div>)}</div>
      </div>
      <div className="seat-summary__subtotal"><span>SUBTOTAL</span><strong>{formatGEL(hold.subtotal * 100)}</strong></div>
    </aside>
  </>;
}
