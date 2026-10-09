import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";
import { SEARCH_DEBOUNCE_MS } from "../src/search/useMovieSearch.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const account = { id: 12, username: "Fixture", email: "fixture@example.test", profileComplete: true,
  fullName: "Fixture Buyer", mobileNumber: "599123456", dateOfBirth: "1990-04-12", age: 36, preferredVenue: null };
const movie = (index = 1, overrides = {}) => ({ id: index, slug: `server-movie-${index}`, title: `Batman ${index}`,
  kind: "film", posterUrl: `https://search-fixture.test/poster-${index}.png`, runtimeMinutes: 134,
  ageRating: { code: "12+", minAge: 12 }, isComingSoon: false, fromPrice: 16, ...overrides });
const order = { id: 7, reference: "SEARCH-REFUND", status: "paid", isUpcoming: true, isRefundable: true,
  totalPrice: 19, session: { id: 10, date: "2026-10-09", time: "21:45", movie: { title: "Refund comparison", posterUrl: null },
    venue: { name: "Fixture Venue" }, hall: { name: "B" }, format: { name: "2D" }, language: { name: "Georgian" } },
  tickets: [{ seatCode: "A1", ticketType: { slug: "adult", name: "Adult" }, price: 19 }] };
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [],
  maxSeatsPerOrder: 3, ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
let server, origin, fontAssets;
before(async () => {
  if (!endpoint) return;
  // Optional local authentic assets permit visual QA without any external fetch.
  if (process.env.KINO_SEARCH_QA_FONT_ASSETS) fontAssets = JSON.parse(await readFile(process.env.KINO_SEARCH_QA_FONT_ASSETS, "utf8"));
  server = await createServer({ cacheDir: "node_modules/.cache/kino-search-integration", server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "search-strict-check",
      resolveId(id) { if (id === "/search-strict-entry.jsx") return "\0search-strict-entry.jsx"; },
      load(id) {
        if (id === "\0search-strict-entry.jsx") return 'import {StrictMode,createElement} from "react";import {createRoot} from "react-dom/client";import App from "/src/app/App.jsx";import "/src/styles/main.css";createRoot(document.getElementById("root")).render(createElement(StrictMode,null,createElement(App)));';
      },
      transformIndexHtml: { order: "pre", handler(html, context) {
        return context.originalUrl?.includes("strict-qa=1") ? html.replace("/src/main.jsx", "/search-strict-entry.jsx") : html;
      } },
    }],
  });
  await server.listen(); origin = new URL(server.resolvedUrls.local[0]);
});
after(async () => { await server?.close(); });

