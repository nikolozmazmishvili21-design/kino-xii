import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, Checkout, Recovery, Notice, Confirmation, bookingContext, authContext;
before(async () => {
  server = await createServer({ cacheDir: "node_modules/.cache/kino-checkout-rendering", server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  Checkout = (await server.ssrLoadModule("/src/components/booking/Checkout.jsx")).default;
  Recovery = (await server.ssrLoadModule("/src/components/booking/OrderRecovery.jsx")).default;
  Notice = (await server.ssrLoadModule("/src/components/booking/OrderNotice.jsx")).default;
  Confirmation = (await server.ssrLoadModule("/src/components/booking/OrderConfirmation.jsx")).default;
  bookingContext = (await server.ssrLoadModule("/src/booking/BookingContext.js")).BookingContext;
  authContext = (await server.ssrLoadModule("/src/auth/AuthContext.js")).AuthContext;
});
after(async () => { await server?.close(); });
const user = { id: 12, fullName: "Fixture Buyer", email: "buyer@example.test", mobileNumber: "599123456", profileComplete: true };
function booking(phase = "idle") {
  return { state: { order: { phase, feedback: null }, sessionRead: { data: { movie: { title: "Server Movie" }, hall: { name: "B" }, date: "2026-10-07", time: "19:30" } },
    hold: { phase: "active", data: { subtotal: 100.47, seats: [{ seatId: 1, code: "A1", price: 7.13, ticketType: { name: "Server Adult" } }] } } },
    back: () => {}, submitOrder: () => {}, canSubmitOrder: true, openOrderTickets: () => {}, returnOrderHome: () => {}, dismissOrderNotice: () => {} };
}
const render = (Component, value) => renderToStaticMarkup(createElement(authContext.Provider, { value: { user } }, createElement(bookingContext.Provider, { value }, createElement(Component, { headingId: "confirmation-title" }))));
const input = (html, name) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];

test("Checkout has one semantic form, six fields, authoritative prefill and blank payment", () => {
  const value = booking(), html = render(Checkout, value);
  assert.equal((html.match(/<form/g) ?? []).length, 1); assert.equal((html.match(/<input/g) ?? []).length, 6);
  for (const field of ["fullName", "email", "mobileNumber"]) assert.ok(input(html, field).includes(`value="${user[field]}"`));
  for (const field of ["cardNumber", "expiry", "cvv"]) assert.match(input(html, field), /value=""/);
  assert.match(html, /aria-current="step">CHECKOUT/); assert.match(html, /type="submit"[^>]*>Pay &amp; Complete Order/);
  assert.match(html, /id="booking-back"/); assert.match(html, /Server Adult/); assert.match(html, /₾ 7\.13/); assert.match(html, /₾ 100\.47/);
  assert.doesNotMatch(JSON.stringify(value), /cardNumber|expiry|cvv/);
});
test("Checkout autocomplete/input semantics preserve formatting and leading zeros", () => {
  const html = render(Checkout, booking());
  for (const [name, token] of Object.entries({ fullName: "name", email: "email", mobileNumber: "tel-national", cardNumber: "cc-number", expiry: "cc-exp", cvv: "cc-csc" })) {
    assert.match(input(html, name), new RegExp(`autoComplete="${token}"`));
    assert.doesNotMatch(input(html, name), /type="number"/);
  }
  assert.match(input(html, "email"), /type="email"/); assert.match(input(html, "cardNumber"), /inputMode="numeric"/);
});
test("pending Checkout disables all inputs, Pay and Back with one pending announcement", () => {
  const html = render(Checkout, booking("submitting"));
  for (const name of ["fullName", "email", "mobileNumber", "cardNumber", "expiry", "cvv"]) assert.match(input(html, name), /disabled=""/);
  assert.match(html, /aria-busy="true"/); assert.match(html, /id="booking-back"[^>]*disabled=""/);
  assert.match(html, /type="submit"[^>]*disabled=""[^>]*>Completing order…/);
  assert.equal((html.match(/Completing your order…/g) ?? []).length, 1);
});
test("Recovery contains exact copy and factual navigation only", () => {
  const html = render(Recovery, booking("uncertain"));
  assert.match(html, /We couldn&#x27;t confirm whether your order was completed\./);
  assert.match(html, /Check my tickets/); assert.match(html, /Return to home/); assert.match(html, /tabindex="-1"/);
  assert.doesNotMatch(html, /<form|<input|Pay|Back|Retry|timer/);
});
test("bounded notices render message/actions without Order details", () => {
  for (const kind of ["success", "uncertain"]) {
    const value = booking(); value.orderNotice = { id: 1, kind, message: kind === "success" ? "Your order was completed." : "We couldn't confirm whether your order was completed.", action: "tickets", accountId: 12 };
    const html = render(Notice, value);
    assert.match(html, /role="status"/); assert.match(html, /Dismiss/); assert.match(html, kind === "success" ? /View my tickets/ : /Check my tickets/);
    assert.doesNotMatch(html, /Server Movie|Server Adult|A1|₾|cardLastFour|reference|<input/);
  }
  assert.equal(render(Notice, booking()), "");
});

test("Confirmation renders only returned purchase facts, in ticket order, with direct server total", () => {
  const value = booking("success");
  value.state.order.data = { id: 999, reference: "SERVER-REFERENCE", totalPrice: 87.65, cardLastFour: "9876", contact: user,
    session: { movie: { title: "Returned Film", posterUrl: "https://example.test/poster.png" }, venue: { name: "Returned Venue" },
      hall: { name: "Returned Hall" }, date: "2026-10-08", time: "21:45", format: { name: "Returned Format" }, language: { name: "Returned Language" } },
    tickets: [{ seatCode: "Z9", ticketType: { name: "Returned Student" }, price: 11.27 }, { seatCode: "Z2", ticketType: { name: "Returned Child" }, price: 6.08 }] };
  const html = render(Confirmation, value);
  for (const text of ["Booking confirmed!", "SERVER-REFERENCE", "Returned Film", "Returned Venue", "Returned Hall", "Returned Format", "Returned Language", "8 Oct", "21:45", "Z9", "Z2", "Returned Student", "Returned Child", "₾ 11.27", "₾ 6.08", "₾ 87.65", "TOTAL PAID", "View my tickets", "Back to home"]) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf("Z9") < html.indexOf("Z2"));
  assert.match(html, /<h2[^>]*id="confirmation-title"[^>]*tabindex="-1"/);
  assert.match(html, /aria-label="Purchased tickets"/); assert.match(html, /alt="Returned Film poster"/);
  assert.doesNotMatch(html, /Server Movie|Server Adult|A1|100\.47|7\.13|<input|<form|Pay|Retry|timer|CHECKOUT|SEATS|email|9876|999|QR|Download|cardNumber|expiry|cvv/);
});

test("Confirmation reuses the missing-poster fallback and escapes server content", () => {
  const value = booking("success");
  value.state.order.data = { reference: "<b>server</b>", totalPrice: 4.56,
    session: { movie: { title: "<script>film</script>", posterUrl: null }, venue: { name: "Venue" }, hall: { name: "B" }, date: "2026-10-08", time: "21:45", format: { name: "2D" }, language: { name: "English" } },
    tickets: [{ seatCode: "<i>Z9</i>", ticketType: { name: "Adult" }, price: 1.23 }] };
  const html = render(Confirmation, value);
  assert.match(html, /Poster unavailable for &lt;script&gt;film&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;server&lt;\/b&gt;/); assert.match(html, /&lt;i&gt;Z9&lt;\/i&gt;/);
  assert.doesNotMatch(html, /<script>|<b>server|<i>Z9/);
});
