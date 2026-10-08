import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

// Run against an isolated browser with fixture-only API traffic:
// KINO_PROFILE_QA_CDP_URL=http://127.0.0.1:9231 node --test tests/profileRendering.test.js
const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires an isolated Chrome CDP endpoint" }, run);
const user = { id: 987654, username: "Restore QA", email: "restore@example.test", avatar: null, fullName: "Fresh Server User", mobileNumber: "599123456", dateOfBirth: "1990-04-12", age: 36, preferredVenue: { id: 3, name: "Server Venue" }, profileComplete: true };
const filters = { venues: [{ ...user.preferredVenue, slug: "server-venue", formats: [] }], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [], ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }], maxSeatsPerOrder: 3 };
let server, origin;
before(async () => {
  if (!endpoint) return;
  server = await createServer({ cacheDir: "node_modules/.cache/kino-profile-qa/vite-profile-rendering", server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "profile-test-entry", transformIndexHtml: { order: "pre", handler: (html) => html.replace('/src/main.jsx', '/tests/fixtures/profileHarness.jsx') } }] });
  await server.listen(); origin = server.resolvedUrls.local[0];
});
after(async () => { await server?.close(); });

async function fixture({ late = false, pending = false, path = "profile", initialUser = user, loginUser = null, holdQa = false } = {}) {
  const browser = await connectProfileBrowser(endpoint);
  const calls = { me: 0, posts: 0, forbidden: [], exceptions: [] };
  let freshUser = initialUser, pausedMe, meStatus = 200, pauseNextMe = false, pausedHoldMe;
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }];
  const fulfill = (event, data, status = 200) => browser.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: status, responseHeaders: headers, body: status === 204 ? "" : Buffer.from(JSON.stringify(data)).toString("base64") });
  browser.on("Runtime.exceptionThrown", (event) => calls.exceptions.push(event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", async (event) => {
    const url = new URL(event.request.url), method = event.request.method;
    if (url.origin === new URL(origin).origin) return browser.send("Fetch.continueRequest", { requestId: event.requestId });
    if (method === "GET" && url.hostname === "fonts.googleapis.com" && url.pathname === "/css2") return fulfill(event, null, 204);
    if (url.hostname !== "api.kinoxii.redberryinternship.ge") {
      calls.forbidden.push({ method, path: url.pathname });
      return browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    }
    if (method === "OPTIONS") return fulfill(event, null, 204);
    if (method === "GET" && url.pathname === "/api/me") {
      calls.me++;
      if (pending && !pausedMe) { pausedMe = event; return; }
      if (pauseNextMe) { pauseNextMe = false; pausedHoldMe = event; return; }
      return fulfill(event, meStatus === 200 ? { data: freshUser } : { message: "Unable to verify the current User." }, meStatus);
    }
    if (method === "GET" && url.pathname === "/api/filter-options") return fulfill(event, { data: filters });
    if (method === "POST" && ["/api/login", "/api/register"].includes(url.pathname)) return fulfill(event, { data: { user: loginUser ?? freshUser, token: "isolated-test-token" } }, url.pathname === "/api/register" ? 201 : 200);
    if (method === "GET" && url.pathname === "/api/sessions") return fulfill(event, { data: [], meta: { currentPage: 1, lastPage: 1, perPage: 10, totalSessions: 0, totalMovies: 0 } });
    if (method === "POST" && url.pathname === "/api/logout") return fulfill(event, null, 204);
    if (method === "GET" && /^\/api\/sessions\/(10|11)$/.test(url.pathname)) return fulfill(event, { data: { id: Number(url.pathname.split("/").at(-1)), price: 19, movie: { ageRating: { minAge: 12 } } } });
    if (method === "GET" && url.pathname === "/api/sessions/10/seats") return fulfill(event, { data: { sessionId: 10, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A", seats: [
      { id: 1, label: "1", code: "A1", state: "available", isMine: false, aisleAfter: false },
    ] }] }] } });
    if (method === "POST" && url.pathname === "/api/sessions/10/holds") {
      calls.posts++;
      // Exactly one injected rejection. Any replay is blocked and reported;
      // no subsequent mutation can reach the real API.
      if (calls.posts === 1) return fulfill(event, { message: "Booking is currently unavailable." }, 422);
    }
    calls.forbidden.push({ method, path: url.pathname });
    return browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
  });
  await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('kino-xii.auth.token', 'isolated-test-token');" });
  try {
    const query = new URLSearchParams();
    if (late) query.set("late", "");
    if (holdQa) query.set("hold-qa", "");
    await browser.send("Page.navigate", { url: `${origin}${path}?${query}` });
    if (pending) await browser.wait("window.profileQa");
    else if (path === "profile") await browser.wait("document.querySelector('.profile-form')");
    else await browser.wait("window.profileQa && document.querySelector('.navbar')");
  } catch (error) { await browser.close(); throw error; }
  return { browser, calls,
    setUser(next) { freshUser = next; },
    setMeStatus(status) { meStatus = status; },
    pauseMe() { pauseNextMe = true; },
    async waitHoldMe() { const deadline = Date.now() + 10000; while (!pausedHoldMe && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(pausedHoldMe); },
    async resolveHoldMe(next) { assert.ok(pausedHoldMe); await fulfill(pausedHoldMe, { data: next }); pausedHoldMe = null; },
    async resolveMe(next = freshUser) { assert.ok(pausedMe); pending = false; await fulfill(pausedMe, { data: next }); },
    async snapshot() { return browser.evaluate(`({ auth: JSON.parse(document.getElementById('auth-probe').textContent), status: document.querySelector('.profile-page__status')?.textContent, fields: Object.fromEntries([...document.querySelectorAll('.profile-form input, .profile-form select')].map(e => [e.name, e.value])) })`); },
    async adopt(next) { const accepted = await browser.evaluate(`window.profileQa.replaceUser(${JSON.stringify(next)})`); assert.equal(accepted, true); await browser.wait(`JSON.parse(document.getElementById('auth-probe').textContent).user.fullName === ${JSON.stringify(next.fullName)}`); },
    async edit(name, value) { await browser.evaluate(`(() => { const input = document.querySelector('[name="${name}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`); },
    async close() {
      try { assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.exceptions, []); }
      finally { await browser.close(); }
    },
  };
}

