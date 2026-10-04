import { useRef } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../../routing/routes.js";
import CatalogueRow from "./CatalogueRow.jsx";
import ComingSoonCard from "./ComingSoonCard.jsx";
import SectionState from "./SectionState.jsx";

export default function ComingSoonSection({ state }) {
  const sectionRef = useRef(null);
  return (
    <section className="home-section home-section--coming-soon" ref={sectionRef} tabIndex={-1} aria-labelledby="coming-soon-title">
      <div className="home-section__header">
        <h2 id="coming-soon-title" className="home-section__title">Coming Soon</h2>
        <Link className="home-section__all" to={ROUTES.sessions} aria-label="See all sessions">See all</Link>
      </div>
      <p className="visually-hidden" id="home-notify-unavailable">Movie notifications are not available yet.</p>
      {state.status === "success" && state.movies.length > 0 ? (
        <div className="home-row-viewport home-row-viewport--coming-soon">
          <CatalogueRow className="home-section__row--coming-soon" label="Coming Soon movies">
            {state.movies.map((movie) => <ComingSoonCard movie={movie} notifyDescriptionId="home-notify-unavailable" key={movie.id} />)}
          </CatalogueRow>
        </div>
      ) : (
        <SectionState state={state} label="Coming Soon movies" emptyMessage="No upcoming movies are available." sectionRef={sectionRef} />
      )}
    </section>
  );
}
