import { useEffect, useRef } from "react";
import { nextSevenLocalDates } from "../../sessions/sessionsQuery.js";

export default function SessionsDatePicker({ selected, onChange }) {
  const rowRef = useRef(null);
  const dates = nextSevenLocalDates();
  if (!dates.includes(selected)) dates.push(selected);

  useEffect(() => {
    // Scroll only this row; restoring a deep link must not scroll the whole page.
    const row = rowRef.current;
    const chip = row?.querySelector('[aria-pressed="true"]');
    if (chip) revealDate(row, chip);
  }, [selected]);

  return (
    <fieldset className="sessions-filter-section">
      <legend>Date</legend>
      <div className="sessions-date-row" ref={rowRef}>
        {dates.map((date) => {
          const [year, month, day] = date.split("-").map(Number);
          const calendarDay = new Date(0);
          calendarDay.setFullYear(year, month - 1, day);
          calendarDay.setHours(12, 0, 0, 0);
          return (
            <button key={date} type="button" className="sessions-day"
              aria-label={calendarDay.toLocaleDateString("en", {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
              })}
              aria-pressed={date === selected}
              onClick={() => { if (date !== selected) onChange(date); }}
              onFocus={(event) => revealDate(rowRef.current, event.currentTarget)}>
              <span>{calendarDay.toLocaleDateString("en", { weekday: "short" })}</span>
              <span>{day}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function revealDate(row, chip) {
  if (!row) return;
  const left = chip.offsetLeft;
  if (left < row.scrollLeft) row.scrollLeft = left;
  else if (left + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
    row.scrollLeft = left + chip.offsetWidth - row.clientWidth;
  }
}
