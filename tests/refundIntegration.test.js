import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const user = (id = 12) => ({ id, username: "Fixture", email: "fixture@example.test",
  profileComplete: true, fullName: "Fixture Buyer", mobileNumber: "599123456",
  dateOfBirth: "1990-04-12", age: 36, preferredVenue: null });
const order = (reference = "REFUND-A") => ({ id: 7, reference, status: "paid", isUpcoming: true,
  isRefundable: true, totalPrice: 19, session: { id: 10, date: "2026-10-08", time: "21:45",
    movie: { title: "Fixture Film", posterUrl: null, ageRating: { minAge: 12 } },
    venue: { name: "Fixture Venue" }, hall: { name: "B" }, format: { name: "2D" }, language: { name: "Georgian" } },
  tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 19 }] });
const refunded = (reference = "REFUND-A") => ({ ...order(reference), status: "refunded",
  isUpcoming: false, isRefundable: false, totalPrice: 17.25 });
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [],
  ageRatings: [], maxSeatsPerOrder: 3, ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
let server, origin;
before(async () => {
  if (!endpoint) return;
  server = await createServer({ cacheDir: "node_modules/.cache/kino-refund-integration",
    server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "refund-fixture",
      transformIndexHtml: { order: "pre", handler: html => html.replace("/src/main.jsx", "/tests/fixtures/refundHarness.jsx") } }] });
  await server.listen(); origin = server.resolvedUrls.local[0];
});
after(async () => { await server?.close(); });

