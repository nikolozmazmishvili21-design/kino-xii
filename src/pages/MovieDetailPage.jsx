import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useBookingEntry } from "../auth/BookingEntryContext.js";
import { ROUTES } from "../routing/routes.js";
import useMovieRead from "../movie-detail/useMovieRead.js";
import { recordRecentlyViewed } from "../utils/recentlyViewedStorage.js";
import MovieHero from "../components/movie-detail/MovieHero.jsx";
import MovieDetails from "../components/movie-detail/MovieDetails.jsx";
import MovieSessions from "../components/movie-detail/MovieSessions.jsx";
import Footer from "../components/Footer.jsx";

export default function MovieDetailPage() {
  const { slug } = useParams();
  const { user, status, mutation, isCurrentUser, getSessionIdentity, registerAuthLifecycle } = useAuth();
  const { openBooking } = useBookingEntry();
  const movie = useMovieRead(slug);
  const userId = status === "authenticated" ? user?.id : null;
  const visit = useRef(null);

  // The public read survives auth changes; only its permission to record a visit expires.
  useLayoutEffect(() => {
    if (visit.current?.requestId === movie.requestId) return;
    visit.current = { requestId: movie.requestId, identity: getSessionIdentity(),
      restoring: status === "restoring", revoked: Boolean(mutation), recorded: false };
  }, [movie.requestId, status, mutation, getSessionIdentity]);

  useLayoutEffect(() => registerAuthLifecycle(() => {
    const owner = visit.current;
    if (!owner) return;
    if (owner.restoring) {
      // Resolve the initial persisted session before assigning a direct URL visit.
      owner.identity = getSessionIdentity();
      owner.restoring = false;
    } else owner.revoked = true;
  }), [registerAuthLifecycle, getSessionIdentity]);

  useEffect(() => {
    const owner = visit.current;
    const identity = getSessionIdentity();
    const sameOwner = owner?.identity?.accountId === identity?.accountId
      && owner?.identity?.generation === identity?.generation;
    if (owner?.requestId === movie.requestId && !owner.revoked && !owner.restoring && !owner.recorded
      && sameOwner && movie.status === "success" && movie.data.title.trim() && !mutation
      && (status === "guest" || (status === "authenticated" && isCurrentUser(user)))) {
      owner.recorded = true;
      recordRecentlyViewed(userId, movie.data.slug);
    }
  }, [movie.requestId, movie.status, movie.data, userId, status, mutation, user, isCurrentUser, getSessionIdentity]);

  return (
    <>
      <main className={`movie-detail-page${movie.status !== "success" ? " movie-detail-page--fallback" : ""}`}>
        {movie.status === "loading" && <div className="movie-detail-state" role="status"><h1>Loading movie…</h1></div>}
        {movie.status === "error" && <div className="movie-detail-state" role="alert">
          <h1>{movie.error?.status === 404 ? "Movie not found" : "Movie could not be loaded"}</h1>
          <p>{movie.error?.status === 404 ? "This movie is unavailable. Browse Sessions to find another movie."
            : "We could not load this movie. Please try again."}</p>
          {movie.error?.status !== 404 && <button type="button" className="button button--secondary" onClick={movie.retry}>Retry movie</button>}
          <Link to={ROUTES.sessions}>Browse Sessions</Link>
        </div>}
        {movie.status === "success" && <>
          <MovieHero movie={movie.data} />
          <div className="movie-detail-page__content">
            <MovieSessions key={slug} movie={movie.data} slug={slug} onActivate={openBooking} />
            <MovieDetails movie={movie.data} />
          </div>
        </>}
      </main>
      <Footer />
    </>
  );
}
