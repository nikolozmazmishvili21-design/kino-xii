import AgeBadge from "../home/AgeBadge.jsx";
import MovieImage from "../home/MovieImage.jsx";
import SessionTime from "./SessionTime.jsx";

export default function SessionsMovieGroup({ movie, sessions, onActivate }) {
  const headingId = `sessions-movie-${movie.id}`;
  const genreNames = movie.genres.map((genre) => genre.name)
    .filter((name) => typeof name === "string" && name.trim());
  return (
    <article className="sessions-movie" aria-labelledby={headingId}>
      <div className="sessions-movie__header">
        <MovieImage src={movie.posterUrl} title={movie.title} />
        <div className="sessions-movie__info">
          <div className="sessions-movie__title-row">
            <h2 id={headingId}>{movie.title}</h2>
            <AgeBadge rating={movie.ageRating} />
          </div>
          <p className="sessions-movie__runtime">{movie.runtimeMinutes} min</p>
          {/* D-022: required metadata added inside the existing 80px information block. */}
          <p className="sessions-movie__metadata">
            {genreNames.length > 0 && <span>{genreNames.join(", ")}</span>}
            <span className="sessions-movie__price">from ₾{movie.fromPrice}</span>
          </p>
        </div>
      </div>
      <div className="sessions-time-row" role="group" aria-label={`${movie.title} showtimes`} tabIndex={0}>
        {sessions.map((session) => <SessionTime key={session.id} session={session}
          movieTitle={movie.title} onActivate={onActivate} />)}
      </div>
    </article>
  );
}