async function fixture({ guest = false, ignoreAbort = false, width = 1728, height = 1027, path = "/profile?tab=tickets", orders = [] } = {}) {
  const browser = await connectProfileBrowser(endpoint);
  const calls = { searches: [], mutations: [], forbidden: [], exceptions: [], posters: [], sessions: [] };
  const handlers = new Set(), errors = [], moviesBySlug = new Map();
  let closing = false;
  const intercept = async (method, params) => {
    try { return await browser.send(method, params); }
    catch (error) {
      // A real AbortController removes the paused interception. Never swallow a
      // timeout/assertion or any other protocol failure.
      if (error?.name === "Error" && /^Invalid InterceptionId[.]?$/.test(error.message)) return { aborted: true };
      throw error;
    }
  };
  const fulfill = (event, bytes, type = "application/json", status = 200) => intercept("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,OPTIONS" }, { name: "Cache-Control", value: "no-store" },
    ], body: status === 204 ? "" : Buffer.from(bytes).toString("base64"),
  });
  const json = (event, body, status = 200) => fulfill(event, JSON.stringify(body), "application/json", status);
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", event => {
    if (closing) return;
    const task = (async () => {
      const url = new URL(event.request.url), method = event.request.method;
      if (url.origin === origin.origin) return intercept("Fetch.continueRequest", { requestId: event.requestId });
      const font = fontAssets?.assets[event.request.url];
      if (font) return fulfill(event, Buffer.from(font.base64, "base64"), font.contentType);
      if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return json(event, null, 204);
      if (url.hostname === "search-fixture.test" && method === "GET") {
        calls.posters.push(url.href); return fulfill(event, pixel, "image/png");
      }
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        if (method !== "GET") calls.mutations.push({ method, path: url.pathname });
        if (method === "GET" && url.pathname === "/api/filter-options") return json(event, { data: filters });
        if (method === "GET" && url.pathname === "/api/me") return json(event, { data: account });
        if (method === "GET" && url.pathname === "/api/tickets") return json(event, { data: orders });
        if (method === "GET" && url.pathname === "/api/search") {
          assert.deepEqual([...url.searchParams.keys()], ["q"]);
          assert.equal(event.request.postData, undefined);
          calls.searches.push({ event, query: url.searchParams.get("q") }); return;
        }
        if (method === "GET" && url.pathname.startsWith("/api/movies/")) {
          const slug = decodeURIComponent(url.pathname.slice("/api/movies/".length));
          const found = moviesBySlug.get(slug);
          assert.ok(found, "Movie navigation must use a returned exact server slug");
          return json(event, { data: { ...found, availableDates: [], genres: [], formats: [], releaseDate: "2026-10-09", synopsis: "Synthetic detail response" } });
        }
        if (method === "GET" && url.pathname === "/api/sessions") {
          calls.sessions.push(url.search);
          return json(event, { data: [], meta: { currentPage: Number(url.searchParams.get("page") ?? 1), lastPage: 3,
            perPage: 10, totalSessions: 0, totalMovies: 0, date: url.searchParams.get("date") } });
        }
      }
      calls.forbidden.push({ method, url: event.request.url });
      return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => handlers.delete(task));
    handlers.add(task);
  });
  const close = async () => {
    closing = true;
    await Promise.all([...handlers]);
    await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.forbidden, []);
    assert.deepEqual(calls.exceptions, []); assert.deepEqual(calls.mutations, []);
  };
  const source = `localStorage.clear();sessionStorage.clear();${guest ? "" : "localStorage.setItem('kino-xii.auth.token','synthetic-search-session');"}
    const nativeSetTimeout=window.setTimeout.bind(window), nativeClearTimeout=window.clearTimeout.bind(window), nativeFetch=window.fetch.bind(window);
    const timers=new Map();let time=0,next=-1;window.searchQa={aborts:0,settled:0,pending:()=>timers.size,advance(ms){time+=ms;for(const [id,timer] of [...timers]){if(timer.at<=time){timers.delete(id);timer.callback();}}}};
    window.setTimeout=(callback,delay,...args)=>{if(delay!==${SEARCH_DEBOUNCE_MS})return nativeSetTimeout(callback,delay,...args);const id=next--;timers.set(id,{at:time+delay,callback:()=>callback(...args)});return id;};
    window.clearTimeout=id=>{if(!timers.delete(id))nativeClearTimeout(id);};
    window.fetch=(url,options)=>{if(!String(url).includes('/api/search?'))return nativeFetch(url,options);options.signal?.addEventListener('abort',()=>window.searchQa.aborts++);
      return nativeFetch(url,${ignoreAbort ? "{...options,signal:undefined}" : "options"}).then(response=>{const text=response.text.bind(response);response.text=()=>text().then(value=>{window.searchQa.settled++;return value;},error=>{window.searchQa.settled++;throw error;});return response;},error=>{window.searchQa.settled++;throw error;});};`;
  try {
    await browser.send("Network.enable"); await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source });
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.navigate", { url: new URL(path, origin).href });
    await browser.wait("document.querySelector('.navbar-search__pill') && " + (guest ? "document.querySelector('.navbar__actions')" : "document.querySelector('.profile-dropdown__toggle')"));
  } catch (error) { await close(); throw error; }
  const waitCalls = async predicate => {
    const deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate(), "Expected intercepted Search request");
  };
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))");
  const advance = async ms => { await browser.evaluate(`window.searchQa.advance(${ms})`); await settle(); };
  const type = async query => {
    await browser.evaluate("(() => {const input=document.querySelector('.search-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," + JSON.stringify(query) + ");input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await browser.wait("document.querySelector('.search-input input').value === " + JSON.stringify(query));
    if (query.trim()) await browser.wait("window.searchQa.pending() === 1");
    await settle();
  };
  return { browser, calls, close, settle, advance, type, waitCalls,
    async open() {
      const target = await browser.evaluate("(() => {const button=document.querySelector('.navbar-search__pill'),r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hittable:button.contains(document.elementFromPoint(x,y)),overlaps:[...document.querySelectorAll('.navbar__links a,.profile-dropdown__toggle,.navbar__actions button')].filter(e=>{const other=e.getBoundingClientRect();return r.left<other.right&&r.right>other.left&&r.top<other.bottom&&r.bottom>other.top;}).map(e=>e.className)};})()");
      assert.equal(target.hittable, true, "Search trigger must be physically reachable");
      assert.deepEqual(target.overlaps, [], "Search must not overlap other Navbar controls");
      await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
      await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
      await browser.wait("document.querySelector('.search-overlay:popover-open') && document.activeElement.matches('.search-input input')");
    },
    async resolve(index, movies = [movie()], status = 200) {
      for (const value of movies ?? []) if (value?.slug) moviesBySlug.set(value.slug, value);
      const result = await json(calls.searches[index].event, status === 200 ? { data: movies } : { message: "Synthetic Search failure" }, status);
      await settle(); return result;
    },
    async reject(index) { await intercept("Fetch.failRequest", { requestId: calls.searches[index].event.requestId, errorReason: "Failed" }); await settle(); },
    async capture(name) {
      const { data } = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const directory = process.env.KINO_SEARCH_QA_OUTPUT ?? "node_modules/.cache/kino-search-ui";
      await mkdir(directory, { recursive: true }); await writeFile(directory + "/" + name + ".png", Buffer.from(data, "base64"));
    },
  };
}

