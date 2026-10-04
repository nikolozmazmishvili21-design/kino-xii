export default function CatalogueRow({ className, label, children }) {
  function handleFocus(event) {
    if (event.target === event.currentTarget) return;

    const viewport = event.currentTarget.getBoundingClientRect();
    const focused = event.target.getBoundingClientRect();
    if (focused.left < viewport.left || focused.right > viewport.right) {
      event.target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }

  return (
    <div className={`home-section__row ${className}`} role="region" aria-label={label} tabIndex={0} onFocus={handleFocus}>
      {children}
    </div>
  );
}