async function fixture({ guest = false, stale = false, pauseTickets = false, pauseMe = false, ignoreTicketAbort = false } = {}) {
  const browser = await connectProfileBrowser(endpoint);
  const calls = { refunds: 0, tickets: 0, me: 0, logouts: 0, deletes: 0, forbidden: [], exceptions: [] };
  let freshUser = user(), data = [order()], refundRequest, meRequest, loginRequest;
  let loginStatus = 200, pauseLogin = false;
  let ticketStatus = 200;
  const chronology = [], ticketCredentials = [], refundCredentials = [];
  const reads = [], handlerErrors = [], pendingHandlers = new Set();
  let closing = false;
  // Chrome removes interceptions when the application aborts a request.
  // Catch only this exact protocol condition, only around interception commands.
  const interception = async (method, params) => {
    try { return await browser.send(method, params); }
    catch (error) {
      if (error?.name !== "Error" || !/^Invalid InterceptionId[.]?$/.test(error.message)) throw error;
      return error; // finish() additionally checks that POST ownership was retired.
    }
  };
  const cleanup = async () => {
    if (closing) return;
    closing = true; // Stop new handler work while interception stays enabled.
    try {
      await Promise.all([...pendingHandlers]);
      await browser.close(); // Closing the target cancels deferred traffic/timers.
    } finally {
      reads.length = 0;
      refundRequest = null;
      meRequest = null;
    }
  };
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
    { name: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,DELETE,OPTIONS" }];
  const fulfill = (event, body, status = 200) => interception("Fetch.fulfillRequest", { requestId: event.requestId,
    responseCode: status, responseHeaders: headers, body: status === 204 ? "" : Buffer.from(JSON.stringify(body)).toString("base64") });
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  const handleRequest = async event => {
    const url = new URL(event.request.url), method = event.request.method;
    if (url.origin === new URL(origin).origin) return interception("Fetch.continueRequest", { requestId: event.requestId });
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return fulfill(event, null, 204);
    if (url.hostname === "api.kinoxii.redberryinternship.ge") {
      if (method === "OPTIONS") return fulfill(event, null, 204);
      if (method === "GET" && url.pathname === "/api/filter-options") return fulfill(event, { data: filters });
      if (method === "GET" && url.pathname === "/api/me") {
        calls.me++;
        if (pauseMe) { meRequest = event; return; }
        return fulfill(event, stale ? { message: "Unauthenticated" } : { data: freshUser }, stale ? 401 : 200);
      }
      if (method === "POST" && ["/api/login", "/api/register"].includes(url.pathname)) {
        chronology.push("login");
        if (pauseLogin) { loginRequest = event; return; }
        if (loginStatus !== 200) return fulfill(event, { message: "Invalid synthetic credentials" }, loginStatus);
        stale = false;
        return fulfill(event, { data: { user: freshUser, token: "synthetic-session-" + freshUser.id } }, url.pathname.endsWith("register") ? 201 : 200);
      }
      if (method === "POST" && url.pathname === "/api/logout") { calls.logouts++; return fulfill(event, null, 204); }
      if (method === "GET" && url.pathname === "/api/tickets") {
        assert.equal(url.search, "");
        calls.tickets++; chronology.push("tickets");
        ticketCredentials.push(new Headers(event.request.headers).get("Authorization"));
        if (pauseTickets) { reads.push(event); return; }
        return fulfill(event, ticketStatus === 200 ? { data } : { message: "Synthetic tickets refusal" }, ticketStatus);
      }
      if (method === "POST" && /^[/]api[/]orders[/][^/]+[/]refund$/.test(url.pathname)) {
        calls.refunds++; chronology.push("refund"); refundCredentials.push(new Headers(event.request.headers).get("Authorization"));
        refundRequest = event; return;
      }
      if (method === "GET" && url.pathname === "/api/sessions/10") return fulfill(event, { data: { ...order().session, price: 19 } });
      if (method === "GET" && url.pathname === "/api/sessions/10/seats") return fulfill(event, { data: {
        sessionId: 10, hall: { id: 1 }, sections: [{ name: "Stalls", rows: [{ label: "A",
          seats: [{ id: 1, label: "1", code: "A1", state: "available", isMine: false, aisleAfter: false }] }] }] } });
      if (method === "POST" && url.pathname === "/api/sessions/10/holds") return fulfill(event, { data: {
        holdId: "11111111-2222-3333-4444-555555555555", sessionId: 10, isLive: true,
        expiresAt: new Date(Date.now() + 480000).toISOString(), subtotal: 19,
        seats: [{ seatId: 1, code: "A1", price: 19, ticketType: { slug: "adult", name: "Adult" } }] } }, 201);
      if (method === "DELETE" && url.pathname === "/api/holds/11111111-2222-3333-4444-555555555555") {
        calls.deletes++; return fulfill(event, null, 204);
      }
    }
    calls.forbidden.push({ method, path: url.pathname });
    return interception("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
  };
  browser.on("Fetch.requestPaused", event => {
    if (closing) return; // Paused requests stay blocked until their target closes.
    const task = Promise.resolve().then(() => handleRequest(event))
      .catch(error => { handlerErrors.push(error); })
      .finally(() => pendingHandlers.delete(task));
    pendingHandlers.add(task); // The shared dispatcher does not await callbacks.
  });
  try {
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source:
      "localStorage.clear();sessionStorage.clear();window.refundQaClock=0;Object.defineProperty(performance,'now',{value:()=>window.refundQaClock});" +
      (ignoreTicketAbort ? "const nativeFetch=window.fetch;window.fetch=(url,options)=>nativeFetch(url,String(url).includes('/api/tickets')?{...options,signal:undefined}:options);" : "") +
      (guest ? "" : "localStorage.setItem('kino-xii.auth.token','synthetic-restored-session');") });
    await browser.send("Page.navigate", { url: origin + "profile?tab=tickets&filter=upcoming&keep=1" });
    if (pauseMe) await browser.wait("document.body");
    else await browser.wait("window.refundQa");
  } catch (error) {
    await cleanup();
    if (handlerErrors.length) throw new AggregateError([error, ...handlerErrors], "Fixture initialization failed.", { cause: error });
    throw error;
  }
  const waitCalls = async predicate => {
    const deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate(), "Expected intercepted request");
  };
  return { browser, calls, reads, chronology, ticketCredentials, refundCredentials,
    waitCalls, setLoginStatus(value) { loginStatus = value; },
    setPauseLogin(value) { pauseLogin = value; },
    async start(value = order()) {
      const expected = calls.refunds + 1;
      refundRequest = null;
      const accepted = await browser.evaluate("window.refundQa.start(" + JSON.stringify(value) + ")");
      assert.equal(accepted, true); await waitCalls(() => calls.refunds === expected && Boolean(refundRequest));
    },
    setPause(value) { pauseTickets = value; }, setData(value) { data = value; },
    setTicketStatus(value) { ticketStatus = value; },
    setUser(value) { freshUser = value; },
    async login(value = user()) {
      freshUser = value;
      await browser.evaluate("window.refundQa.login({email:'fixture@example.test',password:'fixture-password'})");
      await browser.wait("window.refundQa.identity()?.accountId === " + value.id);
    },
    async modalLogin(value = user()) {
      freshUser = value;
      await browser.wait("document.querySelector('.auth-modal--login form')");
      await browser.evaluate("(() => { const form=document.querySelector('.auth-modal form'); for(const [name,value] of Object.entries({email:'fixture@example.test',password:'fixture-password'})) { const input=form.elements.namedItem(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); } })()");
      await browser.evaluate("document.querySelector('.auth-modal form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    },
    async resolveLogin(value = freshUser, status = 200) {
      await waitCalls(() => Boolean(loginRequest)); pauseLogin = false;
      await fulfill(loginRequest, status === 200 ? { data: { user: value, token: "synthetic-new-login" } } : { message: "Invalid synthetic credentials" }, status);
    },
    async failRefund() {
      assert.ok(refundRequest);
      await interception("Fetch.failRequest", { requestId: refundRequest.requestId, errorReason: "Failed" });
      await browser.wait("!window.refundQa.busy()");
    },
    async finish(body = refunded(), status = 200) {
      assert.ok(refundRequest);
      const invalidated = await fulfill(refundRequest, status === 200 ? { data: body } : { message: "Synthetic refusal" }, status);
      if (invalidated instanceof Error && await browser.evaluate("window.refundQa.busy()")) throw invalidated;
      await browser.wait("!window.refundQa.busy()");
    },
    async read(index, value = data, status = 200) {
      await waitCalls(() => Boolean(reads[index]));
      await fulfill(reads[index], status === 200 ? { data: value } : { message: "Synthetic read failure" }, status);
    },
    async me(value, status = 200) {
      await waitCalls(() => Boolean(meRequest)); pauseMe = false;
      await fulfill(meRequest, status === 200 ? { data: value } : { message: "Expired" }, status);
    },
    async expire() { await browser.evaluate("window.refundQaClock=30000;window.refundQa.deadline()"); },
    async settle() { await browser.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,0))))"); },
    async close() {
      await cleanup();
      if (handlerErrors.length) throw new AggregateError(handlerErrors, "Fixture interception failed.");
      assert.deepEqual(calls.forbidden, []);
      assert.deepEqual(calls.exceptions, []);
    },
  };
}

rendered("AppShell owns one dormant runtime through StrictMode, filters, consumers and Tickets remounts", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.browser.evaluate("window.refundQa.mount(false)"); await h.settle();
    await h.browser.evaluate("window.refundQa.mount(true)");
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past&keep=1')");
    await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQaReplacements"), 0);
    assert.equal(h.calls.refunds, 0);
    assert.equal(await h.browser.evaluate("location.search.includes('keep=1')"), true);
    assert.doesNotMatch(await h.browser.evaluate("document.body.innerText"), /Confirm refund|Refund order/);
  } finally { await h.close(); }
});

