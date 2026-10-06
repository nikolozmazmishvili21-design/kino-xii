import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useBookingEntry } from "../auth/BookingEntryContext.js";
import { useAppBootstrap } from "../app/AppBootstrapContext.js";
import { BookingContext } from "./BookingContext.js";
import { bookingReducer, initialBookingState, createBookingReadScope, consumeReadyBooking, expireBookingRead } from "./bookingReducer.js";
import useBookingReads from "./useBookingReads.js";
import { selectionConfiguration } from "./seatSelection.js";
import SeatSelectionModal from "../components/booking/SeatSelectionModal.jsx";

export default function BookingProvider({ children, authClosed }) {
  const { status, user, mutation, isCurrentUser } = useAuth();
  const { bookingReadyAction, consumeBookingReady, reauthenticateBooking, openerRef } = useBookingEntry();
  const { filterOptions } = useAppBootstrap();
  const [state, dispatch] = useReducer(bookingReducer, undefined, initialBookingState);
  const [scope] = useState(createBookingReadScope);
  const bookingOpener = useRef(null);

  const close = useCallback(() => {
    const active = scope.active();
    scope.close();
    if (active) dispatch({ type: "CLOSE", instanceId: active.instanceId });
  }, [scope]);

  const onExpire = useCallback((request) => {
    // expireSession does not itself guard the expected user. Check it before handoff.
    expireBookingRead(scope, request, isCurrentUser, close, reauthenticateBooking);
  }, [scope, isCurrentUser, close, reauthenticateBooking]);

  const retry = useBookingReads({ state, scope, dispatch, isCurrentUser, onExpire });

  useEffect(() => {
    if (status !== "authenticated" || mutation || user?.profileComplete !== true || !authClosed) {
      close();
      return;
    }
    if (scope.active() && !isCurrentUser(scope.active().expectedUser)) close();
    consumeReadyBooking(bookingReadyAction, consumeBookingReady, (sessionId) => {
      bookingOpener.current = openerRef.current;
      const active = scope.open(sessionId, user, bookingOpener.current);
      dispatch({ type: "OPEN", sessionId, instanceId: active.instanceId });
    });
  }, [status, mutation, user, authClosed, bookingReadyAction, consumeBookingReady, openerRef, scope, close, isCurrentUser]);

  useEffect(() => () => scope.abortReads(), [scope]);
  useEffect(() => {
    dispatch({ type: "CONFIG_CHANGED", instanceId: state.instanceId, options: filterOptions });
  }, [filterOptions, state.instanceId]);

  const value = useMemo(() => ({
    state, filterOptions, close, retry, openerRef: bookingOpener,
    config: selectionConfiguration(filterOptions, state.sessionRead.data),
    toggleSeat: (seatId) => dispatch({ type: "TOGGLE_SEAT", instanceId: state.instanceId, seatId, options: filterOptions }),
    removeSeat: (seatId) => dispatch({ type: "REMOVE_SEAT", instanceId: state.instanceId, seatId }),
    setTicket: (seatId, slug) => dispatch({ type: "SET_TICKET", instanceId: state.instanceId, seatId, slug, options: filterOptions }),
  }), [state, filterOptions, close, retry]);

  const visible = state.sessionId !== null && status === "authenticated" && !mutation
    && user?.profileComplete === true && authClosed;
  return <BookingContext.Provider value={value}>{children}{visible && <SeatSelectionModal key={state.instanceId} />}</BookingContext.Provider>;
}
