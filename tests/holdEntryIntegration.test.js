import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires an isolated Chrome CDP endpoint" }, run);
const message = "Booking is currently unavailable.";
const user = { id: 987654, username: "Hold QA", email: "hold@example.test", avatar: null,
  fullName: "Fixture User", mobileNumber: "599123456", dateOfBirth: "1990-04-12", age: 36,
  preferredVenue: { id: 3, name: "Fixture Venue" }, profileComplete: true };
const format = { id: 1, slug: "standard", name: "Standard", priceUplift: 0 };
const venue = { ...user.preferredVenue, slug: "fixture-venue", city: "Tbilisi", formats: [format] };
const language = { id: 1, slug: "english", name: "English" };
const movie = { id: 1, slug: "fixture-film", title: "Fixture Film", genres: [], formats: [format],
  runtimeMinutes: 100, posterUrl: null, fromPrice: 19, ageRating: { code: "12+", minAge: 12 } };
const session = { id: 10, date: "2026-10-06", time: "23:00", startsAt: "2026-10-06T23:00:00+04:00",
  timeBand: "evening", price: 19, seatsLeft: 3, isSoldOut: false, movie, venue, format, language,
  hall: { id: 1, name: "A", venue } };
const options = { venues: [venue], genres: [], formats: [format], languages: [language], timeBands: [], sorts: [],
  ageRatings: [movie.ageRating], maxSeatsPerOrder: 3,
  ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
const seat = (id, label, code) => ({ id, label, code, state: "available", isMine: false, aisleAfter: false });
const map = { sessionId: 10, hall: session.hall, sections: [{ name: "Stalls", rows: [
  { label: "A", seats: [seat(3, "3", "A3")] },
  { label: "B", seats: [seat(6, "1", "B1"), seat(10, "5", "B5")] },
] }] };

let server, origin, bareServer, bareOrigin;
before(async () => {
  if (!endpoint) return;
  server = await createServer({
    cacheDir: "node_modules/.cache/kino-profile-qa/vite-real-hold-entry",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "hold-entry-observations", enforce: "pre", transform(code, id) {
      const file = id.replaceAll("\\", "/").split("?")[0];
      if (file.endsWith("/src/app/AppShell.jsx")) {
        return 'import HoldEntryProbe from "/tests/fixtures/holdEntryProbe.jsx";\n' + code
          .replace('<Navbar onOpenAuth={openAuth} />', '<HoldEntryProbe handoffArmed={profileHandoff.current !== null} /><Navbar onOpenAuth={openAuth} />')
          .replace('if (pathname !== ROUTES.profile) navigate(ROUTES.profile);', 'if (pathname !== ROUTES.profile) { window.holdEntryEvents.profileNavigations++; navigate(ROUTES.profile); }');
      }
      if (file.endsWith("/src/booking/holdOperations.js")) {
        return code.replace('deps.profileRequired(freshUser, request.sessionId);', 'window.holdEntryEvents.profileRequired++; deps.profileRequired(freshUser, request.sessionId);');
      }
      if (file.endsWith("/src/booking/bookingRuntime.js")) {
        return code.replace('setContinuation(value) { continuation = value; },',
          'setContinuation(value) { if (value?.kind === "profile") window.holdEntryEvents.profileContinuations++; continuation = value; },');
      }
    } }],
  });
  await server.listen(); origin = server.resolvedUrls.local[0];
  bareServer = await createServer({ cacheDir: "node_modules/.cache/kino-profile-qa/vite-bare-hold-entry", server: { host: "127.0.0.1", port: 0 } });
  await bareServer.listen(); bareOrigin = bareServer.resolvedUrls.local[0];
});
after(async () => { await Promise.all([server?.close(), bareServer?.close()]); });