async function key(h, key, shift = false) {
  const code = { Tab: 9, Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35 }[key];
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0,
    ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
}
async function searchFor(h, query = "Batman") {
  await h.type(query); await h.advance(SEARCH_DEBOUNCE_MS); await h.waitCalls(() => h.calls.searches.length > 0);
}

rendered("Search prompt opens from the real Navbar button, labels/focuses input and never requests for blank text", async () => {
  const h = await fixture();
  try {
    assert.equal(await h.browser.evaluate("document.querySelector('.navbar-search__pill').disabled"), false);
    await h.open();
    assert.match(await h.browser.evaluate("document.querySelector('.search-overlay').textContent"), /What do you want to watch\?Search by title/);
    assert.doesNotMatch(await h.browser.evaluate("document.querySelector('.search-overlay').textContent"), /director|cast/i);
    assert.equal(await h.browser.evaluate("document.querySelector('label[for=\"'+document.activeElement.id+'\"]').textContent"), "Search by title");
    assert.equal(await h.browser.evaluate("document.querySelector('.navbar-search__pill').getAttribute('aria-expanded')"), "true");
    await h.advance(1000); await h.type("   "); await h.advance(1000);
    assert.equal(h.calls.searches.length, 0);
  } finally { await h.close(); }
});

rendered("Search StrictMode effect remount preserves one usable popover and one debounced GET", async () => {
  const h = await fixture({ path: "/profile?tab=tickets&strict-qa=1" });
  try {
    await h.open(); await searchFor(h); await h.resolve(0);
    await h.browser.wait("document.querySelector('.search-result')");
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.search-overlay:popover-open').length"), 1);
    assert.equal(h.calls.searches.length, 1);
    await key(h, "Escape"); await h.browser.wait("!document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.navbar-search__pill')"), true);
  } finally { await h.close(); }
});

rendered("Search debounces a typing burst at 300ms, correctly encodes q, announces loading and renders six server-controlled results", async () => {
  const h = await fixture();
  try {
    await h.open(); await h.type("Ba"); await h.advance(299); assert.equal(h.calls.searches.length, 0);
    const query = "Batman & + / ? # % ქართული";
    await h.type(query); await h.advance(299); assert.equal(h.calls.searches.length, 0);
    await h.advance(1); await h.waitCalls(() => h.calls.searches.length === 1);
    assert.equal(h.calls.searches[0].query, query);
    assert.equal(await h.browser.evaluate("document.querySelector('.search-panel').getAttribute('aria-busy')"), "true");
    assert.match(await h.browser.evaluate("document.querySelector('.search-panel [role=status]').textContent"), /Searching/);
    const movies = Array.from({ length: 6 }, (_, index) => movie(index + 1));
    await h.resolve(0, movies); await h.browser.wait("document.querySelectorAll('.search-result').length === 6");
    assert.deepEqual(await h.browser.evaluate("[...document.querySelectorAll('.search-result__title')].map(e=>e.textContent)"), movies.map(value => value.title));
    assert.equal(await h.browser.evaluate("document.querySelector('.search-panel').getAttribute('aria-busy')"), "false");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.search-input input')"), true);
    assert.equal(h.calls.searches.length, 1);
  } finally { await h.close(); }
});

