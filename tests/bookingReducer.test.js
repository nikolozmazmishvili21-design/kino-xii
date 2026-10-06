import test from "node:test";
import assert from "node:assert/strict";
import { bookingReducer, initialBookingState, createBookingReadScope, consumeReadyBooking, expireBookingRead } from "../src/booking/bookingReducer.js";
import { createBookingAction } from "../src/auth/pendingAction.js";

const adult = { id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null };
const student = { id: 2, slug: "student", name: "Student", priceRatio: 0.75, blockedFromRatingAge: null };
const options = { maxSeatsPerOrder: 2, ticketTypes: [student, adult] };
const session = { id: 10, price: 19, movie: { ageRating: { minAge: 12 } } };
const seat = (id, state = "available", isMine = false) => ({ id, code: `A${id}`, label: String(id), state, isMine, aisleAfter: false });
const map = { sessionId: 10, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [seat(1), seat(2), seat(3), seat(4, "sold"), seat(5, "held"), seat(6, "unavailable"), seat(7, "available", true)] }] }] };
const reduce = (state, action) => bookingReducer(state, { instanceId: state.instanceId, options, ...action });
function loaded() {
  let state = bookingReducer(initialBookingState(), { type: "OPEN", sessionId: 10, instanceId: 1 });
  for (const [kind, data] of [["sessionRead", session], ["seatMapRead", map]]) {
    state = reduce(state, { type: "READ_START", kind, sessionId: 10, attempt: 1 });
    state = reduce(state, { type: "READ_SUCCESS", kind, sessionId: 10, attempt: 1, data });
  }
  return state;
}

test("local toggle defaults Adult, type changes and summary removal share one selection source", () => {
  let state = reduce(loaded(), { type: "TOGGLE_SEAT", seatId: 1 });
  assert.deepEqual(state.selection, { 1: { ticketTypeSlug: "adult" } });
  state = reduce(state, { type: "SET_TICKET", seatId: 1, slug: "student" });
  assert.equal(state.selection[1].ticketTypeSlug, "student");
  state = reduce(state, { type: "TOGGLE_SEAT", seatId: 1 });
  assert.deepEqual(state.selection, {});
  state = reduce(state, { type: "TOGGLE_SEAT", seatId: 2 });
  state = reduce(state, { type: "REMOVE_SEAT", seatId: 2 });
  assert.deepEqual(state.selection, {});
});

test("cap blocks new additions with configured feedback but keeps selected seats removable", () => {
  let state = loaded();
  for (const seatId of [1, 2, 3]) state = reduce(state, { type: "TOGGLE_SEAT", seatId });
  assert.deepEqual(Object.keys(state.selection), ["1", "2"]);
  assert.equal(state.feedback, "You can select up to 2 seats.");
  assert.equal(state.seatMapRead.data.sections[0].rows[0].seats[2].state, "available");
  state = reduce(state, { type: "REMOVE_SEAT", seatId: 1 });
  assert.equal(state.feedback, null);
  state = reduce(state, { type: "TOGGLE_SEAT", seatId: 3 });
  assert.deepEqual(Object.keys(state.selection), ["2", "3"]);
});

test("sold, held, gaps, own-held, absent seats and invalid types cannot be locally assigned", () => {
  let state = loaded();
  for (const seatId of [4, 5, 6, 7, 999]) state = reduce(state, { type: "TOGGLE_SEAT", seatId });
  assert.deepEqual(state.selection, {});
  state = reduce(state, { type: "TOGGLE_SEAT", seatId: 1 });
  assert.equal(reduce(state, { type: "SET_TICKET", seatId: 1, slug: "invented" }), state);
});

test("missing configuration blocks new selection and invalidated configuration clears old assignments", () => {
  const invalid = { ...options, ticketTypes: [student] };
  assert.deepEqual(reduce(loaded(), { type: "TOGGLE_SEAT", seatId: 1, options: invalid }).selection, {});
  let state = reduce(loaded(), { type: "TOGGLE_SEAT", seatId: 1 });
  state = reduce(state, { type: "CONFIG_CHANGED", options: invalid });
  assert.deepEqual(state.selection, {});
});

test("current malformed rating result clears obsolete selection; context retry stays in instance", () => {
  let state = reduce(loaded(), { type: "TOGGLE_SEAT", seatId: 1 });
  state = reduce(state, { type: "READ_START", kind: "sessionRead", sessionId: 10, attempt: 2 });
  state = reduce(state, { type: "READ_SUCCESS", kind: "sessionRead", sessionId: 10, attempt: 2, data: { id: 10, price: 19, movie: {} } });
  assert.equal(state.instanceId, 1);
  assert.equal(state.seatMapRead.status, "ready");
  assert.deepEqual(reduce(state, { type: "TOGGLE_SEAT", seatId: 1 }).selection, {});
});

