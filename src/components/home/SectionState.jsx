export default function SectionState({ state, label, emptyMessage, sectionRef }) {
  if (state.status === "success" && state.movies.length > 0) return null;

  return (
    <div className="home-section-state" aria-busy={state.status === "loading"}>
      {state.status === "loading" && <p role="status">Loading {label}…</p>}
      {state.status === "success" && <p role="status">{emptyMessage}</p>}
      {state.status === "error" && (
        <>
          <p role="alert">Could not load {label}. {state.error?.message}</p>
          <button className="button button--primary" type="button" onClick={() => {
            sectionRef.current?.focus();
            state.retry();
          }} aria-label={`Retry ${label}`}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
