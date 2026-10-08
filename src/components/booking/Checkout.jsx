import { useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.js";
import { useBooking } from "../../booking/BookingContext.js";
import { createOrder } from "../../api/bookingApi.js";
import { firstInvalidCheckoutField, normalizeCheckoutFields, validateCheckout, validateCheckoutField } from "../../validation/checkoutValidation.js";
import { formatGEL } from "../../booking/seatSelection.js";
import FormField from "../forms/FormField.jsx";

const controls = {
  fullName: { label: "Full Name", autoComplete: "name" },
  email: { label: "Email", type: "email", autoComplete: "email" },
  mobileNumber: { label: "Mobile Number", type: "tel", autoComplete: "tel-national", inputMode: "tel" },
  cardNumber: { label: "Card Number", autoComplete: "cc-number", inputMode: "numeric", placeholder: "e.g. 1234 4567 8901 2345" },
  expiry: { label: "Expiry", autoComplete: "cc-exp", placeholder: "MM/YY" },
  cvv: { label: "CVV", autoComplete: "cc-csc", inputMode: "numeric" },
};
const withoutPayment = (draft) => ({ ...draft, cardNumber: "", expiry: "", cvv: "" });
const withoutPaymentErrors = (errors) => Object.fromEntries(Object.entries(errors).filter(([field]) => !["cardNumber", "expiry", "cvv"].includes(field)));

export default function Checkout() {
  const { user } = useAuth();
  const { state, back, submitOrder, canSubmitOrder } = useBooking();
  const [draft, setDraft] = useState(() => ({ fullName: user?.fullName ?? "", email: user?.email ?? "",
    mobileNumber: user?.mobileNumber ?? "", cardNumber: "", expiry: "", cvv: "" }));
  const [errors, setErrors] = useState({});
  const [general, setGeneral] = useState([]);
  const [focusRequest, setFocusRequest] = useState(null);
  const inputs = useRef({}), active = useRef(false);
  const serverInvalid = useRef(new Set());
  const formId = useId();
  const pending = state.order.phase === "submitting";
  const valid = !firstInvalidCheckoutField(validateCheckout(draft));
  const hold = state.hold.data;
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (focusRequest && active.current) inputs.current[focusRequest.field]?.focus();
  }, [focusRequest]);
  function clearPayment() {
    for (const field of ["cardNumber", "expiry", "cvv"]) serverInvalid.current.delete(field);
    setDraft(withoutPayment);
    setErrors(withoutPaymentErrors);
  }
  function applyResult(outcome) {
    if (!active.current || ["stale", "ignored", "blocked"].includes(outcome.kind)) return;
    if (outcome.clearPayment) clearPayment();
    if (outcome.kind === "validation") {
      serverInvalid.current = new Set(Object.keys(outcome.fields));
      setErrors(outcome.fields);
      setGeneral([...(outcome.message ? [outcome.message] : []), ...outcome.general.flatMap((entry) => entry.messages)]);
      const field = firstInvalidCheckoutField(outcome.fields);
      if (field) setFocusRequest({ field });
    }
  }
  function onSubmit(event) {
    event.preventDefault();
    if (pending) return;
    serverInvalid.current.clear();
    setGeneral([]);
    const validation = validateCheckout(draft);
    setErrors(validation);
    const field = firstInvalidCheckoutField(validation);
    if (field) { setFocusRequest({ field }); return; }
    // This request copy and factory are transient. The coordinator invokes the
    // factory synchronously after its lock; it retains neither form nor payload.
    const normalized = normalizeCheckoutFields(draft);
    void submitOrder(({ holdId, token }) => createOrder({ holdId, ...normalized }, { token }), { valid: true }).then(applyResult);
  }
  function field(name) {
    return <FormField key={name} {...controls[name]} type={controls[name].type ?? "text"} name={name} required
      inputRef={(element) => { inputs.current[name] = element; }} value={draft[name]} disabled={pending}
      error={errors[name]} success={Boolean(draft[name]) && !validateCheckoutField(name, draft[name]) && !errors[name]}
      onChange={(event) => {
        const value = event.target.value;
        setDraft((current) => ({ ...current, [name]: value }));
        serverInvalid.current.delete(name);
        setErrors((current) => ({ ...current, [name]: null }));
      }} onBlur={() => {
        if (!serverInvalid.current.has(name)) setErrors((current) => ({ ...current, [name]: validateCheckoutField(name, draft[name]) }));
      }} />;
  }
  if (!hold) return null;
  const session = state.sessionRead.data;
  const sharedFeedback = state.order.feedback ?? state.feedback;
  return <form id={formId} className="checkout" noValidate onSubmit={onSubmit} aria-label="Checkout" aria-busy={pending}>
    <div className="checkout__form-column">
      <ol className="seat-selection__progress" aria-label="Booking steps"><li>SEATS</li><li aria-current="step">CHECKOUT</li></ol>
      <div className="checkout__fields">
        <div className="checkout__field-group">{field("fullName")}<div className="checkout__paired">{field("email")}{field("mobileNumber")}</div></div>
        <div className="checkout__separator" aria-hidden="true" />
        <div className="checkout__field-group">{field("cardNumber")}<div className="checkout__paired">{field("expiry")}{field("cvv")}</div></div>
      </div>
      {general.length > 0 && <div className="checkout__feedback" role="alert">{general.map((message, index) => <p key={index}>{message}</p>)}</div>}
      {sharedFeedback && <p className="checkout__feedback" role="alert">{sharedFeedback}</p>}
      {pending && <p className="checkout__feedback" role="status">Completing your order…</p>}
      <footer className="checkout__footer"><button type="button" id="booking-back" className="button button--secondary" disabled={pending}
        onClick={() => { clearPayment(); back(); }}>Back</button></footer>
    </div>
    <div className="seat-selection__divider" aria-hidden="true" />
    <aside className="checkout__summary" aria-label="Held seats">
      <h3>Summary</h3>
      <div className="checkout__summary-card">
        <h4>{session?.movie?.title}</h4>
        <p>{[session?.hall?.name && `Hall ${session.hall.name}`, session?.date, session?.time].filter(Boolean).join(" · ")}</p>
        <div className="checkout__summary-divider" />
        {hold.seats.map((seat) => <div className="checkout__summary-seat" key={seat.seatId}>
          <span>Seat {seat.code} · {seat.ticketType.name}</span><strong>{formatGEL(seat.price * 100)}</strong>
        </div>)}
      </div>
      <div className="checkout__purchase">
        <div className="seat-summary__subtotal"><span>SUBTOTAL</span><strong>{formatGEL(hold.subtotal * 100)}</strong></div>
        <button className="button button--primary" type="submit" disabled={pending || !valid || !canSubmitOrder}>
          {pending ? "Completing order…" : "Pay & Complete Order"}
        </button>
      </div>
    </aside>
  </form>;
}
