import { Link } from "react-router-dom";
import { movieDetailPath } from "../../routing/routes.js";
import MovieImage from "./MovieImage.jsx";
import AgeBadge from "./AgeBadge.jsx";
import { movieMetadata } from "./moviePresentation.js";

export default function RecentlyViewedCard({ movie }) {
  const metadata = movieMetadata({
    genres: Array.isArray(movie.genres) ? movie.genres.filter(genre => typeof genre?.name === "string" && genre.name.trim()) : [],
    runtimeMinutes: Number.isFinite(movie.runtimeMinutes) && movie.runtimeMinutes > 0 ? movie.runtimeMinutes : undefined,
  });
  return <Link className="recently-viewed-card" to={movieDetailPath(movie.slug)} aria-label={`View ${movie.title}`}>
    <MovieImage src={typeof movie.posterUrl === "string" ? movie.posterUrl : null} title={movie.title} />
    <div className="recently-viewed-card__content">
      <div className="recently-viewed-card__details">
        <h3 title={movie.title}>{movie.title}</h3>
        {metadata && <p className="movie-card__metadata" title={metadata}>{metadata}</p>}
      </div>
      <AgeBadge rating={typeof movie.ageRating?.code === "string" ? movie.ageRating : null} />
    </div>
  </Link>;
}