for (const stale of ["success", "HTTP rejection", "network rejection"]) rendered("Search Ba→Batman keeps newer success when old " + stale + " arrives despite ignoring abort", async () => {
  const h = await fixture({ ignoreAbort: true });
  try {
    await h.open(); await searchFor(h, "Ba");
    await h.type("Batman");
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.search-result').length"), 0);
    await h.advance(300); await h.waitCalls(() => h.calls.searches.length === 2);
    await h.resolve(1, [movie(2, { title: "Batman current" })]);
    await h.browser.wait("document.querySelector('.search-result__title')?.textContent === 'Batman current'");
    if (stale === "success") await h.resolve(0, [movie(1, { title: "Ba obsolete" })]);
    else if (stale === "HTTP rejection") await h.resolve(0, null, 500);
    else await h.reject(0);
    await h.browser.wait("window.searchQa.settled === 2"); await h.settle();
    assert.equal(await h.browser.evaluate("document.querySelector('.search-result__title').textContent"), "Batman current");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-panel [role=alert]'))"), false);
    assert.equal(await h.browser.evaluate("window.searchQa.aborts"), 1);
  } finally { await h.close(); }
});

rendered("Search query changes hide old results immediately, including a quick return to the earlier query", async () => {
  const h = await fixture();
  try {
    await h.open(); await searchFor(h, "Ba"); await h.resolve(0); await h.browser.wait("document.querySelector('.search-result')");
    await h.type("Batman"); assert.equal(await h.browser.evaluate("document.querySelectorAll('.search-result').length"), 0);
    await h.type("Ba"); assert.equal(await h.browser.evaluate("document.querySelectorAll('.search-result').length"), 0);
    await h.advance(300); await h.waitCalls(() => h.calls.searches.length === 2);
    await h.resolve(1, [movie(2)]); await h.browser.wait("document.querySelector('.search-result__title')?.textContent === 'Batman 2'");
  } finally { await h.close(); }
});

rendered("Search clear restores prompt/input focus, aborts pending work and fences its late results", async () => {
  const h = await fixture({ ignoreAbort: true });
  try {
    await h.open(); await searchFor(h);
    await h.browser.evaluate("document.querySelector('[aria-label=\"Clear search\"]').click()");
    await h.browser.wait("document.querySelector('.search-input input').value === ''");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.search-input input')"), true);
    await h.resolve(0); await h.browser.wait("window.searchQa.settled === 1"); await h.settle();
    assert.match(await h.browser.evaluate("document.querySelector('.search-panel').textContent"), /What do you want to watch/);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.search-result').length"), 0);
    await h.advance(1000); assert.equal(h.calls.searches.length, 1);
  } finally { await h.close(); }
});

for (const pending of [false, true]) rendered("Search Escape during " + (pending ? "pending GET" : "debounce") + " closes/restores focus and abandoned work cannot request or reopen", async () => {
  const h = await fixture({ ignoreAbort: true });
  try {
    await h.open(); await h.type("Batman");
    if (pending) { await h.advance(300); await h.waitCalls(() => h.calls.searches.length === 1); }
    await key(h, "Escape"); await h.browser.wait("!document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.navbar-search__pill')"), true);
    await h.advance(1000);
    if (pending) { await h.resolve(0); await h.browser.wait("window.searchQa.settled === 1"); await h.settle(); }
    assert.equal(h.calls.searches.length, pending ? 1 : 0);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-overlay'))"), false);
    await h.open(); assert.equal(await h.browser.evaluate("document.querySelector('.search-input input').value"), "");
  } finally { await h.close(); }
});

