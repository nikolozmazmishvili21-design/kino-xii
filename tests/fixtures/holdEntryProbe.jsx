import { useLocation } from "react-router-dom";
import { useAuth } from "../../src/auth/AuthContext.js";
import { useBooking } from "../../src/booking/BookingContext.js";
import { useProfileAccess } from "../../src/auth/ProfileAccessContext.js";

// Read-only observer inserted by the integration test's Vite plugin. It does
// not replace a page/provider, open booking, adopt users, or create intents.
export default function HoldEntryProbe({ handoffArmed }) {
  const auth = useAuth();
  const booking = useBooking();
  const access = useProfileAccess();
  const { pathname } = useLocation();
  const snapshot = {
    pathname, handoffArmed,
    user: auth.user, canonicalUser: auth.getCurrentUser(),
    pendingAction: auth.pendingAction, bookingReadyAction: auth.bookingReadyAction,
    profileAccessContinuation: access.continuation,
    profileContinuation: booking.profileRemediationMessage,
    booking: booking.state, canNext: booking.canNext,
  };
  return <output id="hold-entry-probe" hidden>{JSON.stringify(snapshot)}</output>;
}
