import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AuthProvider from "../../src/auth/AuthProvider.jsx";
import { useAuth } from "../../src/auth/AuthContext.js";
import AppBootstrapProvider from "../../src/app/AppBootstrapProvider.jsx";
import AppShell from "../../src/app/AppShell.jsx";
import ProfilePage from "../../src/pages/ProfilePage.jsx";
import { useRefund } from "../../src/tickets/RefundContext.js";
import { useBooking } from "../../src/booking/BookingContext.js";
import { useBookingEntry } from "../../src/auth/BookingEntryContext.js";

export function Probe() {
  const auth = useAuth(), runtime = useRefund(), navigate = useNavigate(), location = useLocation();
  const booking = useBooking(), entry = useBookingEntry();
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const previous = window.refundQaRuntime;
    if (previous && previous !== runtime) window.refundQaReplacements++;
    window.refundQaRuntime = runtime;
    window.refundQaReplacements ??= 0;
    window.refundQa = {
      identity: auth.getSessionIdentity, login: auth.login, register: auth.register,
      logout: auth.logout, restore: auth.restoreSession, expire: auth.expireProfileSession,
      user: auth.getCurrentUser, replaceUser: auth.replaceUser,
      start(order) {
        const consent = runtime.createConsent(order, { confirmed: true });
        const result = runtime.submit(consent, order);
        result.then((value) => { window.refundQaResult = value; });
        return Boolean(consent);
      },
      confirm(order) { return runtime.createConsent(order, { confirmed: true }); },
      check(reference) {
        window.refundQaRecoveryResult = null;
        runtime.checkStatus(reference).then(value => { window.refundQaRecoveryResult = value; });
      },
      renew(order, warningAcknowledged) {
        const consent = runtime.createConsent(order, { confirmed: true, warningAcknowledged });
        if (!consent) return false;
        runtime.submit(consent, order).then(value => { window.refundQaResult = value; });
        return true;
      },
      snapshot: runtime.snapshot, cancel: runtime.cancelIntent,
      authSnapshot: runtime.authSnapshot, verify: runtime.retryVerification, resume: runtime.authenticationSucceeded,
      deadline: runtime.checkDeadline, busy: runtime.hasActivePost,
      mount: setMounted, navigate,
      bookingOpen: entry.openBooking, bookingClose: booking.close,
      bookingSeat: booking.toggleSeat, bookingNext: booking.next,
    };
  }, [auth, runtime, navigate, booking, entry]);
  return <><output id="slice2-auth" hidden>{JSON.stringify({
    status: auth.status, id: auth.user?.id, mutation: auth.mutation,
    identity: auth.getSessionIdentity(), booking: booking.state,
  })}</output>{mounted && location.pathname === "/profile" && <ProfilePage />}</>;
}
export default function Fixture() {
  return <StrictMode><AuthProvider><AppBootstrapProvider><BrowserRouter><Routes>
    <Route element={<AppShell />}>
      <Route path="*" element={<Probe />} />
    </Route>
  </Routes></BrowserRouter></AppBootstrapProvider></AuthProvider></StrictMode>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
