import { useRef } from "react";
import { Link } from "react-router-dom";
import { ROUTES, movieDetailPath } from "../../routing/routes.js";
import arrowIcon from "../../assets/icons/home-arrow-left.svg";
import ticketIcon from "../../assets/icons/home-ticket.svg";
import timerIcon from "../../assets/icons/home-timer.svg";
import AgeBadge from "./AgeBadge.jsx";
import MovieImage from "./MovieImage.jsx";
import SectionState from "./SectionState.jsx";
import useHeroPlayback from "./useHeroPlayback.js";

function FeaturedSlide({ movie, position, count, playback }) {
  const active = position === playback.index;
  const previous = position === playback.previous;
  return (
    <div className={`home-hero__slide${active ? " home-hero__slide--active" : ""}${previous ? " home-hero__slide--previous" : ""}${active && playback.phase === "fading" ? " home-hero__slide--entering" : ""}`}
      role="group" aria-roledescription="slide" aria-label={`${position + 1} of ${count}: ${movie.title}`}
      aria-hidden={!active} inert={!active}
      onLoadCapture={event => playback.imageReady(position, event)} onErrorCapture={event => playback.imageReady(position, event)}>
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
  const playbackRef = useRef(null);
  const playback = useHeroPlayback(movies, playbackRef);
  const movie = movies[playback.index];

  return (
    <div className={`home-hero__playback${playback.playing ? " home-hero__playback--playing" : ""}`} ref={playbackRef}
      style={{ "--hero-fade-duration": `${playback.duration}ms` }}
      onPointerEnter={() => playback.pause("pointer", true)} onPointerLeave={() => playback.pause("pointer", false)}
      onFocusCapture={event => playback.pause("focus", event.target.matches(":focus-visible"))}
      // Input can change modality without moving focus (e.g. clicking an already focused arrow).
      onPointerDownCapture={() => playback.pause("focus", false)}
      onKeyDownCapture={event => { if (!event.altKey && !event.ctrlKey && !event.metaKey) playback.pause("focus", true); }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) playback.pause("focus", false); }}>
      {movies.map((item, position) => <FeaturedSlide movie={item} position={position} count={movies.length} playback={playback} key={item.id} />)}
      <div className="home-hero__navigation">
        <div className="home-hero__progress" aria-hidden="true">
          {movies.map((item, position) => (
            <span className={`home-hero__bar${position === playback.index ? " home-hero__bar--active" : ""}`} key={item.id} />
          ))}
        </div>
        <p className="visually-hidden" role="status" aria-live={playback.playing ? "off" : "polite"} aria-atomic="true">
          Featured movie {playback.index + 1} of {movies.length}: {movie.title}
        </p>
        <div className="home-hero__arrows">
          <button type="button" className="home-hero__arrow" aria-label="Previous featured movie" disabled={movies.length === 1} onClick={() => playback.move(-1)}>
            <img src={arrowIcon} alt="" />
          </button>
          <button type="button" className="home-hero__arrow home-hero__arrow--next" aria-label="Next featured movie" disabled={movies.length === 1} onClick={() => playback.move(1)}>
            <img src={arrowIcon} alt="" />
          </button>
        </div>
      </div>
    </div>
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
