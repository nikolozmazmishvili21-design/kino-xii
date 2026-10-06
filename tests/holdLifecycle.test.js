import test from "node:test";
import assert from "node:assert/strict";
import { createBookingRuntime } from "../src/booking/bookingRuntime.js";
import { createHoldStorage, HOLD_STORAGE_KEY } from "../src/booking/holdStorage.js";
import { HOLD_COPY, formatHoldTime, remainingHoldMs, observeHoldClock, usableHold, holdMatchesMap, snapshotSelection, mapHoldErrors } from "../src/booking/holdLifecycle.js";
import { createHold, getHold, releaseHold } from "../src/api/bookingApi.js";
import { ApiError } from "../src/api/client.js";
import { me } from "../src/api/authApi.js";
import { selectedSeatPreviews } from "../src/booking/seatSelection.js";

const ID = "11111111-2222-3333-4444-555555555555";
const NEXT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const START = Date.parse("2026-10-06T12:00:00Z");
const user = { id: 12, profileComplete: true };
const options = { maxSeatsPerOrder: 3, ticketTypes: [
  { id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null },
  { id: 2, slug: "student", name: "Student", priceRatio: 0.75, blockedFromRatingAge: null },
] };
const session = { id: 10, price: 19, movie: { ageRating: { minAge: 12 } } };
const seat = (id, isMine = false, state = isMine ? "held" : "available") => ({ id, code: `A${id}`, label: `${id}`, state, isMine, aisleAfter: false });
const map = (own = [], sold = []) => ({ sessionId: 10, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [1, 2, 3, 4].map((id) => seat(id, own.includes(id), sold.includes(id) ? "sold" : own.includes(id) ? "held" : "available")) }] }] });
const hold = (ids = [1], overrides = {}) => ({ holdId: ID, sessionId: 10, expiresAt: new Date(START + 468000).toISOString(), secondsRemaining: 99999, isLive: true, subtotal: 7.13,
  seats: ids.map((id) => ({ seatId: id, code: `A${id}`, ticketType: { slug: "adult", name: "Adult server" }, price: 7.13 })), ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const error = (status, extra = {}) => new ApiError(`Server ${status}`, { status, ...extra });
function harness(overrides = {}) {
  let identity = user, now = START, currentMap = map(), reference = null;
  const calls = { creates: [], gets: [], deletes: [], maps: 0, me: 0, reauth: [], profiles: [], users: [] };
  const api = {
    async createHold(id, snapshot) { calls.creates.push({ id, snapshot }); return hold(snapshot.map((entry) => entry.seatId), { seats: snapshot.map((entry) => ({ seatId: entry.seatId, code: entry.code, ticketType: { slug: entry.ticketType, name: "Server ticket" }, price: 7.13 })) }); },
    async getHold(id) { calls.gets.push(id); return hold(); },
    async releaseHold(id, auth) { calls.deletes.push({ id, auth }); },
    ...overrides.api,
  };
  const storage = { read: () => reference, write: (value) => { reference = { holdId: value.holdId, sessionId: value.sessionId }; }, clear: () => { reference = null; } };
  const runtime = createBookingRuntime({ storage, now: () => now, options: () => options,
    getToken: () => "test-only-token", isCurrentUser: (expected) => expected === identity,
    getUser: () => identity,
    getSession: async (id) => ({ ...session, id }),
    getSessionSeats: async () => { calls.maps++; return currentMap; },
    me: async () => { calls.me++; return { data: identity }; },
    reauthenticate: (id) => { calls.reauth.push(id); identity = null; },
    replaceUser: (fresh) => { calls.users.push(fresh); identity = fresh; return true; },
    profileRequired: (fresh, id) => { calls.profiles.push({ fresh, id, currentUser: identity }); },
    ...overrides,
    api,
  });
  return { runtime, calls, api, storage, select: (id = 1) => runtime.edit("TOGGLE_SEAT", { seatId: id }),
    setUser: (value) => { identity = value; }, setMap: (value) => { currentMap = value; }, setNow: (value) => { now = value; },
    open: () => runtime.enter(10, identity), reference: () => reference };
}

test("hold API sends only seat IDs/slugs, exact endpoints/envelopes, and never orders", async () => {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    const status = init.method === "DELETE" ? 204 : init.method === "POST" ? 201 : 200;
    return new Response(status === 204 ? null : JSON.stringify({ data: hold() }), { status, headers: { "Content-Type": "application/json" } });
  };
  try {
    await createHold(10, [{ seatId: 1, ticketType: "adult", price: 400, code: "A1", subtotal: 123 }], { token: "qa" });
    assert.deepEqual(JSON.parse(requests[0].init.body), { seats: [{ seatId: 1, ticketType: "adult" }] });
    assert.ok(requests[0].url.endsWith("/sessions/10/holds"));
    assert.equal(requests[0].init.headers.get("Authorization"), "Bearer qa");
    assert.deepEqual(await getHold(ID, { token: "qa" }), hold());
    await releaseHold(ID, { token: "qa" });
    assert.deepEqual(requests.map((request) => request.init.method), ["POST", "GET", "DELETE"]);
    assert.ok(requests.slice(1).every((request) => request.url.endsWith(`/holds/${ID}`)));
    assert.ok(requests.every((request) => !request.url.includes("/orders")));
  } finally { globalThis.fetch = original; }
});

test("pure timer formats ceil seconds and absolute background/time jumps", () => {
  for (const [ms, expected] of [[468000, "7:48"], [65000, "1:05"], [9000, "0:09"], [3665000, "61:05"], [0, "0:00"], [1, "0:01"]]) assert.equal(formatHoldTime(ms), expected);
  assert.equal(remainingHoldMs(hold().expiresAt, START + 467100), 900);
  assert.equal(remainingHoldMs(hold().expiresAt, START + 900000), 0);
});
test("hold validation rejects missing/mismatched data without fabricating authority", () => {
  assert.equal(usableHold(hold(), 10, [{ seatId: 1, ticketType: "adult" }], START), true);
  for (const bad of [hold([], {}), hold([1], { holdId: "bad" }), hold([1], { sessionId: 11 }), hold([1], { isLive: false }), hold([1], { subtotal: null }), hold([1], { expiresAt: "bad" }), hold([1], { expiresAt: new Date(START).toISOString() }), hold([1], { seats: [{ seatId: 1 }] })]) assert.equal(usableHold(bad, 10, null, START), false);
  assert.equal(usableHold(hold(), 10, [{ seatId: 2, ticketType: "adult" }], START), false);
});
test("storage bounds reference, clears malformed data, and tolerates unavailable storage", () => {
  const values = new Map();
  const storage = createHoldStorage(() => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }));
  storage.write(hold());
  assert.deepEqual(JSON.parse(values.get(HOLD_STORAGE_KEY)), { holdId: ID, sessionId: 10 });
  assert.deepEqual(storage.read(), { holdId: ID, sessionId: 10 });
  storage.clear(); assert.equal(storage.read(), null);
  values.set(HOLD_STORAGE_KEY, '{"holdId":"bad"}'); assert.equal(storage.read(), null); assert.equal(values.size, 0);
  const blocked = createHoldStorage(() => { throw Error("blocked"); });
  assert.doesNotThrow(() => { blocked.write(hold()); blocked.clear(); }); assert.equal(blocked.read(), null);
});
test("immutable snapshot does not track subsequently changed draft objects", () => {
  const selection = { 1: { ticketTypeSlug: "adult" } };
  const snapshot = snapshotSelection(selection, map());
  selection[1].ticketTypeSlug = "student";
  assert.equal(snapshot[0].ticketType, "adult");
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0]));
});
test("valid selection enables Next; synchronous lock prevents duplicate POST and all pending edits", async () => {
  const pending = deferred(); const h = harness(); await h.open();
  assert.equal(h.runtime.canNext(), false); h.select(); assert.equal(h.runtime.canNext(), true);
  h.api.createHold = async (...args) => { h.calls.creates.push(args); return pending.promise; };
  const first = h.runtime.submit(); await h.runtime.submit();
  h.select(2); h.runtime.edit("REMOVE_SEAT", { seatId: 1 }); h.runtime.edit("SET_TICKET", { seatId: 1, slug: "student" });
  assert.equal(h.calls.creates.length, 1); assert.deepEqual(h.runtime.state().selection, { 1: { ticketTypeSlug: "adult" } });
  pending.resolve(hold()); await first; assert.equal(h.runtime.state().step, "checkout");
});
test("successful create adopts server seats/prices/subtotal and minimal reference", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit();
  const state = h.runtime.state(); assert.equal(state.hold.phase, "active"); assert.equal(state.hold.data.subtotal, 7.13);
  assert.equal(state.hold.data.seats[0].price, 7.13); assert.deepEqual(h.reference(), { holdId: ID, sessionId: 10 });
  assert.equal(selectedSeatPreviews(state.selection, map(), session, options, state.hold.data)[0].cents, 713);
});
test("malformed 201 with UUID performs exactly one GET, adopting verified result", async () => {
  const h = harness({ api: { createHold: async () => ({ holdId: ID }) } }); await h.open(); h.select(); await h.runtime.submit();
  assert.deepEqual(h.calls.gets, [ID]); assert.equal(h.runtime.state().step, "checkout");
});
test("malformed success without ID and ambiguous POST remain uncertain with no auto retry", async () => {
  for (const response of [async () => ({}), async () => { throw error(500); }, async () => { throw Error("network"); }]) {
    const h = harness({ api: { createHold: response } }); await h.open(); h.select(); await h.runtime.submit();
    assert.equal(h.runtime.state().hold.phase, "uncertain"); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().feedback, HOLD_COPY.uncertain);
    assert.equal(h.runtime.canNext(), false); await h.runtime.submit(); assert.equal(h.calls.gets.length, 0);
  }
});
test("malformed recovery transient is uncertain; terminal GET never enters Checkout", async () => {
  for (const status of [500, 404]) {
    const h = harness({ api: { createHold: async () => ({ holdId: ID }), getHold: async () => { throw error(status); } } }); await h.open(); h.select(); await h.runtime.submit();
    assert.equal(h.runtime.state().step, "seats"); assert.equal(h.runtime.state().hold.phase, status === 500 ? "uncertain" : "error");
  }
});
test("Start over clears uncertainty and refetches, excludes unknown own-held seats", async () => {
  const h = harness({ api: { createHold: async () => ({}) } }); await h.open(); h.select(); await h.runtime.submit();
  h.setMap(map([1])); await h.runtime.startOver();
  assert.equal(h.runtime.state().hold.phase, "idle"); assert.deepEqual(h.runtime.state().selection, {}); assert.equal(h.runtime.hasUnknownOwn(), true);
  h.select(1); assert.deepEqual(h.runtime.state().selection, {}); assert.equal(h.reference(), null);
});
test("401 same-account continuation revalidates then replays at most once", async () => {
  const h = harness(); await h.open(); h.select(); let creates = 0;
  h.api.createHold = async () => { creates++; if (creates <= 2) throw error(401); return hold(); };
  await h.runtime.submit(); assert.deepEqual(h.calls.reauth, [10]);
  h.setUser({ ...user }); await h.open(); assert.equal(creates, 2); assert.equal(h.calls.maps, 2);
  h.setUser({ ...user }); await h.open(); assert.equal(creates, 2); assert.deepEqual(h.runtime.state().selection, {});
});
test("401 cancelled, new intent, or different account discards automatic replay", async () => {
  for (const mode of ["cancel", "intent", "account"]) {
    const h = harness(); await h.open(); h.select(); let creates = 0;
    h.api.createHold = async () => { creates++; throw error(401); }; await h.runtime.submit();
    if (mode === "cancel") h.runtime.cancelContinuation();
    if (mode === "intent") h.runtime.newIntent(10);
    h.setUser(mode === "account" ? { id: 99, profileComplete: true } : { ...user }); await h.open();
    assert.equal(creates, 1);
  }
});
test("401 changed map reconciles draft and requires explicit Next", async () => {
  const h = harness(); await h.open(); h.select(); h.select(2);
  h.api.createHold = async () => { throw error(401); }; await h.runtime.submit();
  h.setMap(map([], [1])); h.setUser({ ...user }); await h.open();
  assert.deepEqual(Object.keys(h.runtime.state().selection), ["2"]); assert.equal(h.runtime.state().hold.phase, "idle");
});
test("replacement replay accepts only proven prior isMine IDs plus ordinary available new seats", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => { throw error(401); }; await h.runtime.submit();
  h.setMap(map([1, 4])); h.setUser({ ...user });
  h.api.createHold = async (id, snapshot) => { h.calls.creates.push({ id, snapshot }); return hold([1, 2]); };
  await h.open(); assert.equal(h.runtime.state().step, "checkout"); assert.deepEqual(h.calls.creates.at(-1).snapshot.map((entry) => entry.seatId), [1, 2]);
  assert.ok(!h.runtime.state().selection[4]);
});
test("409 matches captured codes, preserves unaffected ticket choices, and keeps conflicts through failed refresh", async () => {
  const h = harness(); await h.open(); h.select(); h.select(2); h.runtime.edit("SET_TICKET", { seatId: 2, slug: "student" });
  h.api.createHold = async () => { throw error(409, { contested: ["A1", "unknown"] }); };
  h.runtime.deps.getSessionSeats = async () => { throw error(500); };
  await h.runtime.submit(); assert.deepEqual(h.runtime.state().selection, { 2: { ticketTypeSlug: "student" } });
  assert.deepEqual(h.runtime.state().contested, ["A1"]); h.select(1); assert.ok(!h.runtime.state().selection[1]);
  assert.equal(map().sections[0].rows[0].seats[0].state, "available");
  h.runtime.deps.getSessionSeats = async () => map([], [1]); await h.runtime.retry("seatMapRead"); assert.deepEqual(h.runtime.state().contested, []);
});
test("malformed contested invents no IDs and reconciles only returned factual map", async () => {
  const h = harness(); await h.open(); h.select(); h.select(2); h.setMap(map([], [2]));
  h.api.createHold = async () => { throw error(409, { contested: [123] }); }; await h.runtime.submit();
  assert.deepEqual(Object.keys(h.runtime.state().selection), ["1"]); assert.deepEqual(h.runtime.state().contested, []);
});
test("stale errors 401/409/422 cannot change newer UI/auth or trigger remediation reads", async () => {
  for (const status of [401, 409, 422]) {
    const h = harness(); await h.open(); h.select(); const pending = deferred(); h.api.createHold = () => pending.promise;
    const old = h.runtime.submit(); h.runtime.close(); await h.open(); h.select(2); const before = h.runtime.state();
    pending.reject(error(status, { contested: ["A2"] })); await old;
    assert.equal(h.runtime.state(), before); assert.equal(h.calls.reauth.length, 0); assert.equal(h.calls.me, 0);
  }
});
test("422 indexed errors use immutable submitted order, unmatched errors stay visible", async () => {
  assert.deepEqual(mapHoldErrors({ "seats.1.ticketType": ["Wrong ticket"], seats: ["Too many"], custom: ["Other"] }, [{ seatId: 1 }, { seatId: 2 }]), { fields: { 2: "Wrong ticket" }, unmatched: ["seats: Too many", "custom: Other"] });
  const h = harness(); await h.open(); h.select(); h.api.createHold = async () => { throw error(422, { errors: { "seats.0.seatId": ["Seat rejected"] } }); }; await h.runtime.submit();
  assert.equal(h.runtime.state().fieldErrors[1], "Seat rejected"); assert.equal(h.calls.me, 0);
});
test("message-only 422 shows exact text and checks /me once without parsing/replay", async () => {
  const h = harness(); await h.open(); h.select(); h.api.createHold = async () => { throw new ApiError("Custom booking rule text", { status: 422 }); }; await h.runtime.submit();
  assert.equal(h.runtime.state().feedback, "Custom booking rule text"); assert.equal(h.calls.me, 1); assert.equal(h.runtime.state().step, "seats");
});
test("message-only 422 adopts actual /me envelope's complete User and preserves current Seats without replay", async () => {
  const freshUser = { ...user, fullName: "Fresh Server User", mobileNumber: "599123456", dateOfBirth: "1990-04-12", preferredVenue: { id: 3, name: "Venue" } };
  const original = globalThis.fetch, reads = [];
  globalThis.fetch = async (url, init) => {
    reads.push({ url, method: init.method });
    return new Response(JSON.stringify({ data: freshUser }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const h = harness({ me }); await h.open(); h.select(); h.select(2);
    h.runtime.edit("SET_TICKET", { seatId: 2, slug: "student" });
    const { instanceId, selection } = h.runtime.state(); let posts = 0;
    h.api.createHold = async () => { posts++; throw new ApiError("Booking is currently unavailable.", { status: 422 }); };
    await h.runtime.submit();
    assert.equal(reads.length, 1); assert.ok(reads[0].url.endsWith("/me")); assert.equal(reads[0].method, "GET");
    assert.deepEqual(h.runtime.deps.getUser(), freshUser); assert.equal(h.calls.users.length, 1);
    h.runtime.syncAuth(h.runtime.deps.getUser(), true);
    assert.equal(h.runtime.state().instanceId, instanceId); assert.equal(h.runtime.state().sessionId, 10);
    assert.equal(h.runtime.state().step, "seats"); assert.equal(h.runtime.state().hold.phase, "error");
    assert.equal(h.runtime.state().feedback, "Booking is currently unavailable."); assert.deepEqual(h.runtime.state().selection, selection);
    assert.equal(h.calls.profiles.length, 0); assert.equal(h.runtime.profileMessage(user.id), null);
    assert.equal(posts, 1); assert.equal(h.runtime.canNext(), true);
  } finally { globalThis.fetch = original; }
});
test("422 fresh incomplete Profile uses existing gate and completion requires explicit Next", async () => {
  const h = harness(); await h.open(); h.select(); let creates = 0;
  h.api.createHold = async () => { creates++; throw new ApiError("Server business rule", { status: 422 }); };
  const freshUser = { ...user, profileComplete: false, fullName: "Fresh Incomplete User", mobileNumber: "599123456" };
  h.runtime.deps.me = async () => ({ data: freshUser }); await h.runtime.submit();
  assert.equal(h.runtime.deps.getUser(), freshUser); assert.deepEqual(h.calls.users, [freshUser]);
  assert.equal(h.calls.profiles[0].currentUser, freshUser); assert.equal(h.calls.profiles[0].fresh, freshUser);
  assert.equal(h.calls.profiles.length, 1); assert.equal(h.runtime.state().sessionId, null);
  assert.equal(creates, 1); assert.equal(h.runtime.profileMessage(user.id), "Server business rule");
  h.setUser({ ...user }); await h.open(); assert.equal(creates, 1); assert.equal(h.runtime.state().feedback, "Server business rule"); assert.equal(h.runtime.canNext(), true);
});
test("failed auth adoption cannot enqueue Profile remediation or invent another User source", async () => {
  for (const profileComplete of [true, false]) {
    const h = harness({ replaceUser: () => false }); await h.open(); h.select();
    h.api.createHold = async () => { throw error(422); };
    h.runtime.deps.me = async () => ({ data: { ...user, profileComplete } });
    await h.runtime.submit();
    assert.equal(h.runtime.deps.getUser(), user); assert.equal(h.calls.profiles.length, 0);
    assert.equal(h.runtime.state().sessionId, 10); assert.equal(h.runtime.state().feedback, "Server 422");
  }
});
test("fresh complete /me replaces an incomplete current User without Profile handoff", async () => {
  const freshUser = { ...user, fullName: "Authoritative Server User" };
  const h = harness({ me: async () => ({ data: freshUser }) });
  h.setUser({ ...user, profileComplete: false }); await h.open(); h.select();
  const instanceId = h.runtime.state().instanceId; let posts = 0;
  h.api.createHold = async () => { posts++; throw error(422); };
  await h.runtime.submit(); h.runtime.syncAuth(freshUser, true);
  assert.equal(h.runtime.deps.getUser(), freshUser); assert.equal(h.runtime.state().instanceId, instanceId);
  assert.equal(h.runtime.state().step, "seats"); assert.deepEqual(Object.keys(h.runtime.state().selection), ["1"]);
  assert.equal(h.calls.profiles.length, 0); assert.equal(posts, 1);
});

test("same-account User replacement during 422 remediation keeps the request current for fresh true/false evidence", async () => {
  for (const profileComplete of [true, false]) {
    const pending = deferred(), h = harness(); await h.open(); h.select();
    const before = h.runtime.state();
    h.api.createHold = async () => { throw new ApiError("Booking is currently unavailable.", { status: 422 }); };
    h.runtime.deps.me = () => pending.promise;
    const work = h.runtime.submit(); await flush();
    const refreshed = { ...user, fullName: "Same Account Snapshot" };
    h.setUser(refreshed); h.runtime.syncAuth(refreshed, true);
    assert.equal(h.runtime.state().instanceId, before.instanceId);
    const fresh = { ...refreshed, fullName: "Fresh Authoritative User", profileComplete };
    pending.resolve({ data: fresh }); await work;
    assert.equal(h.runtime.deps.getUser(), fresh);
    assert.equal(h.calls.users.length, 1);
    assert.equal(h.calls.profiles.length, profileComplete ? 0 : 1);
    if (profileComplete) {
      assert.equal(h.runtime.state().instanceId, before.instanceId);
      assert.deepEqual(h.runtime.state().selection, before.selection);
      assert.equal(h.runtime.state().feedback, "Booking is currently unavailable.");
      assert.equal(h.runtime.canNext(), true);
    } else assert.equal(h.calls.profiles[0].currentUser, fresh);
  }
});

test("same account under a different auth token cannot adopt an older 422 remediation response", async () => {
  let token = "original-test-token";
  const pending = deferred(), h = harness({ getToken: () => token }); await h.open(); h.select();
  h.api.createHold = async () => { throw error(422); }; h.runtime.deps.me = () => pending.promise;
  const work = h.runtime.submit(); await flush();
  token = "new-test-token";
  const currentUser = { ...user, fullName: "New Authenticated Session" }; h.setUser(currentUser);
  pending.resolve({ data: { ...user, profileComplete: false } }); await work;
  assert.equal(h.runtime.deps.getUser(), currentUser);
  assert.equal(h.calls.users.length, 0); assert.equal(h.calls.profiles.length, 0);
});

test("same-account User refresh preserves pending booking reads while different-account reads remain stale", async () => {
  for (const accountId of [user.id, user.id + 1]) {
    const pending = deferred(), h = harness({ getSessionSeats: () => pending.promise });
    const work = h.open(); await flush();
    const refreshed = { ...user, id: accountId, fullName: "Refreshed Account User" }; h.setUser(refreshed);
    h.runtime.syncAuth(refreshed, true);
    pending.resolve(map()); await work;
    if (accountId === user.id) {
      assert.equal(h.runtime.state().sessionId, 10); assert.equal(h.runtime.state().seatMapRead.status, "ready");
    } else assert.equal(h.runtime.state().sessionId, null);
  }
});
test("Back retains authority/reference/timer; unchanged Next skips POST, edited Next replaces without DELETE", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); const verified = h.runtime.state().hold.data;
  h.runtime.back(); assert.equal(h.runtime.state().hold.data, verified); assert.equal(h.reference().holdId, ID);
  await h.runtime.submit(); assert.equal(h.calls.creates.length, 1); assert.equal(h.runtime.state().step, "checkout");
  h.runtime.back(); h.runtime.edit("SET_TICKET", { seatId: 1, slug: "student" }); assert.equal(h.runtime.isChanged(), true);
  await h.runtime.submit(); assert.equal(h.calls.creates.length, 2); assert.equal(h.calls.deletes.length, 0);
});
test("definite rejected replacement GETs previous Hold and map before restoring server authority", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2); h.setMap(map([1]));
  h.api.createHold = async () => { throw error(409, { contested: ["A2"] }); }; await h.runtime.submit();
  assert.deepEqual(h.calls.gets, [ID]); assert.equal(h.runtime.state().hold.phase, "active"); assert.deepEqual(Object.keys(h.runtime.state().selection), ["1"]);
  assert.ok(h.runtime.state().feedback.includes("Server 409")); assert.equal(h.runtime.state().hold.data.subtotal, 7.13);
});
test("terminal previous Hold clears authority; transient previous verification blocks Checkout", async () => {
  for (const status of [404, 500]) {
    const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
    h.api.createHold = async () => { throw error(422, { errors: { seats: ["Rejected"] } }); }; h.api.getHold = async () => { throw error(status); }; await h.runtime.submit();
    assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().step, "seats");
    assert.equal(Boolean(h.runtime.state().recovery), status === 500); assert.equal(Boolean(h.reference()), status === 500);
  }
});
test("ambiguous replacement drops old authority; Start over releases recovery reference once", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => { throw Error("lost response"); }; await h.runtime.submit();
  assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().hold.phase, "uncertain"); assert.equal(h.runtime.state().recovery.reference.holdId, ID);
  await h.runtime.startOver(); assert.equal(h.reference(), null); assert.equal(h.calls.deletes.length, 1);
});
test("fully verified refresh restoration hydrates server values and ignores extra own seats", async () => {
  const h = harness(); h.storage.write(hold()); h.setMap(map([1, 4])); h.runtime.syncAuth(user, true); await flush();
  assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.runtime.state().hold.data.subtotal, 7.13); assert.deepEqual(Object.keys(h.runtime.state().selection), ["1"]);
});
test("restore expired/nonlive/malformed/403/404 is terminal and clears reference", async () => {
  for (const response of [async () => hold([1], { isLive: false }), async () => hold([1], { expiresAt: new Date(START).toISOString() }), async () => ({}), async () => { throw error(403); }, async () => { throw error(404); }]) {
    const h = harness({ api: { getHold: response } }); h.storage.write(hold()); await h.open(); assert.equal(h.reference(), null); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().step, "seats");
  }
});
test("transient restore keeps reference, exposes Retry/Start over, and adopts only after retry proof", async () => {
  const h = harness({ api: { getHold: async () => { throw error(500); } } }); h.storage.write(hold()); await h.open();
  assert.equal(h.runtime.state().feedback, HOLD_COPY.restore); assert.ok(h.reference()); assert.equal(h.runtime.state().hold.data, null);
  h.api.getHold = async () => hold(); h.setMap(map([1])); await h.runtime.retry(); assert.equal(h.runtime.state().step, "checkout");
});
test("Hold/map ownership mismatch never partially hydrates; Retry verifies all reads", async () => {
  for (const currentMap of [map(), map([1], [1]), { ...map([1]), sections: [] }]) {
    const h = harness(); h.storage.write(hold()); h.setMap(currentMap); await h.open();
    assert.equal(h.runtime.state().feedback, HOLD_COPY.mismatch); assert.equal(h.runtime.state().hold.data, null); assert.deepEqual(h.runtime.state().selection, {});
    h.setMap(map([1])); await h.runtime.retry(); assert.equal(h.runtime.state().step, "checkout");
  }
  assert.equal(holdMatchesMap(hold(), map([1, 4])), true);
});
test("same-session fresh intent shares pending restore; different-session restore is obsolete", async () => {
  const pending = deferred(); const h = harness({ api: { getHold: async () => { h.calls.gets.push(ID); return pending.promise; } } }); h.storage.write(hold());
  const first = h.open(); const instance = h.runtime.state().instanceId; await h.open(); assert.equal(h.runtime.state().instanceId, instance); assert.equal(h.calls.gets.length, 1);
  h.runtime.newIntent(11); await h.runtime.enter(11, user); pending.resolve(hold()); await first;
  assert.equal(h.runtime.state().sessionId, 11); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.calls.deletes.length, 1);
});
test("expiry once clears draft/reference, refetches map and never DELETEs", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); const active = h.runtime.state().hold.data; const reads = h.calls.maps;
  h.setNow(START + 500000); assert.equal(h.runtime.expire(active), true); assert.equal(h.runtime.expire(active), false); await flush();
  assert.equal(h.runtime.state().feedback, HOLD_COPY.expired); assert.equal(h.runtime.state().hold.phase, "expired"); assert.deepEqual(h.runtime.state().selection, {}); assert.equal(h.reference(), null); assert.equal(h.calls.maps, reads + 1); assert.equal(h.calls.deletes.length, 0);
});
test("old timer identity cannot expire a newer hold", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); const old = h.runtime.state().hold.data;
  h.runtime.back(); h.select(2); h.api.createHold = async () => hold([1, 2], { holdId: NEXT_ID, expiresAt: new Date(START + 1000000).toISOString() }); await h.runtime.submit();
  h.setNow(START + 500000); assert.equal(h.runtime.expire(old), false); assert.equal(h.runtime.state().hold.data.holdId, NEXT_ID);
});
test("Close clears reference immediately and initiates one captured DELETE without awaiting", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); const pending = deferred(); h.api.releaseHold = (id, auth) => { h.calls.deletes.push({ id, auth }); return pending.promise; };
  h.runtime.close(); h.runtime.close(); assert.equal(h.runtime.state().sessionId, null); assert.equal(h.reference(), null); assert.equal(h.calls.deletes.length, 1); assert.equal(h.calls.deletes[0].auth.token, "test-only-token");
  pending.reject(error(500)); await flush(); assert.equal(h.runtime.state().sessionId, null);
});
test("session switch abandons old hold and stale DELETE cannot alter new booking", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); const pending = deferred(); h.api.releaseHold = (id) => { h.calls.deletes.push(id); return pending.promise; };
  h.runtime.newIntent(11); await h.runtime.enter(11, user); const before = h.runtime.state(); pending.reject(error(403)); await flush(); assert.equal(h.runtime.state(), before); assert.equal(h.calls.deletes.length, 1);
});
test("visible Start over release failure uses exact copy; closed failure remains silent", async () => {
  const h = harness(); h.storage.write(hold()); h.setMap(map()); await h.open(); h.api.releaseHold = async () => { throw error(500); }; await h.runtime.startOver(); await flush();
  assert.equal(h.runtime.state().releaseWarning, HOLD_COPY.release); assert.equal(h.reference(), null);
});
test("abandoned POST late success never adopts/persists/reopens and releases exact returned ID", async () => {
  const h = harness(); await h.open(); h.select(); const pending = deferred(); h.api.createHold = () => pending.promise; const work = h.runtime.submit(); h.runtime.close(); pending.resolve(hold()); await work; await flush();
  assert.equal(h.runtime.state().sessionId, null); assert.equal(h.reference(), null); assert.equal(h.calls.deletes.length, 1); assert.equal(h.calls.deletes[0].id, ID);
});
test("late success never releases a newer active Hold even if backend reuses ID", async () => {
  const h = harness(); await h.open(); h.select(); const pending = deferred(); h.api.createHold = () => pending.promise; const old = h.runtime.submit(); h.runtime.close(); await h.open(); h.select(2);
  h.api.createHold = async () => hold([2]); await h.runtime.submit(); const before = h.runtime.state(); pending.resolve(hold()); await old; await flush();
  assert.equal(h.runtime.state(), before); assert.equal(h.calls.deletes.length, 0); assert.equal(h.reference().holdId, ID);
});
test("stale malformed recovery GET cannot adopt or clear newer state", async () => {
  const h = harness(); await h.open(); h.select(); const pending = deferred(); h.api.createHold = async () => ({ holdId: ID }); h.api.getHold = () => pending.promise;
  const old = h.runtime.submit(); await flush(); h.runtime.close(); await h.open(); h.select(2); const before = h.runtime.state(); pending.resolve(hold()); await old; await flush();
  assert.equal(h.runtime.state(), before); assert.equal(h.reference(), null);
});

