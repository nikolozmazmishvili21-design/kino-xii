// Only this bounded, in-memory action is supported by Checkpoint A.
export function normalizePendingAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  if (action?.type !== "OPEN_BOOKING") return null;
  if (!action.payload || typeof action.payload !== "object" || Array.isArray(action.payload)) return null;
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

export function isSamePendingAction(first, second) {
  const a = normalizePendingAction(first);
  const b = normalizePendingAction(second);
  return a !== null && b !== null && a.payload.sessionId === b.payload.sessionId;
}
