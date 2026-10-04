import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES, movieDetailPath } from "../../routing/routes.js";
import arrowIcon from "../../assets/icons/home-arrow-left.svg";
import ticketIcon from "../../assets/icons/home-ticket.svg";
import timerIcon from "../../assets/icons/home-timer.svg";
import AgeBadge from "./AgeBadge.jsx";
import MovieImage from "./MovieImage.jsx";
import SectionState from "./SectionState.jsx";

function FeaturedSlide({ movie }) {
  return (
    <div className="home-hero__slide">
      <MovieImage src={movie.backdropUrl} title={movie.title} backdrop />
      <div className="home-hero__copy">
        <div className="home-hero__details">
          <h2 className="home-hero__title">{movie.title}</h2>
          <div className="home-hero__badges">
            <AgeBadge rating={movie.ageRating} hero />
            {movie.runtimeMinutes != null && (
              <span className="home-hero__badge">
                <img src={timerIcon} alt="" />{movie.runtimeMinutes} Min
              </span>
            )}
            {movie.formats?.map((format) => (
              <span className="home-hero__badge" key={format.id}>{format.name}</span>
            ))}
          </div>
        </div>
        <div className="home-hero__actions">
          {!movie.isComingSoon && (
            <Link className="button button--primary" to={movieDetailPath(movie.slug)}>
              <img src={ticketIcon} alt="" />Buy tickets
            </Link>
          )}
          <Link className="button home-hero__sessions" to={ROUTES.sessions}>All sessions</Link>
        </div>
      </div>
    </div>
  );
}

function FeaturedMovies({ movies }) {
  const [index, setIndex] = useState(0);
  const movie = movies[index];

  function move(direction) {
    setIndex((current) => (current + direction + movies.length) % movies.length);
  }

  return (
    <>
      <FeaturedSlide movie={movie} key={movie.id} />
      <div className="home-hero__navigation">
        <div className="home-hero__progress" aria-hidden="true">
          {movies.map((item, position) => (
            <span className={`home-hero__bar${position === index ? " home-hero__bar--active" : ""}`} key={item.id} />
          ))}
        </div>
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          Featured movie {index + 1} of {movies.length}: {movie.title}
        </p>
        <div className="home-hero__arrows">
          <button type="button" className="home-hero__arrow" aria-label="Previous featured movie" disabled={movies.length === 1} onClick={() => move(-1)}>
            <img src={arrowIcon} alt="" />
          </button>
          <button type="button" className="home-hero__arrow home-hero__arrow--next" aria-label="Next featured movie" disabled={movies.length === 1} onClick={() => move(1)}>
            <img src={arrowIcon} alt="" />
          </button>
        </div>
      </div>
    </>
  );
}

export default function HeroCarousel({ state }) {
  const sectionRef = useRef(null);
  return (
    <section className="home-hero" ref={sectionRef} tabIndex={-1} aria-label="Featured movies" aria-roledescription="carousel">
      {state.status === "success" && state.movies.length > 0 ? (
        <FeaturedMovies movies={state.movies} />
      ) : (
        <SectionState state={state} label="featured movies" emptyMessage="No featured movies are available." sectionRef={sectionRef} />
      )}
    </section>
  );
}
