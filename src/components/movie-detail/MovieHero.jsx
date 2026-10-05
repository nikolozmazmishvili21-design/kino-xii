import MovieImage from "../home/MovieImage.jsx";
import AgeBadge from "../home/AgeBadge.jsx";
import timerIcon from "../../assets/icons/home-timer.svg";

export default function MovieHero({ movie }) {
  return (
    <header className="movie-detail-hero">
      <div className="movie-detail-hero__backdrop" aria-hidden="true">
        <MovieImage src={movie.backdropUrl} title={movie.title} backdrop />
      </div>
      <div className="movie-detail-hero__scrim" />
      <div className="movie-detail-hero__content">
        <div className="movie-detail-hero__poster"><MovieImage src={movie.posterUrl} title={movie.title} /></div>
        <div className="movie-detail-hero__copy">
          <span className="movie-detail-hero__status">{movie.isComingSoon ? "Coming soon" : "Now Playing"}</span>
          <h1>{movie.title}</h1>
          <p>{movie.synopsis}</p>
          <div className="movie-detail-hero__badges">
            <AgeBadge rating={movie.ageRating} />
            <span className="movie-detail-hero__badge"><img src={timerIcon} width="14" height="14" alt="" />{movie.runtimeMinutes} Min</span>
            {movie.formats?.map((format) => <span className="movie-detail-hero__badge" key={format.id}>{format.name}</span>)}
          </div>
        </div>
      </div>
    </header>
  );
}
