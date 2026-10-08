import { useLayoutEffect, useRef } from "react";
import { useBooking } from "../../booking/BookingContext.js";

export default function OrderRecovery() {
  const { openOrderTickets, returnOrderHome } = useBooking();
  const heading = useRef(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  return <section className="order-recovery" aria-labelledby="order-recovery-heading">
    <h3 id="order-recovery-heading" ref={heading} tabIndex={-1}>We couldn't confirm whether your order was completed.</h3>
    <div className="order-recovery__actions">
      <button type="button" className="button button--primary" onClick={() => openOrderTickets()}>Check my tickets</button>
      <button type="button" className="button button--secondary" onClick={returnOrderHome}>Return to home</button>
    </div>
  </section>;
}
