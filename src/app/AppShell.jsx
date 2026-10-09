import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { ROUTES, profileTab } from "../routing/routes.js";
import Navbar from "../components/navigation/Navbar.jsx";
import AuthModal from "../auth/AuthModal.jsx";
import { useAuth } from "../auth/AuthContext.js";
import { BookingEntryContext } from "../auth/BookingEntryContext.js";
import { createBookingAction } from "../auth/pendingAction.js";
import { ProfileAccessContext } from "../auth/ProfileAccessContext.js";
import { RefundContext } from "../tickets/RefundContext.js";
import { createRefundRuntime } from "../tickets/refundRuntime.js";
import BookingProvider from "../booking/BookingProvider.jsx";

export default function AppShell() {
  const isHome = useMatch(ROUTES.home);
  const isMovieDetail = useMatch(ROUTES.movieDetail);
  const isProfile = useMatch(ROUTES.profile);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { status, user, mutation, pendingAction, bookingReadyAction, setPendingAction,
    clearProtectedAction, markBookingReady, consumeBookingReady, expireSession,
    expireProfileSession, getRequestAuth, registerAuthLifecycle } = useAuth();
  const inTickets = pathname === ROUTES.profile && profileTab(search) === "tickets";
  const ticketsContext = useRef(inTickets);
  // The factory stores this getter; it reads the ref only during later dispatch.
  // eslint-disable-next-line react-hooks/refs
  const [refund] = useState(() => createRefundRuntime({
    getAuth: getRequestAuth, isContextCurrent: () => ticketsContext.current,
  }));
  useLayoutEffect(() => {
    const departed = ticketsContext.current && !inTickets;
    ticketsContext.current = inTickets;
    if (departed) refund.cancelIntent();
  }, [inTickets, refund]);
  useLayoutEffect(() => {
    const unsubscribe = registerAuthLifecycle((type) => {
      if (type === "logout") refund.logout();
      refund.syncAuth();
    });
    refund.syncAuth();
    return unsubscribe; // App/consumer cleanup never retires a submitted POST.
  }, [registerAuthLifecycle, refund]);
  const [authMode, setAuthMode] = useState("closed");
  const [profileContinuation, setProfileContinuation] = useState(null);
  const continuationRef = useRef(null);
  const openerRef = useRef(null);
  const profileHandoff = useRef(null);
  const bookingLifecycle = useRef(null);
  const registerBookingLifecycle = useCallback((handler) => {
    bookingLifecycle.current = handler;
    return () => { if (bookingLifecycle.current === handler) bookingLifecycle.current = null; };
  }, []);
  const visibleAuthMode = authMode !== "closed" ? authMode
    : status === "guest" && (pendingAction || profileContinuation) ? "login" : "closed";

  const finishProfileAccess = useCallback(() => {
    continuationRef.current = null;
    setProfileContinuation(null);
  }, []);

  const requestProfileAccess = useCallback(() => {
    if (continuationRef.current) return;
    const continuation = { type: "access" };
    continuationRef.current = continuation;
    setProfileContinuation(continuation);
  }, []);

  const reauthenticateProfile = useCallback((expectedUser) => {
    if (!expireProfileSession(expectedUser)) return false;
    const continuation = { type: "reauth", userId: expectedUser.id };
    continuationRef.current = continuation;
    setProfileContinuation(continuation);
    setAuthMode("closed");
    return true;
  }, [expireProfileSession]);

  useEffect(() => {
    if (pathname !== ROUTES.profile && continuationRef.current) {
      finishProfileAccess();
      setAuthMode("closed");
    }
  }, [pathname, finishProfileAccess]);

  // Success closes auth without cancelling intent; only the coordinator replays.
  const finishAuth = useCallback(() => setAuthMode("closed"), []);
  const cancelAuth = useCallback(() => {
    bookingLifecycle.current?.cancelContinuation();
    refund.cancelIntent();
    const isProfileAccess = Boolean(continuationRef.current);
    finishProfileAccess();
    clearProtectedAction();
    setAuthMode("closed");
    if (isProfileAccess) navigate(ROUTES.home);
  }, [clearProtectedAction, finishProfileAccess, navigate, refund]);

  const openBooking = useCallback((sessionId) => {
    const action = createBookingAction(sessionId);
    if (!action) return false;
    bookingLifecycle.current?.newIntent(sessionId);
    const opener = document.activeElement;
    if (opener && !opener.closest("dialog")) openerRef.current = opener;
    return setPendingAction(action, { newIntent: true });
  }, [setPendingAction]);

  const reauthenticateBooking = useCallback((sessionId) => {
    return expireSession(createBookingAction(sessionId));
  }, [expireSession]);

  useEffect(() => {
    if (!pendingAction || status !== "authenticated" || mutation
      || visibleAuthMode !== "closed") return;

    if (user?.profileComplete === true) {
      markBookingReady(pendingAction);
    } else if (user?.profileComplete === false && profileHandoff.current !== pendingAction) {
      // Identity guard survives Strict Mode and route rerenders; keep intent pending.
      profileHandoff.current = pendingAction;
      if (pathname !== ROUTES.profile) navigate(ROUTES.profile);
    }
  }, [pendingAction, status, user, mutation, visibleAuthMode, markBookingReady, pathname, navigate]);

  const bookingEntry = useMemo(() => ({
    openBooking,
    bookingReadyAction,
    consumeBookingReady,
    reauthenticateBooking,
    openerRef,
    registerBookingLifecycle,
  }), [openBooking, bookingReadyAction, consumeBookingReady, reauthenticateBooking, registerBookingLifecycle]);

  function openAuth(mode, opener) {
    openerRef.current = opener;
    setAuthMode(mode);
  }

  const profileAccess = useMemo(() => ({
    continuation: profileContinuation,
    requestProfileAccess,
    reauthenticateProfile,
    finishProfileAccess,
  }), [profileContinuation, requestProfileAccess, reauthenticateProfile, finishProfileAccess]);

  return (
    <RefundContext.Provider value={refund}>
    <BookingEntryContext.Provider value={bookingEntry}>
      <ProfileAccessContext.Provider value={profileAccess}>
        <BookingProvider authClosed={visibleAuthMode === "closed"}>
          <div className={`app-shell${isHome ? " app-shell--home" : ""}${isMovieDetail ? " app-shell--movie-detail" : ""}${isProfile ? " app-shell--profile" : ""}`}>
            <Navbar onOpenAuth={openAuth} />
            <Outlet />
            {visibleAuthMode !== "closed" && (
              <AuthModal
                mode={visibleAuthMode}
                onSwitchMode={setAuthMode}
                onClose={cancelAuth}
                onSuccess={finishAuth}
                openerRef={openerRef}
              />
            )}
          </div>
        </BookingProvider>
      </ProfileAccessContext.Provider>
    </BookingEntryContext.Provider>
    </RefundContext.Provider>
  );
}
