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
  let freshUser = user(), data = [order()], refundRequest, meRequest;
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
        stale = false;
        return fulfill(event, { data: { user: freshUser, token: "synthetic-session-" + freshUser.id } }, url.pathname.endsWith("register") ? 201 : 200);
      }
      if (method === "POST" && url.pathname === "/api/logout") { calls.logouts++; return fulfill(event, null, 204); }
      if (method === "GET" && url.pathname === "/api/tickets") {
        assert.equal(url.search, "");
        calls.tickets++;
        if (pauseTickets) { reads.push(event); return; }
        return fulfill(event, { data });
      }
      if (method === "POST" && /^[/]api[/]orders[/][^/]+[/]refund$/.test(url.pathname)) {
        calls.refunds++; refundRequest = event; return;
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
  return { browser, calls, reads,
    async start(value = order()) {
      const accepted = await browser.evaluate("window.refundQa.start(" + JSON.stringify(value) + ")");
      assert.equal(accepted, true); await waitCalls(() => Boolean(refundRequest));
    },
    setPause(value) { pauseTickets = value; }, setData(value) { data = value; },
    setUser(value) { freshUser = value; },
    async login(value = user()) {
      freshUser = value;
      await browser.evaluate("window.refundQa.login({email:'fixture@example.test',password:'fixture-password'})");
      await browser.wait("window.refundQa.identity()?.accountId === " + value.id);
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

rendered("current definite Refund 401 stays recorded without Login or automatic replay", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.start(); await h.settle();
    const before = h.calls.tickets;
    await h.finish(null, 401); await h.settle();
    assert.equal(h.calls.tickets, before); // No indirect Login through automatic Tickets GET.
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets__error'))"), true);
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].phase"), "reauth");
    assert.equal(await h.browser.evaluate("window.refundQa.snapshot().records[0].continuation.replayCount"), 0);
    assert.equal(await h.browser.evaluate("window.refundQa.identity().accountId"), 12);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(h.calls.refunds, 1);
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
