import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createBookingRuntime } from "../src/booking/bookingRuntime.js";
import { ApiError } from "../src/api/client.js";

// Verify rendered controls through the existing Vite JSX pipeline without adding
// a DOM/test dependency. Live browser focus/layout verification is separate.
let server, context, Summary, Checkout, SeatMap, Timer, Profile, authContext, profileContext, bootstrapContext;
before(async () => {
  server = await createServer({ cacheDir: "node_modules/.cache/kino-profile-qa/vite-hold-rendering", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  context = (await server.ssrLoadModule("/src/booking/BookingContext.js")).BookingContext;
  Summary = (await server.ssrLoadModule("/src/components/booking/SelectedSeatsSummary.jsx")).default;
  Checkout = (await server.ssrLoadModule("/src/components/booking/CheckoutHandoff.jsx")).default;
  SeatMap = (await server.ssrLoadModule("/src/components/booking/SeatMap.jsx")).default;
  Timer = (await server.ssrLoadModule("/src/components/booking/HoldTimer.jsx")).default;
  Profile = (await server.ssrLoadModule("/src/pages/ProfilePage.jsx")).default;
  authContext = (await server.ssrLoadModule("/src/auth/AuthContext.js")).AuthContext;
  profileContext = (await server.ssrLoadModule("/src/auth/ProfileAccessContext.js")).ProfileAccessContext;
  bootstrapContext = (await server.ssrLoadModule("/src/app/AppBootstrapContext.js")).AppBootstrapContext;
});
after(async () => { await server?.close(); });
const options = { maxSeatsPerOrder: 3, ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
const session = { id: 10, price: 19, movie: { ageRating: { minAge: 12 } } };
const map = { sessionId: 10, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [
  { id: 1, label: "1", code: "A1", state: "held", isMine: true, aisleAfter: false },
  { id: 2, label: "2", code: "A2", state: "available", isMine: false, aisleAfter: false },
  { id: 4, label: "4", code: "A4", state: "held", isMine: true, aisleAfter: false },
] }] }] };
const hold = { holdId: "11111111-2222-3333-4444-555555555555", sessionId: 10, isLive: true, expiresAt: new Date(Date.now() + 3665000).toISOString(), secondsRemaining: 1, subtotal: 100.47,
  seats: [{ seatId: 1, code: "A1", price: 7.13, ticketType: { slug: "adult", name: "Server Adult" } }] };
function value(overrides = {}) {
  return { filterOptions: options, config: { ready: true, types: options.ticketTypes, max: 3 }, canNext: true,
    next: () => {}, back: () => {}, removeSeat: () => {}, setTicket: () => {},
    state: { sessionRead: { data: session }, seatMapRead: { data: map }, selection: { 1: { ticketTypeSlug: "adult" } }, hold: { phase: "active", data: hold }, fieldErrors: {}, recovery: null }, ...overrides };
}
const render = (Component, booking) => renderToStaticMarkup(createElement(context.Provider, { value: booking }, createElement(Component)));
const seatTag = (html, id) => html.match(new RegExp(`<button[^>]*id="booking-seat-${id}"[^>]*>`))?.[0];

