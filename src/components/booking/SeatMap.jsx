import { Fragment } from "react";
import { rowSlots, seatPresentation } from "../../booking/seatSelection.js";
import heldStripes from "../../assets/icons/seat-held-stripes.svg";
import heldLegend from "../../assets/icons/seat-held-legend.svg";

function SeatButton({ seat, section, row, selected, blocked, onToggle, verifiedIds, contested }) {
  const presentation = seatPresentation(seat, selected, verifiedIds.includes(seat.id), contested.includes(seat.code));
  return (
    <button type="button" className={`seat-map__seat seat-map__seat--${presentation.kind}`}
      id={`booking-seat-${seat.id}`}
      disabled={presentation.disabled || blocked}
      aria-pressed={selected} aria-describedby={blocked ? "booking-selection-status" : undefined}
      aria-label={`${section.name}, row ${row.label}, seat ${seat.code}, ${presentation.description}`}
      onClick={() => { if (!blocked) onToggle(seat.id); }}>
      {presentation.kind === "held" && <img className="seat-map__held-pattern" src={heldStripes} alt="" />}
      <span>{seat.label}</span>
    </button>
  );
}

export default function SeatMap({ map, selection, blocked, onToggle, verifiedIds = [], contested = [] }) {
  return (
    <>
      <div className="seat-map__screen">SCREEN</div>
      <div className="seat-map__viewport" role="region" aria-label="Seat map; scroll to reach all sections and seats" tabIndex={0}>
        <div className="seat-map__canvas">
          {map.sections.map((section, sectionIndex) => (
            <section className="seat-map__section" aria-label={section.name} key={`${sectionIndex}-${section.name}`}>
              <h3>{section.name}</h3>
              <div className="seat-map__rows">
                {section.rows.map((row, rowIndex) => (
                  <div className="seat-map__row" role="group" aria-label={`${section.name}, row ${row.label}`} key={`${rowIndex}-${row.label}`}>
                    <span className="seat-map__row-label" aria-hidden="true">{row.label}</span>
                    {rowSlots(row).map((slot) => (
                      <Fragment key={slot.key}>
                        {slot.kind === "aisle" ? <span className="seat-map__aisle" aria-hidden="true" />
                          : slot.kind === "gap" ? <span className="seat-map__gap" aria-hidden="true" />
                            : <SeatButton seat={slot.seat} section={section} row={row} selected={Boolean(selection[slot.seat.id])}
                              blocked={blocked} onToggle={onToggle} verifiedIds={verifiedIds} contested={contested} />}
                      </Fragment>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <ul className="seat-map__legend" aria-label="Seat states">
        <li><span className="seat-map__marker seat-map__marker--available" aria-hidden="true" />Available</li>
        <li><span className="seat-map__marker seat-map__marker--selected" aria-hidden="true" />Selected</li>
        <li><span className="seat-map__marker seat-map__marker--sold" aria-hidden="true" />Sold</li>
        <li><span className="seat-map__marker seat-map__marker--held" aria-hidden="true"><img src={heldLegend} alt="" /></span>Held by another user</li>
      </ul>
    </>
  );
}
