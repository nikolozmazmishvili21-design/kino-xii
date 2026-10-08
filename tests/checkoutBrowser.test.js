import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires an isolated Chrome CDP endpoint" }, run);
const user = { id: 987654, username: "Checkout QA", email: "buyer@example.test", avatar: null, fullName: "Fixture Buyer",
  mobileNumber: "599123456", dateOfBirth: "1990-04-12", age: 36, preferredVenue: { id: 3, name: "Fixture Venue" }, profileComplete: true };
const options = { venues: [{ ...user.preferredVenue, slug: "fixture", formats: [] }], genres: [], formats: [], languages: [], sorts: [], timeBands: [], ageRatings: [],
  maxSeatsPerOrder: 3, ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
const session = { id: 10, price: 19, date: "2026-10-07", time: "19:30", movie: { title: "Fixture Film", ageRating: { minAge: 12 } },
  venue: user.preferredVenue, hall: { id: 1, name: "B" }, format: { name: "Standard" }, language: { name: "Georgian" } };
const HOLD = "11111111-2222-3333-4444-555555555555";
const NEW_HOLD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const serverOrder = { id: 7, reference: "SYNTHETIC-ORDER", status: "paid", totalPrice: 87.65, cardLastFour: "9876", contact: user,
  session: { ...session, date: "2026-10-08", time: "21:45", movie: { title: "Returned Film", posterUrl: "/src/assets/images/navbar-background.png" },
    venue: { name: "Returned Venue" }, hall: { name: "Returned Hall" }, format: { name: "Returned Format" }, language: { name: "Returned Language" } },
  tickets: [{ seatCode: "Z9", ticketType: { slug: "student", name: "Returned Student" }, price: 11.27 },
    { seatCode: "Z2", ticketType: { slug: "child", name: "Returned Child" }, price: 6.08 }] };
const returnedTickets = [serverOrder, { ...serverOrder, id: 8, reference: "SYNTHETIC-REFUNDED", status: "refunded" }];
let server, origin;
before(async () => {
  if (!endpoint) return;
  server = await createServer({ cacheDir: "node_modules/.cache/kino-checkout-browser", server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "checkout-test-entry", transformIndexHtml: { order: "pre", handler: (html) => html.replace("/src/main.jsx", "/tests/fixtures/profileHarness.jsx")
      .replace("</head>", '<link rel="stylesheet" href="/src/styles/main.css"></head>') } }] });
  await server.listen(); origin = server.resolvedUrls.local[0];
});
after(async () => { await server?.close(); });

