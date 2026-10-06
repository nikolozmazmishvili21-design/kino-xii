import test from "node:test";
import assert from "node:assert/strict";
import { allowedTicketTypes, selectionConfiguration, seatPresentation, rowSlots, isSeatMap,
  previewCents, selectedSeatPreviews, subtotalCents, formatGEL, CONFIGURATION_ERROR, CONTEXT_ERROR } from "../src/booking/seatSelection.js";
import { getSession, getSessionSeats } from "../src/api/sessionsApi.js";

const adult = { id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null };
const child = { id: 2, slug: "child", name: "Child", priceRatio: 0.6, blockedFromRatingAge: 16 };
const student = { id: 3, slug: "student", name: "Student", priceRatio: 0.75, blockedFromRatingAge: null };
const options = { maxSeatsPerOrder: 2, ticketTypes: [child, student, adult] };
const session = { id: 10, price: 19, movie: { ageRating: { minAge: 12 } } };
const seat = (id, overrides = {}) => ({ id, code: `J${id}`, label: String(id), state: "available", aisleAfter: false, isMine: false, ...overrides });
const map = { sessionId: 10, hall: { id: 4 }, sections: [{ name: "Circle", rows: [{ label: "J", seats: [seat(1), seat(2), seat(3, { isMine: true })] }] }] };

test("seat states distinguish local selection, sold, held, gaps, and separate own ownership", () => {
  assert.equal(seatPresentation(seat(1)).kind, "available");
  assert.equal(seatPresentation(seat(1), true).description, "selected locally");
  for (const state of ["sold", "held"]) assert.equal(seatPresentation(seat(1, { state })).disabled, true);
  assert.notEqual(seatPresentation(seat(1, { state: "held" })).kind, seatPresentation(seat(1, { state: "sold" })).kind);
  assert.equal(seatPresentation(seat(1, { state: "unavailable" })).kind, "gap");
  for (const state of ["available", "held", "sold"]) {
    const own = seatPresentation(seat(1, { state, isMine: true }));
    assert.equal(own.kind, "own");
    assert.equal(own.disabled, true);
    assert.match(own.description, /unavailable for editing/);
  }
});

test("row slots preserve unavailable spaces and insert an aisle after its actual seat", () => {
  const row = { label: "J", seats: [seat(21, { state: "unavailable", aisleAfter: true }), seat(4), seat(9, { aisleAfter: true })] };
  const slots = rowSlots(row);
  assert.deepEqual(slots.map((slot) => slot.kind), ["gap", "aisle", "seat", "seat", "aisle"]);
  assert.deepEqual(slots.filter((slot) => slot.seat).map((slot) => slot.seat.id), [21, 4, 9]);
  assert.equal(row.label, "J");
});

test("nested map validation rejects wrong-session, malformed, and duplicate identity data", () => {
  assert.equal(isSeatMap(map, 10), true);
  assert.equal(isSeatMap(map, 11), false);
  assert.equal(isSeatMap({ ...map, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [seat(1), seat(1)] }] }] }, 10), false);
  assert.equal(isSeatMap({ ...map, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [seat(1, { state: "fake" })] }] }] }, 10), false);
  assert.equal(isSeatMap({ ...map, sections: null }, 10), false);
});

test("Adult lookup is independent of array order and uses returned values", () => {
  const config = selectionConfiguration(options, session);
  assert.equal(config.adult, adult);
  assert.equal(config.max, 2);
  assert.equal(config.ready, true);
});

test("missing or unusable Adult blocks assignment with reload recovery", () => {
  for (const types of [[], [child, student], null, {}, [null], [{ ...adult, priceRatio: "1" }],
    [{ ...adult, id: undefined }], [{ ...adult, name: "" }], [{ ...adult, priceRatio: Infinity }]]) {
    const config = selectionConfiguration({ ...options, ticketTypes: types }, session);
    assert.equal(config.ready, false);
    assert.equal(config.error, CONFIGURATION_ERROR);
    assert.equal(config.recovery, "reload");
  }
});

