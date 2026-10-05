import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { ROUTES } from "../routing/routes.js";
import Navbar from "../components/navigation/Navbar.jsx";
import AuthModal from "../auth/AuthModal.jsx";
import { useAuth } from "../auth/AuthContext.js";
import { BookingEntryContext } from "../auth/BookingEntryContext.js";
import { createBookingAction } from "../auth/pendingAction.js";

export default function AppShell() {
  const isHome = useMatch(ROUTES.home);
  const isMovieDetail = useMatch(ROUTES.movieDetail);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { status, user, mutation, pendingAction, bookingReadyAction, setPendingAction,
    clearProtectedAction, markBookingReady, consumeBookingReady, expireSession } = useAuth();
  const [authMode, setAuthMode] = useState("closed");
  const openerRef = useRef(null);
  const profileHandoff = useRef(null);
  const visibleAuthMode = authMode !== "closed" ? authMode
    : status === "guest" && pendingAction ? "login" : "closed";

  // Success closes auth without cancelling intent; only the coordinator replays.
  const finishAuth = useCallback(() => setAuthMode("closed"), []);
  const cancelAuth = useCallback(() => {
    clearProtectedAction();
    setAuthMode("closed");
  }, [clearProtectedAction]);

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

  return (
    <BookingEntryContext.Provider value={bookingEntry}>
      <div className={`app-shell${isHome ? " app-shell--home" : ""}${isMovieDetail ? " app-shell--movie-detail" : ""}`}>
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
    </BookingEntryContext.Provider>
  );
}
