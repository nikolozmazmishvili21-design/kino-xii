// Assignment fallback geometry; no Sessions loading variant is defined in Figma.
export default function SessionsSkeleton() {
  return (
    <div className="sessions-skeleton" aria-hidden="true">
      {Array.from({ length: 4 }, (_, group) => (
        <div className="sessions-movie" key={group}>
          <div className="sessions-movie__header">
            <div className="sessions-skeleton__poster" />
            <div className="sessions-skeleton__info"><span /><span /><span /></div>
          </div>
          <div className="sessions-time-row">
            {Array.from({ length: 5 }, (_, session) => <div className="sessions-skeleton__time" key={session} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
