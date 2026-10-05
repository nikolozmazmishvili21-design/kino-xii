// The filter-options bootstrap is complete, but mirror the sidebar on the first Sessions read.
export default function SessionsFiltersSkeleton() {
  return (
    <aside className="sessions-filters sessions-filters-skeleton" aria-label="Loading Sessions filters" aria-busy="true">
      <div className="sessions-filters__body" aria-hidden="true">
        <div className="sessions-filters-skeleton__heading" />
        {[4, 7, 5, 4, 3].map((count, section) => (
          <div className="sessions-filter-section" key={section}>
            <div className="sessions-filters-skeleton__label" />
            <div className={section === 1 ? "sessions-date-row" : "sessions-filter-choices"}>
              {Array.from({ length: count }, (_, index) => (
                <div key={index} className={section === 1 ? "sessions-filters-skeleton__day" : "sessions-filters-skeleton__choice"} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