test("reducer rejects late successes, errors, wrong sessions, and previous retry attempts", () => {
  let state = loaded();
  state = reduce(state, { type: "READ_START", kind: "seatMapRead", sessionId: 10, attempt: 2 });
  for (const type of ["READ_SUCCESS", "READ_ERROR"]) {
    assert.equal(reduce(state, { type, kind: "seatMapRead", sessionId: 10, attempt: 1, data: map, error: new Error("late") }), state);
    assert.equal(reduce(state, { type, kind: "seatMapRead", sessionId: 11, attempt: 2, data: map }), state);
    assert.equal(reduce(state, { type, kind: "seatMapRead", sessionId: 10, instanceId: 0, attempt: 2, data: map }), state);
  }
  const next = bookingReducer(state, { type: "OPEN", sessionId: 10, instanceId: 2 });
  assert.equal(bookingReducer(next, { type: "READ_SUCCESS", instanceId: 1, sessionId: 10, kind: "seatMapRead", attempt: 2, data: map }), next);
});

test("close resets all local state and new explicit opens start fresh", () => {
  let state = reduce(loaded(), { type: "TOGGLE_SEAT", seatId: 1 });
  state = reduce(state, { type: "CLOSE" });
  assert.deepEqual(state, initialBookingState());
  state = bookingReducer(state, { type: "OPEN", sessionId: 10, instanceId: 2 });
  assert.equal(state.sessionRead.status, "loading");
  assert.deepEqual(state.selection, {});
});

test("read scope aborts both resources on replacement and distinguishes same-session reopens", () => {
  const scope = createBookingReadScope();
  const user = { id: 1 };
  const currentUser = (expected) => expected === user;
  const a = scope.open(10, user);
  const requestA = scope.start("sessionRead");
  const mapA = scope.start("seatMapRead");
  assert.equal(scope.isCurrent(requestA, currentUser), true);
  const b = scope.open(11, user);
  assert.notEqual(a.instanceId, b.instanceId);
  assert.equal(requestA.controller.signal.aborted, true);
  assert.equal(mapA.controller.signal.aborted, true);
  assert.equal(scope.isCurrent(mapA, currentUser), false);
  const requestB = scope.start("seatMapRead");
  scope.abortReads(a.instanceId);
  assert.equal(scope.isCurrent(requestB, currentUser), true);
  scope.close();
  scope.open(11, user);
  assert.equal(scope.isCurrent(requestB, currentUser), false);
});

test("retry supersedes one resource only; StrictMode cleanup permits new read attempts", () => {
  const scope = createBookingReadScope();
  const user = {};
  scope.open(10, user);
  const context = scope.start("sessionRead");
  const first = scope.start("seatMapRead");
  const retry = scope.start("seatMapRead");
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(context.controller.signal.aborted, false);
  assert.equal(scope.isCurrent(retry, (expected) => expected === user), true);
  scope.abortReads();
  assert.equal(scope.active().sessionId, 10);
  const replay = scope.start("seatMapRead");
  assert.equal(scope.isCurrent(replay, () => true), true);
});

test("current 401 checks the expected user before reset and requeues only the same session", () => {
  const scope = createBookingReadScope();
  const user = {};
  scope.open(10, user);
  const request = scope.start("seatMapRead");
  const calls = [];
  const current = (expected) => { calls.push("user guard"); return expected === user; };
  const close = () => { calls.push("close"); scope.close(); };
  assert.equal(expireBookingRead(scope, request, current, close, (id) => calls.push(`reauth ${id}`)), true);
  assert.deepEqual(calls, ["user guard", "close", "reauth 10"]);
  assert.equal(scope.active(), null);
  assert.equal(request.controller.signal.aborted, true);
});

test("stale user, instance, or retry 401 never expires newer auth or booking", () => {
  const scope = createBookingReadScope();
  scope.open(10, {});
  const stale = scope.start("seatMapRead");
  let reauth = 0;
  const fail = () => { reauth += 1; };
  assert.equal(expireBookingRead(scope, stale, () => false, fail, fail), false);
  scope.start("seatMapRead");
  assert.equal(expireBookingRead(scope, stale, () => true, fail, fail), false);
  scope.open(11, {});
  assert.equal(expireBookingRead(scope, stale, () => true, fail, fail), false);
  assert.equal(reauth, 0);
});

test("READY is consumed immediately once; wrong identity, cancelled/logout snapshots do not open", () => {
  const ready = createBookingAction(10);
  let stored = ready;
  const opened = [];
  const consume = (expected) => {
    if (stored !== expected) return null;
    const action = stored;
    stored = null;
    return action;
  };
  assert.equal(consumeReadyBooking(createBookingAction(10), consume, (id) => opened.push(id)), false);
  assert.equal(consumeReadyBooking(ready, consume, (id) => opened.push(id)), true);
  assert.equal(consumeReadyBooking(ready, consume, (id) => opened.push(id)), false);
  assert.deepEqual(opened, [10]);
  const afterLogout = createBookingAction(11);
  stored = null;
  assert.equal(consumeReadyBooking(afterLogout, consume, (id) => opened.push(id)), false);
  stored = createBookingAction(10);
  assert.equal(consumeReadyBooking(stored, consume, (id) => opened.push(id)), true);
  assert.deepEqual(opened, [10, 10]);
});
