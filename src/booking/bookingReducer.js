import { findSeat, hasPreviewContext, selectionConfiguration } from "./seatSelection.js";

const emptyRead = () => ({ status: "idle", data: null, error: null, attempt: 0 });
export function initialBookingState() {
  return { sessionId: null, instanceId: 0, sessionRead: emptyRead(), seatMapRead: emptyRead(), selection: {}, feedback: null };
}

export function bookingReducer(state, action) {
  if (action.type === "OPEN") return { ...initialBookingState(), sessionId: action.sessionId, instanceId: action.instanceId,
    sessionRead: { ...emptyRead(), status: "loading" }, seatMapRead: { ...emptyRead(), status: "loading" } };
  if (action.instanceId !== state.instanceId || state.sessionId === null) return state;
  if (action.type === "CLOSE") return initialBookingState();
  if (action.type === "READ_START") {
    const key = action.kind;
    if (action.sessionId !== state.sessionId || action.attempt <= state[key].attempt) return state;
    return { ...state, [key]: { status: "loading", data: null, error: null, attempt: action.attempt }, selection: {}, feedback: null };
  }
  if (action.type === "READ_SUCCESS" || action.type === "READ_ERROR") {
    const key = action.kind;
    if (action.sessionId !== state.sessionId || action.attempt !== state[key].attempt) return state;
    if (action.type === "READ_ERROR") return { ...state, [key]: { ...state[key], status: "error", error: action.error }, selection: {}, feedback: null };
    return { ...state, [key]: { ...state[key], status: "ready", data: action.data, error: null },
      ...(key === "sessionRead" && !hasPreviewContext(action.data) ? { selection: {}, feedback: null } : {}) };
  }
  if (action.type === "CONFIG_CHANGED") {
    if (!selectionConfiguration(action.options, state.sessionRead.data).ready && Object.keys(state.selection).length) {
      return { ...state, selection: {}, feedback: null };
    }
    return state;
  }
  if (action.type === "REMOVE_SEAT") {
    const selection = { ...state.selection };
    delete selection[action.seatId];
    return { ...state, selection, feedback: null };
  }
  const config = selectionConfiguration(action.options, state.sessionRead.data);
  if (!config.ready || state.sessionRead.status !== "ready" || state.seatMapRead.status !== "ready") return state;
  if (action.type === "TOGGLE_SEAT") {
    const seat = findSeat(state.seatMapRead.data, action.seatId);
    if (!seat || seat.state !== "available" || seat.isMine) return state;
    if (state.selection[seat.id]) return bookingReducer(state, { type: "REMOVE_SEAT", seatId: seat.id, instanceId: state.instanceId });
    if (Object.keys(state.selection).length >= config.max) {
      return { ...state, feedback: `You can select up to ${config.max} seats.` };
    }
    return { ...state, selection: { ...state.selection, [seat.id]: { ticketTypeSlug: config.adult.slug } }, feedback: null };
  }
  if (action.type === "SET_TICKET" && state.selection[action.seatId]
    && config.types.some((type) => type.slug === action.slug)) {
    return { ...state, selection: { ...state.selection, [action.seatId]: { ticketTypeSlug: action.slug } }, feedback: null };
  }
  return state;
}

// Request identity is synchronous; React's queued renders cannot keep an obsolete read alive.
export function createBookingReadScope() {
  let active = null;
  let instance = 0;
  let attempt = 0;
  const requests = new Map();
  function abortReads(instanceId = active?.instanceId) {
    for (const [kind, request] of requests) {
      if (request.instanceId === instanceId) {
        request.controller.abort();
        requests.delete(kind);
      }
    }
  }
  function close() {
    abortReads();
    active = null;
  }
  return {
    active: () => active,
    open(sessionId, expectedUser, opener) {
      close();
      active = { sessionId, instanceId: ++instance, expectedUser, opener };
      return active;
    },
    close,
    abortReads,
    start(kind) {
      if (!active) return null;
      requests.get(kind)?.controller.abort();
      const request = { ...active, kind, attempt: ++attempt, controller: new AbortController() };
      requests.set(kind, request);
      return request;
    },
    isCurrent(request, isCurrentUser) {
      return Boolean(request && active?.instanceId === request.instanceId && active.sessionId === request.sessionId
        && requests.get(request.kind) === request && !request.controller.signal.aborted
        && isCurrentUser(request.expectedUser));
    },
  };
}

export function consumeReadyBooking(expectedAction, consume, open) {
  if (!expectedAction) return false;
  const action = consume(expectedAction);
  if (!action) return false;
  open(action.payload.sessionId);
  return true;
}

export function expireBookingRead(scope, request, isCurrentUser, close, reauthenticate) {
  if (!scope.isCurrent(request, isCurrentUser)) return false;
  const sessionId = request.sessionId;
  close();
  reauthenticate(sessionId);
  return true;
}
