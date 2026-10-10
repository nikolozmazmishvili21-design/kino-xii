import { useId } from "react";
import bellIcon from "../../assets/icons/home-bell.svg";
import checkIcon from "../../assets/icons/home-notified.svg";
import AgeBadge from "./AgeBadge.jsx";
import MovieImage from "./MovieImage.jsx";
import { movieMetadata, movieReleaseDate } from "./moviePresentation.js";

export default function ComingSoonCard({ movie, onNotify, notification, disabled }) {
  const id = useId();
  const metadata = movieMetadata(movie);
  const releaseDate = movieReleaseDate(movie.releaseDate);
  const phase = notification?.phase ?? "idle";
  const success = phase === "success";
  const pending = phase === "pending";
  const awaitingAuth = phase === "awaiting-auth";
  const unavailable = Boolean(disabled || pending || success || awaitingAuth);
  const label = success ? "You will be notified" : pending ? "Setting notification…" : "Notify Me";

  function handleNotify() {
    // aria-disabled preserves the keyboard/modal opener; it does not block clicks.
    // The runtime separately rechecks live session identity and its dispatch lock.
    if (unavailable) return;
    onNotify(movie.slug);
  }

  return (
    <div className="coming-soon-item">
      <article className="coming-soon-card" aria-labelledby={`${id}-title`}>
        <MovieImage src={movie.posterUrl} title={movie.title} />
        <div className="coming-soon-card__content">
          <div className="coming-soon-card__details">
            {releaseDate && <time className="coming-soon-card__release" dateTime={movie.releaseDate}>In cinemas {releaseDate}</time>}
            <h3 id={`${id}-title`} className="coming-soon-card__title" title={movie.title}>{movie.title}</h3>
            {metadata && <p className="movie-card__metadata" title={metadata}>{metadata}</p>}
            <AgeBadge rating={movie.ageRating} />
          </div>
          <button
            className={`coming-soon-card__notify${success ? " coming-soon-card__notify--success" : ""}`}
            type="button"
            aria-disabled={unavailable || undefined}
            aria-busy={pending}
            aria-label={`${label} — ${movie.title}`}
            aria-describedby={phase === "error" ? `${id}-error` : undefined}
            onClick={handleNotify}
          >
            <img src={success ? checkIcon : bellIcon} alt="" />{label}
          </button>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {success ? `You will be notified about ${movie.title}.` : pending ? `Setting notification for ${movie.title}.`
            : awaitingAuth ? `Log in to be notified about ${movie.title}.` : ""}
        </p>
      </article>
      {phase === "error" && <p className="coming-soon-card__error" id={`${id}-error`} role="alert">{notification.message}</p>}
    </div>
  );
}