function hydrated(state, expected = user) {
  assert.deepEqual(state.auth.user, expected); assert.equal(state.auth.status, "authenticated");
  assert.equal(state.status, expected.profileComplete ? "Profile Complete" : "Profile incomplete");
  for (const field of ["email", "fullName", "mobileNumber", "dateOfBirth"]) assert.equal(state.fields[field], expected[field] ?? "");
  assert.equal(state.fields.preferredVenueId, String(expected.preferredVenue?.id ?? ""));
}

rendered("direct Profile load and full reload use the actual AuthProvider's inner restored User", async () => {
  const h = await fixture();
  try {
    hydrated(await h.snapshot()); assert.equal(h.calls.me, 1);
    await h.browser.evaluate("window.profileQaReloadPending = true");
    await h.browser.send("Page.reload", { ignoreCache: true });
    // Page.reload can acknowledge before the old document is discarded. Wait
    // for the new document rather than matching the previous form immediately.
    await h.browser.wait("!window.profileQaReloadPending && document.getElementById('auth-probe') && document.querySelector('.profile-form')");
    hydrated(await h.snapshot()); assert.equal(h.calls.me, 2); assert.equal(h.calls.posts, 0);
  } finally { await h.close(); }
});

const incompleteUser = { ...user, profileComplete: false, fullName: null, mobileNumber: null, dateOfBirth: null, preferredVenue: null, age: null };
const settleEffects = (browser) => browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))))");

rendered("incomplete canonical User is replaced by fresh /me and remains complete after all effects settle", async () => {
  const h = await fixture({ initialUser: incompleteUser });
  try {
    const initial = await h.snapshot(); assert.deepEqual(initial.auth.user, incompleteUser);
    assert.equal(initial.status, "Profile incomplete"); assert.equal(initial.fields.email, user.email);
    for (const field of ["fullName", "mobileNumber", "dateOfBirth", "preferredVenueId"]) assert.equal(initial.fields[field], "");
    h.setUser(user);
    await h.browser.evaluate("window.profileQa.restoreSession()");
    await settleEffects(h.browser);
    hydrated(await h.snapshot()); assert.equal(h.calls.me, 2);
    await h.browser.evaluate("document.getElementById('rerender').click()"); await settleEffects(h.browser);
    hydrated(await h.snapshot()); assert.equal(h.calls.posts, 0);
  } finally { await h.close(); }
});

rendered("login/register adopt their returned User without requiring an additional /me", async () => {
  for (const method of ["login", "register"]) {
    for (const returnedUser of [user, incompleteUser]) {
      const h = await fixture({ loginUser: returnedUser });
      try {
        hydrated(await h.snapshot());
        h.setMeStatus(returnedUser.profileComplete ? 500 : 401);
        const result = await h.browser.evaluate(`window.profileQa.${method}({username:'Restore QA',email:'restore@example.test',password:'test-only-password',password_confirmation:'test-only-password'})`);
        await settleEffects(h.browser);
        assert.deepEqual(result, returnedUser);
        hydrated(await h.snapshot(), returnedUser); assert.equal(h.calls.me, 1);
      } finally { await h.close(); }
    }
  }
});