rendered("stored-token restoration, fresh me, same-account relogin, logout and signup distinguish sessions", async () => {
  const h = await fixture();
  try {
    const first = await h.browser.evaluate("window.refundQa.identity()");
    await h.browser.evaluate("window.refundQa.restore()"); await h.settle();
    assert.deepEqual(await h.browser.evaluate("window.refundQa.identity()"), first);
    await h.browser.evaluate("window.refundQa.logout()");
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    await h.login();
    const second = await h.browser.evaluate("window.refundQa.identity()");
    assert.ok(second.generation > first.generation);
    await h.browser.evaluate("window.refundQa.logout()");
    h.setUser(user(99));
    await h.browser.evaluate("window.refundQa.register({username:'Fixture',email:'fixture@example.test',password:'fixture-password',password_confirmation:'fixture-password'})");
    await h.browser.wait("window.refundQa.identity()?.accountId === 99");
    assert.ok((await h.browser.evaluate("window.refundQa.identity()")).generation > second.generation);
    assert.equal(h.calls.refunds, 0);
    assert.equal(h.calls.logouts, 2);
  } finally { await h.close(); }
});

rendered("initial guest and stale stored-token restoration never dispatch Refund", async () => {
  for (const options of [{ guest: true }, { stale: true }]) {
    const h = await fixture(options);
    try {
      assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
      assert.equal(await h.browser.evaluate("localStorage.getItem('kino-xii.auth.token')"), null);
      assert.equal(h.calls.me, options.guest ? 0 : 1);
      assert.equal(h.calls.refunds, 0);
    } finally { await h.close(); }
  }
});

rendered("complete returned Order replaces the exact card and stale during-POST reads cannot overwrite it", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    h.setPause(true);
    await h.start(); await h.settle(); await h.finish();
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past')");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    for (let index = 0; index < h.reads.length; index++) await h.read(index, [order()]);
    await h.settle();
    assert.match(await h.browser.evaluate("document.querySelector('.my-tickets').innerText"), /17.25/);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), true);
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("partial reported success refetches facts, rejects contradictory paid data and preserves Retry", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    h.setPause(true); await h.start();
    await h.finish({ reference: "REFUND-A", status: "refunded" });
    await h.settle();
    await h.read(h.reads.length - 1, [order()]);
    await h.browser.wait("document.querySelector('.my-tickets__error')");
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 0);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].phase"), "succeeded");
    h.setPause(false); h.setData([refunded()]);
    await h.browser.evaluate("document.querySelector('.my-tickets__error button').click()");
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past')");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("timeout retires A while B's live GET completes without restart or cross-account auth effects", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.start(); h.setPause(true);
    await h.login(user(99)); await h.settle();
    const count = h.calls.tickets, index = h.reads.length - 1;
    await h.expire(); await h.settle();
    assert.equal(h.calls.tickets, count);
    await h.read(index, [order("B-ONLY")]);
    await h.browser.wait("document.querySelector('.my-tickets__order')?.textContent.includes('B-ONLY')");
    await h.finish(null, 401); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.identity().accountId"), 99);
    assert.deepEqual(await h.browser.evaluate("window.refundQa.snapshot().records"), []);
    assert.equal(h.calls.refunds, 1);
    h.setPause(false); h.setData([order()]);
    await h.login(user());
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].phase"), "uncertain");
  } finally { await h.close(); }
});

rendered("genuine generation invalidation restarts once and replacement failure exposes read Retry", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    h.setPause(true); await h.start(); await h.settle();
    const before = h.calls.tickets;
    await h.expire(); await h.settle();
    assert.equal(h.calls.tickets, before + 1);
    await h.read(h.reads.length - 1, [], 500);
    await h.browser.wait("document.querySelector('.my-tickets__error')");
    const count = h.calls.tickets;
    await h.browser.evaluate("window.refundQa.deadline();window.refundQa.deadline()"); await h.settle();
    assert.equal(h.calls.tickets, count);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].phase"), "uncertain");
    h.setPause(false); h.setData([order()]);
    await h.browser.evaluate("document.querySelector('.my-tickets__error button').click()");
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    assert.equal(h.calls.refunds, 1);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), false);
  } finally { await h.close(); }
});

rendered("semantic Tickets departure revokes consent but subgroup navigation and pending remount preserve ownership", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.browser.evaluate("window.refundQa.confirm(" + JSON.stringify(order()) + ")");
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past&keep=1')"); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().phase"), "confirming");
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=personal')"); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().confirmation"), null);
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets')");
    await h.start();
    await h.browser.evaluate("window.refundQa.mount(false);window.refundQa.cancel()"); await h.settle();
    await h.browser.evaluate("window.refundQa.mount(true)");
    assert.equal(await h.browser.evaluate("window.refundQa.busy()"), true);
    await h.browser.evaluate("window.refundQa.navigate('/sessions')"); await h.settle();
    await h.finish(null, 401);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("current definite Refund 401 opens Login and preserves intent without a premature replay", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.start(); await h.settle(); const before = h.calls.tickets;
    await h.finish(null, 401); await h.settle();
    assert.equal(h.calls.tickets, before);
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records.length"), 0);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.auth-modal--login').length"), 1);
    assert.equal(await h.browser.evaluate("localStorage.getItem('kino-xii.auth.token')"), null);
    assert.equal(h.calls.logouts, 0); assert.equal(h.calls.refunds, 1);
    // Direct auth state observation is insufficient to authorize continuation.
    await h.login(); await h.settle();
    assert.equal(h.calls.refunds, 1);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation.replayCount"), 0);
  } finally { await h.close(); }
});

