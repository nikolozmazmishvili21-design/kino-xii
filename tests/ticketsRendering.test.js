import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

let server, Content, Profile, auth, booking, access, bootstrap;
before(async () => {
  server = await createServer({ cacheDir: "node_modules/.cache/kino-tickets-rendering", server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  Content = (await server.ssrLoadModule("/src/components/profile/MyTickets.jsx")).TicketsContent;
  Profile = (await server.ssrLoadModule("/src/pages/ProfilePage.jsx")).default;
  auth = (await server.ssrLoadModule("/src/auth/AuthContext.js")).AuthContext;
  booking = (await server.ssrLoadModule("/src/booking/BookingContext.js")).BookingContext;
  access = (await server.ssrLoadModule("/src/auth/ProfileAccessContext.js")).ProfileAccessContext;
  bootstrap = (await server.ssrLoadModule("/src/app/AppBootstrapContext.js")).AppBootstrapContext;
});
after(async () => { await server?.close(); });
const order = (reference, status = "paid") => ({ id: status === "paid" ? 7 : 8, reference, status, totalPrice: 87.65,
  contact: { fullName: "Do not display contact", email: "private@example.test" }, cardLastFour: "9876",
  session: { movie: { title: "Returned Film", posterUrl: null }, date: "2026-10-08", time: "21:45", venue: { name: "Returned Venue" }, hall: { name: "B" }, format: { name: "Returned Format" }, language: { name: "Returned Language" } },
  tickets: [{ seatCode: "Z9", ticketType: { name: "Server Student" }, price: 11.27 }, { seatCode: "Z2", ticketType: { name: "Server Child" }, price: 6.08 }] });
const render = (read, identity) => renderToStaticMarkup(createElement(Content, { read, identity }));

test("Tickets renders paid and refunded server Orders, direct totals, ticket ordering and no controls", () => {
  const html = render({ status: "success", data: [order("SERVER-PAID"), order("SERVER-REFUNDED", "refunded")] });
  for (const value of ["My Tickets", "SERVER-PAID", "SERVER-REFUNDED", "Paid", "Refunded", "Returned Film", "8 Oct", "21:45", "Returned Venue", "Hall B", "Returned Format", "Returned Language", "Z9", "Z2", "Server Student", "Server Child", "₾ 11.27", "₾ 6.08", "₾ 87.65", "Poster unavailable for Returned Film"]) assert.ok(html.includes(value), value);
  assert.equal((html.match(/<article/g) ?? []).length, 2); assert.ok(html.indexOf("SERVER-PAID") < html.indexOf("SERVER-REFUNDED"));
  assert.ok(html.indexOf("Z9") < html.indexOf("Z2")); assert.match(html, /aria-label="Purchased tickets"/);
  assert.doesNotMatch(html, /<button|private@example|Do not display|9876|cardNumber|expiry|cvv|Hold|QR|Download/);
});

test("Tickets has accessible loading/auth, factual empty, and a read Retry", () => {
  assert.match(render({ status: "loading" }), /role="status">Loading your tickets/);
  assert.match(render({ status: "unauthenticated" }), /role="status">Please sign in/);
  const empty = render({ status: "empty" }, { id: 99 }); assert.match(empty, /No tickets yet/); assert.doesNotMatch(empty, /failed|retry|completed|<article/i);
  const error = render({ status: "error", error: "Read failed", retry: () => {} });
  assert.match(error, /role="alert">Read failed/); assert.match(error, /type="button"[^>]*>Retry tickets/);
});

test("recovery matches exact id/reference only, requires every provided identity field, and stays neutral otherwise", () => {
  const read = { status: "success", data: [order("SERVER-PAID"), order("SERVER-REFUNDED", "refunded")] };
  for (const identity of [{ id: 7 }, { reference: "SERVER-PAID" }, { id: 7, reference: "SERVER-PAID" }]) {
    assert.equal((render(read, identity).match(/my-tickets__order--recovered/g) ?? []).length, 1);
  }
  for (const identity of [null, {}, { id: 99 }, { id: 7, reference: "SERVER-REFUNDED" }, { sessionId: 10 }]) {
    const html = render(read, identity); assert.doesNotMatch(html, /my-tickets__order--recovered|failed|retry Order|purchase completed/i);
  }
});

test("Tickets safely escapes returned reference/title/seat content", () => {
  const value = order("<b>server</b>"); value.session.movie.title = "<script>film</script>"; value.tickets[0].seatCode = "<i>Z9</i>";
  const html = render({ status: "success", data: [value] }); assert.match(html, /&lt;b&gt;server/); assert.match(html, /&lt;script&gt;film/); assert.match(html, /&lt;i&gt;Z9/); assert.doesNotMatch(html, /<script>|<i>Z9|<b>server/);
});

test("Profile selects URL navigation safely and preserves the existing form mounted on Tickets", () => {
  const user = { id: 12, profileComplete: true, fullName: "Server Buyer", email: "buyer@example.test", mobileNumber: "599123456", dateOfBirth: "1990-04-12", preferredVenue: null };
  for (const [path, tickets] of [["/profile", false], ["/profile?tab=tickets", true], ["/profile?tab=whatever", false]]) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(auth.Provider, { value: { status: "authenticated", mutation: null, user } },
        createElement(access.Provider, { value: { continuation: null } },
          createElement(bootstrap.Provider, { value: { filterOptions: { venues: [] } } },
            createElement(booking.Provider, { value: { profileRemediationMessage: null, consumeTicketsRecovery: () => null } }, createElement(Profile)))))));
    assert.match(html, tickets ? /aria-current="page"[^>]*href="\/profile\?tab=tickets"/ : /aria-current="page"[^>]*href="\/profile"/);
    assert.match(html, /<form[^>]*aria-label="Personal Information"/); assert.match(html, /value="Server Buyer"/); assert.match(html, /Profile Complete/);
    if (tickets) { assert.match(html, /class="profile-page__column" hidden=""/); assert.match(html, /Loading your tickets/); }
    else { assert.doesNotMatch(html, /class="profile-page__column" hidden|Loading your tickets/); }
  }
});