rendered("explicit restore 401 clears auth after successful login without an extra confirmation read", async () => {
  const h = await fixture();
  try {
    h.setMeStatus(401);
    assert.deepEqual(await h.browser.evaluate("window.profileQa.login({email:'restore@example.test',password:'test-only-password'})"), user);
    await settleEffects(h.browser); hydrated(await h.snapshot()); assert.equal(h.calls.me, 1);
    assert.equal(await h.browser.evaluate("window.profileQa.restoreSession()"), null);
    await settleEffects(h.browser);
    const state = await h.snapshot(); assert.equal(state.auth.status, "guest"); assert.equal(state.auth.user, null);
    assert.equal(await h.browser.evaluate("localStorage.getItem('kino-xii.auth.token') === null"), true);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.profile-form'))"), false);
    assert.equal(h.calls.me, 2);
  } finally { await h.close(); }
});

rendered("explicit restore failure preserves the authenticated returned User and permits a fresh retry", async () => {
  const h = await fixture({ loginUser: incompleteUser });
  try {
    h.setMeStatus(500);
    assert.deepEqual(await h.browser.evaluate("window.profileQa.login({email:'restore@example.test',password:'test-only-password'})"), incompleteUser);
    await settleEffects(h.browser);
    hydrated(await h.snapshot(), incompleteUser); assert.equal(h.calls.me, 1);
    assert.equal(await h.browser.evaluate("window.profileQa.restoreSession().catch(error => error.status)"), 500);
    await settleEffects(h.browser); hydrated(await h.snapshot(), incompleteUser);
    assert.equal(await h.browser.evaluate("Boolean(localStorage.getItem('kino-xii.auth.token'))"), true);
    h.setMeStatus(200); await h.browser.evaluate("window.profileQa.restoreSession()"); await settleEffects(h.browser);
    hydrated(await h.snapshot()); assert.equal(h.calls.me, 3);
  } finally { await h.close(); }
});

rendered("stale bootstrap /me cannot overwrite the User returned by newer login", async () => {
  const loginUser = { ...user, fullName: "User From New Login" };
  const h = await fixture({ pending: true, loginUser });
  try {
    await h.browser.wait("JSON.parse(document.getElementById('auth-probe').textContent).status === 'restoring'");
    await h.browser.evaluate("window.profileQa.login({email:'restore@example.test',password:'test-only-password'})");
    await h.resolveMe(incompleteUser);
    await h.browser.wait("document.querySelector('.profile-form')"); await settleEffects(h.browser);
    hydrated(await h.snapshot(), loginUser); assert.equal(h.calls.me, 1);
  } finally { await h.close(); }
});

