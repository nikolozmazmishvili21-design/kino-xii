import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTES, profileTab, profileTicketsPath } from "../routing/routes.js";
import { useAuth } from "../auth/AuthContext.js";
import { useBookingEntry } from "../auth/BookingEntryContext.js";
import { createBookingAction } from "../auth/pendingAction.js";
import { useAppBootstrap } from "../app/AppBootstrapContext.js";
import { BookingContext } from "./BookingContext.js";
import { createBookingRuntime } from "./bookingRuntime.js";
import { initialBookingState } from "./bookingReducer.js";
import { selectionConfiguration } from "./seatSelection.js";
import SeatSelectionModal from "../components/booking/SeatSelectionModal.jsx";
import OrderNotice from "../components/booking/OrderNotice.jsx";

const EMPTY_BOOKING = initialBookingState();

export default function BookingProvider({ children, authClosed }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [noticeNavigation, setNoticeNavigation] = useState(null);
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
  const lifecycle = useMemo(() => ({ ...runtime, newIntent: (sessionId) => {
    setNoticeNavigation(null);
    runtime.newIntent(sessionId);
  } }), [runtime]);
  const observedState = useSyncExternalStore(runtime.subscribe, runtime.state);
  // Hide protected data synchronously; auth cleanup effects run after rendering.
  const state = observedState.sessionId === null || runtime.ownsBooking(user) ? observedState : EMPTY_BOOKING;
  const orderInfo = useSyncExternalStore(runtime.subscribeOrder, runtime.orderSnapshot);

  useEffect(() => registerBookingLogout(runtime.logout), [registerBookingLogout, runtime]);
  useEffect(() => registerBookingLifecycle(lifecycle), [registerBookingLifecycle, lifecycle]);
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
    canSubmitOrder: runtime.canSubmitOrder(), submitOrder: runtime.submitOrder,
    clearOrderError: runtime.clearOrderError, orderNotice: orderInfo.notice,
    dismissOrderNotice: runtime.dismissOrderNotice, orderReauth: orderInfo.reauth,
    orderRecovery: orderInfo.recovery,
    hasPendingOrderForSession: runtime.hasPendingOrderForSession(),
    ticketsRecoveryIntent: orderInfo.ticketsIntent, consumeTicketsRecovery: runtime.consumeTicketsRecovery,
    openOrderTickets: (options) => {
      if (!runtime.prepareTicketsRecovery(options)) return;
      if (options?.noticeId !== undefined) {
        runtime.dismissOrderNotice(options.noticeId);
        // A detached notice does not own any current booking. Route presentation
        // can hide its dialog while preserving the newer Hold and all its state.
        setNoticeNavigation(runtime.state().instanceId);
      } else runtime.close();
      navigate(profileTicketsPath());
    },
    returnOrderHome: () => { runtime.close(); navigate("/"); },
    completeOrderFlow: (destination) => {
      if (!runtime.completeOrderFlow({ instanceId: state.instanceId, sessionId: state.sessionId, order: state.order.data })) return false;
      if (destination === "tickets") navigate(profileTicketsPath());
      if (destination === "home") navigate("/");
      return true;
    },
    changed: runtime.isChanged(), unknownOwn: runtime.hasUnknownOwn(), verifiedIds: runtime.verifiedIds(),
    profileRemediationMessage: runtime.profileMessage(user?.id),
    toggleSeat: (seatId) => runtime.edit("TOGGLE_SEAT", { seatId }),
    removeSeat: (seatId) => runtime.edit("REMOVE_SEAT", { seatId }),
    setTicket: (seatId, slug) => runtime.edit("SET_TICKET", { seatId, slug }),
  }), [state, filterOptions, runtime, user, orderInfo, navigate]);

  const visible = state.sessionId !== null && status === "authenticated" && !mutation
    && user?.profileComplete === true && authClosed
    && !(noticeNavigation === state.instanceId && location.pathname === ROUTES.profile && profileTab(location.search) === "tickets");
  return <BookingContext.Provider value={value}>{children}{visible ? <SeatSelectionModal key={state.instanceId} /> : <OrderNotice />}</BookingContext.Provider>;
}
