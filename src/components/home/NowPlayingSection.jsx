import { useRef } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../../routing/routes.js";
import CatalogueRow from "./CatalogueRow.jsx";
import MovieCard from "./MovieCard.jsx";
import SectionState from "./SectionState.jsx";

export default function NowPlayingSection({ state }) {
  const sectionRef = useRef(null);
  return (
    <section className="home-section" ref={sectionRef} tabIndex={-1} aria-labelledby="now-playing-title">
      <div className="home-section__header">
        <h2 id="now-playing-title" className="home-section__title">Now Playing</h2>
        <Link className="home-section__all" to={ROUTES.sessions} aria-label="See all Now Playing sessions">See all</Link>
      </div>
      {state.status === "success" && state.movies.length > 0 ? (
        <div className="home-row-viewport home-row-viewport--now-playing">
          <CatalogueRow className="home-section__row--now-playing" label="Now Playing movies">
            {state.movies.map((movie) => <MovieCard movie={movie} key={movie.id} />)}
          </CatalogueRow>
        </div>
      ) : (
        <SectionState state={state} label="Now Playing movies" emptyMessage="No movies are playing right now." sectionRef={sectionRef} />
      )}
    </section>
  );
}
