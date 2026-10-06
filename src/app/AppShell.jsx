import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { ROUTES } from "../routing/routes.js";
import Navbar from "../components/navigation/Navbar.jsx";
import AuthModal from "../auth/AuthModal.jsx";
import { useAuth } from "../auth/AuthContext.js";
import { BookingEntryContext } from "../auth/BookingEntryContext.js";
import { createBookingAction } from "../auth/pendingAction.js";
import { ProfileAccessContext } from "../auth/ProfileAccessContext.js";

export default function AppShell() {
  const isHome = useMatch(ROUTES.home);
  const isMovieDetail = useMatch(ROUTES.movieDetail);
  const isProfile = useMatch(ROUTES.profile);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { status, user, mutation, pendingAction, bookingReadyAction, setPendingAction,
    clearProtectedAction, markBookingReady, consumeBookingReady, expireSession,
    expireProfileSession } = useAuth();
  const [authMode, setAuthMode] = useState("closed");
  const [profileContinuation, setProfileContinuation] = useState(null);
  const continuationRef = useRef(null);
  const openerRef = useRef(null);
  const profileHandoff = useRef(null);
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
    const isProfileAccess = Boolean(continuationRef.current);
    finishProfileAccess();
    clearProtectedAction();
    setAuthMode("closed");
    if (isProfileAccess) navigate(ROUTES.home);
  }, [clearProtectedAction, finishProfileAccess, navigate]);

  const openBooking = useCallback((sessionId) => {
    const action = createBookingAction(sessionId);
    if (!action) return false;
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
  }), [openBooking, bookingReadyAction, consumeBookingReady, reauthenticateBooking]);

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
    <BookingEntryContext.Provider value={bookingEntry}>
      <ProfileAccessContext.Provider value={profileAccess}>
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
      </ProfileAccessContext.Provider>
    </BookingEntryContext.Provider>
  );
}
