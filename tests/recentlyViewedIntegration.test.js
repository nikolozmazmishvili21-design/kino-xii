import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";
import { localDateKey } from "../src/movie-detail/movieDetailPresentation.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const account = id => ({ id, username: `Fixture ${id}`, email: "recent@example.test", avatar: null, fullName: null, profileComplete: false, age: null });
const film = (slug, extra = {}) => ({ id: { a: 1, b: 2, c: 3 }[slug] ?? 4, slug, title: `Returned movie ${slug.toUpperCase()}`,
  posterUrl: "https://recent-fixture.test/poster.png", backdropUrl: null, genres: [{ name: "Drama" }], runtimeMinutes: 134,
  ageRating: { code: "12+", minAge: 12, description: "Returned rating" }, availableDates: [], formats: [],
  isComingSoon: false, fromPrice: 14, releaseDate: "2026-10-02", synopsis: "Returned synopsis", ...extra });
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [], maxSeatsPerOrder: 3,
  ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
let server, origin, assets;
before(async () => {
  if (!endpoint) return;
  if (process.env.KINO_NOTIFY_QA_ASSETS) assets = JSON.parse(await readFile(process.env.KINO_NOTIFY_QA_ASSETS, "utf8"));
  const committed = {};
  if (process.env.KINO_RECENT_COMMITTED === "1") {
    for (const [path, file] of [["src/pages/MovieDetailPage.jsx", "MovieDetailPage.jsx"],
      ["src/movie-detail/useMovieRead.js", "useMovieRead.js"], ["src/utils/recentlyViewedStorage.js", "recentlyViewedStorage.js"],
      ["src/pages/HomePage.jsx", "HomePage.jsx"]]) {
      committed[path] = await readFile(`.qa.local/recent-committed/${file}`, "utf8");
    }
  }
  server = await createServer({ cacheDir: "node_modules/.cache/kino-recent-vite", server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "recent-strict-fixture", enforce: "pre", transform(code, id) {
      const file = id.replaceAll("\\", "/");
      for (const [path, source] of Object.entries(committed)) if (file.endsWith(`/${path}`)) return source;
      if (id.replaceAll("\\", "/").endsWith("/src/app/AppShell.jsx")) return 'import RecentlyViewedProbe from "/tests/fixtures/recentlyViewedProbe.jsx";\n' + code
        .replace('<Navbar onOpenAuth={openAuth} />', '<RecentlyViewedProbe /><Navbar onOpenAuth={openAuth} />');
    }, resolveId(id) { if (id === "/recent-strict.jsx") return "\0recent-strict.jsx"; }, load(id) {
      if (id === "\0recent-strict.jsx") return 'import {StrictMode,createElement} from "react";import {createRoot} from "react-dom/client";import App from "/src/app/App.jsx";import "/src/styles/main.css";createRoot(document.getElementById("root")).render(createElement(StrictMode,null,createElement(App)));';
    }, transformIndexHtml: { order: "pre", handler(html) { return html.replace("/src/main.jsx", "/recent-strict.jsx"); } } }],
  });
  await server.listen(); origin = new URL(server.resolvedUrls.local[0]);
});
after(async () => { await server?.close(); });

