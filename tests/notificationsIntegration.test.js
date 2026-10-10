import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const account = { id: 12, username: "Notify Fixture", email: "notify@example.test", avatar: null,
  fullName: null, profileComplete: false, age: null };
const movie = (id = 29, extra = {}) => ({ id, slug: `exact-server-${id}`, title: "The Cartographer's Wife",
  posterUrl: `https://notify-fixture.test/poster-${id}.png`, releaseDate: "2026-10-02", runtimeMinutes: 134,
  genres: [{ id: 9, name: "Drama", slug: "drama" }], ageRating: { code: "12+", minAge: 12 }, isComingSoon: true, ...extra });
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [],
  maxSeatsPerOrder: 3, ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
let server, origin, assets;
before(async () => {
  if (!endpoint) return;
  if (process.env.KINO_NOTIFY_QA_ASSETS) assets = JSON.parse(await readFile(process.env.KINO_NOTIFY_QA_ASSETS, "utf8"));
  server = await createServer({ cacheDir: "node_modules/.cache/kino-notify-vite", server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "notify-strict-probe", enforce: "pre", transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/app/AppShell.jsx")) return 'import NotifyProbe from "/tests/fixtures/notifyProbe.jsx";\n' + code
        .replace('<Navbar onOpenAuth={openAuth} />', '<NotifyProbe /><Navbar onOpenAuth={openAuth} />');
    }, resolveId(id) { if (id === "/notify-strict.jsx") return "\0notify-strict.jsx"; }, load(id) {
      if (id === "\0notify-strict.jsx") return 'import {StrictMode,createElement} from "react";import {createRoot} from "react-dom/client";import App from "/src/app/App.jsx";import "/src/styles/main.css";createRoot(document.getElementById("root")).render(createElement(StrictMode,null,createElement(App)));';
    }, transformIndexHtml: { order: "pre", handler(html) { return html.replace("/src/main.jsx", "/notify-strict.jsx"); } } }],
  });
  await server.listen(); origin = new URL(server.resolvedUrls.local[0]);
});
after(async () => { await server?.close(); });