async function fixture({ checkout = true, path = "sessions?hold-qa", guest = false, initialUser = user, ticketReplies = [], ticketsPaused = false, savedUser = null } = {}) {
  const browser = await connectProfileBrowser(endpoint);
  const calls = { orders: 0, deletes: 0, creates: 0, profileSaves: 0, tickets: 0, ticketQueries: [], ticketAccounts: [], forbidden: [], exceptions: [] };
  let currentUser = initialUser, held = null, pendingOrder = null, payload = null, pauseVerification = false, verification = null, pauseTickets = ticketsPaused;
  const pendingTickets = [];
  const holds = new Map();
  const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
    { name: "Access-Control-Allow-Headers", value: "Content-Type,Authorization" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" }];
  const fulfill = (event, body, status = 200) => browser.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: status,
    responseHeaders: headers, body: status === 204 ? "" : Buffer.from(JSON.stringify(body)).toString("base64") });
  browser.on("Runtime.exceptionThrown", (event) => calls.exceptions.push(event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", async (event) => {
    const url = new URL(event.request.url), method = event.request.method;
    if (url.origin === new URL(origin).origin) return browser.send("Fetch.continueRequest", { requestId: event.requestId });
    if (method === "GET" && url.hostname === "fonts.googleapis.com") return fulfill(event, null, 204);
    if (url.hostname === "api.kinoxii.redberryinternship.ge") {
      if (method === "OPTIONS") return fulfill(event, null, 204);
      if (method === "GET" && url.pathname === "/api/me") return fulfill(event, { data: currentUser });
      if (method === "GET" && url.pathname === "/api/filter-options") return fulfill(event, { data: options });
      if (method === "PUT" && url.pathname === "/api/profile" && savedUser) {
        calls.profileSaves++;
        currentUser = savedUser;
        return fulfill(event, { data: currentUser });
      }
      if (method === "GET" && url.pathname === "/api/tickets") {
        calls.tickets++; calls.ticketQueries.push(url.search); calls.ticketAccounts.push(currentUser.id);
        if (pauseTickets) { pendingTickets.push(event); return; }
        const reply = ticketReplies.shift() ?? { status: 200, body: { data: returnedTickets } };
        if (reply.network) return browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
        return fulfill(event, reply.body, reply.status);
      }
      const sessionId = Number(url.pathname.split("/")[3]);
      if (method === "GET" && /^\/api\/sessions\/(10|11)$/.test(url.pathname)) return fulfill(event, { data: { ...session, id: sessionId } });
      if (method === "GET" && /^\/api\/sessions\/(10|11)\/seats$/.test(url.pathname)) return fulfill(event, { data: { sessionId, hall: session.hall,
        sections: [{ name: "Stalls", rows: [{ label: "A", seats: [1, 2].map((id) => ({ id, code: `A${id}`, label: String(id),
          state: holds.has(sessionId === 10 ? HOLD : NEW_HOLD) ? "held" : "available", isMine: holds.has(sessionId === 10 ? HOLD : NEW_HOLD), aisleAfter: false })) }] }] } });
      if (method === "POST" && /^\/api\/sessions\/(10|11)\/holds$/.test(url.pathname)) {
        calls.creates++;
        const assignments = JSON.parse(event.request.postData).seats;
        held = { holdId: sessionId === 10 ? HOLD : NEW_HOLD, sessionId, isLive: true, expiresAt: new Date(Date.now() + 480000).toISOString(), subtotal: 100.47,
          seats: assignments.map((seat) => ({ seatId: seat.seatId, code: `A${seat.seatId}`, price: 7.13, ticketType: { slug: seat.ticketType, name: "Server Adult" } })) };
        holds.set(held.holdId, held); return fulfill(event, { data: held }, 201);
      }
      if (method === "GET" && [HOLD, NEW_HOLD].some(id => url.pathname === `/api/holds/${id}`)) {
        if (pauseVerification) { verification = event; return; }
        return fulfill(event, { data: holds.get(url.pathname.split("/").at(-1)) });
      }
      if (method === "DELETE" && [HOLD, NEW_HOLD].some(id => url.pathname === `/api/holds/${id}`)) {
        calls.deletes++; holds.delete(url.pathname.split("/").at(-1)); held = null; return fulfill(event, null, 204);
      }
      if (method === "POST" && url.pathname === "/api/orders") {
        calls.orders++; payload = JSON.parse(event.request.postData); pendingOrder = event; return;
      }
      if (method === "POST" && url.pathname === "/api/login") return fulfill(event, { data: { user: currentUser, token: "checkout-fixture-new-auth" } });
      if (method === "POST" && url.pathname === "/api/logout") return fulfill(event, null, 204);
    }
    // No request outside the local Vite origin is ever forwarded. All unknown
    // API traffic (including any production mutation) is blocked.
    calls.forbidden.push({ method, path: url.pathname });
    return browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
  });
  await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.kinoHoldQa = true; localStorage.clear(); sessionStorage.clear(); ${guest ? "" : "localStorage.setItem('kino-xii.auth.token','checkout-fixture-auth');"}` });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1728, height: 1027, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: `${origin}${path}` });
  await browser.send("Page.bringToFront");
  const ready = async (expression) => {
    try { await browser.wait(expression); }
    catch (error) {
      const diagnostic = await browser.evaluate("({auth:document.getElementById('auth-probe')?.textContent, root:document.getElementById('root')?.textContent})");
      await browser.close();
      throw new Error(`${error.message}; bootstrap: ${JSON.stringify({ diagnostic, forbidden: calls.forbidden, exceptions: calls.exceptions })}`, { cause: error });
    }
  };
  await ready(`window.holdQa && JSON.parse(document.getElementById('auth-probe').textContent).status === '${guest ? "guest" : "authenticated"}'`);
  if (checkout) {
  await browser.evaluate("document.getElementById('rerender').focus(); window.holdQa.open(10)");
  await ready("document.getElementById('booking-seat-1') && !document.getElementById('booking-seat-1').disabled");
  await browser.evaluate("document.getElementById('booking-seat-1').click()");
  await ready("!document.querySelector('.seat-summary__checkout button').disabled");
  await browser.evaluate("document.querySelector('.seat-summary__checkout button').click()");
  await ready("document.querySelector('form.checkout')");
  }
  const h = { browser, calls,
    async capture(name) {
      const screenshot = await browser.send("Page.captureScreenshot", { format: "png" });
      await writeFile(`node_modules/.cache/kino-checkout-browser/${name}.png`, Buffer.from(screenshot.data, "base64"));
    },
    async edit(name, value) {
      await browser.evaluate(`(() => { const input = document.querySelector('form.checkout [name="${name}"], .profile-form [name="${name}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    },
    async pay() {
      await h.edit("cardNumber", "4242 4242 4242 4242"); await h.edit("expiry", "12/39"); await h.edit("cvv", "007");
      await browser.evaluate("document.querySelector('form.checkout').requestSubmit()");
      await browser.wait("JSON.parse(document.getElementById('booking-probe').textContent).state.order.phase === 'submitting'");
      for (let i = 0; !pendingOrder && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(pendingOrder, "Synthetic Order request reached interception");
    },
    async settle(status, body) { const request = pendingOrder; pendingOrder = null; payload = null; assert.ok(request); await fulfill(request, body, status); },
    async snapshot() { return browser.evaluate("JSON.parse(document.getElementById('booking-probe').textContent)"); },
    async safe() {
      const safe = await browser.evaluate(`(() => {
        const surfaces = JSON.stringify({ booking: JSON.parse(document.getElementById('booking-probe').textContent), local: {...localStorage}, session: {...sessionStorage}, url: location.href, globals: {...window.holdQa, ...window.profileQa} });
        return !['4242424242424242','4242 4242 4242 4242','12/39','"cardNumber"','"cvv"','"expiry"'].some(value => surfaces.includes(value));
      })()`);
      assert.equal(safe, true, "Payment stayed outside shared/persisted/debug surfaces");
    },
    payloadMatches(expected) { return JSON.stringify(payload) === JSON.stringify(expected); },
    async expire() {
      await new Promise((resolve, reject) => {
        browser.on("Emulation.virtualTimeBudgetExpired", resolve);
        void browser.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: 481000 }).catch(reject);
      });
      await browser.evaluate("window.holdQa.expire()");
    },
    async resumeVirtualTasks() {
      await new Promise((resolve, reject) => {
        browser.on("Emulation.virtualTimeBudgetExpired", resolve);
        void browser.send("Emulation.setVirtualTimePolicy", { policy: "pauseIfNetworkFetchesPending", budget: 1000 }).catch(reject);
      });
    },
    async verificationPending() { for (let i = 0; !verification && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10)); assert.ok(verification); },
    pauseVerification() { pauseVerification = true; },
    async finishVerification() { pauseVerification = false; await fulfill(verification, { data: held }); verification = null; },
    async replaceAccount() { currentUser = { ...user, id: 123456, fullName: "Account B Buyer" }; await browser.evaluate("window.profileQa.logout()");
      await browser.evaluate("window.profileQa.login({email:'other@example.test',password:'fixture-only-password'})"); },
    pauseTickets() { pauseTickets = true; },
    async waitTickets(count = 1) { for (let i = 0; pendingTickets.length < count && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10)); assert.ok(pendingTickets.length >= count); },
    async finishTickets(body = { data: returnedTickets }, status = 200, index = 0) {
      const [event] = pendingTickets.splice(index, 1); assert.ok(event);
      try { await fulfill(event, body, status); }
      catch (error) { if (!/Invalid InterceptionId/.test(error.message)) throw error; }
    },
    async failTickets() { const event = pendingTickets.shift(); assert.ok(event); await browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }); },
    replyTickets(body, status = 200) { ticketReplies.push({ body, status }); },
    async close() {
      payload = null;
      try { assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.exceptions, []); }
      finally { await browser.close(); }
    },
  };
  return h;
}