rendered("booking Hold logout cleanup and Refund pending ownership both survive the auth observer bridge", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.start();
    await h.browser.evaluate("window.refundQa.bookingOpen(10)");
    await h.browser.wait("document.querySelector('dialog.seat-selection')");
    await h.browser.wait("JSON.parse(document.getElementById('slice2-auth').textContent).booking.seatMapRead.status === 'ready'");
    await h.browser.evaluate("window.refundQa.bookingSeat(1)");
    await h.browser.evaluate("window.refundQa.bookingNext()");
    await h.browser.wait("JSON.parse(document.getElementById('slice2-auth').textContent).booking.step === 'checkout'");
    await h.browser.evaluate("window.refundQa.logout()");
    await h.settle();
    assert.equal(h.calls.deletes, 1);
    assert.equal(h.calls.logouts, 1);
    assert.equal(await h.browser.evaluate("window.refundQa.busy()"), true);
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    await h.expire(); assert.equal(await h.browser.evaluate("window.refundQa.busy()"), false);
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("non-aborting stale GETs before dispatch and during POST cannot affect final data or auth", async () => {
  const h = await fixture({ pauseTickets: true, ignoreTicketAbort: true });
  try {
    await h.settle();
    const before = h.reads.length;
    assert.ok(before > 0);
    await h.start(); await h.settle();
    const during = h.reads.length;
    assert.ok(during > before);
    await h.finish(); await h.settle();
    const fresh = h.reads.length - 1;
    assert.ok(fresh >= during);
    for (let index = 0; index < fresh; index++) await h.read(index, [order()], index % 2 ? 401 : 200);
    await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.identity().accountId"), 12);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 0);
    await h.read(fresh, [refunded()]);
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past')");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("non-aborting old-account GET 401 cannot expire B and completion cannot expose A's cards", async () => {
  const h = await fixture({ pauseTickets: true, ignoreTicketAbort: true });
  try {
    await h.settle();
    const aReads = h.reads.length;
    await h.login(user(99)); await h.settle();
    const bRead = h.reads.length - 1;
    for (let index = 0; index < aReads; index++) await h.read(index, [order()], index % 2 ? 200 : 401);
    await h.read(bRead, [order("B-ONLY")]);
    await h.browser.wait("document.querySelector('.my-tickets__order')?.textContent.includes('B-ONLY')");
    assert.equal(await h.browser.evaluate("window.refundQa.identity().accountId"), 99);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(h.calls.refunds, 0);
  } finally { await h.close(); }
});

rendered("malformed success and HTTP 500 preserve uncertainty while fresh GET supplies factual paid cards", async () => {
  for (const response of [{ body: { reference: "WRONG", status: "refunded" }, status: 200 },
    { body: null, status: 500 }]) {
    const h = await fixture();
    try {
      await h.browser.wait("document.querySelector('.my-tickets__order')");
      await h.start(); await h.finish(response.body, response.status);
      await h.browser.wait("document.querySelector('.my-tickets__status--paid')");
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].phase"), "uncertain");
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), false);
      assert.equal(h.calls.refunds, 1);
    } finally { await h.close(); }
  }
});

async function begin401(h) {
  await h.browser.wait("document.querySelector('.my-tickets__order')");
  await h.start(); await h.finish(null, 401);
  await h.browser.wait("document.querySelector('.auth-modal--login')");
  assert.equal(h.calls.refunds, 1);
}

rendered("same-account real Login starts new unfiltered verification and exactly one replay with a new deadline", async () => {
  const h = await fixture();
  try {
    const original = await h.browser.evaluate("window.refundQa.identity()");
    await begin401(h); h.setPause(true); const reads = h.reads.length;
    await h.browser.evaluate("window.refundQaClock=100000");
    h.setPauseLogin(true); await h.modalLogin(); await h.settle();
    assert.equal(h.reads.length, reads); assert.equal(h.calls.refunds, 1);
    await h.resolveLogin();
    await h.browser.wait("window.refundQa.snapshot().phase === 'verifying'");
    await h.waitCalls(() => h.reads.length > reads);
    assert.ok((await h.browser.evaluate("window.refundQa.identity()")).generation > original.generation);
    assert.equal(h.calls.refunds, 1);
    assert.deepEqual(h.chronology.slice(-2), ["login", "tickets"]);
    assert.equal(h.ticketCredentials.at(-1), "Bearer synthetic-new-login");
    await h.read(reads, [order()]); await h.waitCalls(() => h.calls.refunds === 2);
    assert.equal(h.refundCredentials.at(-1), "Bearer synthetic-new-login");
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].replayCount"), 1);
    await h.browser.evaluate("window.refundQa.resume(1);window.refundQa.resume(1);window.refundQa.mount(false);window.refundQa.mount(true)");
    await h.settle(); assert.equal(h.calls.refunds, 2);
    await h.browser.evaluate("window.refundQaClock=129999;window.refundQa.deadline()");
    assert.equal(await h.browser.evaluate("window.refundQa.busy()"), true);
    h.setPause(false); h.setData([refunded()]); await h.finish(); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().phase"), "succeeded");
    assert.equal(await h.browser.evaluate("window.refundQaReplacements"), 0);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
  } finally { await h.close(); }
});

rendered("second Refund POST 401 ends continuation and Profile guest gate cannot reopen Login", async () => {
  const h = await fixture();
  try {
    await begin401(h); await h.modalLogin(); await h.waitCalls(() => h.calls.refunds === 2);
    await h.finish(null, 401); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    for (let i = 0; i < 3; i++) {
      await h.browser.evaluate("window.refundQa.mount(false)"); await h.settle();
      await h.browser.evaluate("window.refundQa.mount(true);window.refundQa.navigate('/profile?tab=tickets&filter=past')"); await h.settle();
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    }
    assert.equal(h.calls.refunds, 2); assert.equal(h.calls.logouts, 0);
    await h.login(); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().phase"), "blocked");
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
    assert.equal(h.calls.refunds, 2);
  } finally { await h.close(); }
});