for (const failure of ["HTTP 500", "HTTP 401", "network"]) rendered("Search " + failure + " shows an understandable error; only explicit Retry sends another GET", async () => {
  const h = await fixture();
  try {
    await h.open(); await searchFor(h);
    if (failure === "network") await h.reject(0); else await h.resolve(0, null, failure === "HTTP 401" ? 401 : 500);
    await h.browser.wait("document.querySelector('.search-panel [role=alert]')");
    assert.match(await h.browser.evaluate("document.querySelector('.search-panel [role=alert]').textContent"), /Search could not be loaded/);
    await h.advance(1000); assert.equal(h.calls.searches.length, 1);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.auth-modal'))"), false);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.profile-dropdown__toggle'))"), true);
    await h.browser.evaluate("document.querySelector('.search-panel button').click()");
    await h.browser.wait("window.searchQa.pending() === 1"); await h.advance(300);
    await h.waitCalls(() => h.calls.searches.length === 2); await h.resolve(1, []);
    await h.browser.wait("document.querySelector('.search-state__title')?.textContent.includes('No results')");
    assert.equal(await h.browser.evaluate("document.querySelector('.search-panel [role=status]').textContent"), "No results for “Batman”");
    assert.equal(h.calls.searches.length, 2);
  } finally { await h.close(); }
});

rendered("Search minimal/optional data uses safe fallbacks, literal text and actual returned poster URLs", async () => {
  const h = await fixture();
  try {
    await h.open(); await searchFor(h, "img");
    const malicious = "<img src=x onerror=alert(1)> server title";
    await h.resolve(0, [{ title: malicious, slug: "minimal" }, movie(2, { kind: "event", isComingSoon: true, fromPrice: 99 })]);
    await h.browser.wait("document.querySelectorAll('.search-result').length === 2");
    assert.equal(await h.browser.evaluate("document.querySelector('.search-result__title').textContent"), malicious);
    assert.equal(await h.browser.evaluate("document.querySelector('.search-result__title img')"), null);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-result').querySelector('.search-result__price'))"), false);
    assert.match(await h.browser.evaluate("document.querySelectorAll('.search-result')[0].textContent"), /Poster unavailable/);
    assert.match(await h.browser.evaluate("document.querySelectorAll('.search-result')[1].textContent"), /Live event.*Coming Soon/);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.search-result')[1].querySelector('img').getAttribute('src')"), movie(2).posterUrl);
    assert.doesNotMatch(await h.browser.evaluate("document.querySelectorAll('.search-result')[1].textContent"), /99/);
  } finally { await h.close(); }
});

for (const comingSoon of [false, true]) rendered("Search keyboard arrows/Enter and native links navigate the exact " + (comingSoon ? "Coming Soon" : "film") + " slug without booking; Back/Forward cannot reopen Search", async () => {
  const h = await fixture();
  try {
    await h.open(); await searchFor(h);
    const selected = movie(2, { title: "Exact selected title", slug: "server/title #ქართული", isComingSoon: comingSoon });
    await h.resolve(0, [movie(1), selected]); await h.browser.wait("document.querySelectorAll('.search-result').length === 2");
    await key(h, "ArrowUp"); assert.match(await h.browser.evaluate("document.activeElement.textContent"), /Exact selected title/);
    await key(h, "Home"); assert.match(await h.browser.evaluate("document.activeElement.textContent"), /Batman 1/);
    await key(h, "ArrowUp"); assert.equal(await h.browser.evaluate("document.activeElement.matches('.search-input input')"), true);
    await key(h, "ArrowDown"); await key(h, "End"); await key(h, "Enter");
    await h.browser.wait("document.querySelector('.movie-detail-hero h1')?.textContent === 'Exact selected title'");
    assert.equal(await h.browser.evaluate("decodeURIComponent(location.pathname)"), "/movies/" + selected.slug);
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-overlay, .seat-selection, .checkout'))"), false);
    if (comingSoon) assert.match(await h.browser.evaluate("document.querySelector('.movie-detail-hero__status').textContent"), /Coming soon/i);
    await h.browser.evaluate("history.back()"); await h.browser.wait("location.pathname === '/profile'");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-overlay'))"), false);
    await h.browser.evaluate("history.forward()"); await h.browser.wait("location.pathname.startsWith('/movies/')");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-overlay'))"), false);
    assert.equal(h.calls.searches.length, 1);
  } finally { await h.close(); }
});