rendered("Checkout desktop geometry/prefill, Back clearing, blur validation and normalized duplicate-safe submission", async () => {
  const h = await fixture();
  try {
    const layout = await h.browser.evaluate(`(() => { const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.width,r.height]; }; return {dialog:rect('dialog'),body:rect('.checkout'),column:rect('.checkout__form-column'),summary:rect('.checkout__summary'),input:rect('[name="cardNumber"]'),pair:rect('[name="email"]'),cta:rect('.checkout__purchase button'),timer:rect('.hold-timer'),name:document.querySelector('[name="fullName"]').value, blank:[...document.querySelectorAll('[autocomplete^="cc-"]')].every(e=>!e.value)}; })()`);
    assert.deepEqual(layout.dialog, [1146, 599]); assert.deepEqual(layout.body, [1082, 452]); assert.equal(layout.column[0], 720);
    assert.equal(layout.summary[0], 321); assert.equal(layout.input[1], 40); assert.equal(layout.pair[0], 354); assert.deepEqual(layout.cta, [321, 41]); assert.deepEqual(layout.timer, [102, 46]);
    assert.equal(layout.name, user.fullName); assert.equal(layout.blank, true);
    const screenshot = await h.browser.send("Page.captureScreenshot", { format: "png" });
    await writeFile("node_modules/.cache/kino-checkout-browser/checkout-desktop.png", Buffer.from(screenshot.data, "base64"));
    await h.edit("cardNumber", "4242 4242 4242 4242"); await h.browser.evaluate("document.getElementById('booking-back').click()");
    await h.browser.wait("!document.querySelector('form.checkout')"); assert.equal(h.calls.deletes, 0);
    await h.browser.evaluate("document.querySelector('.seat-summary__checkout button').click()"); await h.browser.wait("document.querySelector('form.checkout')");
    assert.equal(await h.browser.evaluate("document.querySelector('[name=cardNumber]').value === ''"), true);
    await h.browser.evaluate("document.querySelector('form.checkout').requestSubmit()"); await h.browser.wait("document.activeElement.name === 'cardNumber'");
    await h.safe();
    assert.equal(h.calls.orders, 0); assert.equal(await h.browser.evaluate("document.querySelectorAll('.form-field--error').length"), 3);
    await h.edit("cardNumber", "bad"); await h.browser.evaluate("document.querySelector('[name=cardNumber]').focus(); document.getElementById('booking-back').focus()");
    await h.browser.wait("document.querySelector('[name=cardNumber]').getAttribute('aria-invalid') === 'true'");
    assert.equal(await h.browser.evaluate("document.querySelector('[name=cardNumber]').getAttribute('aria-invalid')"), "true");
    await h.edit("fullName", "  Fixture Buyer  "); await h.edit("mobileNumber", "599 123 456"); await h.pay();
    assert.equal(h.payloadMatches({ holdId: HOLD, fullName: user.fullName, email: user.email, mobileNumber: user.mobileNumber, cardNumber: "4242424242424242", expiry: "12/39", cvv: "007" }), true, "Exact normalized seven-field payload");
    await h.browser.evaluate("document.querySelector('form.checkout').requestSubmit(); document.querySelector('form.checkout').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); document.getElementById('rerender').click()");
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.equal(h.calls.orders, 1); assert.equal(await h.browser.evaluate("[...document.querySelectorAll('form.checkout input, form.checkout button')].every(e=>e.disabled) && !document.querySelector('.seat-selection__close').disabled"), true);
    await h.safe(); await h.settle(201, { data: serverOrder }); await h.browser.wait("!document.querySelector('form.checkout')");
    assert.equal((await h.snapshot()).state.order.phase, "success"); assert.equal(await h.browser.evaluate("Boolean(document.querySelector('dialog[open] .order-confirmation'))"), true);
    await h.safe(); assert.equal(h.calls.deletes, 0);
  } finally { await h.close(); }
});

rendered("422 fields stay local, focus recognized errors and preserve payment while editing only clears that field", async () => {
  const h = await fixture();
  try {
    await h.pay(); await h.settle(422, { message: "Validation feedback", errors: { email: ["Server email feedback"], cvv: ["Server CVV feedback"], holdId: ["General Hold feedback"] } });
    await h.browser.wait("document.activeElement.name === 'email'");
    assert.equal(await h.browser.evaluate("document.body.textContent.includes('General Hold feedback')"), true);
    assert.equal(await h.browser.evaluate("document.querySelector('[name=cardNumber]').value.length > 0"), true);
    assert.deepEqual((await h.snapshot()).state.fieldErrors, {});
    await h.browser.evaluate("document.querySelector('[name=cvv]').focus(); document.querySelector('[name=email]').focus()");
    assert.equal(await h.browser.evaluate("document.querySelector('[name=cvv]').getAttribute('aria-invalid')"), "true");
    await h.edit("email", "edited@example.test");
    assert.equal(await h.browser.evaluate("document.querySelector('[name=email]').getAttribute('aria-invalid') === null && document.querySelector('[name=cvv]').getAttribute('aria-invalid') === 'true'"), true);
    await h.safe();
  } finally { await h.close(); }
});