rendered("failed real Login attempts and Login/Signup switching preserve only unused Refund intent", async () => {
  const h = await fixture();
  try {
    await begin401(h);
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    await h.browser.wait("document.querySelector('.auth-modal--signup')");
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    h.setLoginStatus(401);
    for (let i = 0; i < 2; i++) {
      await h.modalLogin(); await h.settle();
      assert.match(await h.browser.evaluate("document.querySelector('.auth-modal').innerText"), /Invalid synthetic credentials/);
      assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal [name=email]').value"), "fixture@example.test");
      assert.equal(h.calls.refunds, 1);
    }
    h.setLoginStatus(200); await h.modalLogin(); await h.waitCalls(() => h.calls.refunds === 2);
    h.setData([refunded()]); await h.finish();
    assert.equal(h.calls.refunds, 2);
  } finally { await h.close(); }
});

rendered("Refund reauth honors incomplete server Profile without adding booking's completion gate", async () => {
  const h = await fixture();
  try {
    await begin401(h);
    await h.modalLogin({ ...user(), profileComplete: false, fullName: null, mobileNumber: null, dateOfBirth: null });
    await h.waitCalls(() => h.calls.refunds === 2);
    assert.equal(await h.browser.evaluate("window.refundQa.user().profileComplete"), false);
    assert.equal(await h.browser.evaluate("location.search.includes('tab=tickets')"), true);
    assert.equal(h.calls.deletes, 0);
    h.setData([refunded()]); await h.finish();
  } finally { await h.close(); }
});

rendered("different-account real Login cancels Refund and exposes only the new account's Tickets", async () => {
  const h = await fixture();
  try {
    await begin401(h); h.setData([order("B-ONLY")]); await h.modalLogin(user(99));
    await h.browser.wait("window.refundQa.identity()?.accountId === 99");
    await h.browser.wait("document.querySelector('.my-tickets__order')?.textContent.includes('B-ONLY')");
    assert.equal(h.calls.refunds, 1); assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.deepEqual(await h.browser.evaluate("window.refundQa.snapshot().records"), []);
    await h.login(); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
  } finally { await h.close(); }
});

for (const [name, data] of [
  ["refunded", [refunded()]], ["Past paid", [{ ...order(), isUpcoming: false, isRefundable: false }]],
  ["non-refundable", [{ ...order(), isRefundable: false }]], ["missing reference", []],
  ["duplicate reference", [order(), order()]], ["Order ID mismatch", [{ ...order(), id: 999 }]],
  ["session ID mismatch", [{ ...order(), session: { ...order().session, id: 999 } }]],
  ["incomplete Order", [{ ...order(), tickets: [] }]], ["missing flag", [{ ...order(), isRefundable: undefined }]],
]) rendered("real Login verification of " + name + " never replays", async () => {
  const h = await fixture();
  try {
    await begin401(h); h.setData(data); await h.modalLogin();
    await h.browser.wait("window.refundQa.identity()?.accountId === 12 && ['succeeded','blocked'].includes(window.refundQa.snapshot().phase)");
    await h.settle(); assert.equal(h.calls.refunds, 1);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
  } finally { await h.close(); }
});

for (const status of [500, 401]) rendered("real Login verification GET " + status + " has bounded purpose-specific recovery", async () => {
  const h = await fixture();
  try {
    await begin401(h); h.setPause(true); const index = h.reads.length;
    await h.modalLogin(); await h.waitCalls(() => h.reads.length > index);
    await h.read(index, [], status); await h.settle();
    assert.equal(h.calls.refunds, 1);
    if (status === 401) {
      assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
      await h.browser.evaluate("window.refundQa.mount(false)"); await h.settle();
      await h.browser.evaluate("window.refundQa.mount(true)"); await h.settle();
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
      await h.login(); await h.settle(); await h.browser.evaluate("window.refundQa.verify()");
      assert.equal(h.calls.refunds, 1);
    } else {
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().phase"), "verification_retry");
      const count = h.calls.tickets;
      await h.browser.evaluate("window.refundQa.mount(false)"); await h.settle();
      await h.browser.evaluate("window.refundQa.mount(true)"); await h.settle();
      assert.equal(h.calls.tickets, count); assert.equal(h.calls.refunds, 1);
      h.setPause(false);
      await h.browser.evaluate("void window.refundQa.verify();void window.refundQa.verify()");
      await h.waitCalls(() => h.calls.refunds === 2); h.setData([refunded()]); await h.finish();
      assert.equal(h.calls.refunds, 2);
    }
  } finally { await h.close(); }
});