test("native timer observer recalculates on focus/visibility, expires once, and cleans listeners", () => {
  let now = START, interval, cleared = false, expiryCount = 0;
  const page = new EventTarget(), view = new EventTarget(), ticks = [];
  page.visibilityState = "visible";
  view.setInterval = (callback, ms) => { interval = callback; assert.equal(ms, 1000); return 1; };
  view.clearInterval = (id) => { assert.equal(id, 1); cleared = true; };
  const stop = observeHoldClock(hold(), (time) => ticks.push(time), () => expiryCount++, { clock: () => now, page, view });
  assert.deepEqual(ticks, [START]);
  now += 65000; view.dispatchEvent(new Event("focus")); assert.equal(ticks.at(-1), now);
  page.visibilityState = "hidden"; now += 500000; page.dispatchEvent(new Event("visibilitychange")); assert.equal(expiryCount, 0);
  page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange")); assert.equal(expiryCount, 1);
  interval(); view.dispatchEvent(new Event("focus")); assert.equal(expiryCount, 1);
  stop(); const count = ticks.length; view.dispatchEvent(new Event("focus")); page.dispatchEvent(new Event("visibilitychange")); assert.equal(ticks.length, count); assert.equal(cleared, true);
});
test("expired saved retrieval announces accepted expiry copy", async () => {
  const h = harness({ api: { getHold: async () => hold([1], { isLive: false }) } }); h.storage.write(hold()); await h.open();
  assert.equal(h.runtime.state().feedback, HOLD_COPY.expired); assert.equal(h.runtime.state().hold.phase, "expired"); assert.equal(h.reference(), null);
});
test("contradictory previous-hold map clears reference and retains only factual available draft", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => { throw error(422, { errors: { seats: ["Rejected"] } }); }; h.setMap(map([], [1])); await h.runtime.submit();
  assert.equal(h.reference(), null); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().recovery, null);
  assert.deepEqual(Object.keys(h.runtime.state().selection), ["2"]); assert.ok(h.runtime.state().feedback.includes("Rejected"));
});
test("stale remediation /me cannot route another user or replace current feedback", async () => {
  for (const profileComplete of [true, false]) {
    for (const mode of ["reopen", "session", "intent", "different-account", "logout"]) {
      const h = harness(); await h.open(); h.select(); const pending = deferred();
      h.api.createHold = async () => { throw error(422); }; h.runtime.deps.me = () => pending.promise;
      const work = h.runtime.submit(); await flush();
      if (mode === "reopen") { h.runtime.close(); await h.open(); }
      if (mode === "session") { h.runtime.close(); await h.runtime.enter(11, user); }
      if (mode === "intent") h.runtime.newIntent(10);
      if (mode === "different-account") h.setUser({ ...user, id: 99 });
      if (mode === "logout") { h.runtime.close(); h.setUser(null); }
      const before = h.runtime.state(), authBefore = h.runtime.deps.getUser();
      pending.resolve({ data: { ...user, profileComplete } }); await work;
      assert.equal(h.runtime.state(), before); assert.equal(h.runtime.deps.getUser(), authBefore);
      assert.equal(h.calls.profiles.length, 0); assert.equal(h.calls.users.length, 0);
    }
  }
});
test("saved GET401 requires auth, retains reference, and resumes verified reads without POST", async () => {
  const h = harness(); h.storage.write(hold()); h.api.getHold = async () => { throw error(401); }; await h.open();
  assert.equal(h.reference().holdId, ID); assert.deepEqual(h.calls.reauth, [10]); assert.equal(h.runtime.state().sessionId, null);
  h.setUser({ ...user }); h.setMap(map([1])); h.api.getHold = async () => hold(); await h.open(); assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.calls.creates.length, 0);
});
test("malformed-success GET401 reauthenticates for verification without replaying POST", async () => {
  const h = harness({ api: { createHold: async () => ({ holdId: ID }), getHold: async () => { throw error(401); } } }); await h.open(); h.select(); await h.runtime.submit();
  assert.deepEqual(h.calls.reauth, [10]); h.setUser({ ...user }); h.setMap(map([1])); h.api.getHold = async () => hold(); await h.open();
  assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.calls.creates.length, 0);
});
test("late cleanup waits for full newer malformed-success verification before judging reused ID", async () => {
  const h = harness(); await h.open(); h.select(); const oldPost = deferred(), newGet = deferred(); h.api.createHold = () => oldPost.promise;
  const old = h.runtime.submit(); h.runtime.close(); await h.open(); h.select(2);
  h.api.createHold = async () => ({ holdId: ID }); h.api.getHold = () => newGet.promise;
  const newer = h.runtime.submit(); await flush(); oldPost.resolve(hold()); await old; await flush(); assert.equal(h.calls.deletes.length, 0);
  newGet.resolve(hold([2])); await newer; await flush(); assert.equal(h.calls.deletes.length, 0); assert.equal(h.runtime.state().hold.data.seats[0].seatId, 2);
});
test("stale release failure after fresh create does not add recovery feedback to newer hold", async () => {
  const h = harness(); h.storage.write(hold()); await h.open(); const pending = deferred(); h.api.releaseHold = () => pending.promise;
  await h.runtime.startOver(); h.select(2); h.api.createHold = async () => hold([2], { holdId: NEXT_ID }); await h.runtime.submit();
  const before = h.runtime.state(); pending.reject(error(500)); await flush(); assert.equal(h.runtime.state(), before); assert.equal(h.runtime.state().releaseWarning, null);
});
test("unavailable sessionStorage still allows current-tab authoritative Checkout", async () => {
  const h = harness({ storage: createHoldStorage(() => { throw Error("blocked"); }) }); await h.open(); h.select(); await h.runtime.submit();
  assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.runtime.state().hold.data.holdId, ID);
});
test("restoration context failure stays transient while terminal map read clears reference", async () => {
  for (const status of [500, 403, 404]) {
    const h = harness({ getSessionSeats: async () => { throw error(status); } }); h.storage.write(hold()); await h.open();
    assert.equal(h.runtime.state().hold.data, null); assert.equal(Boolean(h.reference()), status === 500); assert.equal(Boolean(h.runtime.state().recovery), status === 500);
  }
});
test("uncertain replacement with a newly known UUID releases both distinct recovery references", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => ({ holdId: NEXT_ID }); h.api.getHold = async () => { throw error(500); }; await h.runtime.submit();
  await h.runtime.startOver(); assert.deepEqual(h.calls.deletes.map((entry) => entry.id).sort(), [ID, NEXT_ID].sort()); assert.equal(h.reference(), null);
});
test("stale previous-hold revalidation cannot adopt or erase newer booking/reference", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2); const pending = deferred();
  h.api.createHold = async () => { throw error(409); }; h.api.getHold = () => pending.promise; const work = h.runtime.submit(); await flush();
  h.runtime.close(); await h.open(); h.select(3); h.api.createHold = async () => hold([3], { holdId: NEXT_ID }); await h.runtime.submit(); const before = h.runtime.state();
  pending.resolve(hold()); await work; assert.equal(h.runtime.state(), before); assert.equal(h.reference().holdId, NEXT_ID);
});
test("definite replacement rejection immediately drops old timer authority during remediation", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2); const pending = deferred();
  h.api.createHold = async () => { throw error(422); }; h.runtime.deps.me = () => pending.promise;
  const work = h.runtime.submit(); await flush(); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().feedback, "Server 422"); assert.equal(h.runtime.canNext(), false);
  h.setMap(map([1])); pending.resolve({ data: user }); await work; assert.equal(h.runtime.state().hold.phase, "active");
});
test("logout cleanup captures valid auth even while Profile remediation has hidden the booking", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => { throw error(422); }; h.runtime.deps.me = async () => ({ data: { ...user, profileComplete: false } }); await h.runtime.submit();
  assert.equal(h.runtime.state().sessionId, null); assert.ok(h.reference());
  h.runtime.close(); h.setUser(null); assert.equal(h.calls.deletes.length, 1); assert.equal(h.calls.deletes[0].auth.token, "test-only-token"); assert.equal(h.reference(), null);
});
test("different-session intent abandons saved reference immediately during reauthentication", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => { throw error(401); }; await h.runtime.submit(); assert.ok(h.reference()); h.runtime.newIntent(11); assert.equal(h.reference(), null); assert.equal(h.calls.deletes.length, 0);
});
test("invalidated configuration obsoletes pending POST instead of adopting its late response", async () => {
  const h = harness(); await h.open(); h.select(); const pending = deferred(); h.api.createHold = () => pending.promise; const work = h.runtime.submit();
  h.runtime.configureDependencies({ options: () => ({ maxSeatsPerOrder: 3, ticketTypes: [] }) });
  assert.equal(h.runtime.state().hold.phase, "uncertain"); pending.resolve(hold()); await work; await flush(); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.reference(), null); assert.equal(h.calls.deletes.length, 1);
});
test("replacement 401 does not replay prior held IDs that no longer report isMine", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2); let replays = 0;
  h.api.createHold = async () => { throw error(401); }; await h.runtime.submit(); h.setUser({ ...user }); h.setMap(map());
  h.api.createHold = async () => { replays++; return hold([1, 2]); }; await h.open();
  assert.equal(replays, 0); assert.deepEqual(Object.keys(h.runtime.state().selection), ["2"]); assert.equal(h.runtime.state().step, "seats");
});
test("Profile completion previous-hold transient read retains recovery reference and never replays POST", async () => {
  const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
  h.api.createHold = async () => { throw error(422); }; h.runtime.deps.me = async () => ({ data: { ...user, profileComplete: false } }); await h.runtime.submit();
  h.setUser({ ...user }); h.setMap(map([1])); h.api.getHold = async () => { throw error(500); }; await h.open();
  assert.ok(h.reference()); assert.equal(h.runtime.state().hold.data, null); assert.equal(h.runtime.state().recovery.retryable, true); assert.equal(h.calls.creates.length, 1);
});
test("fresh same-session intent retries failed restoration within the same booking instance", async () => {
  const h = harness({ api: { getHold: async () => { throw error(500); } } }); h.storage.write(hold()); await h.open(); const instance = h.runtime.state().instanceId;
  h.runtime.newIntent(10); h.setMap(map([1])); h.api.getHold = async () => hold(); await h.open();
  assert.equal(h.runtime.state().instanceId, instance); assert.equal(h.runtime.state().step, "checkout"); assert.equal(h.calls.deletes.length, 0);
});
test("malformed create recovered as non-live announces expiry and never enters Checkout", async () => {
  const h = harness({ api: { createHold: async () => ({ holdId: ID }), getHold: async () => hold([1], { isLive: false }) } }); await h.open(); h.select(); await h.runtime.submit();
  assert.equal(h.runtime.state().feedback, HOLD_COPY.expired); assert.equal(h.runtime.state().hold.phase, "expired"); assert.equal(h.reference(), null);
});
test("multiple returned errors for the same seat remain visible instead of overwriting", () => {
  assert.deepEqual(mapHoldErrors({ "seats.0.seatId": ["Wrong hall"], "seats.0.ticketType": ["Wrong ticket"] }, [{ seatId: 1 }]), { fields: { 1: "Wrong hall Wrong ticket" }, unmatched: [] });
});
test("Profile continuation verifies previous requested UUID and announces server-confirmed expiry", async () => {
  for (const expired of [false, true]) {
    const h = harness(); await h.open(); h.select(); await h.runtime.submit(); h.runtime.back(); h.select(2);
    h.api.createHold = async () => { throw error(422); }; h.runtime.deps.me = async () => ({ data: { ...user, profileComplete: false } }); await h.runtime.submit();
    h.setUser({ ...user }); h.setMap(map([1])); h.api.getHold = async () => expired ? hold([1], { isLive: false }) : hold([1], { holdId: NEXT_ID }); await h.open();
    assert.equal(h.runtime.state().hold.data, null); assert.equal(h.reference(), null);
    if (expired) { assert.equal(h.runtime.state().hold.phase, "expired"); assert.ok(h.runtime.state().feedback.includes(HOLD_COPY.expired)); }
  }
});
