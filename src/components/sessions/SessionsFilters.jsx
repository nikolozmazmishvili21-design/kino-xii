import { availableSessionFormats } from "../../sessions/sessionsQuery.js";
import SessionsDatePicker from "./SessionsDatePicker.jsx";

function FilterChoices({ label, options, selected, onChange, valueKey = "slug", labelKey = "name", splitDetail = false }) {
  return (
    <fieldset className="sessions-filter-section">
      <legend>{label}</legend>
      <div className="sessions-filter-choices">
        {options.map((option) => {
          // Preserve the API's entire label, including its parentheses and range punctuation.
          const parts = splitDetail && option[labelKey].match(/^(.+?)(\s+\(.*\))$/);
          return (
            <label key={option[valueKey]} className="sessions-filter-choice">
              <input type="checkbox" checked={selected.includes(option[valueKey])}
                onChange={(event) => onChange(event.target.checked
                  ? [...selected, option[valueKey]]
                  : selected.filter((value) => value !== option[valueKey]))} />
              <span className="sessions-filter-label">
                <span>{parts ? parts[1] : option[labelKey]}</span>
                {parts && <span className="sessions-filter-detail">{parts[2]}</span>}
                {option.city && <span className="sessions-filter-detail">· {option.city}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function SessionsFilters({ filterOptions, query, onChange }) {
  const count = query.venues.length + query.formats.length + query.languages.length
    + query.bands.length + (query.search ? 1 : 0);
  return (
    <aside className={`sessions-filters${count ? " sessions-filters--active" : ""}`}
      aria-labelledby="sessions-filters-heading">
      <div className="sessions-filters__body">
        <h2 id="sessions-filters-heading">Filters</h2>
        <FilterChoices label="Venue" options={filterOptions.venues} selected={query.venues}
          onChange={(venues) => onChange({ venues })} />
        <SessionsDatePicker selected={query.date} onChange={(date) => onChange({ date })} />
        <FilterChoices label="Format" options={availableSessionFormats(filterOptions, query.venues)}
          selected={query.formats} onChange={(formats) => onChange({ formats })} />
        <FilterChoices label="Language" options={filterOptions.languages} selected={query.languages}
          onChange={(languages) => onChange({ languages })} />
        <FilterChoices label="Time of Day" options={filterOptions.timeBands} selected={query.bands}
          valueKey="id" labelKey="label" splitDetail onChange={(bands) => onChange({ bands })} />
      </div>
      <div className="sessions-filters__footer">
        {count > 0 && <button type="button" className="sessions-clear"
          onClick={() => onChange({ venues: [], formats: [], languages: [], bands: [], search: "" })}>
          Clear All Filters
        </button>}
        <p role="status">{count} {count === 1 ? "filter" : "filters"} active</p>
      </div>
    </aside>
  );
}