async function fixture({ userId = null, histories = {}, path = "/", paused = [], failures = {}, overrides = {}, ignoreAbort = false,
  blockedStorage = false, sessionDates = [], completeProfile = false, pauseLogin = false } = {}) {
  const browser = await connectProfileBrowser(endpoint), tasks = new Set(), errors = [], waiters = new Set();
  const calls = { details: [], sessions: [], logins: [], posts: [], forbidden: [], exceptions: [] }, pause = new Set(paused);
  const fixtureAccount = id => ({ ...account(id), ...(completeProfile ? { profileComplete: true, age: 36, fullName: "Fixture User" } : {}) });
  let closing = false, currentUser = fixtureAccount(userId ?? 12), loginId = 12;
  const format = { id: 1, slug: "standard", name: "Standard", priceUplift: 0 }, language = { id: 1, slug: "english", name: "English" };
  const venue = { id: 1, name: "Fixture Venue", slug: "fixture-venue", city: "Tbilisi", formats: [format] }, hall = { id: 1, name: "A", venue };
  const sessionFor = date => ({ id: 101 + sessionDates.indexOf(date), date, time: "23:00", startsAt: `${date}T23:00:00+04:00`,
    timeBand: "evening", price: 14, seatsLeft: 1, isSoldOut: false, movie: film("a"), venue, hall, format, language });
  const intercept = async (method, params) => {
    try { return await browser.send(method, params); }
    catch (error) { if (/^Invalid InterceptionId[.]?$/.test(error.message)) return; throw error; }
  };
  const fulfill = (event, bytes, type = "application/json", status = 200) => intercept("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type,X-Recent-QA-Request" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }, { name: "Cache-Control", value: "no-store" },
    ], body: status === 204 ? "" : Buffer.from(bytes).toString("base64"),
  });
  const json = (event, value, status = 200) => fulfill(event, JSON.stringify(value), "application/json", status);
  const waitDetail = (slug, count = 1) => new Promise((resolve, reject) => {
    const check = () => {
      if (calls.details.filter(event => event.slug === slug && !event.fulfilled).length < count) return;
      clearTimeout(timer); waiters.delete(check); resolve();
    };
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`No intercepted detail read for ${slug}`)); }, 10000);
    waiters.add(check); check();
  });
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", event => {
    if (closing) return;
    const task = (async () => {
      const url = new URL(event.request.url), method = event.request.method;
      if (url.origin === origin.origin) return intercept("Fetch.continueRequest", { requestId: event.requestId });
      const asset = assets?.[event.request.url];
      if (asset) return fulfill(event, Buffer.from(asset.base64, "base64"), asset.contentType);
      if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return json(event, null, 204);
      if (url.hostname === "recent-fixture.test") {
        const poster = assets?.["https://notify-fixture.test/poster-29.png"];
        return poster ? fulfill(event, Buffer.from(poster.base64, "base64"), poster.contentType) : fulfill(event, pixel, "image/png");
      }
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        if (method === "GET" && url.pathname === "/api/filter-options") return json(event, { data: sessionDates.length
          ? { ...filters, venues: [venue], formats: [format], languages: [language] } : filters });
        if (method === "GET" && url.pathname === "/api/me") return json(event, { data: currentUser });
        if (method === "GET" && url.pathname === "/api/movies/featured") return json(event, { data: [film("a")] });
        if (method === "GET" && url.pathname === "/api/movies/now-playing") return json(event, { data: ["a", "b", "c"].map(slug => film(slug)) });
        if (method === "GET" && url.pathname === "/api/movies/coming-soon") return json(event, { data: [film("upcoming", { isComingSoon: true })] });
        if (method === "GET" && /^\/api\/movies\/[^/]+\/sessions$/.test(url.pathname)) {
          calls.sessions.push(event);
          const date = url.searchParams.get("date");
          return json(event, { data: [{ venue, sessions: [sessionFor(date)] }] });
        }
        if (method === "GET" && /^\/api\/sessions\/10[123](\/seats)?$/.test(url.pathname)) {
          const id = Number(url.pathname.split("/")[3]), session = sessionFor(sessionDates[id - 101]);
          return json(event, { data: url.pathname.endsWith("/seats") ? { sessionId: id, hall,
            sections: [{ name: "Stalls", rows: [{ label: "A", seats: [{ id: 1, label: "1", code: "A1", state: "available", isMine: false, aisleAfter: false }] }] }] } : session });
        }
        if (method === "GET" && /^\/api\/movies\/[^/]+$/.test(url.pathname)) {
          event.slug = decodeURIComponent(url.pathname.split("/").at(-1));
          event.generation = Number(new Headers(event.request.headers).get("X-Recent-QA-Request"));
          calls.details.push(event);
          for (const notify of [...waiters]) notify();
          if (pause.has(event.slug)) return;
          event.fulfilled = true;
          const status = failures[event.slug] ?? 200;
          return json(event, status === 200 ? { data: film(event.slug, { availableDates: sessionDates, ...overrides[event.slug] }) } : { message: "Synthetic movie refusal" }, status);
        }
        if (method === "POST" && url.pathname === "/api/login") {
          calls.logins.push(event); for (const notify of [...waiters]) notify();
          currentUser = fixtureAccount(loginId);
          if (pauseLogin) return;
          return json(event, { data: { user: currentUser, token: `synthetic-recent-${loginId}` } });
        }
        if (method === "POST" && url.pathname === "/api/logout") return json(event, { message: "Logged out" });
      }
      if (method === "POST") calls.posts.push(event.request.url);
      calls.forbidden.push({ method, url: event.request.url });
      return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => tasks.delete(task)); tasks.add(task);
  });
  const close = async () => {
    closing = true; await Promise.all([...tasks]); await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.exceptions, []); assert.deepEqual(calls.posts, []);
  };
  const stored = Object.entries(histories).map(([owner, value]) => [`kino-xii:recently-viewed:${owner}`, typeof value === "string" ? value : JSON.stringify(value)]);
  try {
    await browser.send("Network.enable"); await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `if(!sessionStorage.getItem('recent-fixture-booted')){
      localStorage.clear();for(const [key,value] of ${JSON.stringify(stored)})localStorage.setItem(key,value);
      ${userId === null ? "" : `localStorage.setItem('kino-xii.auth.token','synthetic-recent-${userId}');`}
      sessionStorage.setItem('recent-fixture-booted','true');}
      ${blockedStorage ? "Object.defineProperty(window,'localStorage',{get(){throw new Error('Synthetic storage restriction')}});" : ""}
      window.recentSettled=0;window.recentRequests=[];let sequence=0;const realFetch=window.fetch.bind(window);window.fetch=(url,options)=>{
        if(!/\\/movies\\/[^/?]+$/.test(String(url)))return realFetch(url,options);
        const request={id:++sequence,slug:decodeURIComponent(new URL(url,location.href).pathname.split('/').at(-1)),aborted:options?.signal?.aborted??false,settled:false};
        window.recentRequests.push(request);options?.signal?.addEventListener('abort',()=>{request.aborted=true},{once:true});
        const headers=new Headers(options?.headers);headers.set('X-Recent-QA-Request',String(request.id));
        return realFetch(url,{...options,headers${ignoreAbort ? ",signal:undefined" : ""}}).then(response=>{const read=response.text.bind(response);response.text=()=>read().then(text=>{window.recentSettled++;request.settled=true;return text;});return response;});};` });
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.navigate", { url: new URL(path, origin).href });
    await browser.wait("window.recentProbe && !document.querySelector('.navbar__auth-loading')");
  } catch (error) { await close(); throw error; }
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const cards = () => browser.evaluate("Array.from(document.querySelectorAll('.recently-viewed-card')).map(a=>decodeURIComponent(a.getAttribute('href').slice('/movies/'.length)))");
  const waitCards = slugs => browser.wait(`JSON.stringify(Array.from(document.querySelectorAll('.recently-viewed-card')).map(a=>decodeURIComponent(a.getAttribute('href').slice('/movies/'.length))))===${JSON.stringify(JSON.stringify(slugs))}`);
  const history = (owner = userId) => browser.evaluate(`JSON.parse(localStorage.getItem('kino-xii:recently-viewed:'+${JSON.stringify(owner ?? "guest")}))`);
  const resolveRequest = async (event, status = 200, extra = {}) => {
    assert.equal(event.fulfilled, undefined, "The exact intercepted generation must still be paused");
    event.fulfilled = true;
    await json(event, status === 200 ? { data: film(event.slug, { ...overrides[event.slug], ...extra }) }
      : { message: "Synthetic late failure" }, status);
  };
  return { browser, calls, close, settle, cards, waitCards, history, pause, failures, waitDetail, resolveRequest,
    async waitLiveDetail(slug, after = 0) {
      const expression = `window.recentRequests.findLast(r=>r.slug===${JSON.stringify(slug)} && r.id>${after} && !r.aborted && !r.settled)?.id`;
      await browser.wait(expression);
      const generation = await browser.evaluate(expression);
      return new Promise((resolve, reject) => {
        const check = () => {
          const event = calls.details.find(item => item.generation === generation);
          if (!event) return;
          clearTimeout(timer); waiters.delete(check); resolve(event);
        };
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`No interception for live detail generation ${generation}`)); }, 10000);
        waiters.add(check); check();
      });
    },
    async submitLogin() {
      await browser.wait("document.querySelector('.auth-modal input[type=email]')");
      await browser.evaluate(`(() => {for(const [type,value] of [['email','recent@example.test'],['password','synthetic']]){
        const input=document.querySelector('.auth-modal input[type='+type+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
        document.querySelector('.auth-modal form').requestSubmit();})()`);
      await browser.wait("document.querySelector('.auth-modal form[aria-busy=true]')");
    },
    async resolveLogin() {
      await new Promise((resolve, reject) => {
        const check = () => { if (!calls.logins.length) return; clearTimeout(timer); waiters.delete(check); resolve(); };
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error("No intercepted Login")); }, 10000); waiters.add(check); check();
      });
      await json(calls.logins[0], { data: { user: currentUser, token: `synthetic-recent-${loginId}` } });
      await browser.wait("!document.querySelector('.auth-modal') && document.querySelector('.profile-dropdown__toggle')");
    },
    async home() {
      await browser.evaluate("document.querySelector('.navbar a[href=\"/\"]').click()");
      await browser.wait("location.pathname==='/' && document.querySelector('.movie-card__buy')");
    },
    async open(slug, wait = true) {
      await browser.wait(`document.querySelector('.movie-card__buy[href="/movies/${encodeURIComponent(slug)}"]')`);
      await browser.evaluate(`document.querySelector('.movie-card__buy[href="/movies/${encodeURIComponent(slug)}"]').click()`);
      await browser.wait(`location.pathname===${JSON.stringify(`/movies/${encodeURIComponent(slug)}`)}`);
      if (wait) await browser.wait("document.querySelector('.movie-detail-hero h1')");
    },
    async login(id) { loginId = id; await browser.evaluate("window.recentProbe.login()"); await browser.wait("document.querySelector('.profile-dropdown__toggle')"); },
    async logout() { await browser.evaluate("window.recentProbe.logout()"); await browser.wait("!document.querySelector('.profile-dropdown__toggle')"); },
    async resolve(slug, status = 200) {
      await waitDetail(slug);
      for (const event of calls.details.filter(item => item.slug === slug && !item.fulfilled)) {
        event.fulfilled = true; await json(event, status === 200 ? { data: film(slug, overrides[slug]) } : { message: "Synthetic late failure" }, status);
      }
      await settle();
    },
    async capture(name) {
      await browser.evaluate("document.querySelector('.home-section--recently-viewed').scrollIntoView({block:'center'})");
      await browser.evaluate("document.fonts.ready"); await settle();
      const { data } = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const dir = "node_modules/.cache/kino-recent-ui"; await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${name}.png`, Buffer.from(data, "base64"));
    },
  };
}

const dateFixtures = () => [0, 1, 2].map(offset => { const date = new Date(); date.setDate(date.getDate() + offset); return localDateKey(date); });

for (const entry of ["Navbar", "protected-action"]) rendered(`Movie Detail auth regression: ${entry} Login and logout preserve the third date without reloading`, async t => {
  const dates = dateFixtures();
  const h = await fixture({ path: "/movies/a", sessionDates: dates, completeProfile: true, pauseLogin: true });
  const selectThird = async () => {
    await h.browser.wait("document.querySelectorAll('.movie-date:not(:disabled)').length===3");
    await h.browser.evaluate("document.querySelectorAll('.movie-date:not(:disabled)')[2].click()");
    await h.browser.wait(`document.querySelector('.movie-ticket')?.getAttribute('aria-label').includes(${JSON.stringify(dates[2])})`);
  };
  const snapshot = async () => ({ reads: h.calls.details.length, ...await h.browser.evaluate(`({
    selected: [...document.querySelectorAll('.movie-date:not(:disabled)')].findIndex(b=>b.getAttribute('aria-pressed')==='true'),
    sameSessions:document.querySelector('.movie-sessions')===window.originalSessions,
    loadingSeen:window.detailLoadingSeen,
  })`) });
  try {
    await selectThird();
    await h.browser.evaluate(`window.originalSessions=document.querySelector('.movie-sessions');window.detailLoadingSeen=0;
      window.detailObserver=new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes){
        if(n.nodeType===1&&((n.matches('.movie-detail-state')&&n.textContent.includes('Loading movie'))||
          [...n.querySelectorAll('.movie-detail-state')].some(e=>e.textContent.includes('Loading movie'))))window.detailLoadingSeen++;}});
      window.detailObserver.observe(document.querySelector('.movie-detail-page'),{childList:true,subtree:true});`);
    const before = await snapshot();
    await h.browser.evaluate(entry === "Navbar" ? "document.querySelector('.navbar__actions .button--secondary').click()" : "document.querySelector('.movie-ticket').click()");
    await h.submitLogin(); await h.settle(); const duringLogin = await snapshot();
    await h.resolveLogin();
    if (entry === "protected-action") {
      await h.browser.wait("document.querySelector('.seat-selection .seat-map') || document.querySelector('.seat-selection [aria-label=\"Close Seat Selection\"]')");
      await h.browser.evaluate("document.querySelector('.seat-selection__close').click()");
      await h.browser.wait("!document.querySelector('.seat-selection')");
    }
    await h.browser.wait("document.querySelector('.movie-ticket')"); await h.settle();
    const afterLogin = await snapshot();
    if (entry === "Navbar") {
      await h.browser.evaluate("document.querySelector('.movie-ticket').click()");
      await h.browser.wait("document.querySelector('.seat-selection')");
      await h.browser.evaluate("document.querySelector('.seat-selection__close').click()");
      await h.browser.wait("!document.querySelector('.seat-selection')");
    }
    await selectThird();
    const beforeLogout = await snapshot();
    await h.browser.evaluate("document.querySelector('.profile-dropdown__toggle').click()");
    await h.browser.wait("document.querySelector('.profile-dropdown__logout')");
    await h.browser.evaluate("document.querySelector('.profile-dropdown__logout').click()");
    await h.browser.wait("document.querySelector('.navbar__actions') && document.querySelector('.movie-ticket')"); await h.settle();
    const afterLogout = await snapshot();
    t.diagnostic(JSON.stringify({ entry, before, duringLogin, afterLogin, beforeLogout, afterLogout }));
    for (const state of [duringLogin, afterLogin, afterLogout]) {
      assert.equal(state.reads, before.reads, "Authentication must not issue a Movie Detail GET");
      assert.equal(state.selected, 2, "Third session date must remain selected");
      assert.equal(state.sameSessions, true, "MovieSessions must remain mounted");
      assert.equal(state.loadingSeen, 0, "Loading movie must not reappear");
    }
    assert.equal(h.calls.posts.length, 0);
    if (process.env.KINO_RECENT_COMMITTED !== "1") {
      assert.deepEqual(await h.history(null), ["a"]);
      assert.equal(await h.history(12), null, "Login does not copy a previously guest-owned visit");
    }
  } finally { await h.close(); }
});

rendered("Movie Detail route changes and Back/Forward load the actual movie without stale results", async () => {
  const h = await fixture({ sessionDates: dateFixtures() });
  try {
    await h.open("a"); await h.home(); await h.open("b");
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-detail-hero h1').textContent"), "Returned movie B");
    const count = h.calls.details.length;
    await h.browser.evaluate("history.back()"); await h.browser.wait("location.pathname==='/' && document.querySelector('.movie-card__buy')");
    await h.browser.evaluate("history.back()"); await h.browser.wait("location.pathname==='/movies/a' && document.querySelector('.movie-detail-hero h1')?.textContent==='Returned movie A'");
    assert.ok(h.calls.details.length > count);
    await h.browser.evaluate("history.forward()"); await h.browser.wait("location.pathname==='/'");
    await h.browser.evaluate("history.forward()"); await h.browser.wait("location.pathname==='/movies/b' && document.querySelector('.movie-detail-hero h1')?.textContent==='Returned movie B'");
    assert.deepEqual(await h.history(), ["b", "a"]);
  } finally { await h.close(); }
});

rendered("fresh guest Home preserves its layout without an empty Recently Viewed section", async () => {
  const h = await fixture();
  try {
    await h.browser.wait("document.querySelector('.movie-card__buy')"); await h.settle();
    assert.equal(await h.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
    assert.equal(h.calls.details.length, 0);
  } finally { await h.close(); }
});

for (const userId of [null, 12]) rendered(`${userId === null ? "guest" : "authenticated"} visits A, B, A, C order two cards and survive refresh`, async () => {
  const h = await fixture({ userId });
  try {
    for (const [slug, expected] of [["a", ["a"]], ["b", ["b", "a"]], ["a", ["a", "b"]], ["c", ["c", "a"]]]) {
      await h.open(slug); await h.home(); await h.waitCards(expected); assert.deepEqual(await h.cards(), expected);
    }
    assert.deepEqual(await h.history(), ["c", "a", "b"]);
    await h.browser.send("Page.reload"); await h.waitCards(["c", "a"]);
    assert.deepEqual(await h.history(), ["c", "a", "b"]);
  } finally { await h.close(); }
});

rendered("direct Movie Detail records the returned canonical slug only after successful load", async () => {
  const h = await fixture({ path: "/movies/alias", overrides: { alias: { slug: "a" } } });
  try {
    await h.browser.wait("document.querySelector('.movie-detail-hero h1')"); await h.home(); await h.waitCards(["a"]);
    assert.deepEqual(await h.history(), ["a"]);
  } finally { await h.close(); }
});
for (const status of [404, 500]) rendered(`failed Movie Detail ${status} records no history`, async () => {
  const h = await fixture({ path: "/movies/a", failures: { a: status } });
  try {
    await h.browser.wait("document.querySelector('.movie-detail-state[role=alert]')"); await h.home(); await h.settle();
    assert.equal(await h.history(), null); assert.equal(await h.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
  } finally { await h.close(); }
});

rendered("Movie Detail without an actual slug or title does not record a placeholder visit", async () => {
  for (const fields of [{ slug: null }, { slug: " " }, { title: " " }]) {
    const h = await fixture({ path: "/movies/a", overrides: { a: fields } });
    try {
      await h.browser.wait("document.querySelector('.movie-detail-hero')"); await h.home(); await h.settle();
      assert.equal(await h.history(), null); assert.equal(await h.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
    } finally { await h.close(); }
  }
});

rendered("invalid browser history and unavailable localStorage do not crash Home or Movie Detail", async () => {
  for (const options of [{ histories: { guest: "{bad JSON" } }, { blockedStorage: true }]) {
    const h = await fixture(options);
    try {
      await h.browser.wait("document.querySelector('.movie-card__buy')");
      assert.equal(await h.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
      await h.open("a"); await h.home(); await h.settle();
      if (!options.blockedStorage) { await h.waitCards(["a"]); assert.deepEqual(await h.history(), ["a"]); }
      else assert.equal(await h.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
    } finally { await h.close(); }
  }
});

rendered("Home prunes a 404 and backfills two current API cards without recording its own reads", async () => {
  const h = await fixture({ histories: { guest: ["missing", "b", "a"] }, failures: { missing: 404 } });
  try { await h.waitCards(["b", "a"]); assert.deepEqual(await h.history(), ["b", "a"]); }
  finally { await h.close(); }
});
rendered("all missing history disappears; transient errors preserve slugs and permit explicit retry", async () => {
  const missing = await fixture({ histories: { guest: ["a"] }, failures: { a: 404 } });
  try {
    await missing.browser.wait("localStorage.getItem('kino-xii:recently-viewed:guest')==='[]'");
    assert.equal(await missing.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
  } finally { await missing.close(); }
  const h = await fixture({ histories: { guest: ["a"] }, failures: { a: 500 } });
  try {
    await h.browser.wait("document.querySelector('.recently-viewed-error [role=alert]')"); assert.deepEqual(await h.history(), ["a"]);
    delete h.failures.a; await h.browser.evaluate("document.querySelector('.recently-viewed-error button').click()");
    await h.waitCards(["a"]); assert.equal(await h.browser.evaluate("document.querySelector('.recently-viewed-error')"), null);
  } finally { await h.close(); }
});

rendered("guest, A and B histories switch on Login/logout without merging", async () => {
  const h = await fixture({ histories: { guest: ["a"], 12: ["b"], 13: ["c"] } });
  try {
    await h.waitCards(["a"]); await h.login(12); await h.waitCards(["b"]);
    await h.login(13); await h.waitCards(["c"]); await h.logout(); await h.waitCards(["a"]);
    assert.deepEqual(await h.history(null), ["a"]); assert.deepEqual(await h.history(12), ["b"]); assert.deepEqual(await h.history(13), ["c"]);
  } finally { await h.close(); }
});

for (const status of [200, 404]) rendered(`late account A history ${status} cannot expose data or prune after switching to B`, async () => {
  const h = await fixture({ userId: 12, histories: { 12: ["a"], 13: ["b"] }, paused: ["a"], ignoreAbort: true });
  try {
    await h.waitDetail("a"); assert.match(await h.browser.evaluate("document.querySelector('.home-section--recently-viewed [role=status]').textContent"), /Loading/);
    await h.login(13); await h.waitCards(["b"]);
    const settled = await h.browser.evaluate("window.recentSettled"); await h.resolve("a", status);
    await h.browser.wait(`window.recentSettled>${settled}`); await h.settle();
    assert.deepEqual(await h.cards(), ["b"]); assert.deepEqual(await h.history(12), ["a"]); assert.deepEqual(await h.history(13), ["b"]);
  } finally { await h.close(); }
});

rendered("same-session authentication restoration restarts a paused history read without stranding loading", async () => {
  const h = await fixture({ userId: 12, histories: { 12: ["a"] }, paused: ["a"] });
  try {
    const initial = await h.waitLiveDetail("a");
    await h.browser.evaluate("window.recentProbe.restoreSession()");
    const restored = await h.waitLiveDetail("a", initial.generation);
    assert.equal(await h.browser.evaluate(`window.recentRequests.find(r=>r.id===${initial.generation}).aborted`), true);
    const title = `Restored request ${restored.generation}`;
    // Fulfill only the replacement generation, leaving every obsolete read paused.
    await h.resolveRequest(restored, 200, { title }); await h.waitCards(["a"]);
    assert.equal(await h.browser.evaluate("document.querySelector('.recently-viewed-card h3').textContent"), title);
    assert.deepEqual(await h.history(12), ["a"]);
    assert.equal(await h.browser.evaluate("document.querySelector('.home-section--recently-viewed [role=status]')"), null);
  } finally { await h.close(); }
});

rendered("rapid navigation ignores an abort-ignoring old Movie Detail response", async () => {
  const h = await fixture({ paused: ["a"], ignoreAbort: true });
  try {
    await h.open("a", false); await h.waitDetail("a"); await h.home(); await h.open("b");
    const settled = await h.browser.evaluate("window.recentSettled"); await h.resolve("a"); await h.browser.wait(`window.recentSettled>${settled}`);
    await h.home(); await h.waitCards(["b"]); assert.deepEqual(await h.history(), ["b"]);
  } finally { await h.close(); }
});

rendered("detail read started for A cannot record a late success into B history", async () => {
  const h = await fixture({ userId: 12, paused: ["a"], ignoreAbort: true });
  try {
    await h.open("a", false); await h.waitLiveDetail("a");
    const reads = await h.browser.evaluate("window.recentRequests.length");
    await h.login(13);
    const settled = await h.browser.evaluate("window.recentSettled"); await h.resolve("a"); await h.browser.wait(`window.recentSettled>${settled}`); await h.settle();
    assert.equal(await h.history(12), null); assert.equal(await h.history(13), null);
    await h.browser.wait("document.querySelector('.movie-detail-hero h1')");
    assert.equal(await h.browser.evaluate("window.recentRequests.length"), reads, "Account switching must not reload public movie metadata");
    await h.home();
    assert.equal(await h.browser.evaluate("document.querySelector('#recently-viewed-title')"), null);
  } finally { await h.close(); }
});

for (const activation of ["pointer", "keyboard"]) rendered(`Recently Viewed ${activation} opens the exact Movie Detail route without booking`, async () => {
  const h = await fixture({ histories: { guest: ["a", "b"] } });
  const press = async key => {
    const code = { Tab: 9, Enter: 13 }[key];
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, ...(key === "Enter" ? { text: "\r" } : {}) });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
  };
  try {
    await h.waitCards(["a", "b"]);
    assert.equal(await h.browser.evaluate("document.querySelector('.recently-viewed-card img').alt"), "Returned movie A poster");
    if (activation === "keyboard") {
      for (let i = 0; i < 40 && !(await h.browser.evaluate("document.activeElement===document.querySelector('.recently-viewed-card')")); i++) await press("Tab");
      assert.equal(await h.browser.evaluate("document.activeElement===document.querySelector('.recently-viewed-card')"), true);
      assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
      assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid"); await press("Enter");
    } else {
      await h.browser.evaluate("document.querySelector('.recently-viewed-card').scrollIntoView({block:'center'})");
      const point = await h.browser.evaluate("(() => {const r=document.querySelector('.recently-viewed-card').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      assert.equal(await h.browser.evaluate("document.querySelector('.recently-viewed-card').matches(':hover')"), true);
      await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      assert.equal(await h.browser.evaluate("document.querySelector('.recently-viewed-card').matches(':active')"), true);
      await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
    await h.browser.wait("location.pathname==='/movies/a' && document.querySelector('.movie-detail-hero h1')");
    assert.equal(await h.browser.evaluate("document.querySelector('.seat-selection')"), null); assert.equal(h.calls.posts.length, 0);
  } finally { await h.close(); }
});

rendered("missing optional API metadata uses the poster fallback without invented values or clipping long titles", async () => {
  const title = "Returned long movie title ".repeat(20);
  const h = await fixture({ histories: { guest: ["a"] }, overrides: { a: { title, posterUrl: null, genres: null, runtimeMinutes: null, ageRating: null } } });
  try {
    await h.waitCards(["a"]);
    const result = await h.browser.evaluate("(() => {const c=document.querySelector('.recently-viewed-card'),t=c.querySelector('h3');return {title:t.textContent,tooltip:t.title,fallback:c.querySelector('.movie-image__fallback').textContent,metadata:c.querySelector('.movie-card__metadata'),badge:c.querySelector('.movie-age'),overflow:getComputedStyle(t).textOverflow,height:c.getBoundingClientRect().height};})()");
    assert.equal(result.title, title); assert.equal(result.tooltip, title); assert.match(result.fallback, /Poster unavailable/);
    assert.equal(result.metadata, null); assert.equal(result.badge, null); assert.equal(result.overflow, "ellipsis"); assert.equal(result.height, 87);
  } finally { await h.close(); }
});

rendered("1920×1080 Recently Viewed matches Figma pair, section spacing and card geometry", async () => {
  const h = await fixture({ histories: { guest: ["a", "b"] } });
  try {
    await h.waitCards(["a", "b"]); await h.browser.evaluate("document.fonts.ready");
    const result = await h.browser.evaluate(`(() => {const section=document.querySelector('.home-section--recently-viewed'),cards=[...section.querySelectorAll('.recently-viewed-card')],card=cards[0],image=card.querySelector('.movie-image'),content=card.querySelector('.recently-viewed-card__content'),heading=section.querySelector('h2'),title=card.querySelector('h3'),metadata=card.querySelector('p'),r=e=>e.getBoundingClientRect(),s=e=>getComputedStyle(e);return {viewport:[innerWidth,innerHeight],count:cards.length,width:r(card).width,height:r(card).height,x:r(card).x,gap:r(cards[1]).left-r(card).right,background:s(card).backgroundColor,radius:s(card).borderRadius,padding:s(card).padding,image:[r(image).width,r(image).height,s(image).borderRadius],content:r(content).width,title:[s(title).fontFamily,s(title).fontSize,s(title).fontWeight],metadata:[s(metadata).fontSize,s(metadata).fontWeight],section:[s(section).paddingTop,s(section).gap,s(heading).textTransform],belowHeading:r(card).top-r(heading).bottom,next:section.nextElementSibling.className,then:section.nextElementSibling.nextElementSibling.getAttribute('aria-labelledby'),badge:card.querySelector('.movie-age').textContent};})()`);
    assert.deepEqual(result.viewport, [1920, 1080]); assert.equal(result.count, 2); assert.ok(Math.abs(result.width - 329.121) < 0.02);
    assert.equal(result.height, 87); assert.equal(result.x, 70); assert.equal(result.gap, 20); assert.equal(result.background, "rgb(30, 32, 49)");
    assert.equal(result.radius, "16px"); assert.equal(result.padding, "10px"); assert.ok(Math.abs(result.image[0] - 87.121) < 0.02);
    assert.deepEqual(result.image.slice(1), [67, "8px"]); assert.equal(result.content, 210);
    assert.match(result.title[0], /Archivo/); assert.deepEqual(result.title.slice(1), ["14px", "800"]); assert.deepEqual(result.metadata, ["12px", "400"]);
    assert.deepEqual(result.section, ["9px", "20px", "none"]); assert.equal(result.belowHeading, 20);
    assert.equal(result.next, "home-page__divider"); assert.equal(result.then, "now-playing-title"); assert.equal(result.badge, "Age rating: 12+");
    await h.capture("recently-viewed-1920");
    await writeFile("node_modules/.cache/kino-recent-ui/geometry.json", JSON.stringify(result, null, 2));
    const point = await h.browser.evaluate("(() => {const r=document.querySelector('.recently-viewed-card').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.recently-viewed-card')).filter"), "drop-shadow(rgba(0, 0, 0, 0.2) 0px 4px 12px)");
    await h.capture("recently-viewed-hover-1920");
    await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    assert.equal(await h.browser.evaluate("document.querySelector('.recently-viewed-card').matches(':active')"), true);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.recently-viewed-card')).filter"), "drop-shadow(rgba(0, 0, 0, 0.2) 0px 4px 12px)");
    await h.capture("recently-viewed-pressed-1920");
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  } finally { await h.close(); }
});