for (const cancellation of ["Close", "Escape", "logout", "Personal Information", "away"]) rendered(cancellation + " revokes Refund auth intent and old pending login cannot replay", async () => {
  const h = await fixture();
  try {
    await begin401(h);
    if (cancellation !== "logout") { h.setPauseLogin(true); await h.modalLogin(); await h.settle(); }
    if (cancellation === "Close") await h.browser.evaluate("document.querySelector('[aria-label=\"Close authentication dialog\"]').click()");
    if (cancellation === "Escape") await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    if (cancellation === "logout") await h.browser.evaluate("void window.refundQa.logout()");
    if (cancellation === "Personal Information") await h.browser.evaluate("window.refundQa.navigate('/profile')");
    if (cancellation === "away") await h.browser.evaluate("window.refundQa.navigate('/sessions')");
    await h.settle();
    if (cancellation === "logout") await h.login(); else await h.resolveLogin();
    await h.settle();
    assert.equal(h.calls.refunds, 1);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets')"); await h.settle();
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

for (const cancellation of ["account", "navigation", "logout"]) rendered(cancellation + " during non-aborting fresh verification blocks stale GET 401 and replay", async () => {
  const h = await fixture({ ignoreTicketAbort: true });
  try {
    await begin401(h); h.setPause(true); const index = h.reads.length;
    await h.modalLogin(); await h.waitCalls(() => h.reads.length > index);
    if (cancellation === "account") await h.login(user(99));
    if (cancellation === "navigation") await h.browser.evaluate("window.refundQa.navigate('/sessions')");
    if (cancellation === "logout") await h.browser.evaluate("window.refundQa.logout()");
    await h.settle(); const account = await h.browser.evaluate("window.refundQa.identity()");
    await h.read(index, [], 401); await h.settle();
    assert.deepEqual(await h.browser.evaluate("window.refundQa.identity()"), account);
    assert.equal(h.calls.refunds, 1);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
  } finally { await h.close(); }
});

rendered("Upcoming/Past, browser history and consumer remount preserve only the authorized auth continuation", async () => {
  const h = await fixture();
  try {
    await begin401(h);
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past&keep=1')"); await h.settle();
    await h.browser.evaluate("history.back()"); await h.settle();
    await h.browser.evaluate("history.forward()"); await h.settle();
    await h.browser.evaluate("window.refundQa.mount(false)"); await h.settle();
    await h.browser.evaluate("window.refundQa.mount(true)"); await h.settle();
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.auth-modal--login').length"), 1);
    await h.modalLogin(); await h.waitCalls(() => h.calls.refunds === 2);
    h.setData([refunded()]); await h.finish();
    assert.equal(h.calls.refunds, 2); assert.equal(await h.browser.evaluate("location.search.includes('keep=1')"), true);
  } finally { await h.close(); }
});

rendered("network Refund failure and timeout/late 401 cannot authorize Login or replay", async () => {
  for (const deadline of [false, true]) {
    const h = await fixture();
    try {
      await h.browser.wait("document.querySelector('.my-tickets__order')"); await h.start();
      if (deadline) { await h.expire(); await h.finish(null, 401); } else await h.failRefund();
      await h.settle(); assert.equal(h.calls.refunds, 1);
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().phase"), "uncertain");
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
      await h.login(); await h.settle(); assert.equal(h.calls.refunds, 1);
    } finally { await h.close(); }
  }
});


rendered("successful Signup remains account-bound across the retained Refund authentication flow", async () => {
  for (const id of [12, 99]) {
    const h = await fixture();
    try {
      await begin401(h); h.setUser({ ...user(id), profileComplete: false });
      await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
      await h.browser.wait("document.querySelector('.auth-modal--signup form')");
      await h.browser.evaluate("(() => { const form=document.querySelector('.auth-modal form'); for(const [name,value] of Object.entries({username:'Fixture',email:'fixture@example.test',password:'fixture-password',password_confirmation:'fixture-password'})) { const input=form.elements.namedItem(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); } })()");
      await h.browser.evaluate("document.querySelector('.auth-modal form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
      await h.browser.wait("window.refundQa.identity()?.accountId === " + id);
      if (id === 12) { await h.waitCalls(() => h.calls.refunds === 2); h.setData([refunded()]); await h.finish(); }
      await h.settle(); assert.equal(h.calls.refunds, id === 12 ? 2 : 1);
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
      assert.equal(await h.browser.evaluate("window.refundQa.user().profileComplete"), false);
    } finally { await h.close(); }
  }
});

rendered("stale Refund 401 from A preserves B's login and never opens a Refund auth flow", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')"); await h.start();
    h.setData([order("B-ONLY")]); await h.login(user(99));
    const identity = await h.browser.evaluate("window.refundQa.identity()");
    await h.finish(null, 401); await h.settle();
    assert.deepEqual(await h.browser.evaluate("window.refundQa.identity()"), identity);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(h.calls.refunds, 1); assert.equal(h.calls.logouts, 0);
  } finally { await h.close(); }
});

rendered("closing Signup and clicking auth backdrop revoke the retained Refund intent", async () => {
  for (const signup of [false, true]) {
    const h = await fixture();
    try {
      await begin401(h);
      if (signup) {
        await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
        await h.browser.evaluate("document.querySelector('[aria-label=\"Close authentication dialog\"]').click()");
      } else {
        await h.browser.evaluate("(() => { const dialog=document.querySelector('.auth-modal'); const r=dialog.getBoundingClientRect(); const options={bubbles:true,button:0,clientX:r.left-10,clientY:r.top-10}; dialog.dispatchEvent(new PointerEvent('pointerdown',options));dialog.dispatchEvent(new MouseEvent('click',options)); })()");
      }
      await h.settle(); assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
      await h.login(); await h.settle(); assert.equal(h.calls.refunds, 1);
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
    } finally { await h.close(); }
  }
});


rendered("fresh partial or inconsistent refunded report retains outcome and restores complete server details without replay", async () => {
  for (const partial of [{ reference: "REFUND-A", status: "refunded" }, { ...refunded(), id: 999 }]) {
    const h = await fixture();
    try {
      await begin401(h); h.setPause(true); const index = h.reads.length;
      await h.modalLogin(); await h.waitCalls(() => h.reads.length > index);
      await h.read(index, [partial]); await h.settle();
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), true);
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].displayStatus"), "refreshing");
      assert.equal(h.calls.refunds, 1);
      await h.waitCalls(() => h.reads.length > index + 1);
      await h.read(h.reads.length - 1, [refunded()]);
      await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past')");
      await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
      assert.equal(h.calls.refunds, 1);
    } finally { await h.close(); }
  }
});

for (const scenario of ["guest Login", "guest Signup", "Refund Login"]) rendered("N2: delayed current success closes reopened " + scenario + " without reviving canceled Refund", async () => {
  const refund = scenario === "Refund Login";
  const h = await fixture({ guest: !refund });
  try {
    if (refund) await begin401(h);
    h.setPauseLogin(true); await h.modalLogin();
    await h.waitCalls(() => h.chronology.includes("login"));
    await h.browser.evaluate('document.querySelector(\'[aria-label="Close authentication dialog"]\').click()');
    await h.browser.wait("!document.querySelector('.auth-modal')");
    await h.browser.evaluate("document.querySelector('.navbar__actions button.button--secondary').click()");
    await h.browser.wait("document.querySelector('.auth-modal--login')");
    if (scenario === "guest Signup") {
      await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
      await h.browser.wait("document.querySelector('.auth-modal--signup')");
    }
    await h.resolveLogin();
    await h.browser.wait("window.refundQa.identity()?.accountId === 12");
    await h.settle();
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(h.calls.refunds, refund ? 1 : 0);
    if (refund) {
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
      await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets')");
      await h.settle(); assert.equal(h.calls.refunds, 1);
    }
  } finally { await h.close(); }
});