async function fixture({ guest = false, width = 1920, movies = [29, 32, 26, 25].map(id => movie(id)), pauseRead = false, ignoreAbort = false, pauseLogin = false } = {}) {
  const browser = await connectProfileBrowser(endpoint);
  const calls = { posts: [], gets: [], logins: [], registrations: [], forbidden: [], exceptions: [] }, tasks = new Set(), errors = [];
  const requestWaiters = new Set();
  const record = (kind, event) => {
    calls[kind].push(event);
    for (const notify of [...requestWaiters]) notify();
  };
  const waitRequests = (kind, count) => new Promise((resolve, reject) => {
    const check = () => {
      if (calls[kind].length < count) return;
      clearTimeout(timer); requestWaiters.delete(check); resolve(calls[kind][count - 1]);
    };
    const timer = setTimeout(() => {
      requestWaiters.delete(check);
      reject(new Error(`Timed out waiting for ${kind} request ${count}; recorded ${calls[kind].length}`));
    }, 10000);
    requestWaiters.add(check); check();
  });
  let closing = false, loginUser = account;
  const intercept = async (method, params) => {
    try { return await browser.send(method, params); }
    catch (error) { if (/^Invalid InterceptionId[.]?$/.test(error.message)) return { aborted: true }; throw error; }
  };
  const fulfill = (event, bytes, type = "application/json", status = 200) => intercept("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }, { name: "Cache-Control", value: "no-store" },
    ], body: status === 204 ? "" : Buffer.from(bytes).toString("base64"),
  });
  const json = (event, data, status = 200) => fulfill(event, JSON.stringify(data), "application/json", status);
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", event => {
    if (closing) return;
    const task = (async () => {
      const url = new URL(event.request.url), method = event.request.method;
      if (url.origin === origin.origin) return intercept("Fetch.continueRequest", { requestId: event.requestId });
      const asset = assets?.[event.request.url];
      if (asset) return fulfill(event, Buffer.from(asset.base64, "base64"), asset.contentType);
      if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return json(event, null, 204);
      if (url.hostname === "notify-fixture.test") {
        if (url.pathname === "/broken.png") return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
        return fulfill(event, pixel, "image/png");
      }
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        if (method === "GET" && url.pathname === "/api/filter-options") return json(event, { data: filters });
        if (method === "GET" && url.pathname === "/api/me") return json(event, { data: account });
        if (method === "GET" && url.pathname === "/api/sessions") return json(event, { data: [],
          meta: { currentPage: 1, lastPage: 1, perPage: 10, totalSessions: 0, totalMovies: 0 } });
        if (method === "GET" && url.pathname === "/api/movies/coming-soon") {
          assert.equal(url.search, "?limit=4"); record("gets", event);
          if (pauseRead) return;
          return json(event, { data: movies });
        }
        if (method === "GET" && url.pathname === "/api/movies/featured") return json(event, { data: [movie(100, { isComingSoon: false, backdropUrl: null })] });
        if (method === "GET" && url.pathname === "/api/movies/now-playing") return json(event, { data: Array.from({ length: 6 }, (_, i) => movie(100 + i, { isComingSoon: false, fromPrice: 14 })) });
        if (method === "POST" && /^\/api\/movies\/[^/]+\/notify$/.test(url.pathname)) { record("posts", event); return; }
        if (method === "POST" && url.pathname === "/api/login") {
          record("logins", event);
          if (pauseLogin) return;
          return json(event, { data: { user: loginUser, token: `synthetic-notify-${calls.logins.length}` } });
        }
        if (method === "POST" && url.pathname === "/api/register") {
          calls.registrations.push(event); return json(event, { data: { user: account, token: "synthetic-registered" } }, 201);
        }
        if (method === "POST" && url.pathname === "/api/logout") return json(event, { message: "Logged out" });
      }
      calls.forbidden.push({ method, url: event.request.url });
      return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => tasks.delete(task)); tasks.add(task);
  });
  const close = async () => {
    closing = true; await Promise.all([...tasks]); await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.exceptions, []);
  };
  try {
    await browser.send("Network.enable"); await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.clear();sessionStorage.clear();${guest ? "" : "localStorage.setItem('kino-xii.auth.token','synthetic-notify-original');"}
      window.notifySettled=0;const realFetch=window.fetch.bind(window);window.fetch=(url,options)=>{
        if(!String(url).endsWith('/notify'))return realFetch(url,options);
        return realFetch(url,${ignoreAbort ? "{...options,signal:undefined}" : "options"}).then(response=>{const read=response.text.bind(response);response.text=()=>read().then(text=>{window.notifySettled++;return text;});return response;});};` });
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 1080, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.navigate", { url: origin.href });
    await browser.wait("window.notifyProbe && document.querySelector('#coming-soon-title')");
    if (!pauseRead && movies.length) await browser.wait("document.querySelector('.coming-soon-card__notify')");
  } catch (error) { await close(); throw error; }
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const waitCalls = async count => { await waitRequests("posts", count); assert.equal(calls.posts.length, count); };
  return { browser, calls, close, settle, waitCalls, waitReads: count => waitRequests("gets", count),
    click: (index = 0) => browser.evaluate(`document.querySelectorAll('.coming-soon-card__notify')[${index}].click()`),
    text: (index = 0) => browser.evaluate(`document.querySelectorAll('.coming-soon-card__notify')[${index}].textContent`),
    async resolve(index = 0, { status = 201, data = { movieId: 29, subscribed: true }, message = "Synthetic notification refusal" } = {}) {
      const result = await json(calls.posts[index], status === 201 || status === 200 ? { data } : { message }, status);
      await settle(); return result;
    },
    async offline(index = 0) { await intercept("Fetch.failRequest", { requestId: calls.posts[index].requestId, errorReason: "Failed" }); await settle(); },
    async read(data = movies, status = 200, index = Math.max(0, calls.gets.length - 1)) {
      const event = await waitRequests("gets", index + 1);
      await json(event, status === 200 ? { data } : { message: "Synthetic catalogue error" }, status); await settle();
    },
    setLoginUser(value) { loginUser = value; },
    async resolveLogin() { return json(await waitRequests("logins", 1), { data: { user: loginUser, token: "synthetic-delayed-login" } }); },
    async login() {
      await browser.wait("document.querySelector('.auth-modal')");
      await browser.evaluate(`(() => {for(const [selector,value] of [['input[type=email]','notify@example.test'],['input[type=password]','synthetic']]){const input=document.querySelector('.auth-modal '+selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
      await browser.evaluate("document.querySelector('.auth-modal form').requestSubmit()");
      await browser.wait("!document.querySelector('.auth-modal') && document.querySelector('.profile-dropdown__toggle')");
    },
    async capture(name) {
      await browser.evaluate("document.querySelector('.home-section--coming-soon').scrollIntoView({block:'center'})");
      await browser.evaluate("document.fonts.ready"); await settle();
      const { data } = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const dir = process.env.KINO_NOTIFY_QA_OUTPUT ?? "node_modules/.cache/kino-notify-ui";
      await mkdir(dir, { recursive: true }); await writeFile(`${dir}/${name}.png`, Buffer.from(data, "base64"));
    },
  };
}

async function press(browser, key) {
  const code = key === " " ? "Space" : key;
  const windowsVirtualKeyCode = { Tab: 9, Enter: 13, " ": 32 }[key];
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode,
    ...(key === "Tab" ? {} : { text: key === "Enter" ? "\r" : " " }) });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

async function tabTo(browser, selector) {
  for (let i = 0; i < 40; i++) {
    await press(browser, "Tab");
    if (await browser.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`)) return;
  }
  assert.fail(`Tab did not reach ${selector}`);
}

const notifyFocus = browser => browser.evaluate(`(() => {const b=document.querySelector('.coming-soon-card__notify');
  return {active:document.activeElement.tagName,notify:document.activeElement===b,nativeDisabled:b.disabled,
    ariaDisabled:b.getAttribute('aria-disabled'),busy:b.getAttribute('aria-busy')};})()`);
const blockedFocus = busy => ({ active: "BUTTON", notify: true, nativeDisabled: false, ariaDisabled: "true", busy: String(busy) });

for (const key of ["Enter", " "]) rendered(`${key === " " ? "Space" : key} keyboard focus retention during pending and success prevents repeated Notify POSTs`, async t => {
  const h = await fixture();
  try {
    await tabTo(h.browser, ".coming-soon-card__notify");
    assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
    assert.equal((await notifyFocus(h.browser)).ariaDisabled, null);
    await press(h.browser, key); await h.waitCalls(1); await h.settle();
    const pending = await notifyFocus(h.browser);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.coming-soon-card__notify')).backgroundColor"), "rgba(0, 0, 0, 0)");
    await press(h.browser, "Enter"); await press(h.browser, " "); await h.settle();
    assert.equal(h.calls.posts.length, 1);
    await h.resolve(); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    const success = await notifyFocus(h.browser);
    await press(h.browser, "Enter"); await press(h.browser, " "); await h.settle();
    assert.equal(h.calls.posts.length, 1);
    t.diagnostic(JSON.stringify({ pending, success, posts: h.calls.posts.length }));
    assert.deepEqual({ pending, success }, { pending: blockedFocus(true), success: blockedFocus(false) });
    await press(h.browser, "Tab");
    assert.equal(await h.browser.evaluate("document.activeElement === document.querySelectorAll('.coming-soon-card__notify')[1]"), true);
  } finally { await h.close(); }
});

for (const guest of [true, false]) rendered(`${guest ? "guest" : "expired-auth"} keyboard focus retention through Login and Notify continuation`, async t => {
  const h = await fixture({ guest });
  try {
    await tabTo(h.browser, ".coming-soon-card__notify");
    await press(h.browser, guest ? "Enter" : " ");
    let initialPending;
    if (!guest) { await h.waitCalls(1); await h.settle(); initialPending = await notifyFocus(h.browser); await h.resolve(0, { status: 401 }); }
    await h.browser.wait("document.querySelector('.auth-modal')");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.auth-modal input[type=email]')"), true);
    assert.equal(await h.browser.evaluate("document.querySelector('.coming-soon-card__notify').getAttribute('aria-disabled')"), "true");
    await h.browser.send("Input.insertText", { text: "notify@example.test" });
    await press(h.browser, "Tab");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.auth-modal input[type=password]')"), true);
    await h.browser.send("Input.insertText", { text: "synthetic" });
    await tabTo(h.browser, ".auth-modal button[type=submit]");
    assert.equal(await h.browser.evaluate("document.activeElement.closest('dialog') !== null"), true);
    await press(h.browser, "Enter");
    await h.browser.wait("!document.querySelector('.auth-modal') && document.querySelector('.profile-dropdown__toggle')");
    const count = guest ? 1 : 2;
    await h.waitCalls(count); await h.settle();
    const pending = await notifyFocus(h.browser);
    await press(h.browser, "Enter"); await press(h.browser, " "); await h.settle();
    assert.equal(h.calls.posts.length, count);
    await h.resolve(count - 1); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    const success = await notifyFocus(h.browser);
    await press(h.browser, "Enter"); await press(h.browser, " "); await h.settle();
    assert.equal(h.calls.posts.length, count); assert.equal(h.calls.logins.length, 1);
    assert.equal(await h.browser.evaluate("location.pathname"), "/");
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    t.diagnostic(JSON.stringify({ initialPending, pending, success, posts: count }));
    if (!guest) assert.deepEqual(initialPending, blockedFocus(true));
    assert.deepEqual({ pending, success }, { pending: blockedFocus(true), success: blockedFocus(false) });
    await press(h.browser, "Tab");
    assert.equal(await h.browser.evaluate("document.activeElement === document.querySelectorAll('.coming-soon-card__notify')[1]"), true);
  } finally { await h.close(); }
});

rendered("pointer activation preserves Notify focus and cannot duplicate pending or successful POSTs", async () => {
  const h = await fixture();
  try {
    await h.browser.evaluate("document.querySelector('.coming-soon-card__notify').scrollIntoView({block:'center'})");
    const point = await h.browser.evaluate("(() => {const r=document.querySelector('.coming-soon-card__notify').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    const click = async () => {
      await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    };
    await click(); await h.waitCalls(1); await h.settle();
    assert.deepEqual(await notifyFocus(h.browser), blockedFocus(true));
    await click(); await h.settle(); assert.equal(h.calls.posts.length, 1);
    await h.resolve(); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.deepEqual(await notifyFocus(h.browser), blockedFocus(false));
    await click(); await h.settle(); assert.equal(h.calls.posts.length, 1);
  } finally { await h.close(); }
});

rendered("keyboard error recovery re-enables an explicit Notify attempt without losing focus", async () => {
  const h = await fixture();
  try {
    await tabTo(h.browser, ".coming-soon-card__notify");
    await press(h.browser, "Enter"); await h.waitCalls(1); await h.resolve(0, { status: 500 });
    await h.browser.wait("document.querySelector('.coming-soon-card__error')");
    assert.deepEqual(await notifyFocus(h.browser), { active: "BUTTON", notify: true, nativeDisabled: false, ariaDisabled: null, busy: "false" });
    assert.equal(h.calls.posts.length, 1);
    await press(h.browser, " "); await h.waitCalls(2); await h.settle();
    assert.deepEqual(await notifyFocus(h.browser), blockedFocus(true));
    await h.resolve(1); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.deepEqual(await notifyFocus(h.browser), blockedFocus(false));
    assert.equal(h.calls.posts.length, 2);
  } finally { await h.close(); }
});

rendered("authentication transition keeps Notify focusable while guarding pointer and keyboard activation", async () => {
  const h = await fixture({ pauseLogin: true });
  try {
    await tabTo(h.browser, ".coming-soon-card__notify");
    await h.browser.evaluate("void window.notifyProbe.login()");
    await h.browser.wait("document.querySelector('.coming-soon-card__notify[aria-disabled=true]')");
    assert.deepEqual(await notifyFocus(h.browser), blockedFocus(false));
    await h.click(); await press(h.browser, "Enter"); await press(h.browser, " "); await h.settle();
    assert.equal(h.calls.posts.length, 0);
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal')"), null);
    await h.resolveLogin(); await h.browser.wait("document.querySelector('.coming-soon-card__notify:not([aria-disabled])')");
    await press(h.browser, "Enter"); await h.waitCalls(1); await h.resolve();
    await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.deepEqual(await notifyFocus(h.browser), blockedFocus(false));
    assert.equal(h.calls.posts.length, 1);
  } finally { await h.close(); }
});

rendered("authenticated incomplete-profile Notify sends exact bodyless POST once, announces pending and retains confirmed success", async () => {
  const h = await fixture({ movies: [movie(29, { slug: "exact-slug-from-server" }), movie(32)] });
  try {
    await h.click(); await h.waitCalls(1); await h.click(); await h.click();
    assert.equal(new URL(h.calls.posts[0].request.url).pathname, "/api/movies/exact-slug-from-server/notify");
    assert.equal(new Headers(h.calls.posts[0].request.headers).get("Authorization"), "Bearer synthetic-notify-original");
    assert.equal(h.calls.posts[0].request.postData, undefined);
    assert.equal(await h.text(), "Setting notification…");
    assert.match(await h.browser.evaluate("document.querySelector('.coming-soon-card [role=status]').textContent"), /Setting notification/);
    await h.resolve(); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.equal(await h.text(), "You will be notified"); assert.equal(await h.text(1), "Notify Me");
    assert.equal(await h.browser.evaluate("location.pathname"), "/");
    assert.equal(await h.browser.evaluate("document.querySelector('dialog')"), null);
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    await h.click(); assert.equal(h.calls.posts.length, 1);
  } finally { await h.close(); }
});

for (const guest of [true, false]) rendered(`${guest ? "guest" : "expired"} authenticates through Login and replays once in StrictMode without profile completion`, async () => {
  const h = await fixture({ guest });
  try {
    await h.click();
    if (!guest) { await h.waitCalls(1); await h.resolve(0, { status: 401 }); }
    await h.browser.wait("document.querySelector('.auth-modal')");
    assert.deepEqual(await h.browser.evaluate("window.notifyProbe.pendingAction"), { type: "NOTIFY_MOVIE", payload: { movieSlug: movie().slug } });
    await h.login(); await h.waitCalls(guest ? 1 : 2);
    assert.equal(new Headers(h.calls.posts.at(-1).request.headers).get("Authorization"), "Bearer synthetic-notify-1");
    await h.resolve(guest ? 0 : 1); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.equal(await h.text(), "You will be notified"); assert.equal(h.calls.logins.length, 1);
    assert.equal(await h.browser.evaluate("location.pathname"), "/");
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    await h.settle(); assert.equal(h.calls.posts.length, guest ? 1 : 2);
  } finally { await h.close(); }
});

rendered("cancelling guest Login clears the pending action and restores button focus without subscribing", async () => {
  const h = await fixture({ guest: true });
  try {
    await h.browser.evaluate("document.querySelector('.coming-soon-card__notify').focus()"); await h.click();
    await h.browser.wait("document.querySelector('.auth-modal')");
    await h.browser.evaluate("document.querySelector('.auth-modal__close').click()");
    await h.browser.wait("!document.querySelector('.auth-modal')");
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.coming-soon-card__notify')"), true);
    assert.equal(await h.browser.evaluate("document.querySelector('.coming-soon-card__notify').disabled"), false);
    assert.equal(h.calls.posts.length, 0);
  } finally { await h.close(); }
});

rendered("a replayed 401 terminates the continuation instead of reopening Login in a loop", async () => {
  const h = await fixture({ guest: true });
  try {
    await h.click(); await h.login(); await h.waitCalls(1); await h.resolve(0, { status: 401 });
    await h.browser.wait("document.querySelector('.coming-soon-card__error')");
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal')"), null);
    assert.match(await h.browser.evaluate("document.querySelector('.coming-soon-card__error').textContent"), /could not be verified/);
    assert.equal(h.calls.posts.length, 1);
  } finally { await h.close(); }
});

rendered("switching Login to Signup preserves Notify and registration replays without a booking gate", async () => {
  const h = await fixture({ guest: true });
  try {
    await h.click(); await h.browser.wait("document.querySelector('.auth-modal')");
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    await h.browser.wait("document.querySelector('.auth-modal--signup')");
    await h.browser.evaluate(`(() => {for(const [name,value] of [['username','Notify Fixture'],['email','notify@example.test'],['password','synthetic'],['password_confirmation','synthetic']]){const input=document.querySelector('.auth-modal input[name='+name+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await h.browser.evaluate("document.querySelector('.auth-modal form').requestSubmit()");
    await h.waitCalls(1); await h.resolve(); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.equal(h.calls.registrations.length, 1); assert.equal(h.calls.logins.length, 0);
    assert.equal(new Headers(h.calls.posts[0].request.headers).get("Authorization"), "Bearer synthetic-registered");
    assert.equal(await h.browser.evaluate("location.pathname"), "/");
  } finally { await h.close(); }
});

rendered("dismissing Login during a pending authentication prevents late success from replaying Notify", async () => {
  const h = await fixture({ guest: true, pauseLogin: true });
  try {
    await h.click(); await h.browser.wait("document.querySelector('.auth-modal')");
    await h.browser.evaluate(`(() => {for(const [type,value] of [['email','notify@example.test'],['password','synthetic']]){const input=document.querySelector('.auth-modal input[type='+type+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await h.browser.evaluate("document.querySelector('.auth-modal form').requestSubmit()");
    await h.browser.wait("document.querySelector('.auth-modal form[aria-busy=true]')");
    await h.browser.evaluate("document.querySelector('.auth-modal__close').click()");
    await h.browser.wait("!document.querySelector('.auth-modal')");
    assert.equal(await h.browser.evaluate("window.notifyProbe.pendingAction"), null);
    await h.resolveLogin(); await h.browser.wait("document.querySelector('.profile-dropdown__toggle')");
    await h.settle(); assert.equal(h.calls.posts.length, 0); assert.equal(await h.text(), "Notify Me");
  } finally { await h.close(); }
});

rendered("long business-rule messages remain readable below the fixed card without clipping or overlap", async () => {
  const h = await fixture();
  try {
    const message = "A returned business-rule explanation. ".repeat(20);
    await h.click(); await h.waitCalls(1); await h.resolve(0, { status: 422, message });
    await h.browser.wait("document.querySelector('.coming-soon-card__error')");
    const result = await h.browser.evaluate("(() => {const e=document.querySelector('.coming-soon-card__error'),r=e.getBoundingClientRect(),row=e.closest('.home-section__row').getBoundingClientRect(),card=e.parentElement.querySelector('article').getBoundingClientRect();return {text:e.textContent,height:card.height,visible:r.top>=card.bottom&&r.bottom<=row.bottom};})()");
    assert.equal(result.text, message); assert.equal(result.height, 160); assert.equal(result.visible, true);
  } finally { await h.close(); }
});

for (const failure of ["network", 404, 403, 409, 422, 500, "unconfirmed", "wrong-movie", "wrong-status"]) rendered(`${failure} leaves a visible recoverable error and never claims success`, async () => {
  const h = await fixture();
  try {
    await h.click(); await h.waitCalls(1);
    if (failure === "network") await h.offline();
    else if (failure === "unconfirmed") await h.resolve(0, { data: { movieId: 29, subscribed: false } });
    else if (failure === "wrong-movie") await h.resolve(0, { data: { movieId: 32, subscribed: true } });
    else if (failure === "wrong-status") await h.resolve(0, { status: 200 });
    else await h.resolve(0, { status: failure });
    await h.browser.wait("document.querySelector('.coming-soon-card__error')");
    assert.equal(await h.text(), "Notify Me"); assert.equal(await h.text(1), "Notify Me");
    const error = await h.browser.evaluate("(() => {const e=document.querySelector('.coming-soon-card__error'),r=e.getBoundingClientRect(),p=e.parentElement.querySelector('article').getBoundingClientRect(),row=e.closest('.home-section__row').getBoundingClientRect();return {text:e.textContent,visible:r.top>=p.bottom&&r.bottom<=row.bottom,associated:document.querySelector('.coming-soon-card__notify').getAttribute('aria-describedby')===e.id};})()");
    assert.ok(error.text); assert.equal(error.visible, true); assert.equal(error.associated, true);
    await h.click(); await h.waitCalls(2); await h.resolve(1); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
  } finally { await h.close(); }
});

for (const change of ["logout", "switch"]) rendered(`${change} during a pending POST cannot adopt late success for another session`, async () => {
  const h = await fixture({ ignoreAbort: true });
  try {
    await h.click(); await h.waitCalls(1);
    if (change === "logout") await h.browser.evaluate("window.notifyProbe.logout()");
    else { h.setLoginUser({ ...account, id: 13, username: "Second account" }); await h.browser.evaluate("window.notifyProbe.login()"); }
    await h.resolve(); await h.browser.wait("window.notifySettled === 1"); await h.settle();
    assert.equal(await h.text(), "Notify Me");
    assert.equal(await h.browser.evaluate("document.querySelector('.coming-soon-card__notify--success')"), null);
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal')"), null);
  } finally { await h.close(); }
});

rendered("multiple cards dispatch and settle independently", async () => {
  const h = await fixture();
  try {
    await h.click(0); await h.click(1); await h.waitCalls(2);
    await h.resolve(1, { data: { movieId: 32, subscribed: true } });
    assert.equal(await h.text(0), "Setting notification…"); assert.equal(await h.text(1), "You will be notified");
    await h.resolve(0, { status: 500 });
    assert.equal(await h.text(0), "Notify Me"); assert.equal(await h.text(1), "You will be notified");
  } finally { await h.close(); }
});

rendered("authenticated refresh restores explicit server subscription; missing and nonboolean flags remain actionable", async () => {
  const h = await fixture({ movies: [movie(29, { isNotified: true }), movie(32), movie(26, { isNotified: "true" })] });
  try {
    assert.equal(await h.text(), "You will be notified"); assert.equal(await h.text(1), "Notify Me"); assert.equal(await h.text(2), "Notify Me");
    const previousReads = h.calls.gets.length;
    await h.browser.send("Page.reload");
    await h.waitReads(previousReads + 1);
    assert.ok(h.calls.gets.length > previousReads);
    await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    assert.equal(await h.text(), "You will be notified"); assert.equal(h.calls.posts.length, 0);
    assert.ok(h.calls.gets.every(event => new Headers(event.request.headers).get("Authorization") === "Bearer synthetic-notify-original"));
  } finally { await h.close(); }
});

rendered("Coming Soon renders API title/date/genres/runtime/rating and safe missing posters without seat or detail navigation", async () => {
  const long = "Very long server title ".repeat(20);
  const h = await fixture({ movies: [movie(29, { title: long, posterUrl: null, releaseDate: "2027-03-07", runtimeMinutes: 118,
    genres: [{ name: "Fantasy" }, { name: "Adventure" }], ageRating: { code: "16+" } }), movie(32, { posterUrl: "https://notify-fixture.test/broken.png" })] });
  try {
    const result = await h.browser.evaluate("(() => {const e=document.querySelector('.coming-soon-card');return {title:e.querySelector('h3').textContent,release:e.querySelector('time').textContent,date:e.querySelector('time').dateTime,metadata:e.querySelector('.movie-card__metadata').textContent,age:e.querySelector('.movie-age').textContent,fallback:e.querySelector('.movie-image__fallback').textContent,links:e.querySelectorAll('a').length,ellipsis:getComputedStyle(e.querySelector('h3')).textOverflow};})()");
    assert.equal(result.title, long); assert.equal(result.release, "In cinemas 7 March"); assert.equal(result.date, "2027-03-07");
    assert.equal(result.metadata, "Fantasy, Adventure · 118 min"); assert.equal(result.age, "Age rating: 16+"); assert.match(result.fallback, /Poster unavailable/);
    assert.equal(result.links, 0); assert.equal(result.ellipsis, "ellipsis");
    await h.browser.evaluate("document.querySelector('.coming-soon-card').click()"); await h.settle();
    assert.equal(await h.browser.evaluate("location.pathname"), "/"); assert.equal(h.calls.posts.length, 0);
    assert.equal(await h.browser.evaluate("document.querySelector('.home-section--coming-soon .home-section__all').getAttribute('href')"), "/sessions");
  } finally { await h.close(); }
});

for (const [titleId, label] of [["coming-soon-title", "Coming Soon"], ["now-playing-title", "Now Playing"]]) {
  for (const activation of ["click", "keyboard"]) rendered(`${label} See all stays visible and ${activation} navigates to the original /sessions destination independently of Notify`, async () => {
    const h = await fixture();
    const selector = `section[aria-labelledby="${titleId}"] .home-section__all`;
    try {
      if (label === "Coming Soon" && activation === "click") {
        await h.click(); await h.waitCalls(1); await h.resolve();
        await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
        assert.equal(await h.text(), "You will be notified");
        assert.equal(await h.browser.evaluate("location.pathname"), "/");
      }
      const link = await h.browser.evaluate(`(() => {const a=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(a);a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect(),header=a.parentElement.getBoundingClientRect();return {text:a.textContent,href:a.getAttribute('href'),label:a.getAttribute('aria-label'),visible:s.display!=='none'&&s.visibility==='visible'&&r.width>0&&r.height>0,color:s.color,fontSize:s.fontSize,fontWeight:s.fontWeight,rightInset:header.right-r.right,x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(link.text, "See all"); assert.equal(link.href, "/sessions"); assert.equal(link.visible, true);
      assert.equal(link.label, label === "Coming Soon" ? "See all sessions" : "See all Now Playing sessions");
      assert.equal(link.color, "rgb(236, 48, 19)"); assert.equal(link.fontSize, "14px"); assert.equal(link.fontWeight, "600");
      assert.ok(Math.abs(link.rightInset) < 1);
      if (activation === "click") {
        await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: link.x, y: link.y });
        assert.equal(await h.browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).matches(':hover')`), true);
        assert.equal(await h.browser.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color`), "rgb(236, 48, 19)");
        await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: link.x, y: link.y, button: "left", clickCount: 1 });
        await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: link.x, y: link.y, button: "left", clickCount: 1 });
      } else {
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await h.browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
        assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
        assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      }
      await h.browser.wait("location.pathname === '/sessions' && document.querySelector('.sessions-page')");
      assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal')"), null);
      assert.equal(h.calls.posts.length, label === "Coming Soon" && activation === "click" ? 1 : 0);
    } finally { await h.close(); }
  });
}

