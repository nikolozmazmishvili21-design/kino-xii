import test from "node:test";
import assert from "node:assert/strict";
import { groupTicketOrders, findRecoveredOrder } from "../src/tickets/ticketGroups.js";
import { ticketsGroup, ticketsGroupSearch, profileTab } from "../src/routing/routes.js";

const order = (reference, overrides = {}) => ({ reference, status: "paid", isUpcoming: true, totalPrice: 21,
  session: { id: 10, date: "2099-01-01", time: "12:30", movie: { title: "Server Film" }, venue: { name: "Venue" },
    hall: { name: "B" }, format: { name: "Format" }, language: { name: "Language" } },
  tickets: [{ seatCode: "B3", ticketType: { slug: "adult", name: "Adult" }, price: 21 }], ...overrides });

test("server flags group Orders stably without consulting session dates or clocks", () => {
  const futurePast = order("REFUNDED-FUTURE", { status: "refunded", isUpcoming: false });
  const futurePaidPast = order("PAID-FUTURE-PAST", { isUpcoming: false });
  const first = order("UPCOMING-FIRST"), second = order("UPCOMING-SECOND");
  first.session = { ...first.session, date: "2000-01-01" };
  const data = [futurePast, first, futurePaidPast, second];
  const original = structuredClone(data), grouped = groupTicketOrders(data);
  assert.deepEqual(grouped, { upcoming: [first, second], past: [futurePast, futurePaidPast] });
  assert.equal(grouped.upcoming[0], first); assert.equal(grouped.past[0], futurePast);
  assert.deepEqual(data, original); assert.deepEqual(groupTicketOrders([]), { upcoming: [], past: [] });
});

test("malformed, contradictory and duplicate grouping/identity values are errors, never guessed groups/counts", () => {
  for (const data of [null, {}, [null], [order("A", { isUpcoming: undefined })], [order("A", { isUpcoming: null })],
    [order("A", { isUpcoming: "false" })], [order("A", { isUpcoming: 0 })], [order("A", { status: "refunded" })],
    [order("A", { status: "unknown" })], [order("A", { reference: "" })], [order("A"), order("A")],
    [order("A", { session: null })]]) assert.throws(() => groupTicketOrders(data), /tickets response could not be read/);
});

test("recovery uses a unique exact Order identity and never session or positional guesses", () => {
  const a = order("A", { id: 7 }), b = order("B", { id: 8 });
  for (const identity of [{ id: 7 }, { reference: "A" }, { id: 7, reference: "A" }]) assert.equal(findRecoveredOrder([a, b], identity), a);
  for (const identity of [null, {}, { reference: "a" }, { id: "7" }, { id: 7, reference: "B" }, { sessionId: 10 }]) assert.equal(findRecoveredOrder([a, b], identity), null);
  assert.equal(findRecoveredOrder([a, { ...b, id: 7 }], { id: 7 }), null);
});

test("URL group restoration defaults safely and keeps Profile membership and unrelated query values", () => {
  for (const search of ["", "?tab=tickets", "?filter=upcoming", "?filter=unknown", "?filter=Past", "?group=past", "?filter="])
    assert.equal(ticketsGroup(search), "upcoming");
  assert.equal(ticketsGroup("?tab=tickets&filter=past"), "past");
  const original = new URLSearchParams("tab=tickets&filter=invalid&other=preserved");
  const next = ticketsGroupSearch(original, "past");
  assert.equal(original.get("filter"), "invalid"); assert.equal(next.get("other"), "preserved");
  assert.equal(profileTab(next), "tickets"); assert.equal(ticketsGroup(next), "past");
  assert.equal(ticketsGroup(ticketsGroupSearch(next, "upcoming")), "upcoming");
  assert.throws(() => ticketsGroupSearch(original, "all"), TypeError);
});
