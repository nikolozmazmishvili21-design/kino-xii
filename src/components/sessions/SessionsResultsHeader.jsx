export default function SessionsResultsHeader({ total, status, sorts, sort, onChange }) {
  const defaultLabel = sorts.find((option) => option.id === "time_asc")?.label;
  return (
    <div className="sessions-results-header">
      <p role="status" className={status === "loading" ? "sessions-results-header__loading" : undefined}>
        <span className={status === "loading" ? "visually-hidden" : undefined}>
          {total !== null ? `Showing ${total} ${total === 1 ? "session" : "sessions"}` : status === "loading" ? "Loading sessions…" : "Sessions unavailable"}
        </span>
      </p>
      <label className="sessions-sort">
        <span>Sort:</span>
        <select aria-label="Sort sessions" value={sort} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled hidden>{defaultLabel ?? "Select sort"}</option>
          {sorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    </div>
  );
}