rendered("N2: delayed failed Login cannot close a reopened modal or authenticate", async () => {
  const h = await fixture({ guest: true });
  try {
    h.setPauseLogin(true); await h.modalLogin();
    await h.waitCalls(() => h.chronology.includes("login"));
    await h.browser.evaluate('document.querySelector(\'[aria-label="Close authentication dialog"]\').click()');
    await h.browser.wait("!document.querySelector('.auth-modal')");
    await h.browser.evaluate("document.querySelector('.navbar__actions button.button--secondary').click()");
    await h.browser.wait("document.querySelector('.auth-modal--login')");
    await h.resolveLogin(user(), 401); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal--login'))"), true);
    assert.equal(h.calls.refunds, 0);
  } finally { await h.close(); }
});

rendered("N3: A Refund reauth as B preserves B ordinary Tickets 401 recovery", async () => {
  const h = await fixture();
  try {
    await begin401(h); h.setPause(true); const index = h.reads.length;
    await h.modalLogin(user(99));
    await h.browser.wait("window.refundQa.identity()?.accountId === 99");
    await h.waitCalls(() => h.reads.length > index); await h.settle();
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    // Auth completion may retire an earlier read; respond to the settled current reader.
    await h.read(h.reads.length - 1, [], 401);
    await h.browser.wait("window.refundQa.identity() === null"); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal--login'))"), true);
    h.setPause(false); h.setData([order("B-ONLY")]); await h.modalLogin(user(99));
    await h.browser.wait("document.querySelector('.my-tickets__order')?.textContent.includes('B-ONLY')");
    assert.equal(h.calls.refunds, 1);
    await h.login(); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation"), null);
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("N3: B explicit logout after A Refund reauth restores the normal Profile guest gate", async () => {
  const h = await fixture();
  try {
    await begin401(h); h.setData([order("B-ONLY")]); await h.modalLogin(user(99));
    await h.browser.wait("document.querySelector('.my-tickets__order')?.textContent.includes('B-ONLY')");
    await h.browser.evaluate("window.refundQa.logout()"); await h.settle();
    assert.equal(await h.browser.evaluate("window.refundQa.identity()"), null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal--login'))"), true);
    assert.equal(h.calls.refunds, 1); assert.equal(h.calls.logouts, 1);
  } finally { await h.close(); }
});

async function checkRecovery(h, expected) {
  await h.browser.evaluate("window.refundQa.check('REFUND-A')");
  await h.browser.wait("window.refundQaRecoveryResult !== null");
  assert.equal(await h.browser.evaluate("window.refundQaRecoveryResult.kind"), expected);
}
const renewedConsent = (h, warned = true, value = order()) => h.browser.evaluate(
  "window.refundQa.renew(" + JSON.stringify(value) + "," + warned + ")");

rendered("Slice 4: uncertain POST, fresh paid GET and explicit warned consent send exactly one new POST", async () => {
  const h = await fixture();
  try {
    await h.start(); await h.finish(null, 500); await h.settle();
    const before = h.calls.tickets;
    h.setData([order()]); await checkRecovery(h, "retry_available");
    assert.ok(h.calls.tickets > before); assert.equal(h.calls.refunds, 1);
    assert.equal(await renewedConsent(h, false), false);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order button').length"), 0);
    assert.match(await h.browser.evaluate("location.search"), /keep=1/);
    assert.equal(await renewedConsent(h), true); await h.waitCalls(() => h.calls.refunds === 2);
    assert.equal(await renewedConsent(h), false);
    await h.finish();
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past&keep=1')");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].priorUncertainty"), true);
    assert.match(await h.browser.evaluate("document.querySelector('.my-tickets__order').textContent"), /17.25/);
    assert.equal(h.calls.refunds, 2);
  } finally { await h.close(); }
});

rendered("Slice 4: post-retirement paid GET authorizes only new consent; late success cannot replace its owner", async () => {
  const h = await fixture();
  try {
    await h.start();
    await checkRecovery(h, "blocked");
    await h.expire(); await checkRecovery(h, "retry_available");
    assert.equal(h.calls.refunds, 1);
    // Chrome has invalidated the old aborted interception; existing B1 handling
    // remains the only allowed interception-error exception.
    await h.finish();
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), false);
    assert.equal(await renewedConsent(h), true); await h.waitCalls(() => h.calls.refunds === 2);
    await h.finish(null, 422);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].priorUncertainty"), true);
    assert.equal(await renewedConsent(h), false);
    await checkRecovery(h, "retry_available"); assert.equal(h.calls.refunds, 2);
  } finally { await h.close(); }
});

rendered("Slice 4: refunded verification adopts the complete list, ordering, counts and selected URL group", async () => {
  const h = await fixture();
  try {
    await h.start(); await h.failRefund();
    h.setData([order("OTHER"), refunded()]); await checkRecovery(h, "succeeded");
    await h.browser.wait("document.querySelectorAll('.my-tickets__tabs .my-tickets__count')[1]?.textContent === '1'");
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 1);
    assert.match(await h.browser.evaluate("document.querySelector('.my-tickets__order').textContent"), /OTHER/);
    assert.match(await h.browser.evaluate("location.search"), /filter=upcoming.*keep=1/);
    assert.equal(await renewedConsent(h), false);
    await h.browser.evaluate("document.querySelectorAll('.my-tickets__tabs button')[1].click()");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("Slice 4: ineligible, missing, duplicate, mismatched and contradictory recovery never grants consent", async () => {
  for (const [data, expected] of [
    [[{ ...order(), isRefundable: false }], "ineligible"],
    [[{ ...order(), isUpcoming: false, isRefundable: false }], "ineligible"],
    [[], "inconclusive"], [[order(), order()], "inconclusive"],
    [[{ ...order(), id: 999 }], "inconclusive"],
    [[{ ...order(), session: { ...order().session, id: 999 } }], "inconclusive"],
    [[{ ...order(), isUpcoming: false }], "inconclusive"],
  ]) {
    const h = await fixture();
    try {
      await h.start(); await h.finish(null, 500); h.setData(data); await checkRecovery(h, expected);
      assert.equal(await renewedConsent(h), false); assert.equal(h.calls.refunds, 1);
      assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].priorUncertainty"), true);
    } finally { await h.close(); }
  }
});

rendered("Slice 4: partial refunded recovery preserves facts through display failure and restores with GET-only Retry", async () => {
  const h = await fixture();
  try {
    await h.start(); await h.finish(null, 500);
    h.setPause(true); const index = h.reads.length;
    await h.browser.evaluate("window.refundQa.check('REFUND-A')");
    await h.waitCalls(() => h.reads.length > index);
    await h.read(index, [{ reference: "REFUND-A", status: "refunded" }]);
    await h.waitCalls(() => h.reads.length > index + 1);
    await h.read(index + 1, [], 500);
    await h.browser.wait("document.querySelector('.my-tickets__error button')");
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), true);
    assert.equal(await renewedConsent(h), false);
    h.setPause(false); h.setData([refunded()]);
    await h.browser.evaluate("document.querySelector('.my-tickets__error button').click()");
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past&keep=1')");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].displayStatus"), "ready");
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});

rendered("Slice 4: recovery GET 401 uses real Login then GET only; paid eligibility still needs warned consent", async () => {
  const h = await fixture();
  try {
    await h.start(); await h.finish(null, 500); h.setTicketStatus(401);
    await checkRecovery(h, "verification_retry");
    await h.browser.wait("document.querySelector('.auth-modal--login')");
    h.setTicketStatus(200); h.setData([order()]); await h.modalLogin();
    await h.browser.wait("window.refundQa.snapshot().records[0]?.phase === 'retry_available'");
    assert.equal(h.calls.refunds, 1); assert.equal(await renewedConsent(h, false), false);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(await renewedConsent(h), true); await h.waitCalls(() => h.calls.refunds === 2); await h.finish();
  } finally { await h.close(); }
});

rendered("Slice 4: second recovery GET 401 blocks automatic Login without POST or generic Profile loops", async () => {
  const h = await fixture();
  try {
    await h.start(); await h.finish(null, 500); h.setTicketStatus(401);
    await checkRecovery(h, "verification_retry"); await h.browser.wait("document.querySelector('.auth-modal--login')");
    await h.modalLogin();
    await h.browser.wait("window.refundQa.identity() === null && !document.querySelector('.auth-modal')");
    for (let i = 0; i < 3; i++) await h.settle();
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(h.calls.refunds, 1);
    await h.browser.evaluate("window.refundQa.mount(false);window.refundQa.mount(true)"); await h.settle();
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
  } finally { await h.close(); }
});

rendered("Slice 4: account switch and navigation fence non-aborting recovery responses and stale 401", async () => {
  for (const action of ["account", "navigation"]) for (const status of [200, 401]) {
    const h = await fixture({ ignoreTicketAbort: true });
    try {
      await h.start(); await h.finish(null, 500); await h.settle();
      h.setPause(true); const index = h.reads.length;
      await h.browser.evaluate("window.refundQa.check('REFUND-A')"); await h.waitCalls(() => h.reads.length > index);
      if (action === "account") { h.setData([order("B-ONLY")]); await h.login(user(99)); }
      else await h.browser.evaluate("window.refundQa.navigate('/profile?tab=personal&keep=1')");
      await h.read(index, [refunded()], status); await h.settle();
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
      assert.equal(h.calls.refunds, 1);
      if (action === "account") {
        assert.equal(await h.browser.evaluate("window.refundQa.identity().accountId"), 99);
        assert.deepEqual(await h.browser.evaluate("window.refundQa.snapshot().records"), []);
      } else {
        await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets')");
        assert.equal(await renewedConsent(h), false);
      }
    } finally { await h.close(); }
  }
});

rendered("Slice 4: reads started before recovery cannot overwrite a newly confirmed refunded fact", async () => {
  const h = await fixture({ ignoreTicketAbort: true });
  try {
    await h.start(); await h.finish(null, 500); await h.settle();
    h.setPause(true); const oldIndex = h.reads.length;
    await h.browser.evaluate("document.querySelector('.my-tickets__tabs button').click();window.refundQa.mount(false)");
    await h.settle(); await h.browser.evaluate("window.refundQa.mount(true)");
    await h.waitCalls(() => h.reads.length > oldIndex);
    const recoveryIndex = h.reads.length;
    await h.browser.evaluate("window.refundQa.check('REFUND-A')"); await h.waitCalls(() => h.reads.length > recoveryIndex);
    await h.read(recoveryIndex, [refunded()]);
    await h.browser.evaluate("window.refundQa.navigate('/profile?tab=tickets&filter=past')");
    await h.browser.wait("document.querySelector('.my-tickets__status--refunded')");
    await h.read(oldIndex, [order()]); await h.settle();
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__status--paid').length"), 0);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].reportedRefunded"), true);
    assert.equal(h.calls.refunds, 1);
  } finally { await h.close(); }
});