test("Checkout shell renders server summary, current Checkout, Back only, and no payment/order controls", () => {
  const html = render(Checkout, value());
  assert.match(html, /aria-current="step">CHECKOUT/);
  assert.match(html, /A1/); assert.match(html, /Server Adult/); assert.match(html, /₾ 7\.13/); assert.match(html, /₾ 100\.47/);
  assert.match(html, /<button[^>]*id="booking-back"[^>]*>Back<\/button>/); assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<(?:input|form|select)|Next: Checkout|Purchase|Card Number|Confirm|POST|orders/i);
});
test("pending draft keeps native Next/remove/radio group disabled and displays authoritative held prices", () => {
  const booking = value(); booking.state = { ...booking.state, hold: { phase: "creating", data: hold } }; booking.canNext = false;
  const html = render(Summary, booking);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Remove seat A1"/);
  assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Next: Checkout/);
  assert.match(html, /₾ 7\.13/); assert.match(html, /₾ 100\.47/); assert.match(html, /Server Adult/);
});
test("uncertain/restoring state exposes no held-seat cards or stale protected subtotal", () => {
  for (const phase of ["uncertain", "restoring"]) {
    const booking = value(); booking.state = { ...booking.state, hold: { phase, data: null }, selection: {}, recovery: { reference: { holdId: hold.holdId } } }; booking.canNext = false;
    const html = render(Summary, booking);
    assert.doesNotMatch(html, /seat-summary__card"|Server Adult|₾ 100\.47/); assert.match(html, /₾ 0/);
  }
});
test("seat rendering allows only verified own seats, blocks arbitrary own and transient contested seats", () => {
  const html = renderToStaticMarkup(createElement(SeatMap, { map, selection: { 1: {} }, verifiedIds: [1], contested: ["A2"], blocked: false, onToggle: () => {} }));
  assert.doesNotMatch(seatTag(html, 1), /disabled/); assert.match(seatTag(html, 2), /disabled=""/); assert.match(seatTag(html, 4), /disabled=""/);
  const pending = renderToStaticMarkup(createElement(SeatMap, { map, selection: {}, verifiedIds: [1], blocked: true, onToggle: () => {} }));
  for (const id of [1, 2, 4]) assert.match(seatTag(pending, id), /disabled=""/);
});
test("field validation has a visible per-seat message and fieldset association", () => {
  const booking = value(); booking.state = { ...booking.state, fieldErrors: { 1: "Server seat error" } };
  const html = render(Summary, booking);
  assert.match(html, /<fieldset[^>]*aria-describedby="[^"]+-error"[^>]*aria-invalid="true"/);
  assert.match(html, /id="[^"]+-error">Server seat error/);
});
test("timer exposes non-live role and derives long display from expiresAt rather than secondsRemaining", () => {
  const html = renderToStaticMarkup(createElement(Timer, { hold: { ...hold, expiresAt: new Date(Date.now() + 3665000).toISOString() }, onExpire: () => {} }));
  assert.match(html, /SEATS HELD/); assert.match(html, /role="timer"[^>]*aria-live="off">61:05/); assert.doesNotMatch(html, /aria-live="polite"/);
});

test("User adopted by hold remediation hydrates the existing Profile status and all profile fields", async () => {
  for (const profileComplete of [true, false]) {
    let authUser = { id: 12, email: "profile@example.test", profileComplete: true };
    const freshUser = { ...authUser, profileComplete, fullName: "Fresh Profile User", mobileNumber: "599123456", dateOfBirth: "1990-04-12", preferredVenue: { id: 3, name: "Server Venue" } };
    const runtime = createBookingRuntime({
      getUser: () => authUser, isCurrentUser: (expected) => expected === authUser,
      replaceUser: (fresh) => { authUser = fresh; return true; }, getToken: () => "test-only-token",
      storage: { read: () => null, write: () => {}, clear: () => {} }, options: () => options,
      getSession: async () => session, getSessionSeats: async () => map,
      api: { createHold: async () => { throw new ApiError("Booking is currently unavailable.", { status: 422 }); } },
      me: async () => ({ data: freshUser }), profileRequired: () => {},
    });
    await runtime.enter(10, authUser); runtime.edit("TOGGLE_SEAT", { seatId: 2 }); await runtime.submit();
    assert.equal(authUser, freshUser);
    const html = renderToStaticMarkup(
      createElement(authContext.Provider, { value: { status: "authenticated", mutation: null, user: authUser } },
        createElement(profileContext.Provider, { value: { continuation: null } },
          createElement(bootstrapContext.Provider, { value: { filterOptions: { venues: [freshUser.preferredVenue] } } },
            createElement(context.Provider, { value: { profileRemediationMessage: runtime.profileMessage(authUser.id) } }, createElement(Profile))))),
    );
    assert.match(html, profileComplete ? /Profile Complete/ : /Profile incomplete/);
    if (profileComplete) assert.doesNotMatch(html, /Profile incomplete|Booking is currently unavailable\./);
    else assert.match(html, /role="alert">Booking is currently unavailable\./);
    for (const [name, fieldValue] of Object.entries({ fullName: freshUser.fullName, mobileNumber: freshUser.mobileNumber, dateOfBirth: freshUser.dateOfBirth })) {
      const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
      assert.ok(input); assert.ok(input.includes(`value="${fieldValue}"`));
    }
    assert.match(html, /<option value="3" selected="">Server Venue/);
  }
});
