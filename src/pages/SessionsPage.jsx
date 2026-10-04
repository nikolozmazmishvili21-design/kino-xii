import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppBootstrap } from "../app/AppBootstrapContext.js";
import useSessions from "../sessions/useSessions.js";
import {
  availableSessionFormats,
  nextSevenLocalDates,
  parseSessionsQuery,
  reconcileSessionsPage,
  updateSessionsFilters,
  writeSessionsQuery,
} from "../sessions/sessionsQuery.js";

function FilterChoices({ label, options, selected, onChange, valueKey = "slug", labelKey = "name" }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option[valueKey]}>
          <input
            type="checkbox"
            checked={selected.includes(option[valueKey])}
            onChange={(event) => onChange(event.target.checked
              ? [...selected, option[valueKey]]
              : selected.filter((value) => value !== option[valueKey]))}
          />
          {option[labelKey]}
        </label>
      ))}
    </fieldset>
  );
}

export default function SessionsPage() {
  const { filterOptions } = useAppBootstrap();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseSessionsQuery(searchParams, { filterOptions });
  const sessions = useSessions(query);
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

  function retry() {
    resultsRef.current?.focus();
    sessions.retry();
  }

  // Native controls expose the data/URL foundation; final Figma UI is deferred.
  return (
    <main>
      <h1>Sessions</h1>
      <label>
        Date
        <input type="date" value={query.date} list="sessions-dates"
          onChange={(event) => changeFilters({ date: event.target.value })} />
      </label>
      <datalist id="sessions-dates">
        {nextSevenLocalDates().map((date) => <option key={date} value={date} />)}
      </datalist>
      <FilterChoices label="Venue" options={filterOptions.venues} selected={query.venues}
        onChange={(venues) => changeFilters({ venues })} />
      <FilterChoices label="Format" options={availableSessionFormats(filterOptions, query.venues)}
        selected={query.formats} onChange={(formats) => changeFilters({ formats })} />
      <FilterChoices label="Language" options={filterOptions.languages} selected={query.languages}
        onChange={(languages) => changeFilters({ languages })} />
      <FilterChoices label="Time of Day" options={filterOptions.timeBands} selected={query.bands}
        valueKey="id" labelKey="label" onChange={(bands) => changeFilters({ bands })} />
      <label>
        Search films
        <input type="search" maxLength={100} value={query.search}
          onChange={(event) => changeFilters({ search: event.target.value })} />
      </label>
      <label>
        Sort
        <select value={query.sort} onChange={(event) => changeFilters({ sort: event.target.value })}>
          {/* Temporary blank placeholder for an omitted sort; final control is deferred. */}
          <option value="" disabled hidden />
          {filterOptions.sorts.map((sort) => <option key={sort.id} value={sort.id}>{sort.label}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => changeFilters({
        venues: [], formats: [], languages: [], bands: [], search: "",
      })}>Clear All Filters</button>
      <section ref={resultsRef} tabIndex={-1} aria-labelledby="sessions-results-heading"
        aria-busy={sessions.status === "loading"}>
        <h2 id="sessions-results-heading">Results</h2>
        {sessions.status === "loading" && <p role="status">Loading sessions...</p>}
        {sessions.status === "error" && <>
          <p role="alert">{sessions.error.message}</p>
          <button type="button" onClick={retry}>Retry</button>
        </>}
        {sessions.status === "success" && <>
          <p role="status">Showing {sessions.meta.totalSessions} sessions</p>
          <p>Page {sessions.meta.currentPage} of {sessions.meta.lastPage} · {sessions.meta.totalMovies} films</p>
          {sessions.data.length === 0 ? <p>No sessions found</p> : (
            <ul>
              {sessions.data.map(({ movie, sessions: showings }) => (
                <li key={movie.id}>{movie.title} — {showings.length} sessions</li>
              ))}
            </ul>
          )}
        </>}
      </section>
    </main>
  );
}
