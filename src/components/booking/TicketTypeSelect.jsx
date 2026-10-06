import { useId } from "react";

export default function TicketTypeSelect({ seat, types, selectedSlug, onChange }) {
  const id = useId();
  return (
    <fieldset className="seat-ticket-types">
      <legend className="visually-hidden">Ticket type for seat {seat.code}</legend>
      {types.map((type) => (
        <label className={`seat-ticket-types__option${selectedSlug === type.slug ? " seat-ticket-types__option--selected" : ""}`} key={type.id}>
          <input type="radio" name={id} value={type.slug} checked={selectedSlug === type.slug} onChange={() => onChange(type.slug)} />
          <span>{type.name} {Number((type.priceRatio * 100).toFixed(2))}%</span>
        </label>
      ))}
    </fieldset>
  );
}