rendered("message-only 422 and 409 remove Checkout, preserve runtime feedback and never replay Order", async () => {
  for (const status of [422, 409]) {
    const h = await fixture();
    try {
      await h.pay(); await h.settle(status, status === 422 ? { message: "Exact expiry warning" } : { message: "Exact conflict warning", contested: ["A1"] });
      await h.browser.wait("!document.querySelector('form.checkout')"); await h.browser.wait(`document.body.textContent.includes('${status === 422 ? "Exact expiry warning" : "Exact conflict warning"}')`);
      assert.equal((await h.snapshot()).state.step, "seats"); assert.equal(h.calls.orders, 1); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("403 clears payment and blocks Pay until guarded verification returns Checkout", async () => {
  const h = await fixture();
  try {
    h.pauseVerification(); await h.pay(); await h.settle(403, { message: "Exact forbidden warning" });
    await h.verificationPending(); await h.browser.wait("!document.querySelector('form.checkout')");
    await h.finishVerification(); await h.browser.wait("document.querySelector('form.checkout')");
    assert.equal(await h.browser.evaluate("document.body.textContent.includes('Exact forbidden warning') && [...document.querySelectorAll('[autocomplete^=cc-]')].every(e=>!e.value) && document.querySelector('.checkout__purchase button').disabled"), true);
    assert.equal(h.calls.orders, 1); await h.safe();
  } finally { await h.close(); }
});

rendered("401 verified same-account return has empty payment and exhausted reauth leaves no spinner or replay", async () => {
  const h = await fixture();
  try {
    await h.pay(); await h.settle(401, { message: "Please authenticate" }); await h.browser.wait("document.querySelector('.auth-modal form')");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('form.checkout'))"), false); await h.safe();
    await h.browser.evaluate("(() => { for (const [name,value] of Object.entries({email:'buyer@example.test',password:'fixture-only-password'})) { const input=document.querySelector('.auth-modal [name='+name+']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); } })()");
    await h.browser.evaluate("document.querySelector('.auth-modal form').requestSubmit()"); await h.browser.wait("document.querySelector('form.checkout')");
    assert.equal(h.calls.orders, 1); assert.equal(await h.browser.evaluate("[...document.querySelectorAll('[autocomplete^=cc-]')].every(e=>!e.value)"), true);
    await h.pay(); await h.settle(401, { message: "Again rejected" }); await h.browser.wait("document.body.textContent.includes('Please sign in again before continuing your booking.')");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('form.checkout, .auth-modal'))"), false); assert.equal(h.calls.orders, 2); await h.safe();
  } finally { await h.close(); }
});

rendered("uncertainty focuses recovery, hides payment/timer and hands exact identifier to memory before navigation", async () => {
  for (const identity of [{ id: 7, reference: "SYNTHETIC-PARTIAL" }, null]) {
    const h = await fixture();
    try {
      await h.pay(); await h.settle(identity ? 201 : 500, identity ? { data: { ...identity, contact: { email: user.email }, session, cardLastFour: "4242" } } : { message: "Synthetic server failure" });
      await h.browser.wait("document.activeElement.id === 'order-recovery-heading'");
      if (!identity) await h.capture("recovery-desktop");
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('form.checkout, .hold-timer, [name=cardNumber]'))"), false);
      assert.equal(await h.browser.evaluate("document.querySelector('.order-recovery').textContent.includes(\"We couldn't confirm whether your order was completed.\")"), true);
      await h.expire(); assert.equal((await h.snapshot()).state.order.phase, "uncertain"); await h.safe();
      await h.browser.evaluate("document.querySelector('.order-recovery .button--primary').click()"); await h.browser.wait("location.pathname === '/profile' && location.search === '?tab=tickets'");
      // Expiry's exhausted virtual budget pauses Router transition tasks too.
      // Resume scheduling for the new read without changing production clocks.
      await h.resumeVirtualTasks();
      await h.browser.wait("document.querySelector('.my-tickets__order')").catch(async (error) => {
        const diagnostic = await h.browser.evaluate("({tickets:document.querySelector('.my-tickets')?.textContent,auth:JSON.parse(document.getElementById('auth-probe').textContent).status})");
        throw new Error(`${error.message}; reads=${h.calls.tickets}; ${JSON.stringify(diagnostic)}`, { cause: error });
      });
      assert.equal((await h.snapshot()).ticketsIntent, null);
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets__order--recovered'))"), false);
      assert.equal(h.calls.tickets, 1); assert.equal(h.calls.orders, 1);
      assert.equal((await h.snapshot()).state.sessionId, null); await h.safe(); assert.equal(h.calls.deletes, 0);
    } finally { await h.close(); }
  }
});

rendered("pending Close removes payment, and detached success/uncertainty produces only guarded notice", async () => {
  for (const kind of ["success", "uncertain", "other-account"]) {
    const h = await fixture();
    try {
      await h.pay(); await h.browser.evaluate("document.querySelector('.seat-selection__close').click()"); await h.browser.wait("!document.querySelector('form.checkout')");
      assert.equal(h.calls.deletes, 0); await h.safe(); if (kind === "other-account") await h.replaceAccount();
      await h.settle(kind === "uncertain" ? 500 : 201, kind === "uncertain" ? { message: "Server failure" } : { data: serverOrder });
      if (kind === "other-account") { await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.order-notice'))"), false); }
      else {
        await h.browser.wait("document.querySelector('.order-notice')");
        const text = await h.browser.evaluate("document.querySelector('.order-notice').textContent");
        assert.ok(text.includes(kind === "success" ? "Your order was completed." : "We couldn't confirm whether your order was completed."));
        assert.doesNotMatch(text, /SYNTHETIC-ORDER|SERVER-SEAT|87\.65|buyer@example/);
        if (kind === "success") {
          await h.browser.evaluate("[...document.querySelectorAll('.order-notice button')].find(e=>e.textContent==='Dismiss').click()"); await h.browser.wait("!document.querySelector('.order-notice')");
        } else {
          await h.browser.evaluate("document.querySelector('.order-notice button').click()"); await h.browser.wait("location.search === '?tab=tickets'");
          await h.browser.wait("document.querySelector('.my-tickets__order')");
          assert.equal((await h.snapshot()).ticketsIntent, null); assert.equal(h.calls.tickets, 1);
        }
      }
      assert.equal((await h.snapshot()).state.sessionId, null); assert.equal(h.calls.deletes, 0); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("same-session reopen explains frozen pending state; expiry winning a near-tie shows inline success notice", async () => {
  for (const expire of [false, true]) {
    const h = await fixture();
    try {
      await h.pay();
      if (expire) await h.expire();
      else { await h.browser.evaluate("document.querySelector('.seat-selection__close').click(); window.holdQa.open(10)"); }
      await h.browser.wait("document.getElementById('booking-selection-status')?.textContent === 'Completing your order…'").catch(async (error) => {
        throw new Error(`${error.message}; expire=${expire}; booking=${JSON.stringify(await h.snapshot())}`);
      });
      assert.equal(await h.browser.evaluate("[...document.querySelectorAll('.seat-map__seat')].every(e=>e.disabled) && document.querySelector('.seat-summary__checkout button').disabled && !document.querySelector('.seat-selection__close').disabled"), true);
      const instance = (await h.snapshot()).state.instanceId;
      if (expire) assert.equal(await h.browser.evaluate("document.body.textContent.includes('Your hold time expired. Please re-select your seats.')"), true);
      await h.settle(201, { data: serverOrder }); await h.browser.wait("document.querySelector('.order-notice--inline')");
      const snapshot = await h.snapshot(); assert.equal(snapshot.state.instanceId, instance); assert.equal(snapshot.state.step, "seats"); assert.equal(snapshot.state.order.phase, "idle");
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('form.checkout, .order-confirmation'))"), false); assert.equal(h.calls.orders, 1); assert.equal(h.calls.deletes, 0); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("recovery Home and pending Escape/backdrop preserve factual outcome and sensitive clearing", async () => {
  for (const action of ["home", "escape", "backdrop"]) {
    const h = await fixture();
    try {
      await h.pay();
      if (action === "home") {
        await h.settle(500, { message: "Server failure" }); await h.browser.wait("document.querySelector('.order-recovery')");
        await h.browser.evaluate("document.querySelector('.order-recovery .button--secondary').click()"); await h.browser.wait("location.pathname === '/'");
      } else if (action === "escape") {
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      } else {
        await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 });
        await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
      }
      await h.browser.wait("!document.querySelector('dialog[open]')"); await h.safe(); assert.equal(h.calls.deletes, 0);
      if (action !== "home") { await h.settle(201, { data: serverOrder }); await h.browser.wait("document.querySelector('.order-notice')"); }
      assert.equal(h.calls.orders, 1);
    } finally { await h.close(); }
  }
});

rendered("current 201 keeps the same dialog, focuses authoritative Confirmation and outlives the old timer", async () => {
  const h = await fixture();
  try {
    await h.browser.evaluate("window.confirmationQaDialog = document.querySelector('dialog'); true");
    await h.pay(); await h.settle(201, { data: serverOrder });
    await h.browser.wait("document.activeElement?.textContent === 'Booking confirmed!'");
    const facts = await h.browser.evaluate(`(() => {
      const root = document.querySelector('.order-confirmation');
      return { same: document.querySelector('dialog[open]') === window.confirmationQaDialog,
        text: root.textContent, heading: document.activeElement.tagName, tabIndex: document.activeElement.tabIndex,
        absent: !document.querySelector('dialog input, dialog form, .hold-timer, .seat-selection__progress, #booking-back, .order-notice'),
        poster: root.querySelector('.movie-image img')?.alt, persisted: sessionStorage.length === 0,
        secondary: { background: getComputedStyle(root.querySelector('.button--secondary')).backgroundColor, color: getComputedStyle(root.querySelector('.button--secondary')).color } };
    })()`);
    assert.equal(facts.same, true); assert.equal(facts.heading, "H2"); assert.equal(facts.tabIndex, -1); assert.equal(facts.absent, true);
    assert.equal(facts.poster, "Returned Film poster"); assert.equal(facts.persisted, true);
    assert.deepEqual(facts.secondary, { background: "rgba(255, 255, 255, 0.1)", color: "rgb(255, 255, 255)" });
    for (const value of ["SYNTHETIC-ORDER", "Returned Film", "Returned Venue", "Returned Hall", "Returned Format", "Returned Language", "8 Oct", "21:45", "Z9", "Z2", "Returned Student", "Returned Child", "₾ 11.27", "₾ 6.08", "₾ 87.65"]) assert.ok(facts.text.includes(value), value);
    assert.ok(facts.text.indexOf("Z9") < facts.text.indexOf("Z2"));
    assert.doesNotMatch(facts.text, /Fixture Film|Fixture Venue|100\.47|7\.13|A1|Pay|Retry|email|9876|QR|Download|4242|12\/39/);
    await h.safe();
    const geometry = await h.browser.evaluate(`(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.width,r.height,r.x,r.y]; };
      return {dialog:rect('dialog'), content:rect('.order-confirmation'), icon:rect('.order-confirmation__success'), summary:rect('.order-confirmation__summary'), poster:rect('.order-confirmation .movie-image'), primary:rect('.order-confirmation .button--primary'), secondary:rect('.order-confirmation .button--secondary')};
    })()`);
    assert.deepEqual(geometry.dialog.slice(0, 2), [1146, 599]); assert.deepEqual(geometry.content.slice(0, 2), [673, 487]);
    assert.deepEqual(geometry.icon.slice(0, 2), [56, 56]); assert.deepEqual(geometry.summary.slice(0, 2), [673, 218]);
    assert.deepEqual(geometry.poster.slice(0, 2), [48, 64]); assert.deepEqual(geometry.primary.slice(0, 2), [154, 41]); assert.deepEqual(geometry.secondary.slice(0, 2), [139, 41]);
    assert.equal(geometry.content[2] + geometry.content[0] / 2, geometry.dialog[2] + geometry.dialog[0] / 2);
    assert.equal(geometry.content[3] + geometry.content[1] / 2, geometry.dialog[3] + geometry.dialog[1] / 2);
    const screenshot = await h.browser.send("Page.captureScreenshot", { format: "png" });
    await writeFile("node_modules/.cache/kino-checkout-browser/confirmation-desktop.png", Buffer.from(screenshot.data, "base64"));
    await h.expire(); assert.equal((await h.snapshot()).state.order.phase, "success");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('dialog[open] .order-confirmation')) && !document.querySelector('.order-notice')"), true);
    assert.equal(h.calls.deletes, 0); assert.equal(h.calls.orders, 1); assert.equal(h.calls.creates, 1);
  } finally { await h.close(); }
});

rendered("Confirmation Close, Home and Tickets complete without release, repeat POST or persistence", async () => {
  for (const action of ["close", "home", "tickets", "escape", "backdrop"]) {
    const h = await fixture();
    try {
      await h.pay(); await h.settle(201, { data: serverOrder }); await h.browser.wait("document.querySelector('.order-confirmation')");
      if (action === "close") await h.browser.evaluate("document.querySelector('.seat-selection__close').click()");
      else if (action === "home" || action === "tickets") await h.browser.evaluate(`document.querySelector('.order-confirmation .button--${action === "home" ? "secondary" : "primary"}').click()`);
      else if (action === "escape") {
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      } else {
        await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 });
        await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
      }
      await h.browser.wait("!document.querySelector('dialog[open]')");
      const snapshot = await h.snapshot(); assert.equal(snapshot.state.sessionId, null); assert.equal(snapshot.state.order.data, null);
      if (action === "home") await h.browser.wait("location.pathname === '/'");
      if (action === "tickets") {
        await h.browser.wait("location.pathname === '/profile' && location.search === '?tab=tickets' && document.querySelector('.my-tickets__order')");
        assert.equal(snapshot.ticketsIntent, null); assert.equal(h.calls.tickets, 1);
      }
      if (["close", "escape", "backdrop"].includes(action)) assert.equal(await h.browser.evaluate("document.activeElement.id"), "rerender");
      assert.equal(await h.browser.evaluate("sessionStorage.length === 0 && !localStorage.getItem('Order')"), true);
      await h.safe(); assert.equal(h.calls.deletes, 0); assert.equal(h.calls.orders, 1);
      if (action === "close") {
        await h.browser.evaluate("window.holdQa.open(10)"); await h.browser.wait("document.getElementById('booking-seat-1')");
        assert.equal(await h.browser.evaluate("!document.querySelector('.order-confirmation')"), true);
        assert.equal((await h.snapshot()).state.order.phase, "idle");
      }
    } finally { await h.close(); }
  }
});

rendered("Tickets URL/direct entry, Profile links, Back/Forward/reload and dropdown preserve Profile edits", async () => {
  const h = await fixture({ checkout: false, path: "profile?hold-qa" });
  try {
    await h.browser.wait("document.querySelector('.profile-form')"); assert.equal(h.calls.tickets, 0);
    await h.edit("fullName", "Unsaved Profile Edit");
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile?tab=tickets\"]').click()");
    await h.browser.wait("document.querySelectorAll('.my-tickets__order').length === 2");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-page__navigation [aria-current=page]').textContent"), "My Tickets");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-page__column').hidden && document.querySelector('.profile-form [name=fullName]').value === 'Unsaved Profile Edit'"), true);
    assert.equal(h.calls.tickets, 1); assert.deepEqual(h.calls.ticketQueries, [""]);
    const text = await h.browser.evaluate("document.querySelector('.my-tickets').textContent");
    for (const value of ["SYNTHETIC-ORDER", "SYNTHETIC-REFUNDED", "Paid", "Refunded", "Returned Film", "Returned Venue", "Returned Hall", "Returned Format", "Returned Language", "Z9", "Z2", "₾ 11.27", "₾ 6.08", "₾ 87.65"]) assert.ok(text.includes(value), value);
    assert.doesNotMatch(text, /Fixture Film|100\.47|9876|buyer@example|Download|QR/);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets button').length"), 0);
    const screenshot = await h.browser.send("Page.captureScreenshot", { format: "png" });
    await writeFile("node_modules/.cache/kino-checkout-browser/tickets-desktop.png", Buffer.from(screenshot.data, "base64"));
    await h.browser.evaluate("history.back()"); await h.browser.wait("!document.querySelector('.profile-page__column').hidden");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-form [name=fullName]').value"), "Unsaved Profile Edit");
    await h.browser.evaluate("history.forward()"); await h.browser.wait("document.querySelectorAll('.my-tickets__order').length === 2"); assert.equal(h.calls.tickets, 2);
    await h.browser.evaluate("window.ticketsReloadMarker = true"); await h.browser.send("Page.reload", { ignoreCache: true });
    await h.browser.wait("!window.ticketsReloadMarker && document.querySelectorAll('.my-tickets__order').length === 2"); assert.equal(h.calls.tickets, 3);
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile\"]').click()"); await h.browser.wait("!document.querySelector('.my-tickets')");
    await h.browser.evaluate("document.querySelector('.profile-dropdown__toggle').click()"); await h.browser.wait("document.querySelector('.profile-dropdown__panel a[href=\"/profile?tab=tickets\"]')");
    await h.browser.evaluate("document.querySelector('.profile-dropdown__panel a[href=\"/profile?tab=tickets\"]').click()"); await h.browser.wait("document.querySelector('.my-tickets__order')");
    assert.equal(h.calls.tickets, 4); assert.equal(h.calls.orders, 0); assert.equal(h.calls.deletes, 0); await h.safe();
  } finally { await h.close(); }
});

