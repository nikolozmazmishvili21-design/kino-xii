import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useBookingEntry } from "../auth/BookingEntryContext.js";
import { createBookingAction } from "../auth/pendingAction.js";
import { useAppBootstrap } from "../app/AppBootstrapContext.js";
import { BookingContext } from "./BookingContext.js";
import { createBookingRuntime } from "./bookingRuntime.js";
import { selectionConfiguration } from "./seatSelection.js";
import SeatSelectionModal from "../components/booking/SeatSelectionModal.jsx";

export default function BookingProvider({ children, authClosed }) {
  const { status, user, mutation, isCurrentUser, getCurrentUser, replaceUser, setPendingAction, registerBookingLogout } = useAuth();
  const { bookingReadyAction, consumeBookingReady, reauthenticateBooking, openerRef, registerBookingLifecycle } = useBookingEntry();
  const { filterOptions } = useAppBootstrap();
  const bookingOpener = useRef(null);
  const [runtime] = useState(() => createBookingRuntime({
    isCurrentUser, getUser: getCurrentUser, replaceUser, options: () => filterOptions, reauthenticate: reauthenticateBooking,
    profileRequired: (freshUser, sessionId) => {
      if (isCurrentUser(freshUser)) setPendingAction(createBookingAction(sessionId));
    },
  }));
  const state = useSyncExternalStore(runtime.subscribe, runtime.state);

  useEffect(() => registerBookingLogout(runtime.close), [registerBookingLogout, runtime]);
  useEffect(() => registerBookingLifecycle(runtime), [registerBookingLifecycle, runtime]);
  useEffect(() => {
    runtime.configureDependencies({ options: () => filterOptions, replaceUser, profileRequired: (freshUser, sessionId) => {
      if (isCurrentUser(freshUser)) setPendingAction(createBookingAction(sessionId));
    } });
  }, [runtime, filterOptions, replaceUser, isCurrentUser, setPendingAction]);
  useEffect(() => {
    const allowed = status === "authenticated" && !mutation && user?.profileComplete === true && authClosed;
    runtime.syncAuth(user, allowed);
    if (!allowed || !bookingReadyAction) return;
    const action = consumeBookingReady(bookingReadyAction);
    if (!action) return;
    bookingOpener.current = openerRef.current;
    void runtime.enter(action.payload.sessionId, user, bookingOpener.current);
  }, [runtime, status, mutation, user, authClosed, bookingReadyAction, consumeBookingReady, openerRef]);

  const value = useMemo(() => ({
    state, filterOptions, openerRef: bookingOpener,
    config: selectionConfiguration(filterOptions, state.sessionRead.data),
    close: runtime.close, retry: runtime.retry, next: runtime.submit, back: runtime.back,
    startOver: runtime.startOver, expire: runtime.expire, canNext: runtime.canNext(),
    changed: runtime.isChanged(), unknownOwn: runtime.hasUnknownOwn(), verifiedIds: runtime.verifiedIds(),
    profileRemediationMessage: runtime.profileMessage(user?.id),
    toggleSeat: (seatId) => runtime.edit("TOGGLE_SEAT", { seatId }),
    removeSeat: (seatId) => runtime.edit("REMOVE_SEAT", { seatId }),
    setTicket: (seatId, slug) => runtime.edit("SET_TICKET", { seatId, slug }),
  }), [state, filterOptions, runtime, user]);

  const visible = state.sessionId !== null && status === "authenticated" && !mutation
    && user?.profileComplete === true && authClosed;
  return <BookingContext.Provider value={value}>{children}{visible && <SeatSelectionModal key={state.instanceId} />}</BookingContext.Provider>;
}