async function fixture({ bare = false } = {}) {
  const browser = await connectProfileBrowser(endpoint);
  const pageOrigin = bare ? bareOrigin : origin;
  const calls = { me: 0, maps: 0, forbidden: [], exceptions: [] };
  let pausedMe;
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
    { name: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" }, { name: "Access-Control-Allow-Methods", value: "GET,OPTIONS" }];
  const fulfill = (event, body, status = 200) => browser.send("Fetch.fulfillRequest", { requestId: event.requestId,
    responseCode: status, responseHeaders: headers, body: status === 204 ? "" : Buffer.from(JSON.stringify(body)).toString("base64") });
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", async event => {
    const url = new URL(event.request.url), method = event.request.method;
    if (url.origin === new URL(pageOrigin).origin) return browser.send("Fetch.continueRequest", { requestId: event.requestId });
    if (method === "GET" && url.hostname === "fonts.googleapis.com") return fulfill(event, null, 204);
    if (url.hostname === "api.kinoxii.redberryinternship.ge") {
      if (method === "OPTIONS") return fulfill(event, null, 204);
      if (method === "GET" && url.pathname === "/api/me") {
        calls.me++;
        if (calls.me === 1) return fulfill(event, { data: user });
        pausedMe = event; return;
      }
      if (method === "GET" && url.pathname === "/api/filter-options") return fulfill(event, { data: options });
      if (method === "GET" && url.pathname === "/api/sessions") return fulfill(event, {
        data: [{ movie, sessions: [session] }],
        meta: { currentPage: 1, lastPage: 1, perPage: 10, totalMovies: 1, totalSessions: 1, date: session.date },
      });
      if (method === "GET" && url.pathname === "/api/sessions/10") return fulfill(event, { data: session });
      if (method === "GET" && url.pathname === "/api/sessions/10/seats") { calls.maps++; return fulfill(event, { data: map }); }
    }
    // Every unrecognised request, including every real mutation, is blocked.
    calls.forbidden.push({ method, path: url.pathname });
    return browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
  });
  await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('kino-xii.auth.token', 'isolated-test-token');
    window.holdEntryEvents = { posts: 0, postBodies: [], profileRequired: 0, profileContinuations: 0, profileNavigations: 0 };
    Object.defineProperty(window, 'holdEntryObserved', { get() {
      const probe = document.getElementById('hold-entry-probe');
      return probe ? JSON.parse(probe.textContent) : null;
    } });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.pathname === '/api/sessions/10/holds' && init?.method === 'POST') {
        window.holdEntryEvents.posts++;
        window.holdEntryEvents.postBodies.push(JSON.parse(init.body));
        if (window.holdEntryEvents.posts === 1) return new Response(JSON.stringify({ message: ${JSON.stringify(message)} }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
  ` });
  await browser.send("Page.navigate", { url: `${pageOrigin}sessions` });
  await browser.wait(bare ? "document.querySelector('.session-time:not(:disabled)') && document.querySelector('.profile-dropdown__toggle')"
    : "document.querySelector('.session-time:not(:disabled)') && window.holdEntryObserved?.user?.profileComplete === true");
  return { browser, calls,
    snapshot: () => browser.evaluate("JSON.parse(document.getElementById('hold-entry-probe').textContent)"),
    events: () => browser.evaluate("window.holdEntryEvents"),
    async resolveMe(next) {
      const deadline = Date.now() + 10000;
      while (!pausedMe && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(pausedMe, "The guarded post-422 /me must be pending");
      await fulfill(pausedMe, { data: next }); pausedMe = null;
    },
    async close() {
      try { assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.exceptions, []); }
      finally { await browser.close(); }
    },
  };
}

async function click(browser, selector) {
  const point = await browser.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
const settle = browser => browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))))");
async function submit(h) {
  await click(h.browser, ".session-time:not(:disabled)");
  await h.browser.wait("document.querySelector('dialog[open]') && [3, 6, 10].every(id => document.getElementById('booking-seat-' + id) && !document.getElementById('booking-seat-' + id).disabled)");
  for (const id of [3, 6, 10]) await click(h.browser, "#booking-seat-" + id);
  await h.browser.wait("window.holdEntryObserved.canNext");
  const before = await h.snapshot();
  await click(h.browser, ".seat-summary__checkout .button");
  await h.browser.wait("window.holdEntryEvents.posts === 1 && document.getElementById('booking-selection-status')?.textContent === 'Booking is currently unavailable.'");
  return before;
}

rendered("real Sessions entry: message-only HOLD 422 plus complete /me never arms Profile remediation", async () => {
  const h = await fixture();
  try {
    const before = await submit(h);
    const fresh = { ...user, fullName: "Fresh Fixture User" };
    await h.resolveMe(fresh);
    await h.browser.wait("window.holdEntryObserved.user?.fullName === 'Fresh Fixture User' && (location.pathname === '/profile' || window.holdEntryObserved.booking.seatMapRead.attempt > " + before.booking.seatMapRead.attempt + ")");
    for (let pass = 0; pass < 3; pass++) {
      await settle(h.browser);
      const after = await h.snapshot(), events = await h.events();
      assert.equal(after.pathname, "/sessions");
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('dialog[open]'))"), true);
      assert.equal(after.booking.instanceId, before.booking.instanceId);
      assert.equal(after.booking.step, "seats");
      assert.deepEqual(after.booking.selection, before.booking.selection);
      assert.equal(after.booking.feedback, message);
      assert.equal(await h.browser.evaluate("document.getElementById('booking-selection-status')?.textContent"), message);
      assert.deepEqual(after.user, fresh); assert.deepEqual(after.canonicalUser, fresh);
      assert.equal(after.pendingAction, null); assert.equal(after.bookingReadyAction, null);
      assert.equal(after.profileContinuation, null); assert.equal(after.profileAccessContinuation, null);
      assert.equal(after.handoffArmed, false);
      assert.equal(events.profileRequired, 0); assert.equal(events.profileContinuations, 0); assert.equal(events.profileNavigations, 0);
      assert.equal(events.posts, 1);
    }
    assert.deepEqual((await h.events()).postBodies, [{ seats: [{ seatId: 3, ticketType: "adult" }, { seatId: 6, ticketType: "adult" }, { seatId: 10, ticketType: "adult" }] }]);
    assert.equal(h.calls.me, 2);
  } finally { await h.close(); }
});

rendered("real Sessions entry: message-only HOLD 422 plus incomplete /me enters Profile without replay", async () => {
  const h = await fixture();
  try {
    await submit(h);
    const fresh = { ...user, profileComplete: false };
    await h.resolveMe(fresh);
    await h.browser.wait("location.pathname === '/profile' && document.querySelector('.profile-page__status')?.textContent === 'Profile incomplete'");
    await settle(h.browser);
    const after = await h.snapshot(), events = await h.events();
    assert.deepEqual(after.user, fresh); assert.deepEqual(after.canonicalUser, fresh);
    assert.equal(after.profileContinuation, message);
    assert.equal(after.pendingAction?.payload.sessionId, session.id); assert.equal(after.handoffArmed, true);
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-page__banner [role=alert]')?.textContent"), message);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('dialog[open]'))"), false);
    assert.equal(events.posts, 1); assert.equal(events.profileRequired, 1); assert.equal(events.profileContinuations, 1); assert.equal(events.profileNavigations, 1);
    assert.equal(h.calls.me, 2);
  } finally { await h.close(); }
});

rendered("unmodified production app: synthetic HOLD 422 and asynchronously resolved complete /me preserve Seats", async () => {
  // No JSX substitutions, context probes, or source instrumentation: mount
  // src/main.jsx exactly as production does and activate actual UI controls.
  const h = await fixture({ bare: true });
  try {
    await click(h.browser, ".profile-dropdown__toggle");
    await h.browser.wait("document.querySelector('.profile-dropdown__status-title')?.textContent === 'Profile Complete'");
    const completeIconSrc = await h.browser.evaluate("document.querySelector('.navbar .avatar__status')?.getAttribute('src')");
    await click(h.browser, ".profile-dropdown__toggle");
    await click(h.browser, ".session-time:not(:disabled)");
    await h.browser.wait("document.querySelector('dialog[open]') && [3, 6, 10].every(id => document.getElementById('booking-seat-' + id) && !document.getElementById('booking-seat-' + id).disabled)");
    for (const id of [3, 6, 10]) await click(h.browser, "#booking-seat-" + id);
    await h.browser.wait("!document.querySelector('.seat-summary__checkout .button').disabled");
    await click(h.browser, ".seat-summary__checkout .button");
    await h.browser.wait("window.holdEntryEvents.posts === 1 && document.getElementById('booking-selection-status')?.textContent === 'Booking is currently unavailable.'");
    await h.resolveMe({ ...user, fullName: "Fresh Fixture User" });
    const deadline = Date.now() + 10000;
    while (h.calls.maps < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.calls.maps, 2);
    await h.browser.wait("location.pathname === '/profile' || (document.querySelector('.seat-summary__checkout .button') && !document.querySelector('.seat-summary__checkout .button').disabled)");
    for (let pass = 0; pass < 3; pass++) {
      await settle(h.browser);
      const state = await h.browser.evaluate(`({
        pathname: location.pathname, open: Boolean(document.querySelector('dialog[open]')),
        step: document.querySelector('.seat-selection__progress [aria-current=step]')?.textContent,
        feedback: document.getElementById('booking-selection-status')?.textContent,
        selection: [3, 6, 10].map(id => document.getElementById('booking-seat-' + id)?.getAttribute('aria-pressed')),
        completeIcon: document.querySelector('.navbar .avatar__status')?.getAttribute('src') === ${JSON.stringify(completeIconSrc)},
        profileBanner: Boolean(document.querySelector('.profile-page__banner')),
        posts: window.holdEntryEvents.posts,
      })`);
      assert.deepEqual(state, { pathname: "/sessions", open: true, step: "SEATS", feedback: message,
        selection: ["true", "true", "true"], completeIcon: true, profileBanner: false, posts: 1 });
    }
    assert.equal(h.calls.me, 2);
  } finally { await h.close(); }
});
