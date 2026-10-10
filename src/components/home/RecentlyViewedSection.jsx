import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.js";
import { readRecentlyViewed, recentlyViewedKey } from "../../utils/recentlyViewedStorage.js";
import { loadRecentlyViewed } from "../../recently-viewed/loadRecentlyViewed.js";
import RecentlyViewedCard from "./RecentlyViewedCard.jsx";
import CatalogueRow from "./CatalogueRow.jsx";

export default function RecentlyViewedSection({ userId }) {
  const { getSessionIdentity, registerAuthLifecycle } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [hasHistory] = useState(() => readRecentlyViewed(userId).length > 0);
  const sectionRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController(), owner = getSessionIdentity();
    const unsubscribe = registerAuthLifecycle(() => {
      controller.abort();
      // A same-session /me refresh need not remount Home: restart its aborted read.
      setAttempt(value => value + 1);
    });
    const isCurrent = () => {
      const next = getSessionIdentity();
      return owner?.accountId === next?.accountId && owner?.generation === next?.generation;
    };
    loadRecentlyViewed(userId, { signal: controller.signal, isCurrent })
      .then(data => { if (!controller.signal.aborted && isCurrent()) setResult({ ...data, attempt }); })
      .catch(error => {
        if (!controller.signal.aborted && isCurrent() && error.name !== "AbortError") {
          setResult({ movies: [], failed: true, hasHistory: true, attempt });
        }
      });
    return () => { controller.abort(); unsubscribe(); };
  }, [userId, attempt, getSessionIdentity, registerAuthLifecycle]);
  useEffect(() => {
    const changed = event => { if (event.key === null || event.key === recentlyViewedKey(userId)) setAttempt(value => value + 1); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [userId]);
  const state = result?.attempt === attempt ? result : null;
  if (!(state?.hasHistory ?? hasHistory)) return null;
  return <>
    <section className="home-section home-section--recently-viewed" aria-labelledby="recently-viewed-title" ref={sectionRef} tabIndex={-1}>
      <h2 className="home-section__title" id="recently-viewed-title">Recently viewed</h2>
      {!state && <p role="status">Loading recently viewed movies…</p>}
      {state?.movies.length > 0 && <CatalogueRow className="home-section__row--recently-viewed" label="Recently viewed movies">
        {state.movies.map(movie => <RecentlyViewedCard key={movie.slug} movie={movie} />)}
      </CatalogueRow>}
      {state?.failed && <div className="recently-viewed-error">
        <p role="alert">Some recently viewed movies could not be loaded.</p>
        <button className="button button--secondary" type="button" onClick={() => {
          sectionRef.current?.focus(); setAttempt(value => value + 1);
        }}>Retry recently viewed</button>
      </div>}
    </section>
    <div className="home-page__divider" aria-hidden="true" />
  </>;
}
