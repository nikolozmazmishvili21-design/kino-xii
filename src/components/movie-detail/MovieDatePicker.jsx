import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";

export default function MovieDatePicker({ model, selectedDate, onSelect }) {
  return (
    <div className="movie-dates" role="group" aria-label="Session date">
      {model.days.map((date) => (
        <button type="button" key={date}
          className={`movie-date${selectedDate === date ? " movie-date--selected" : ""}`}
          disabled={!model.selectableDates.has(date)} aria-pressed={selectedDate === date}
          aria-label={formatMovieDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          onClick={() => onSelect(date)}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}>
          <span>{formatMovieDate(date, { weekday: "short" })}</span>
          <span>{formatMovieDate(date, { day: "numeric" })}</span>
        </button>
      ))}
    </div>
  );
}
