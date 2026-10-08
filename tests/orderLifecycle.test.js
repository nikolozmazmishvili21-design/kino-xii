import test from "node:test";
import assert from "node:assert/strict";
import { readableOrder, confirmationReadyOrder, orderRecoveryIdentity,
  classifyOrderResponse, classifyOrderError } from "../src/booking/orderLifecycle.js";
import { ApiError } from "../src/api/client.js";

function order(overrides = {}) {
  return {
    id: 7, reference: "SYNTHETIC-ORDER", status: "paid", totalPrice: 12.5,
    session: { id: 10, date: "2026-10-07", time: "19:30", movie: { title: "Synthetic Film" },
      venue: { name: "Synthetic Venue" }, hall: { name: "B" }, format: { name: "2D" }, language: { name: "Georgian" } },
    tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 12.5 }],
    contact: { fullName: "Synthetic Buyer", email: "buyer@example.test", mobileNumber: "599000000" },
    paidAt: "2026-10-07T12:00:00Z", cardLastFour: "0000", ...overrides,
  };
}

test("usable paid Order is readable and Confirmation-ready without fabricated fields", () => {
  const value = Object.freeze(order());
  assert.equal(readableOrder(value), true);
  assert.equal(confirmationReadyOrder(value, { sessionId: 10 }), true);
  const classified = classifyOrderResponse({ status: 201, data: { data: value } }, { sessionId: 10 });
  assert.equal(classified.kind, "usable-order");
  assert.equal(classified.order, value);
  assert.equal(confirmationReadyOrder(value, { sessionId: 11 }), false);
});

test("Confirmation correspondence requires the canonical numeric session ID without coercion", () => {
  const value = order();
  assert.equal(confirmationReadyOrder(value, { sessionId: 10 }), true);
  assert.equal(confirmationReadyOrder(value, { sessionId: "10" }), false);
  assert.equal(classifyOrderResponse({ status: 201, data: { data: value } }, { sessionId: "10" }).kind, "malformed-success");
});

test("reference, supported status, and finite numeric total are necessary", () => {
  for (const reference of [undefined, null, "", "   ", 7]) assert.equal(confirmationReadyOrder(order({ reference })), false);
  for (const status of [undefined, "success", "pending"]) assert.equal(readableOrder(order({ status })), false);
  for (const totalPrice of [undefined, null, "12.5", NaN, Infinity]) assert.equal(readableOrder(order({ totalPrice })), false);
  assert.equal(confirmationReadyOrder(order({ totalPrice: 0 })), true);
  for (const value of [null, undefined, [], "invalid"]) assert.equal(readableOrder(value), false);
});

test("session has usable returned identity, date/time and named display context", () => {
  const session = order().session;
  for (const value of [null, {}, { ...session, id: "10" }, { ...session, date: "bad" },
    { ...session, date: "2026-02-30" }, { ...session, time: "" }]) {
    assert.equal(confirmationReadyOrder(order({ session: value })), false);
  }
  for (const field of ["movie", "venue", "hall", "format", "language"]) {
    for (const value of [undefined, null, {}]) assert.equal(readableOrder(order({ session: { ...session, [field]: value } })), false);
  }
  assert.equal(readableOrder(order({ session: { ...session, date: "2028-02-29" } })), true);
});

test("all tickets require returned seat/type and finite numeric price", () => {
  const ticket = order().tickets[0];
  for (const tickets of [undefined, null, [], {}, [null], [ticket, {}],
    [{ ...ticket, seatCode: " " }], [{ ...ticket, ticketType: null }],
    [{ ...ticket, ticketType: { name: "Adult" } }], [{ ...ticket, ticketType: { slug: "adult" } }]]) {
    assert.equal(confirmationReadyOrder(order({ tickets })), false);
  }
  for (const price of [undefined, null, "12.5", NaN, Infinity]) {
    assert.equal(confirmationReadyOrder(order({ tickets: [{ ...ticket, price }] })), false);
  }
  assert.equal(confirmationReadyOrder(order({ tickets: [{ ...ticket, price: 0 }] })), true);
});

test("contact is required only for explicitly displayed fields", () => {
  const contactFields = ["fullName", "email", "mobileNumber"];
  assert.equal(confirmationReadyOrder(order(), { contactFields }), true);
  assert.equal(confirmationReadyOrder(order({ contact: undefined })), true);
  for (const contact of [undefined, null, {}, { fullName: "Buyer", email: "", mobileNumber: "599000000" }]) {
    assert.equal(confirmationReadyOrder(order({ contact }), { contactFields }), false);
  }
  assert.equal(confirmationReadyOrder(order({ contact: { email: "buyer@example.test" } }), { contactFields: ["email"] }), true);
  assert.equal(readableOrder(order(), { contactFields: ["billingAddress"] }), false);
});

test("paidAt and last four are checked only if their UI will display them", () => {
  const value = order({ paidAt: undefined, cardLastFour: undefined });
  assert.equal(confirmationReadyOrder(value), true);
  assert.equal(confirmationReadyOrder(value, { showPaidAt: true }), false);
  assert.equal(confirmationReadyOrder(value, { showCardLastFour: true }), false);
  assert.equal(confirmationReadyOrder(order(), { showPaidAt: true, showCardLastFour: true }), true);
  assert.equal(readableOrder(order({ paidAt: "not-a-date" }), { showPaidAt: true }), false);
  for (const cardLastFour of ["000", "00000", 0, "xxxx"]) assert.equal(readableOrder(order({ cardLastFour }), { showCardLastFour: true }), false);
});

