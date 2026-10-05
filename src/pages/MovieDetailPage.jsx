import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { ROUTES } from "../routing/routes.js";
import useMovieRead from "../movie-detail/useMovieRead.js";
import { recordRecentlyViewed } from "../utils/recentlyViewedStorage.js";
import MovieHero from "../components/movie-detail/MovieHero.jsx";
import MovieDetails from "../components/movie-detail/MovieDetails.jsx";
import MovieSessions from "../components/movie-detail/MovieSessions.jsx";
import Footer from "../components/Footer.jsx";

export default function MovieDetailPage() {
  const { slug } = useParams();
  const { user, isAuthenticated } = useAuth();
  const movie = useMovieRead(slug);
  const userId = isAuthenticated ? user?.id : null;

  useEffect(() => {
    if (movie.status === "success" && userId !== null && userId !== undefined) {
      recordRecentlyViewed(userId, slug);
    }
  }, [movie.status, movie.data, userId, slug]);

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
            {/* The real booking consumer will supply onActivate(sessionId), as on Sessions. */}
            <MovieSessions key={slug} movie={movie.data} slug={slug} />
            <MovieDetails movie={movie.data} />
          </div>
        </>}
      </main>
      <Footer />
    </>
  );
}
