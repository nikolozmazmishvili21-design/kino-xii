import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppShell from "../../src/app/AppShell.jsx";
import ProfilePage from "../../src/pages/ProfilePage.jsx";
import { useBooking } from "../../src/booking/BookingContext.js";
import { useBookingEntry } from "../../src/auth/BookingEntryContext.js";

// Keep the real AppShell/Auth/Booking providers and navigation coordinator.
// Only the page content is a fixture exposing their public state and actions.
function BookingProbe() {
  const booking = useBooking();
  const entry = useBookingEntry();
  useEffect(() => {
    window.holdQa = { open: entry.openBooking, close: booking.close, expire: () => booking.expire(booking.state.hold.data) };
  }, [booking, entry]);
  return <output id="booking-probe" hidden>{JSON.stringify({
    state: booking.state, canNext: booking.canNext,
    profileIntent: booking.profileRemediationMessage,
    ticketsIntent: booking.ticketsRecoveryIntent, pendingOrder: booking.hasPendingOrderForSession,
  })}</output>;
}

export default function HoldRoutes() {
  return <BrowserRouter><Routes><Route element={<AppShell />}>
    <Route path="/" element={<BookingProbe />} />
    <Route path="/sessions" element={<BookingProbe />} />
    <Route path="/profile" element={<><BookingProbe /><ProfilePage /></>} />
  </Route></Routes></BrowserRouter>;
}