rendered("Tickets loading, empty, malformed envelope/item, server/network error and Retry are factual reads", async () => {
  for (const reply of [{ status: 200, body: { data: [] } }, { status: 200, body: { missing: [] } }, { status: 200, body: { data: [{ reference: "INCOMPLETE" }] } }, { status: 500, body: { message: "Tickets read unavailable" } }, { network: true }]) {
    const h = await fixture({ checkout: false, path: "profile?tab=tickets", ticketsPaused: true });
    try {
      await h.waitTickets(); assert.equal(await h.browser.evaluate("document.querySelector('.my-tickets [role=status]').textContent"), "Loading your tickets…");
      if (reply.network) await h.failTickets();
      else await h.finishTickets(reply.body, reply.status);
      if (reply.body?.data?.length === 0) {
        await h.browser.wait("document.querySelector('.my-tickets')?.textContent.includes('No tickets yet.')");
        await h.capture("tickets-empty-desktop");
        assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets button, .my-tickets__order'))"), false);
      } else {
        await h.browser.wait("document.querySelector('.my-tickets__error button')"); assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 0);
        await h.browser.evaluate("document.querySelector('.my-tickets__error button').click()"); await h.waitTickets(); await h.finishTickets();
        await h.browser.wait("document.querySelectorAll('.my-tickets__order').length === 2");
      }
      assert.equal(h.calls.orders, 0); assert.equal(h.calls.deletes, 0); assert.ok(h.calls.ticketQueries.every(query => query === "")); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("exact uncertain recovery focuses its returned Order; unmatched and null evidence remain neutral", async () => {
  for (const identity of [{ id: 7, reference: "SYNTHETIC-ORDER" }, { reference: "SYNTHETIC-ORDER" }, { id: 7, reference: "NOT-RETURNED" }, null]) {
    const h = await fixture();
    try {
      await h.pay(); await h.settle(identity ? 201 : 500, identity ? { data: identity } : { message: "Unknown outcome" });
      await h.browser.wait("document.querySelector('.order-recovery')");
      await h.browser.evaluate("document.querySelector('.order-recovery .button--primary').click()"); await h.browser.wait("document.querySelectorAll('.my-tickets__order').length === 2");
      const match = identity && identity.reference === "SYNTHETIC-ORDER";
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets__order--recovered'))"), Boolean(match));
      if (match) assert.equal(await h.browser.evaluate("document.activeElement.classList.contains('my-tickets__order--recovered')"), true);
      assert.equal((await h.snapshot()).ticketsIntent, null);
      assert.doesNotMatch(await h.browser.evaluate("document.querySelector('.my-tickets').textContent"), /purchase failed|safe to retry|Retry Order|purchase completed/i);
      await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile\"]').click()");
      await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile?tab=tickets\"]').click()"); await h.browser.wait("document.querySelector('.my-tickets__order')");
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets__order--recovered'))"), false);
      assert.equal(h.calls.orders, 1); assert.equal(h.calls.deletes, 0); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("Tickets GET 401 uses existing Login, clears old Orders and refetches after valid auth", async () => {
  const h = await fixture({ checkout: false, path: "profile?tab=tickets", ticketsPaused: true });
  try {
    await h.waitTickets(); await h.finishTickets({ message: "Expired auth" }, 401); await h.browser.wait("document.querySelector('.auth-modal')");
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 0);
    assert.equal(await h.browser.evaluate("location.search"), "?tab=tickets");
    await h.browser.evaluate("window.profileQa.login({email:'buyer@example.test',password:'fixture-only-password'})"); await h.waitTickets(); await h.finishTickets();
    await h.browser.wait("document.querySelectorAll('.my-tickets__order').length === 2 && !document.querySelector('.auth-modal')");
    assert.equal(h.calls.tickets, 2); assert.equal(h.calls.orders, 0); assert.equal(h.calls.deletes, 0); await h.safe();
  } finally { await h.close(); }
});

rendered("direct guest Tickets restores the same URL through existing auth without a completeness gate", async () => {
  const h = await fixture({ checkout: false, path: "profile?tab=tickets", guest: true, initialUser: { ...user, profileComplete: false }, ticketsPaused: true });
  try {
    await h.browser.wait("document.querySelector('.auth-modal')"); assert.equal(h.calls.tickets, 0);
    await h.browser.evaluate("window.profileQa.login({email:'buyer@example.test',password:'fixture-only-password'})"); await h.waitTickets(); await h.finishTickets();
    await h.browser.wait("document.querySelector('.my-tickets__order')"); assert.equal(await h.browser.evaluate("location.search"), "?tab=tickets");
    assert.equal(h.calls.tickets, 1); assert.equal(h.calls.orders, 0);
  } finally { await h.close(); }
});

rendered("account switch aborts deferred A reads, masks loaded A Orders, and gives B a fresh read", async () => {
  for (const loaded of [false, true]) {
    const h = await fixture({ checkout: false, path: "profile?tab=tickets", ticketsPaused: !loaded });
    try {
      if (loaded) { await h.browser.wait("document.querySelector('.my-tickets__order')"); h.pauseTickets(); }
      else await h.waitTickets();
      await h.replaceAccount(); await h.waitTickets(loaded ? 1 : 2);
      assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 0);
      const bOrder = { ...serverOrder, reference: "ACCOUNT-B-ORDER", session: { ...serverOrder.session, movie: { title: "Account B Film", posterUrl: null } } };
      await h.finishTickets({ data: [bOrder] }, 200, loaded ? 0 : 1); await h.browser.wait("document.querySelector('.my-tickets')?.textContent.includes('ACCOUNT-B-ORDER')");
      if (!loaded) await h.finishTickets({ data: [{ ...serverOrder, reference: "STALE-ACCOUNT-A-ORDER" }] });
      assert.doesNotMatch(await h.browser.evaluate("document.querySelector('.my-tickets').textContent"), /SYNTHETIC-ORDER|STALE-ACCOUNT-A-ORDER/);
      assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets__order--recovered'))"), false);
      assert.equal((await h.snapshot()).ticketsIntent, null); assert.deepEqual(h.calls.ticketAccounts, [user.id, 123456]); assert.equal(h.calls.orders, 0); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("an older notice opens Tickets without releasing or clearing newer live booking B", async () => {
  const h = await fixture();
  try {
    await h.pay(); await h.browser.evaluate("document.querySelector('.seat-selection__close').click()"); await h.browser.wait("!document.querySelector('dialog[open]')");
    await h.browser.evaluate("window.holdQa.open(11)"); await h.browser.wait("document.getElementById('booking-seat-1') && !document.getElementById('booking-seat-1').disabled");
    await h.browser.evaluate("document.getElementById('booking-seat-1').click()"); await h.browser.wait("!document.querySelector('.seat-summary__checkout button').disabled");
    await h.browser.evaluate("document.querySelector('.seat-summary__checkout button').click()"); await h.browser.wait("document.querySelector('form.checkout')");
    const before = (await h.snapshot()).state; assert.equal(before.sessionId, 11); assert.equal(before.hold.data.holdId, NEW_HOLD);
    await h.settle(201, { data: serverOrder }); await h.browser.wait("document.querySelector('.order-notice--inline')");
    await h.browser.evaluate("document.querySelector('.order-notice button').click()"); await h.browser.wait("document.querySelector('.my-tickets__order') && !document.querySelector('dialog[open]')");
    const after = (await h.snapshot()).state; assert.deepEqual(after, before);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.order-notice'))"), false); assert.equal(h.calls.deletes, 0); assert.equal(h.calls.orders, 1);
    assert.equal(await h.browser.evaluate(`JSON.parse(sessionStorage.getItem('kino-xii.hold')).holdId === '${NEW_HOLD}'`), true);
    await h.browser.evaluate("history.back()"); await h.browser.wait("document.querySelector('dialog[open] form.checkout')");
    assert.equal((await h.snapshot()).state.hold.data.holdId, NEW_HOLD); assert.equal(await h.browser.evaluate("[...document.querySelectorAll('[autocomplete^=cc-]')].every(input => !input.value)"), true);
    await h.browser.evaluate("history.forward()"); await h.browser.wait("document.querySelector('.my-tickets__order') && !document.querySelector('dialog[open]')");
    await h.browser.evaluate("document.querySelector('.navbar__logo').click()"); await h.browser.wait("location.pathname === '/' && document.querySelector('dialog[open] form.checkout')");
    assert.deepEqual((await h.snapshot()).state, before);
    assert.equal(h.calls.deletes, 0); assert.equal(h.calls.tickets, 2); await h.safe();
  } finally { await h.close(); }
});

rendered("same-account User replacement refetches Tickets and rejects the old snapshot response", async () => {
  for (const loaded of [false, true]) {
    const h = await fixture({ checkout: false, path: "profile?tab=tickets", ticketsPaused: !loaded });
    try {
      if (loaded) { await h.browser.wait("document.querySelector('.my-tickets__order')"); h.pauseTickets(); }
      else await h.waitTickets();
      await h.browser.evaluate("window.profileQa.replaceUser({...window.profileQa.getCurrentUser(), fullName:'Fresh same-account name', profileComplete:false})");
      await h.waitTickets(loaded ? 1 : 2);
      assert.equal(await h.browser.evaluate("document.querySelectorAll('.my-tickets__order').length"), 0);
      await h.finishTickets({ data: [{ ...serverOrder, reference: "FRESH-SNAPSHOT" }] }, 200, loaded ? 0 : 1);
      await h.browser.wait("document.querySelector('.my-tickets')?.textContent.includes('FRESH-SNAPSHOT')");
      if (!loaded) await h.finishTickets({ data: [{ ...serverOrder, reference: "OBSOLETE-SNAPSHOT" }] });
      assert.doesNotMatch(await h.browser.evaluate("document.querySelector('.my-tickets').textContent"), /OBSOLETE-SNAPSHOT|SYNTHETIC-ORDER/);
      assert.equal(h.calls.tickets, 2); assert.equal(h.calls.orders, 0); await h.safe();
    } finally { await h.close(); }
  }
});

rendered("Profile validation and explicit save survive Tickets tabs and adopt the returned User", async () => {
  const savedUser = { ...user, fullName: "Returned Saved Name", profileComplete: false };
  const h = await fixture({ checkout: false, path: "profile?tab=unknown", savedUser });
  try {
    await h.browser.wait("document.querySelector('.profile-form')");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-page__navigation [aria-current]').textContent"), "Personal Information");
    await h.edit("fullName", "x");
    await h.browser.evaluate("document.querySelector('.profile-form [name=fullName]').focus(); document.querySelector('.profile-form [name=mobileNumber]').focus()");
    await h.browser.wait("document.querySelector('.profile-form [name=fullName]').getAttribute('aria-invalid') === 'true'");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-form__save').disabled"), true);
    assert.equal(h.calls.profileSaves, 0);
    await h.edit("fullName", "Edited Buyer");
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile?tab=tickets\"]').click()");
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile\"]').click()");
    await h.browser.wait("!document.querySelector('.profile-form__save').disabled");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-form [name=fullName]').value"), "Edited Buyer");
    await h.browser.evaluate("document.querySelector('.profile-form').requestSubmit(); document.querySelector('.profile-form').requestSubmit()");
    await h.browser.wait("document.querySelector('.profile-form__feedback')?.textContent.includes('Profile saved successfully.')");
    assert.equal(h.calls.profileSaves, 1);
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-form [name=fullName]').value"), savedUser.fullName);
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-page__status').textContent"), "Profile incomplete");
    assert.equal(await h.browser.evaluate("document.querySelector('.profile-form__save').disabled && location.pathname === '/profile'"), true);
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile?tab=tickets\"]').click()");
    await h.browser.wait("document.querySelector('.my-tickets__order')");
    assert.equal(h.calls.tickets, 2); assert.equal(h.calls.orders, 0); assert.equal(h.calls.deletes, 0); await h.safe();
  } finally { await h.close(); }
});

rendered("keyboard booking, validation, pending Close, Confirmation focus and Tickets Retry remain reachable", async () => {
  const h = await fixture({ checkout: false });
  const key = async (name, browser = h.browser) => {
    const code = name, windowsVirtualKeyCode = name === "Tab" ? 9 : 13;
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode,
      ...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode });
  };
  try {
    await h.browser.evaluate("document.getElementById('rerender').focus(); window.holdQa.open(10)");
    await h.browser.wait("document.getElementById('booking-seat-1') && !document.getElementById('booking-seat-1').disabled");
    await key("Tab"); assert.equal(await h.browser.evaluate("document.activeElement.classList.contains('seat-map__viewport')"), true);
    await key("Tab"); assert.equal(await h.browser.evaluate("document.activeElement.id"), "booking-seat-1");
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
    await key("Enter"); await h.browser.wait("!document.querySelector('.seat-summary__checkout button').disabled");
    await h.browser.evaluate("document.querySelector('.seat-summary__checkout button').focus()"); await key("Enter");
    await h.browser.wait("document.querySelector('form.checkout')");
    await h.browser.evaluate("document.querySelector('[name=cardNumber]').focus()"); await key("Tab");
    await h.browser.wait("document.querySelector('[name=cardNumber]').getAttribute('aria-invalid') === 'true'");
    assert.equal(await h.browser.evaluate("(() => { const input=document.querySelector('[name=cardNumber]');return document.getElementById(input.getAttribute('aria-describedby')).textContent; })()"), "Card number is required");
    await h.edit("cardNumber", "4242 4242 4242 4242"); await h.edit("expiry", "12/39"); await h.edit("cvv", "007");
    await h.browser.evaluate("document.querySelector('.checkout__purchase button').focus()"); await key("Enter"); await h.browser.wait("JSON.parse(document.getElementById('booking-probe').textContent).state.order.phase === 'submitting'");
    await key("Enter"); await h.browser.evaluate("document.querySelector('.seat-selection__close').focus()");
    await key("Tab"); assert.equal(await h.browser.evaluate("document.activeElement.classList.contains('seat-selection__close')"), true);
    await key("Enter"); await h.browser.wait("!document.querySelector('dialog[open]')"); assert.equal(await h.browser.evaluate("document.activeElement.id"), "rerender");
    await h.settle(201, { data: serverOrder }); await h.browser.wait("document.querySelector('.order-notice')");
    await h.browser.evaluate("document.querySelector('.order-notice button').focus()"); await key("Enter"); await h.browser.wait("document.querySelector('.my-tickets__order')");
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile\"]').focus()"); await key("Enter"); await h.browser.wait("!document.querySelector('.my-tickets')");
    h.replyTickets({ message: "Fixture Tickets read error" }, 500);
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile?tab=tickets\"]').focus()"); await key("Enter"); await h.browser.wait("document.querySelector('.my-tickets__error button')");
    await key("Tab"); assert.equal(await h.browser.evaluate("document.activeElement.textContent"), "Retry tickets"); await key("Enter"); await h.browser.wait("document.querySelector('.my-tickets__order')");
    assert.equal(h.calls.orders, 1); assert.equal(h.calls.deletes, 0); await h.safe();
  } finally { await h.close(); }
  // Check inherited focus-visible after keyboard interaction in a current flow.
  const current = await fixture();
  try {
    await current.pay(); await key("Tab", current.browser);
    await current.settle(201, { data: serverOrder }); await current.browser.wait("document.activeElement.textContent === 'Booking confirmed!'");
    assert.equal(await current.browser.evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid'"), true);
    await key("Tab", current.browser);
    assert.equal(await current.browser.evaluate("document.activeElement.textContent"), "View my tickets");
  } finally { await current.close(); }
});

rendered("narrow desktop preserves scroll access and long factual Order text stays within cards", async () => {
  const h = await fixture();
  try {
    await h.browser.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await h.browser.evaluate("document.querySelector('.checkout__purchase button').scrollIntoView({block:'center',inline:'nearest'})");
    assert.equal(await h.browser.evaluate("(() => { const r=document.querySelector('.checkout__purchase button').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth; })()"), true);
    await h.capture("checkout-narrow");
    await h.pay(); await h.settle(201, { data: { ...serverOrder, reference: "SYNTHETIC-".repeat(20), session: { ...serverOrder.session, movie: { title: "Long returned movie title ".repeat(6) } },
      tickets: serverOrder.tickets.map(ticket => ({ ...ticket, ticketType: { ...ticket.ticketType, name: "Long returned ticket type ".repeat(6) } })) } });
    await h.browser.wait("document.querySelector('.order-confirmation')");
    await h.browser.evaluate("document.querySelector('.order-confirmation').scrollIntoView({block:'start',inline:'center'})");
    assert.equal(await h.browser.evaluate("(() => { const root=document.querySelector('.order-confirmation');return root.scrollWidth <= root.clientWidth; })()"), true);
    await h.capture("confirmation-narrow-long");
    await h.browser.evaluate("document.querySelector('.order-confirmation .button--primary').click()"); await h.browser.wait("document.querySelector('.my-tickets__order')");
    assert.equal(await h.browser.evaluate("[...document.querySelectorAll('.my-tickets__order')].every(root=>root.scrollWidth<=root.clientWidth)"), true);
    await h.capture("tickets-narrow");
    assert.equal(h.calls.orders, 1); assert.equal(h.calls.deletes, 0); await h.safe();
  } finally { await h.close(); }
});

rendered("previous-account notice handlers cannot navigate, fetch tickets or clean up after auth replacement", async () => {
  const h = await fixture();
  try {
    await h.pay(); await h.browser.evaluate("document.querySelector('.seat-selection__close').click()"); await h.settle(201, { data: serverOrder }); await h.browser.wait("document.querySelector('.order-notice')");
    await h.browser.evaluate("const noticeButton = document.querySelector('.order-notice button'); window.oldNoticeAction = noticeButton[Object.keys(noticeButton).find(key => key.startsWith('__reactProps'))].onClick; true");
    await h.replaceAccount(); await h.browser.evaluate("window.oldNoticeAction()");
    assert.equal(await h.browser.evaluate("location.pathname"), "/sessions"); assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.order-notice'))"), false);
    assert.equal(h.calls.tickets, 0); assert.equal(h.calls.deletes, 0); assert.equal(h.calls.orders, 1); await h.safe();
  } finally { await h.close(); }
});

rendered("an account A recovery hint cannot identify a same-id/reference Order returned for B", async () => {
  const h = await fixture({ ticketsPaused: true });
  try {
    await h.pay(); await h.settle(201, { data: { id: 7, reference: "SYNTHETIC-ORDER" } }); await h.browser.wait("document.querySelector('.order-recovery')");
    await h.browser.evaluate("document.querySelector('.order-recovery .button--primary').click()"); await h.waitTickets();
    assert.equal((await h.snapshot()).ticketsIntent, null);
    await h.replaceAccount(); await h.waitTickets(2);
    await h.finishTickets({ data: [{ ...serverOrder, session: { ...serverOrder.session, movie: { title: "Account B Purchase", posterUrl: null } } }] }, 200, 1);
    await h.browser.wait("document.querySelector('.my-tickets')?.textContent.includes('Account B Purchase')");
    await h.finishTickets();
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.my-tickets__order--recovered'))"), false);
    assert.equal(h.calls.orders, 1); assert.equal(h.calls.deletes, 0); await h.safe();
  } finally { await h.close(); }
});

rendered("leaving Tickets aborts its read; a later entry owns data and ignores the older response", async () => {
  const h = await fixture({ checkout: false, path: "profile?tab=tickets", ticketsPaused: true });
  try {
    await h.waitTickets(); await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile\"]').click()");
    await h.browser.wait("!document.querySelector('.my-tickets')");
    await h.browser.evaluate("document.querySelector('.profile-page__navigation a[href=\"/profile?tab=tickets\"]').click()"); await h.waitTickets(2);
    await h.finishTickets({ data: [{ ...serverOrder, reference: "LATEST-READ" }] }, 200, 1); await h.browser.wait("document.querySelector('.my-tickets')?.textContent.includes('LATEST-READ')");
    await h.finishTickets({ data: [{ ...serverOrder, reference: "STALE-READ" }] });
    assert.doesNotMatch(await h.browser.evaluate("document.querySelector('.my-tickets').textContent"), /STALE-READ/);
    assert.equal(h.calls.tickets, 2); assert.equal(h.calls.orders, 0); assert.equal(h.calls.deletes, 0);
  } finally { await h.close(); }
});
