import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AuthProvider from "../../src/auth/AuthProvider.jsx";
import { useAuth } from "../../src/auth/AuthContext.js";
import AppBootstrapProvider from "../../src/app/AppBootstrapProvider.jsx";
import { AppBootstrapContext } from "../../src/app/AppBootstrapContext.js";
import AppRouter from "../../src/routing/AppRouter.jsx";
import { ProfileAccessContext } from "../../src/auth/ProfileAccessContext.js";
import { BookingContext } from "../../src/booking/BookingContext.js";
import ProfilePage from "../../src/pages/ProfilePage.jsx";
import HoldRoutes from "./holdRoutes.jsx";

const late = new URLSearchParams(location.search).has("late");
const holdQa = new URLSearchParams(location.search).has("hold-qa");
const venues = [{ id: 3, name: "Server Venue" }];
const profileAccess = { continuation: null, requestProfileAccess: () => {}, finishProfileAccess: () => {}, reauthenticateProfile: () => {} };
const booking = { profileRemediationMessage: null };

function AuthProbe() {
  const auth = useAuth();
  const { restoreSession } = auth;
  useEffect(() => {
    window.profileQa = {
      restoreSession: auth.restoreSession, replaceUser: auth.replaceUser,
      login: auth.login, register: auth.register,
      logout: auth.logout,
      setPendingAction: auth.setPendingAction, getCurrentUser: auth.getCurrentUser,
      expireSession: auth.expireSession,
    };
  }, [auth]);
  useEffect(() => { if (late) void restoreSession(); }, [restoreSession]);
  return <output id="auth-probe" hidden>{JSON.stringify({ status: auth.status, user: auth.user, pendingAction: auth.pendingAction, bookingReadyAction: auth.bookingReadyAction })}</output>;
}

export default function Harness() {
  const [revision, setRevision] = useState(0);
  return (
    <AuthProvider>
      <AuthProbe />
      <button id="rerender" onClick={() => setRevision((current) => current + 1)}>Rerender {revision}</button>
      {late ? (
        <AppBootstrapContext.Provider value={{ filterOptions: { venues } }}>
          <ProfileAccessContext.Provider value={profileAccess}>
            <BookingContext.Provider value={booking}><ProfilePage /></BookingContext.Provider>
          </ProfileAccessContext.Provider>
        </AppBootstrapContext.Provider>
      ) : <AppBootstrapProvider>{holdQa ? <HoldRoutes /> : <AppRouter />}</AppBootstrapProvider>}
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(createElement(Harness));
