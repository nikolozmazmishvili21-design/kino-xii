import { useState } from "react";
import { useAuth } from "../../auth/AuthContext.js";
import { localDateKey, movieDateModel, formatMovieDate, isUnderage } from "../../movie-detail/movieDetailPresentation.js";
import useMovieRead from "../../movie-detail/useMovieRead.js";
import MovieDatePicker from "./MovieDatePicker.jsx";
import MovieVenues from "./MovieVenues.jsx";

export default function MovieSessions({ movie, slug, onActivate }) {
  const { user, isAuthenticated } = useAuth();
  const [today] = useState(localDateKey);
  const model = movieDateModel(movie.availableDates, today, movie.isComingSoon === true);
  const [date, setDate] = useState(model.initialDate);
  const selectedDate = model.selectableDates.has(date) ? date : null;
  const sessions = useMovieRead(slug, selectedDate);
  const underage = isAuthenticated && isUnderage(user, movie.ageRating);
  const count = sessions.status === "success"
    ? sessions.data.reduce((total, group) => total + group.sessions.length, 0) : null;

  return (
    <section className="movie-sessions" aria-labelledby="movie-sessions-heading">
      <div className="movie-sessions__header">
        <h2 id="movie-sessions-heading">Sessions</h2>
        <p className="movie-sessions__subtitle" aria-live="polite">
          {count !== null ? `${count} ${count === 1 ? "session" : "sessions"} on ${formatMovieDate(selectedDate)}`
            : selectedDate ? `Sessions on ${formatMovieDate(selectedDate)}` : "No upcoming sessions"}
        </p>
        <MovieDatePicker model={model} selectedDate={selectedDate} onSelect={setDate} />
      </div>
      {underage && <p className="movie-detail-state movie-detail-state--warning" role="status" id="movie-age-restriction">
        This film is rated {movie.ageRating.code}. You cannot buy tickets for it with this account.
      </p>}
      {model.pastDates.length > 0 && <p className="movie-detail-state movie-detail-state--warning" role="status">
        The service returned past dates. These dates cannot be selected.
      </p>}
      {sessions.status === "idle" && <p className="movie-detail-state" role="status">No upcoming sessions are available for this movie.</p>}
      {sessions.status === "loading" && <p className="movie-detail-state" role="status">Loading sessions…</p>}
      {sessions.status === "error" && <div className="movie-detail-state" role="alert">
        <p>Sessions could not be loaded for {formatMovieDate(selectedDate)}. Please try again.</p>
        <button type="button" className="button button--secondary" onClick={sessions.retry}>Retry sessions</button>
      </div>}
      {sessions.status === "success" && (count === 0
        ? <p className="movie-detail-state" role="status">No sessions are available on {formatMovieDate(selectedDate)}.</p>
        : <MovieVenues groups={sessions.data} movie={movie} selectedDate={selectedDate} underage={underage} onActivate={onActivate} />)}
    </section>
  );
}