rendered("Profile mounted before restore hydrates on late User arrival and preserves edits on rerender", async () => {
  const h = await fixture({ late: true, pending: true });
  try {
    const before = await h.snapshot(); assert.equal(before.auth.status, "restoring"); assert.equal(before.auth.user, null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.profile-form'))"), false);
    await h.resolveMe(); await h.browser.wait("document.querySelector('.profile-form')"); hydrated(await h.snapshot());
    await h.edit("fullName", "Unsaved User Edit"); await h.browser.evaluate("document.getElementById('rerender').click()");
    assert.equal((await h.snapshot()).fields.fullName, "Unsaved User Edit");
    assert.equal(h.calls.me, 1); assert.equal(h.calls.posts, 0);
  } finally { await h.close(); }
});

rendered("same-account server refresh preserves dirty fields while updating pristine fields and status", async () => {
  const h = await fixture();
  try {
    await h.edit("fullName", "Unsaved User Edit");
    const fresh = { ...user, fullName: "Server Changed Name", mobileNumber: "577123456", profileComplete: false };
    await h.adopt(fresh); const state = await h.snapshot();
    assert.deepEqual(state.auth.user, fresh); assert.equal(state.status, "Profile incomplete");
    assert.equal(state.fields.fullName, "Unsaved User Edit"); assert.equal(state.fields.mobileNumber, fresh.mobileNumber);
    assert.equal(h.calls.posts, 0);
  } finally { await h.close(); }
});

rendered("different-account restore never leaks the previous account's unsaved fields", async () => {
  const h = await fixture({ late: true });
  try {
    await h.edit("fullName", "Private Unsaved Old Name");
    const nextUser = { ...user, id: 987655, fullName: "New Account User", email: "new-account@example.test", mobileNumber: "577123456" };
    await h.browser.evaluate("window.profileQa.expireSession({type:'OPEN_BOOKING',payload:{sessionId:10}})");
    h.setUser(nextUser); await h.browser.evaluate("window.profileQa.login({email:'new-account@example.test',password:'test-only-password'})");
    await h.browser.wait("document.querySelector('.profile-form')"); hydrated(await h.snapshot(), nextUser);
  } finally { await h.close(); }
});

rendered("stale pending restore cannot overwrite a newer auth invalidation", async () => {
  const h = await fixture({ late: true, pending: true });
  try {
    await h.browser.evaluate("window.profileQa.expireSession({type:'OPEN_BOOKING',payload:{sessionId:10}})");
    await h.resolveMe(); await h.browser.wait("JSON.parse(document.getElementById('auth-probe').textContent).status === 'guest'");
    assert.equal((await h.snapshot()).auth.user, null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.profile-form'))"), false);
  } finally { await h.close(); }
});

const bookingSnapshot = (browser) => browser.evaluate("JSON.parse(document.getElementById('booking-probe').textContent)");

async function startHold(h) {
  await h.browser.wait("window.holdQa");
  await h.browser.evaluate("window.holdQa.open(10)");
  await h.browser.wait("document.getElementById('booking-seat-1') && !document.getElementById('booking-seat-1').disabled");
  await h.browser.evaluate("document.getElementById('booking-seat-1').click()");
  await h.browser.wait("JSON.parse(document.getElementById('booking-probe').textContent).canNext");
  const before = await bookingSnapshot(h.browser);
  h.pauseMe();
  await h.browser.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Next: Checkout').click()");
  await h.waitHoldMe();
  return before;
}

rendered("HOLD 422 true preserves the same Seats instance and draft through a same-account User refresh", async () => {
  const h = await fixture({ path: "sessions", holdQa: true });
  try {
    assert.deepEqual((await h.snapshot()).auth.user, user);
    const before = await startHold(h);
    const fresh = { ...user, fullName: "Fresh Hold Authoritative User" };
    await h.adopt({ ...user, fullName: "Same Account Refreshed Snapshot" });
    await h.resolveHoldMe(fresh); await settleEffects(h.browser);
    const after = await bookingSnapshot(h.browser), auth = (await h.snapshot()).auth;
    assert.deepEqual(auth.user, fresh);
    assert.equal(after.state.instanceId, before.state.instanceId);
    assert.equal(after.state.sessionId, 10); assert.equal(after.state.step, "seats");
    assert.deepEqual(after.state.selection, before.state.selection); assert.equal(after.canNext, true);
    assert.equal(after.state.feedback, "Booking is currently unavailable.");
    assert.equal(await h.browser.evaluate("document.getElementById('booking-selection-status')?.textContent"), "Booking is currently unavailable.");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('dialog[open]'))"), true);
    assert.equal(await h.browser.evaluate("location.pathname"), "/sessions");
    assert.equal(auth.pendingAction, null); assert.equal(auth.bookingReadyAction, null); assert.equal(after.profileIntent, null);
    assert.equal(h.calls.posts, 1); assert.equal(h.calls.me, 2);
  } finally { await h.close(); }
});

rendered("stale HOLD 422 /me cannot act after replacement, logout, account switch, or newer same-session intent", async () => {
  for (const mode of ["replacement", "logout", "account-switch", "newer-intent"]) {
    const h = await fixture({ path: "sessions", holdQa: true });
    try {
      await startHold(h);
      if (mode === "replacement") {
        await h.browser.evaluate("window.holdQa.close(); window.holdQa.open(10)");
      } else if (mode === "logout") {
        await h.browser.evaluate("window.profileQa.logout()");
      } else if (mode === "account-switch") {
        await h.browser.evaluate("window.profileQa.expireSession({type:'OPEN_BOOKING',payload:{sessionId:10}})");
        h.setUser({ ...user, id: user.id + 1, fullName: "Different Account User" });
        await h.browser.evaluate("window.profileQa.login({email:'other@example.test',password:'test-only-password'})");
      } else await h.browser.evaluate("window.holdQa.open(10)");
      await settleEffects(h.browser);
      const authBefore = (await h.snapshot()).auth.user, bookingBefore = await bookingSnapshot(h.browser);
      await h.resolveHoldMe({ ...user, profileComplete: false, fullName: "Stale Incomplete User" });
      await settleEffects(h.browser);
      assert.deepEqual((await h.snapshot()).auth.user, authBefore, mode);
      assert.deepEqual(await bookingSnapshot(h.browser), bookingBefore, mode);
      assert.equal(await h.browser.evaluate("location.pathname"), "/sessions", mode);
      assert.equal((await bookingSnapshot(h.browser)).profileIntent, null, mode);
      assert.equal(h.calls.posts, 1, mode);
    } finally { await h.close(); }
  }
});
