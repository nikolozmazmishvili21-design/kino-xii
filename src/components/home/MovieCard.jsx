import { Link } from "react-router-dom";
import { movieDetailPath } from "../../routing/routes.js";
import AgeBadge from "./AgeBadge.jsx";
import MovieImage from "./MovieImage.jsx";
import { movieMetadata } from "./moviePresentation.js";

export default function MovieCard({ movie }) {
  const metadata = movieMetadata(movie);

  return (
    <article className="movie-card">
      <div className="movie-card__content">
        <div className="movie-card__body">
          <MovieImage src={movie.posterUrl} title={movie.title} />
          <div className="movie-card__details">
            <h3 className="movie-card__title" title={movie.title}>{movie.title}</h3>
            {metadata && <p className="movie-card__metadata" title={metadata}>{metadata}</p>}
            <AgeBadge rating={movie.ageRating} />
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
