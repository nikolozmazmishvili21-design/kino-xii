import bellIcon from "../../assets/icons/home-bell.svg";
import AgeBadge from "./AgeBadge.jsx";
import MovieImage from "./MovieImage.jsx";
import { movieMetadata, movieReleaseDate } from "./moviePresentation.js";

export default function ComingSoonCard({ movie, onNotify, notifyDescriptionId }) {
  const metadata = movieMetadata(movie);
  const releaseDate = movieReleaseDate(movie.releaseDate);

  return (
    <article className="coming-soon-card">
      <MovieImage src={movie.posterUrl} title={movie.title} />
      <div className="coming-soon-card__content">
        <div className="coming-soon-card__details">
          {releaseDate && <time className="coming-soon-card__release" dateTime={movie.releaseDate}>In cinemas {releaseDate}</time>}
          <h3 className="coming-soon-card__title" title={movie.title}>{movie.title}</h3>
          {metadata && <p className="movie-card__metadata" title={metadata}>{metadata}</p>}
          <AgeBadge rating={movie.ageRating} />
        </div>
        <button
          className="coming-soon-card__notify"
          type="button"
          disabled={!onNotify}
          aria-label={`Notify Me about ${movie.title}`}
          aria-describedby={!onNotify ? notifyDescriptionId : undefined}
          onClick={onNotify ? () => onNotify(movie.id) : undefined}
        >
          <img src={bellIcon} alt="" />Notify Me
        </button>
      </div>
    </article>
  );
}
