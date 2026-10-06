import { useCallback, useEffect } from "react";
import { getSession, getSessionSeats } from "../api/sessionsApi.js";
import { ApiError } from "../api/client.js";
import { isSeatMap } from "./seatSelection.js";

export async function readBookingData(kind, sessionId, { signal } = {}, apis = { getSession, getSessionSeats }) {
  const api = kind === "sessionRead" ? apis.getSession : apis.getSessionSeats;
  const data = await api(sessionId, { signal });
  if (kind === "sessionRead" ? data?.id !== sessionId : !isSeatMap(data, sessionId)) {
    throw new ApiError(kind === "sessionRead" ? "Booking details are incomplete. Try again." : "Seat map is unavailable. Try again.");
  }
  return data;
}

export default function useBookingReads({ state, scope, dispatch, isCurrentUser, onExpire }) {
  const read = useCallback((kind) => {
    const request = scope.start(kind);
    if (!request) return;
    if (!scope.isCurrent(request, isCurrentUser)) { request.controller.abort(); return; }
    const { sessionId, instanceId, attempt, controller } = request;
    const identity = { kind, sessionId, instanceId, attempt };
    dispatch({ type: "READ_START", ...identity });
    readBookingData(kind, sessionId, { signal: controller.signal }).then((data) => {
      if (!scope.isCurrent(request, isCurrentUser)) return;
      dispatch({ type: "READ_SUCCESS", ...identity, data });
    }).catch((error) => {
      if (error?.name === "AbortError" || !scope.isCurrent(request, isCurrentUser)) return;
      if (error.status === 401) { onExpire(request); return; }
      dispatch({ type: "READ_ERROR", ...identity, error });
    });
  }, [scope, dispatch, isCurrentUser, onExpire]);

  useEffect(() => {
    if (state.sessionId === null || scope.active()?.instanceId !== state.instanceId) return;
    read("sessionRead");
    read("seatMapRead");
    return () => scope.abortReads(state.instanceId);
  }, [state.sessionId, state.instanceId, scope, read]);

  return read;
}