rendered("Coming Soon loading, empty, error and retry states are local and accessible", async () => {
  const h = await fixture({ pauseRead: true });
  try {
    assert.match(await h.browser.evaluate("document.querySelector('.home-section--coming-soon [role=status]').textContent"), /Loading/);
    await h.waitReads(1); await h.read([], 500, 0); await h.browser.wait("document.querySelector('.home-section--coming-soon [role=alert]')");
    await h.browser.evaluate("document.querySelector('.home-section--coming-soon button').click()");
    await h.browser.wait("document.querySelector('.home-section--coming-soon [aria-busy=true]')");
    await h.waitReads(2);
    assert.equal(h.calls.gets.length, 2);
    await h.read([], 200, 1); await h.browser.wait("document.querySelector('.home-section--coming-soon [role=status]')");
    assert.equal(await h.browser.evaluate("document.querySelector('.home-section--coming-soon [role=status]').textContent"), "No upcoming movies are available.");
  } finally { await h.close(); }
});

for (const width of [1728, 1920]) rendered(`${width}×1080 preserves Home Figma geometry, default/hover/focus/success styles and local icon dimensions`, async () => {
  const h = await fixture({ width });
  try {
    await h.browser.evaluate("document.fonts.ready");
    const result = await h.browser.evaluate("(() => {const section=document.querySelector('.home-section--coming-soon'),card=section.querySelector('.coming-soon-card'),image=card.querySelector('.movie-image'),title=card.querySelector('h3'),button=card.querySelector('button'),icon=button.querySelector('img'),rect=e=>({x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height});return {section:rect(section),card:rect(card),image:rect(image),icon:rect(icon),gap:getComputedStyle(card).gap,padding:getComputedStyle(card).padding,titleSize:getComputedStyle(title).fontSize,titleWeight:getComputedStyle(title).fontWeight,rowGap:getComputedStyle(card.closest('.home-section__row')).gap,button:{background:getComputedStyle(button).backgroundColor,border:getComputedStyle(button).borderTopColor,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height},poster:card.querySelector('.movie-image img').src,crop:getComputedStyle(card.querySelector('.movie-image img')).objectFit};})()");
    assert.equal(await h.browser.evaluate("innerWidth"), width);
    assert.equal(result.section.width, await h.browser.evaluate("document.documentElement.clientWidth"));
    assert.equal(result.card.x, 70); assert.equal(result.card.width, 470); assert.equal(result.card.height, 160);
    assert.equal(result.image.width, 229); assert.equal(result.image.height, 136); assert.equal(result.gap, "15px"); assert.equal(result.padding, "12px");
    assert.equal(result.titleSize, "12px"); assert.equal(result.titleWeight, "600"); assert.equal(result.rowGap, "20px");
    assert.equal(result.crop, "cover"); assert.equal(result.poster, movie().posterUrl);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.coming-soon-card .movie-image img')).objectPosition"), "50% 0%");
    assert.ok(Math.abs(result.icon.width - 15.9991) < 0.02); assert.ok(Math.abs(result.icon.height - 16.0011) < 0.02);
    assert.equal(result.button.background, "rgba(0, 0, 0, 0)"); assert.equal(result.button.border, "rgb(169, 169, 169)");
    await h.capture(`coming-soon-default-${width}`);
    const point = await h.browser.evaluate("(() => {const r=document.querySelector('.coming-soon-card__notify').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.coming-soon-card__notify')).backgroundColor"), "rgba(255, 255, 255, 0.1)");
    await h.capture(`coming-soon-hover-${width}`);
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await h.browser.evaluate("document.querySelector('.coming-soon-card__notify').focus()");
    assert.equal(await h.browser.evaluate("document.querySelector('.coming-soon-card__notify').matches(':focus-visible')"), true);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
    await h.click(); await h.waitCalls(1); await h.resolve(); await h.browser.wait("document.querySelector('.coming-soon-card__notify--success')");
    const success = await h.browser.evaluate("(() => {const b=document.querySelector('.coming-soon-card__notify--success'),r=b.getBoundingClientRect(),c=b.closest('article').getBoundingClientRect(),i=b.querySelector('img');return {height:r.height,background:getComputedStyle(b).backgroundColor,border:getComputedStyle(b).borderTopColor,icon:{width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height,loaded:i.complete&&i.naturalWidth>0},inside:r.right<c.right};})()");
    assert.equal(success.height, 28); assert.equal(success.background, "rgba(255, 255, 255, 0.1)"); assert.equal(success.border, "rgba(0, 0, 0, 0)");
    assert.equal(success.icon.loaded, true); assert.ok(Math.abs(success.icon.width - 15.9991) < 0.02); assert.equal(success.inside, true);
    await h.capture(`coming-soon-success-${width}`);
    const dir = process.env.KINO_NOTIFY_QA_OUTPUT ?? "node_modules/.cache/kino-notify-ui";
    await writeFile(`${dir}/geometry-${width}.json`, JSON.stringify({ result, success }, null, 2));
  } finally { await h.close(); }
});
