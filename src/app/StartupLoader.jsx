// Critical styles live in index.html so both startup phases paint consistently.
export default function StartupLoader() {
  return (
    <main className="startup-loader" role="status" aria-live="polite" aria-atomic="true">
      <p className="startup-loader__brand" aria-hidden="true">KINO <span className="startup-loader__accent">XII</span></p>
      <span className="startup-loader__indicator" aria-hidden="true" />
      <p className="startup-loader__message">Loading Kino XII...</p>
    </main>
  );
}
