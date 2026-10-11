import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { movieDetailPath } from "../../routing/routes.js";
import AgeBadge from "./AgeBadge.jsx";
import MovieImage from "./MovieImage.jsx";
import { movieMetadata } from "./moviePresentation.js";

export default function MovieCard({ movie, expanded, preview, onEnter, onLeave, onFocus, onBlur, onRetry }) {
  const metadata = movieMetadata(movie);
  const mainRef = useRef(null);
  const restoreRetryFocus = useRef(false);
  const [previewReady, setPreviewReady] = useState(false);
  // Clear readiness before painting a collapse or a later expansion.
  if (!expanded && previewReady) setPreviewReady(false);

  useLayoutEffect(() => {
    if (preview?.status !== "success" || !restoreRetryFocus.current) return;
    restoreRetryFocus.current = false;
    if (expanded && document.activeElement === document.body) mainRef.current?.focus({ preventScroll: true });
  }, [preview?.status, expanded]);

  function retry(event) {
    if (preview?.status === "loading") return;
    restoreRetryFocus.current = document.activeElement === event.currentTarget;
    onRetry();
  }

  return (
    <article className={`movie-card${expanded ? " movie-card--expanded" : ""}${expanded && previewReady ? " movie-card--preview-ready" : ""}`} data-movie-slug={movie.slug}
      onPointerEnter={onEnter} onPointerLeave={onLeave}
      onTransitionEnd={event => {
        // Native CSS reversals can finish sooner than the normal 300ms gate.
        if (expanded && event.target === event.currentTarget && event.propertyName === "flex-basis") setPreviewReady(true);
      }}
      onFocus={event => { if (event.target.matches(":focus-visible")) onFocus(); }}
      onKeyDown={onFocus}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onBlur(); }}>
      <div className="movie-card__content">
        <div className="movie-card__body">
          <Link ref={mainRef} className="movie-card__main" to={movieDetailPath(movie.slug)} aria-label={`View ${movie.title}`}>
            <MovieImage src={movie.posterUrl} title={movie.title} />
            <div className="movie-card__details">
              <h3 className="movie-card__title" title={movie.title}>{movie.title}</h3>
              {metadata && <p className="movie-card__metadata" title={metadata}>{metadata}</p>}
              <AgeBadge rating={movie.ageRating} />
            </div>
          </Link>
          <div className="movie-card__preview" aria-hidden={!expanded}>
            <p className="movie-card__synopsis">
              {!preview || preview.status === "loading" ? "Loading synopsis…"
                : preview.status === "error" ? "Synopsis unavailable."
                  : preview.synopsis || "No synopsis available."}
            </p>
            {(preview?.status === "error" || preview?.retrying) && <button className="movie-card__retry" type="button"
              tabIndex={expanded ? 0 : -1} aria-disabled={preview.status === "loading"}
              onClick={retry} aria-label={`Retry synopsis for ${movie.title}`}>Retry</button>}
          </div>
        </div>
        <div className="movie-card__footer">
          {movie.fromPrice != null && <p className="movie-card__price">from ₾{movie.fromPrice}</p>}
          {!movie.isComingSoon && (
            <Link className="button button--primary movie-card__buy" to={movieDetailPath(movie.slug)} aria-label={`Buy Ticket for ${movie.title}`}>
              Buy Ticket
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
