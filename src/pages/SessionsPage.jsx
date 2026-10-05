import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppBootstrap } from "../app/AppBootstrapContext.js";
import { useBookingEntry } from "../auth/BookingEntryContext.js";
import Footer from "../components/Footer.jsx";
import SessionsFilters from "../components/sessions/SessionsFilters.jsx";
import SessionsFiltersSkeleton from "../components/sessions/SessionsFiltersSkeleton.jsx";
import SessionsMovieGroup from "../components/sessions/SessionsMovieGroup.jsx";
import SessionsPagination from "../components/sessions/SessionsPagination.jsx";
import SessionsResultsHeader from "../components/sessions/SessionsResultsHeader.jsx";
import SessionsSkeleton from "../components/sessions/SessionsSkeleton.jsx";
import useSessions from "../sessions/useSessions.js";
import {
  parseSessionsQuery,
  reconcileSessionsPage,
  updateSessionsFilters,
  writeSessionsQuery,
} from "../sessions/sessionsQuery.js";

export default function SessionsPage() {
  const { filterOptions } = useAppBootstrap();
  const { openBooking } = useBookingEntry();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseSessionsQuery(searchParams, { filterOptions });
  const sessions = useSessions(query);
  const [hasSettled, setHasSettled] = useState(false);
  // One local presentation transition. Subsequent reads keep filters mounted and keyboard focus intact.
  if (!hasSettled && sessions.status !== "loading") setHasSettled(true);
  const resultsRef = useRef(null);
  const currentSearch = searchParams.toString();
  const lastPage = sessions.status === "success" ? sessions.meta.lastPage : null;
  const canonicalSearch = writeSessionsQuery(reconcileSessionsPage(query, lastPage)).toString();

  useEffect(() => {
    if (currentSearch !== canonicalSearch) {
      setSearchParams(canonicalSearch, { replace: true });
    }
  }, [currentSearch, canonicalSearch, setSearchParams]);

  function changeFilters(changes) {
    setSearchParams(writeSessionsQuery(updateSessionsFilters(query, changes, filterOptions)));
  }

  function changePage(page) {
    if (page === query.page) return;
    resultsRef.current?.focus();
    setSearchParams(writeSessionsQuery({ ...query, page }));
  }

  function retry() {
    resultsRef.current?.focus();
    sessions.retry();
  }

  return (
    <>
      <main className="sessions-page">
        <header className="sessions-page__header">
          <h1>Sessions</h1>
          <p>Browse showtimes across all venues</p>
        </header>
        <div className="sessions-page__layout">
          {!hasSettled ? <SessionsFiltersSkeleton /> : (
            <SessionsFilters filterOptions={filterOptions} query={query} onChange={changeFilters} />
          )}
          <section className="sessions-results" ref={resultsRef} tabIndex={-1}
            aria-label="Sessions results" aria-busy={sessions.status === "loading"}>
            <SessionsResultsHeader total={sessions.status === "success" ? sessions.meta.totalSessions : null}
              status={sessions.status} sorts={filterOptions.sorts} sort={query.sort}
              onChange={(sort) => changeFilters({ sort })} />
            {sessions.status === "loading" && <SessionsSkeleton />}
            {sessions.status === "error" && <div className="sessions-state">
              <p role="alert">{sessionsErrorMessage(sessions.error)}</p>
              <button type="button" className="button button--primary" onClick={retry}>Retry</button>
            </div>}
            {sessions.status === "success" && <>
              {sessions.data.length === 0 ? <div className="sessions-state"><p>No sessions found</p></div> : (
                <div className="sessions-movies">
                  {sessions.data.map(({ movie, sessions: showings }) => (
                    <SessionsMovieGroup key={movie.id} movie={movie} sessions={showings} onActivate={openBooking} />
                  ))}
                </div>
              )}
              <SessionsPagination currentPage={sessions.meta.currentPage} lastPage={sessions.meta.lastPage}
                onChange={changePage} />
            </>}
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}

function sessionsErrorMessage(error) {
  const context = "Could not load sessions.";
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (!message || message.replace(/\.$/, "").toLowerCase() === context.slice(0, -1).toLowerCase()) {
    return context;
  }
  return `${context} ${message}`;
}