rendered("Search Tab leaves naturally without a global focus trap; outside pointer safely restores focus when needed", async () => {
  const h = await fixture();
  try {
    await h.open(); await key(h, "Tab"); await key(h, "Tab");
    await h.browser.wait("!document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.profile-dropdown__toggle')"), true);
    await h.open();
    await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 10, y: 250, button: "left", clickCount: 1 });
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 10, y: 250, button: "left", clickCount: 1 });
    await h.browser.wait("!document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.navbar-search__pill')"), true);
  } finally { await h.close(); }
});

rendered("Search yields to existing Login/Signup Modal ownership and cancels its pending GET", async () => {
  const h = await fixture({ guest: true, path: "/search-qa" });
  try {
    await h.open(); await searchFor(h);
    await h.browser.evaluate("[...document.querySelectorAll('.navbar__actions button')].find(b=>b.textContent.trim()==='Log in').click()");
    await h.browser.wait("document.querySelector('.auth-modal--login') && !document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("document.body.classList.contains('modal-open')"), true);
    assert.equal(await h.browser.evaluate("Boolean(document.activeElement.closest('.auth-modal'))"), true);
    assert.equal(await h.browser.evaluate("window.searchQa.aborts"), 1);
    await h.browser.evaluate("[...document.querySelectorAll('.auth-modal button')].find(b=>b.textContent.trim()==='Sign up').click()");
    await h.browser.wait("document.querySelector('.auth-modal--signup')");
    await key(h, "Escape"); await h.browser.wait("!document.querySelector('.auth-modal')");
    assert.equal(await h.browser.evaluate("Boolean(document.querySelector('.search-overlay'))"), false);
  } finally { await h.close(); }
});

rendered("Search yields to the real Refund dialog without dispatching a financial mutation", async () => {
  const h = await fixture({ orders: [order] });
  try {
    await h.open(); await h.type("Batman");
    await h.browser.wait("document.querySelector('.my-tickets__refund:not(:disabled)')");
    await h.browser.evaluate("document.querySelector('.my-tickets__refund').click()");
    await h.browser.wait("document.querySelector('.refund-dialog[open]') && !document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("Boolean(document.activeElement.closest('.refund-dialog'))"), true);
    await h.advance(1000); assert.equal(h.calls.searches.length, 0);
    await key(h, "Escape"); await h.browser.wait("!document.querySelector('.refund-dialog')");
    assert.equal(await h.browser.evaluate("document.body.classList.contains('modal-open')"), false);
  } finally { await h.close(); }
});

rendered("Search closing preserves Sessions URL filters; Browse sessions uses the existing route", async () => {
  const h = await fixture({ path: "/sessions?date=2026-10-09&search=server-filter&page=2" });
  try {
    await h.browser.wait("document.querySelector('.sessions-page') && document.querySelector('.sessions-filters')");
    const initial = await h.browser.evaluate("location.search");
    await h.open(); await searchFor(h, "independent title"); await h.resolve(0, []);
    await key(h, "Escape"); await h.browser.wait("!document.querySelector('.search-overlay')");
    assert.equal(await h.browser.evaluate("location.search"), initial);
    assert.equal(new URLSearchParams(initial).get("search"), "server-filter");
    await h.open(); await h.browser.evaluate("document.querySelector('.search-state__browse').click()");
    await h.browser.wait("location.pathname === '/sessions' && !document.querySelector('.search-overlay')");
    assert.equal(h.calls.searches.length, 1);
  } finally { await h.close(); }
});

for (const width of [1728, 1280, 768, 390]) rendered(`Search Figma geometry, real Archivo, hover/focus, long content and viewport scrolling at ${width}px`, async () => {
  const h = await fixture({ width });
  try {
    await h.open();
    await h.browser.evaluate("document.fonts.ready");
    const initial = await h.browser.evaluate("(() => {const o=document.querySelector('.search-overlay'),p=o.querySelector('.search-panel'),s=getComputedStyle(p),r=o.getBoundingClientRect(),input=o.querySelector('.search-input').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,inputWidth:input.width,inputHeight:input.height,panel:{background:s.backgroundColor,border:s.outlineColor,stroke:s.outlineWidth,radius:s.borderRadius,padding:s.padding},icon:[...o.querySelectorAll('.search-state__icon img')].map(i=>({width:i.width,height:i.height})),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()");
    assert.equal(initial.width, Math.min(480, width - 32)); assert.equal(initial.inputWidth, initial.width); assert.equal(initial.inputHeight, 41);
    assert.ok(initial.left >= 0 && initial.right <= width);
    assert.deepEqual(initial.panel, { background: "rgb(7, 12, 28)", border: "rgb(42, 44, 61)", stroke: "1px", radius: "16px", padding: "8px" });
    assert.deepEqual(initial.icon, [{ width: 24, height: 24 }]);
    assert.equal(initial.overflow, false);
    if (fontAssets) {
      await h.browser.send("DOM.enable"); await h.browser.send("CSS.enable");
      const { root } = await h.browser.send("DOM.getDocument");
      const { nodeId } = await h.browser.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".search-state__title" });
      const { fonts } = await h.browser.send("CSS.getPlatformFontsForNode", { nodeId });
      assert.ok(fonts.some(font => font.isCustomFont && font.familyName.startsWith("Archivo") && font.glyphCount > 0));
    }
    await h.capture("search-prompt-" + width);
    await searchFor(h, "Batman");
    await h.resolve(0, Array.from({ length: 6 }, (_, index) => movie(index + 1, { title: "Batman LongTitle".repeat(24), isComingSoon: index === 2 })));
    await h.browser.wait("document.querySelectorAll('.search-result').length === 6");
    const row = await h.browser.evaluate("(() => {const a=document.querySelector('.search-result'),s=getComputedStyle(a),i=a.querySelector('.movie-image'),r=a.getBoundingClientRect();return {width:r.width,height:r.height,gap:s.gap,padding:s.padding,radius:s.borderRadius,posterWidth:i.getBoundingClientRect().width,posterHeight:i.getBoundingClientRect().height,posterRadius:getComputedStyle(i).borderRadius,fit:getComputedStyle(i.querySelector('img')).objectFit,titleSize:getComputedStyle(a.querySelector('.search-result__title')).fontSize,titleWeight:getComputedStyle(a.querySelector('.search-result__title')).fontWeight,overflow:document.querySelector('.search-panel').scrollWidth>document.querySelector('.search-panel').clientWidth};})()");
    assert.equal(row.width, initial.width - 16); assert.equal(row.height, 72); assert.equal(row.gap, "14px");
    assert.equal(row.padding, "8px 20px 8px 10px"); assert.equal(row.radius, "10px");
    assert.equal(row.posterWidth, 40); assert.equal(row.posterHeight, 56); assert.equal(row.posterRadius, "6px"); assert.equal(row.fit, "cover");
    assert.equal(row.titleSize, "14px"); assert.equal(row.titleWeight, "600"); assert.equal(row.overflow, false);
    await key(h, "ArrowDown");
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).backgroundColor"), "rgba(255, 255, 255, 0.1)");
    assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
    const center = await h.browser.evaluate("(()=>{const r=document.activeElement.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...center });
    assert.equal(await h.browser.evaluate("document.querySelector('.search-result').matches(':hover')"), true);
    await h.capture("search-results-" + width);
    await h.browser.send("Emulation.setDeviceMetricsOverride", { width, height: 360, deviceScaleFactor: 1, mobile: false });
    await h.settle(); await key(h, "End");
    assert.equal(await h.browser.evaluate("(()=>{const p=document.querySelector('.search-panel'),r=document.activeElement.getBoundingClientRect();return p.scrollHeight>p.clientHeight&&r.top>=0&&r.bottom<=innerHeight;})()"), true);
    await h.browser.evaluate("document.querySelector('.search-input input').focus()");
    await h.type("NoResults".repeat(30)); await h.advance(300); await h.waitCalls(() => h.calls.searches.length === 2);
    await h.resolve(1, []); await h.browser.wait("document.querySelector('.search-state__title')?.textContent.startsWith('No results')");
    assert.equal(await h.browser.evaluate("document.querySelector('.search-state__icon img').width"), 20);
    assert.equal(await h.browser.evaluate("document.querySelector('.search-panel').scrollWidth>document.querySelector('.search-panel').clientWidth"), false);
    await h.capture("search-no-results-" + width);
    await h.type("Error".repeat(40)); await h.advance(300); await h.waitCalls(() => h.calls.searches.length === 3);
    await h.resolve(2, null, 500); await h.browser.wait("document.querySelector('.search-panel [role=alert]')");
    assert.equal(await h.browser.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth"), false);
    await h.capture("search-error-" + width);
  } finally { await h.close(); }
});