test("rating restrictions use API thresholds including zero and preserve null rules", () => {
  assert.deepEqual(allowedTicketTypes(options, session).map((type) => type.slug), ["child", "student", "adult"]);
  for (const minAge of [16, 18]) assert.deepEqual(allowedTicketTypes(options, { ...session, movie: { ageRating: { minAge } } }).map((type) => type.slug), ["student", "adult"]);
  const renamed = { ...child, name: "API supplied label", blockedFromRatingAge: 0 };
  assert.equal(allowedTicketTypes({ ...options, ticketTypes: [renamed, adult] }, session).length, 1);
});

test("missing rating context blocks selection rather than defaulting to unrestricted", () => {
  for (const movie of [undefined, {}, { ageRating: {} }, { ageRating: { minAge: null } },
    { ageRating: { minAge: "12" } }, { ageRating: { minAge: NaN } }]) {
    const context = { ...session, movie };
    assert.equal(allowedTicketTypes(options, context).length, 0);
    const config = selectionConfiguration(options, context);
    assert.equal(config.error, CONTEXT_ERROR);
    assert.equal(config.recovery, "retry");
  }
});

test("preview rounds decimal products to cents before subtotal; no extra format uplift", () => {
  assert.equal(previewCents(19, 0.75), 1425);
  assert.equal(previewCents(1.005, 1), 101);
  assert.equal(previewCents(2.675, 1), 268);
  assert.equal(previewCents(0.05, 0.5), 3);
  assert.equal(previewCents(1e-7, 1), 0);
  assert.equal(previewCents(NaN, 1), null);
  const previews = selectedSeatPreviews({ 1: { ticketTypeSlug: "student" }, 2: { ticketTypeSlug: "child" } }, map,
    { ...session, format: { priceUplift: 5 } }, options);
  assert.deepEqual(previews.map((preview) => preview.cents), [1425, 1140]);
  assert.equal(subtotalCents(previews), 2565);
  const rounded = selectedSeatPreviews({ 1: { ticketTypeSlug: "adult" }, 2: { ticketTypeSlug: "adult" } }, map, { ...session, price: 1.005 }, options);
  assert.equal(subtotalCents(rounded), 202);
  assert.equal(formatGEL(0), "₾ 0");
  assert.equal(formatGEL(1600), "₾ 16");
  assert.equal(formatGEL(2565), "₾ 25.65");
});

test("own-held, unavailable, blocked ticket, and absent seats cannot enter previews", () => {
  const selection = { 1: { ticketTypeSlug: "child" }, 3: { ticketTypeSlug: "adult" }, 999: { ticketTypeSlug: "adult" } };
  assert.deepEqual(selectedSeatPreviews(selection, map, { ...session, movie: { ageRating: { minAge: 18 } } }, options), []);
  assert.deepEqual(selectedSeatPreviews({ 1: { ticketTypeSlug: "adult" } }, map, session, { ...options, ticketTypes: [] }), []);
});

test("session domain reads use confirmed GET endpoints, bearer auth, signals, and data envelopes", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const controller = new AbortController();
  const calls = [];
  globalThis.localStorage = { getItem: () => "test-token" };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: url.endsWith("/seats") ? map : session }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await getSession(10, { signal: controller.signal }), session);
    assert.deepEqual(await getSessionSeats(10, { signal: controller.signal }), map);
    for (const { init } of calls) {
      assert.equal(init.method, "GET");
      assert.equal(init.signal, controller.signal);
      assert.equal(init.headers.get("Authorization"), "Bearer test-token");
    }
    assert.ok(calls[0].url.endsWith("/sessions/10"));
    assert.ok(calls[1].url.endsWith("/sessions/10/seats"));
    globalThis.localStorage = { getItem: () => null };
    await getSessionSeats(10);
    assert.equal(calls[2].init.headers.has("Authorization"), false);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

test("an optional authenticated read preserves 401 without anonymous fallback or mutation", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  let calls = 0;
  globalThis.localStorage = { getItem: () => "test-token" };
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(init.method, "GET");
    assert.equal(init.headers.get("Authorization"), "Bearer test-token");
    return new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401, headers: { "Content-Type": "application/json" } });
  };
  try {
    await assert.rejects(getSessionSeats(10), (error) => error.status === 401 && error.message === "Unauthenticated.");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});