test("refunded Order is readable Tickets data but never a purchase Confirmation", () => {
  const refunded = order({ status: "refunded" });
  assert.equal(readableOrder(refunded), true);
  assert.equal(confirmationReadyOrder(refunded), false);
  assert.equal(classifyOrderResponse({ status: 201, data: { data: refunded } }).kind, "malformed-success");
});

test("convenient but undisplayed properties are not required", () => {
  const value = order();
  delete value.id; delete value.contact; delete value.paidAt; delete value.cardLastFour;
  assert.equal(confirmationReadyOrder(value), true);
  assert.equal(value.session.startsAt, undefined);
  assert.equal(value.tickets[0].id, undefined);
});

test("recovery evidence extracts only exact own server ID/reference without normalization", () => {
  assert.deepEqual(orderRecoveryIdentity(order()), { id: 7, reference: "SYNTHETIC-ORDER" });
  assert.deepEqual(orderRecoveryIdentity({ id: 7 }), { id: 7 });
  assert.deepEqual(orderRecoveryIdentity({ reference: " Exact server reference " }), { reference: " Exact server reference " });
  for (const value of [{ id: "7" }, { id: 1.5 }, { id: Infinity }, { reference: " " },
    Object.create({ id: 7, reference: "Inherited" }), null, []]) assert.equal(orderRecoveryIdentity(value), null);
});

test("Hold, session, seats, contact, last four, totals and movie never become recovery identity", () => {
  assert.equal(orderRecoveryIdentity({ holdId: "11111111-2222-3333-4444-555555555555", sessionId: 10,
    session: order().session, tickets: order().tickets, seatCodes: ["A1"], contact: order().contact,
    cardLastFour: "0000", totalPrice: 12.5, movie: { title: "Synthetic Film" }, requestId: 8 }), null);
  assert.equal(orderRecoveryIdentity({ data: order() }), null);
});

test("malformed success preserves only available Order identity; arbitrary envelope/status cannot confirm", () => {
  assert.deepEqual(classifyOrderResponse({ status: 201, data: { data: { id: 7, reference: "SYNTHETIC-PARTIAL", session: {} } } }),
    { kind: "malformed-success", recovery: { id: 7, reference: "SYNTHETIC-PARTIAL" } });
  for (const data of [undefined, "invalid", [], { data: null }, { data: [] }, order()]) {
    assert.deepEqual(classifyOrderResponse({ status: 201, data }), { kind: "malformed-success", recovery: null });
  }
  assert.deepEqual(classifyOrderResponse({ status: 200, data: { data: order() } }), { kind: "uncertain", recovery: null });
});

test("422 distinction uses structured errors presence, never expiry words in a field message", () => {
  const message = "Your hold time expired. Please re-select your seats.";
  const errors = { cvv: [message] };
  assert.deepEqual(classifyOrderError(new ApiError(message, { status: 422, errors })), { kind: "validation", message, errors });
  assert.deepEqual(classifyOrderError(new ApiError(message, { status: 422, data: { message } })), { kind: "business", message });
  assert.equal(classifyOrderError({ status: 422, data: { message, errors: null } }).kind, "validation");
  assert.deepEqual(classifyOrderError({ status: 422, data: "unusable body" }), { kind: "rejected", status: 422, message: null });
});

test("documented auth/conflict rejections preserve facts without inventing contested IDs", () => {
  assert.deepEqual(classifyOrderError({ status: 401, data: { message: "Unauthenticated" } }), { kind: "unauthenticated", message: "Unauthenticated" });
  assert.deepEqual(classifyOrderError({ status: 403, data: { message: "Forbidden" } }), { kind: "forbidden", message: "Forbidden" });
  const contested = ["A1", "B2"];
  const result = classifyOrderError({ status: 409, data: { message: "Server conflict", contested } });
  assert.deepEqual(result, { kind: "conflict", message: "Server conflict", contested });
  assert.notEqual(result.contested, contested);
  for (const value of [undefined, "A1", [1], ["A1", null]]) {
    assert.equal(classifyOrderError({ status: 409, data: { message: "Server conflict", contested: value } }).contested, null);
  }
});

test("defensive 404 preserves status as terminal context failure rather than uncertainty", () => {
  const message = "Synthetic context unavailable";
  const result = classifyOrderError(new ApiError(message, { status: 404, data: { message } }));
  assert.deepEqual(result, { kind: "terminal-context", status: 404, message });
  assert.notEqual(result.kind, "uncertain");
  assert.deepEqual(classifyOrderError({ status: 404 }), { kind: "terminal-context", status: 404, message: null });
});

test("network, body-read, abort and unknown server outcomes make no rollback claim", () => {
  for (const error of [new Error("Synthetic transport failure"), new ApiError("Network request failed."),
    { name: "AbortError" }, { status: 500, data: { message: "Server failure" } }, { status: 502 }, undefined]) {
    assert.deepEqual(classifyOrderError(error), { kind: "uncertain", recovery: null });
  }
});
