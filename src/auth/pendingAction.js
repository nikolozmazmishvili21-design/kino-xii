// Protected continuations contain identifiers only, never API objects or credentials.
export function normalizePendingAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  if (!action.payload || typeof action.payload !== "object" || Array.isArray(action.payload)) return null;
  if (action.type === "NOTIFY_MOVIE") {
    const movieSlug = action.payload.movieSlug;
    // Bound retained data without rewriting the exact server path key.
    if (typeof movieSlug !== "string" || !movieSlug.trim() || movieSlug.length > 512) return null;
    return Object.freeze({ type: "NOTIFY_MOVIE", payload: Object.freeze({ movieSlug }) });
  }
  if (action.type !== "OPEN_BOOKING") return null;
  const sessionId = action.payload?.sessionId;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;

  return Object.freeze({
    type: "OPEN_BOOKING",
    payload: Object.freeze({ sessionId }),
  });
}

export function createBookingAction(sessionId) {
  return normalizePendingAction({ type: "OPEN_BOOKING", payload: { sessionId } });
}

export function createNotifyAction(movieSlug) {
  return normalizePendingAction({ type: "NOTIFY_MOVIE", payload: { movieSlug } });
}

export function isSamePendingAction(first, second) {
  const a = normalizePendingAction(first);
  const b = normalizePendingAction(second);
  return a !== null && b !== null && a.type === b.type && (a.type === "OPEN_BOOKING"
    ? a.payload.sessionId === b.payload.sessionId : a.payload.movieSlug === b.payload.movieSlug);
}
