import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../../routing/routes.js";
import CatalogueRow from "./CatalogueRow.jsx";
import MovieCard from "./MovieCard.jsx";
import SectionState from "./SectionState.jsx";
import useNowPlayingPreviews from "./useNowPlayingPreviews.js";

export default function NowPlayingSection({ state }) {
  const sectionRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [focused, setFocused] = useState(null);
  const active = hovered ?? focused;
  const { previews, load } = useNowPlayingPreviews();

  useLayoutEffect(() => {
    if (!active) return;
    const row = sectionRef.current?.querySelector(".home-section__row--now-playing");
    const card = [...(row?.children ?? [])].find(node => node.dataset.movieSlug === active);
    if (!card) return;
    // Follow the actual width transition locally, without scrolling the page vertically.
    const reveal = () => {
      const viewport = row.getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      if (bounds.right > viewport.right) row.scrollLeft += bounds.right - viewport.right;
      else if (bounds.left < viewport.left) row.scrollLeft -= viewport.left - bounds.left;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(card);
    return () => observer.disconnect();
  }, [active]);

  function enter(slug) { setHovered(slug); load(slug); }
  function focus(slug) { setFocused(slug); setHovered(null); load(slug); }
  return (
    <section className="home-section" ref={sectionRef} tabIndex={-1} aria-labelledby="now-playing-title">
      <div className="home-section__header">
        <h2 id="now-playing-title" className="home-section__title">Now Playing</h2>
        <Link className="home-section__all" to={ROUTES.sessions} aria-label="See all Now Playing sessions">See all</Link>
      </div>
      {state.status === "success" && state.movies.length > 0 ? (
        <div className="home-row-viewport home-row-viewport--now-playing">
          <CatalogueRow className="home-section__row--now-playing" label="Now Playing movies">
            {state.movies.map((movie) => <MovieCard movie={movie} key={movie.id}
              expanded={active === movie.slug} preview={previews[movie.slug]}
              onEnter={() => enter(movie.slug)} onLeave={() => setHovered(null)}
              onFocus={() => focus(movie.slug)} onBlur={() => setFocused(null)}
              onRetry={() => load(movie.slug, { retry: true })} />)}
          </CatalogueRow>
        </div>
      ) : (
        <SectionState state={state} label="Now Playing movies" emptyMessage="No movies are playing right now." sectionRef={sectionRef} />
      )}
    </section>
  );
}
