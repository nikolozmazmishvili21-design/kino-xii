import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const film = (id, extra = {}) => ({ id, slug: `server-hero-${id}`, title: `API featured movie ${id}`,
  backdropUrl: `https://hero-fixture.test/backdrop-${id - 1}.svg`, posterUrl: null, runtimeMinutes: 134,
  ageRating: { code: "12+", minAge: 12 }, formats: [{ id: 1, name: "Standard" }], genres: [],
  isComingSoon: false, availableDates: [], ...extra });
const movies = [1, 2, 3, 4].map(id => film(id));
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [], maxSeatsPerOrder: 3,
  ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
let server, origin, assets;
before(async () => {
  if (!endpoint) return;
  if (process.env.KINO_NOTIFY_QA_ASSETS) assets = JSON.parse(await readFile(process.env.KINO_NOTIFY_QA_ASSETS, "utf8"));
  server = await createServer({ cacheDir: "node_modules/.cache/kino-hero-vite", server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "hero-strict-clock", enforce: "pre", transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/components/home/useHeroPlayback.js")) return code
        .replace("count: movies.length,", "count: movies.length, requestFrame: window.heroQA.requestFrame, cancelFrame: window.heroQA.cancelFrame, now: window.heroQA.now,")
        .replace("onChange: setSlide,", "onChange: next => { window.heroQA.states.push({...next, at:window.heroQA.now()}); setSlide(next); },");
    }, resolveId(id) { if (id === "/hero-strict.jsx") return "\0hero-strict.jsx"; }, load(id) {
      if (id === "\0hero-strict.jsx") return 'import {StrictMode,createElement} from "react";import {createRoot} from "react-dom/client";import App from "/src/app/App.jsx";import "/src/styles/main.css";const app=createElement(App);createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).get("strict")==="false"?app:createElement(StrictMode,null,app));';
    }, transformIndexHtml: { order: "pre", handler(html) { return html.replace("/src/main.jsx", "/hero-strict.jsx"); } } }],
  });
  await server.listen(); origin = new URL(server.resolvedUrls.local[0]);
});
after(async () => { await server?.close(); });

async function fixture({ featured = movies, width = 1920, height = 1080, virtual = true, reduced = false,
  pauseFeatured = false, failed = false, pauseImage = null, brokenImage = null, referenceImages = false,
  strict = true, pauseDecodes = [], pauseImages = [] } = {}) {
  // Cold Vite transforms can exceed the helper's default command budget on a busy QA host.
  const browser = await connectProfileBrowser(endpoint, { commandTimeoutMs: 15000 }), tasks = new Set(), errors = [], waiters = new Set();
  const calls = { featured: [], images: [], forbidden: [], exceptions: [] };
  let closing = false, failure = failed;
  const intercept = async (method, params) => {
    try { return await browser.send(method, params); }
    catch (error) { if (/^Invalid InterceptionId[.]?$/.test(error.message)) return; throw error; }
  };
  const fulfill = (event, bytes, type = "application/json", status = 200) => intercept("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,OPTIONS" }, { name: "Cache-Control", value: "no-store" },
    ], body: status === 204 ? "" : Buffer.from(bytes).toString("base64"),
  });
  const json = (event, data, status = 200) => fulfill(event, JSON.stringify(data), "application/json", status);
  const resolveFeatured = event => json(event, failure ? { message: "Synthetic featured failure" } : { data: featured }, failure ? 500 : 200);
  const resolveImage = async event => {
    const index = Number(new URL(event.request.url).pathname.match(/\d+/)[0]);
    if (index === brokenImage) return fulfill(event, "Broken image", "image/png");
    if (referenceImages && process.env.KINO_HERO_REFERENCE_ASSETS) return fulfill(event,
      await readFile(`${process.env.KINO_HERO_REFERENCE_ASSETS}/backdrop-${index}.png`), "image/png");
    return fulfill(event, `<svg xmlns="http://www.w3.org/2000/svg" width="1728" height="1063"><rect width="1728" height="1063" fill="${["#305070", "#805030", "#306050", "#604070"][index]}"/><circle cx="1200" cy="500" r="240" fill="${["#b06040", "#4060b0", "#d0b060", "#80b0c0"][index]}"/></svg>`, "image/svg+xml");
  };
  const waitCall = (kind, predicate = () => true) => new Promise((resolve, reject) => {
    const check = () => { const event = calls[kind].find(predicate); if (!event) return; clearTimeout(timer); waiters.delete(check); resolve(event); };
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`Missing intercepted ${kind} request`)); }, 10000);
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
      if (url.hostname === "hero-fixture.test") {
        calls.images.push(event); for (const notify of [...waiters]) notify();
        if (Number(url.pathname.match(/\d+/)[0]) === pauseImage || pauseImages.includes(Number(url.pathname.match(/\d+/)[0]))) return;
        return resolveImage(event);
      }
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        if (method === "GET" && url.pathname === "/api/filter-options") return json(event, { data: filters });
        if (method === "GET" && url.pathname === "/api/movies/featured") {
          calls.featured.push(event); for (const notify of [...waiters]) notify();
          if (pauseFeatured) return;
          return resolveFeatured(event);
        }
        if (method === "GET" && url.pathname === "/api/movies/now-playing") return json(event, { data: [film(5, { backdropUrl: null })] });
        if (method === "GET" && url.pathname === "/api/movies/coming-soon") return json(event, { data: [film(6, { backdropUrl: null, isComingSoon: true })] });
        if (method === "GET" && /^\/api\/movies\/server-hero-\d+$/.test(url.pathname)) return json(event, { data: film(Number(url.pathname.split("-").at(-1))) });
        if (method === "GET" && url.pathname === "/api/sessions") return json(event, { data: [], meta: { currentPage: 1, lastPage: 1, perPage: 15, total: 0 } });
      }
      calls.forbidden.push({ method, url: event.request.url });
      return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => tasks.delete(task)); tasks.add(task);
  });
  const close = async () => {
    closing = true; await Promise.all([...tasks]); await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.exceptions, []); assert.deepEqual(calls.forbidden, []);
  };
  try {
    await browser.send("Network.enable"); await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.clear();
      (()=>{let clock=0,sequence=0;const jobs=new Map(),raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
      window.heroQA={states:[],maxPending:0,now:()=>${virtual ? "clock" : "performance.now()"},
      requestFrame(callback){const id=++sequence;const native=${virtual ? "null" : "raf(time=>{jobs.delete(id);callback(time);})"};jobs.set(id,{callback,native});window.heroQA.maxPending=Math.max(window.heroQA.maxPending,jobs.size);return id;},
      cancelFrame(id){const job=jobs.get(id);if(job?.native!==null)cancel(job?.native);jobs.delete(id);},
      step(ms){clock+=ms;const batch=[...jobs.values()];jobs.clear();batch.forEach(job=>job.callback(clock));},pending:()=>jobs.size};
      const decode=HTMLImageElement.prototype.decode,held=new Map();
      window.heroQA.heldDecodes=()=>[...held.keys()];window.heroQA.releaseDecode=index=>{held.get(index)?.();held.delete(index);};
      HTMLImageElement.prototype.decode=function(){const decoded=decode.call(this),match=this.src.match(/backdrop-(\\d+)/);
        if(!match||!${JSON.stringify(pauseDecodes)}.includes(Number(match[1])))return decoded;
        return decoded.then(()=>new Promise(resolve=>held.set(Number(match[1]),resolve)));};})();` });
    await browser.send("Page.navigate", { url: strict ? origin.href : `${origin.href}?strict=false` });
    await browser.wait("document.querySelector('.home-hero') && !document.querySelector('.navbar__auth-loading')");
  } catch (error) { await close(); throw error; }
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const state = () => browser.evaluate("window.heroQA.states.at(-1)");
  const waitReady = async () => {
    await browser.wait("document.querySelector('.home-hero__slide--active')");
    if (pauseImage === null && pauseImages.length === 0) await browser.wait("[...document.querySelectorAll('.home-hero .movie-image img')].every(img=>img.complete)");
    await settle();
  };
  const step = async ms => { await browser.evaluate(`window.heroQA.step(${ms})`); await settle(); };
  const click = async direction => { await browser.evaluate(`document.querySelector('.home-hero__arrow${direction > 0 ? "--next" : ":not(.home-hero__arrow--next)"}').click()`); await settle(); };
  const pointer = async (x, y) => { await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await settle(); };
  const mouseClick = async direction => {
    const point = await browser.evaluate(`(() => {const r=document.querySelector('.home-hero__arrow${direction > 0 ? "--next" : ":not(.home-hero__arrow--next)"}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await pointer(point.x, point.y);
    await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point }); await settle();
  };
  const press = async key => {
    const code = key === " " ? "Space" : key, windowsVirtualKeyCode = key === " " ? 32 : key === "Enter" ? 13 : 9;
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : {}) });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode }); await settle();
  };
  const activeIndex = () => browser.evaluate("[...document.querySelectorAll('.home-hero__slide')].indexOf(document.querySelector('.home-hero__slide--active'))");
  return { browser, calls, close, state, step, click, settle, waitReady, waitCall, pointer, mouseClick, press, activeIndex,
    async releaseDecode(index) { await browser.evaluate(`window.heroQA.releaseDecode(${index})`); await settle(); },
    async resolveFeatured() { failure = false; for (const event of calls.featured) await resolveFeatured(event); await settle(); },
    async resolveImage(index) { await resolveImage(await waitCall("images", e => Number(new URL(e.request.url).pathname.match(/\d+/)[0]) === index)); await settle(); },
    async capture(name) { await browser.evaluate("document.fonts.ready"); await settle(); const result = await browser.send("Page.captureScreenshot", { format: "png" });
      const dir = "node_modules/.cache/kino-hero-ui"; await mkdir(dir, { recursive: true }); await writeFile(`${dir}/${name}.png`, Buffer.from(result.data, "base64")); },
  };
}

for (const [width, height] of [[1920, 1080], [1728, 900]]) for (const strict of [false, true]) for (const direction of [1, -1]) {
  rendered(`Hero pointer regression ${direction > 0 ? "Next" : "Previous"} ${strict ? "StrictMode" : "normal"} ${width}x${height}`, async t => {
    const h = await fixture({ width, height, strict, virtual: false });
    try {
      await h.waitReady(); await h.browser.wait("window.heroQA.states.at(-1)?.index===1 && window.heroQA.states.at(-1)?.phase==='holding'");
      await h.mouseClick(direction); const selected = (1 + direction + movies.length) % movies.length;
      assert.equal(await h.activeIndex(), selected);
      assert.equal(await h.browser.evaluate("document.activeElement.matches('.home-hero__arrow')"), true);
      assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), false);
      const clicked = await h.state(), clickedAt = clicked.at;
      await h.pointer(10, height - 10);
      // Native elapsed time exceeds two complete dwell/fade intervals, without another click.
      await new Promise(resolve => setTimeout(resolve, 8300));
      const changes = await h.browser.evaluate(`window.heroQA.states.filter(s=>s.phase==='fading' && s.generation>${clicked.generation}).filter((s,i,all)=>i===0||s.generation!==all[i-1].generation)`);
      t.diagnostic(JSON.stringify({ width, strict, direction, clickedAt, autoAfterClick: changes.map(s => ({ index: s.index, ms: s.at - clickedAt })) }));
      assert.equal(changes.length, 2);
      assert.deepEqual(changes.map(s => s.index), [(selected + 1) % movies.length, (selected + 2) % movies.length]);
      assert.equal(await h.activeIndex(), (selected + 2) % movies.length);
      assert.equal(await h.browser.evaluate("document.querySelector('.home-hero__slide--active h2').textContent"), film((selected + 2) % movies.length + 1).title);
      assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
      assert.equal(await h.browser.evaluate("document.activeElement.matches('.home-hero__arrow')"), true);
    } finally { await h.close(); }
  });
}

rendered("Hero pointer progress and rapid clicks keep one clock and coherent crossfade order", async () => {
  const h = await fixture();
  try {
    await h.waitReady(); await h.step(1800); await h.mouseClick(1);
    assert.equal(await h.activeIndex(), 1);
    assert.equal(await h.browser.evaluate("Number(document.querySelector('.home-hero__playback').style.getPropertyValue('--hero-progress'))"), 0);
    for (const direction of [-1, 1, -1, 1]) await h.mouseClick(direction);
    assert.equal(await h.activeIndex(), 1);
    assert.equal(await h.browser.evaluate("document.querySelectorAll('.home-hero__slide--previous').length"), 1);
    await h.pointer(10, 1000); await h.step(300); await h.step(1500);
    assert.equal(await h.browser.evaluate("Number(document.querySelector('.home-hero__playback').style.getPropertyValue('--hero-progress'))"), 0.5);
    await h.step(1499); assert.equal(await h.activeIndex(), 1);
    await h.step(1); assert.equal(await h.activeIndex(), 2);
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
  } finally { await h.close(); }
});

rendered("Hero keyboard focus leaves to resume and pointer input clears an earlier keyboard pause", async () => {
  const h = await fixture();
  try {
    await h.waitReady(); await h.step(1000);
    for (let i = 0; i < 30 && !(await h.browser.evaluate("document.activeElement.matches('.home-hero__arrow--next')")); i++) await h.press("Tab");
    assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
    await h.step(8000); assert.equal(await h.activeIndex(), 0);
    await h.press("Enter"); await h.step(300); assert.equal(await h.activeIndex(), 1);
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.home-hero__arrow--next')"), true);
    await h.press("Tab"); await h.step(2999); assert.equal(await h.activeIndex(), 1);
    await h.step(1); assert.equal(await h.activeIndex(), 2); await h.step(300);
    // Native Tab sequence re-enters the Hero; pointer activation must release that pause too.
    for (let i = 0; i < 60 && !(await h.browser.evaluate("document.activeElement.matches('.home-hero__arrow--next')")); i++) await h.press("Tab");
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.home-hero__arrow--next')"), true);
    await h.mouseClick(1); assert.equal(await h.activeIndex(), 3);
    await h.pointer(10, 1000); await h.step(300); await h.step(3000); assert.equal(await h.activeIndex(), 0);
    // Keyboard use on an already pointer-focused arrow must pause without requiring a new focus event.
    await h.step(300); await h.press(" "); await h.step(300); assert.equal(await h.activeIndex(), 1);
    await h.step(8000); assert.equal(await h.activeIndex(), 1);
    assert.equal(await h.browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
  } finally { await h.close(); }
});

rendered("Hero decode recovery manual Previous overrides pending autoplay and late decode stays stale", async () => {
  const h = await fixture({ pauseDecodes: [1] });
  try {
    await h.waitReady(); await h.browser.wait("window.heroQA.heldDecodes().includes(1)"); await h.step(3000);
    assert.equal(await h.activeIndex(), 0); assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 0);
    await h.mouseClick(-1); assert.equal(await h.activeIndex(), 3);
    await h.releaseDecode(1); assert.equal(await h.activeIndex(), 3);
    await h.pointer(10, 1000); await h.step(300); await h.step(3000); assert.equal(await h.activeIndex(), 0);
    await h.step(300); await h.step(3000); assert.equal(await h.activeIndex(), 1);
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
  } finally { await h.close(); }
});

rendered("Hero decode recovery out-of-order image responses and decodes honor the latest manual target", async () => {
  const h = await fixture({ pauseImages: [1, 3], pauseDecodes: [1, 3] });
  try {
    await h.waitReady(); await h.browser.wait("window.heroQA.pending()===1"); await h.step(3000);
    await h.mouseClick(-1); assert.equal(await h.activeIndex(), 0);
    // Release responses 3,1 and then decode promises 1,3, deliberately reversing completion order.
    await h.resolveImage(3); await h.browser.wait("window.heroQA.heldDecodes().includes(3)");
    await h.resolveImage(1); await h.browser.wait("window.heroQA.heldDecodes().includes(1)");
    await h.releaseDecode(1); assert.equal(await h.activeIndex(), 0);
    await h.mouseClick(1); assert.equal(await h.activeIndex(), 1);
    await h.releaseDecode(3); assert.equal(await h.activeIndex(), 1);
    await h.pointer(10, 1000); await h.step(300); await h.step(3000); assert.equal(await h.activeIndex(), 2);
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
  } finally { await h.close(); }
});

rendered("Hero decode recovery explicit Next adopts the pending target while hover still pauses autoplay", async () => {
  const h = await fixture({ pauseDecodes: [1] });
  try {
    await h.waitReady(); await h.browser.wait("window.heroQA.heldDecodes().includes(1)"); await h.step(3000);
    await h.mouseClick(1); assert.equal(await h.activeIndex(), 0);
    await h.releaseDecode(1); assert.equal(await h.activeIndex(), 1);
    await h.step(300); await h.step(8000); assert.equal(await h.activeIndex(), 1);
    await h.pointer(10, 1000); await h.step(3000); assert.equal(await h.activeIndex(), 2);
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
  } finally { await h.close(); }
});

for (const [width, height] of [[1920, 1080], [1728, 900]]) rendered(`Hero native autoplay and full cycle at ${width}x${height} without interaction`, async t => {
  const h = await fixture({ width, height, virtual: false });
  try {
    await h.waitReady(); const initial = await h.state(); assert.equal(initial.index, 0);
    const nowPlaying = await h.browser.evaluate("window.originalNowPlaying=document.querySelector('.home-section--now-playing');true"); assert.equal(nowPlaying, true);
    for (const index of [1, 2, 3, 0]) {
      await h.browser.wait(`window.heroQA.states.at(-1)?.index===${index} && window.heroQA.states.at(-1)?.phase==='holding'`);
      assert.equal(await h.browser.evaluate("document.querySelector('.home-hero__slide--active .home-hero__title').textContent"), film(index + 1).title);
    }
    const states = await h.browser.evaluate("window.heroQA.states.filter(s=>s.phase==='fading')");
    assert.deepEqual(states.map(s => s.index), [1, 2, 3, 0]);
    const intervals = states.slice(1).map((s, i) => s.at - states[i].at);
    intervals.forEach(ms => assert.ok(ms >= 3300 && ms < 3600, `Observed ${ms} ms cycle must follow the verified 3000+300 ms timing`));
    t.diagnostic(JSON.stringify({ width, intervals }));
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
    assert.equal(await h.browser.evaluate("document.querySelector('.home-section--now-playing')===window.originalNowPlaying"), true);
    assert.equal(await h.browser.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
  } finally { await h.close(); }
});

rendered("Hero manual arrows wrap, reset progress and ignore rapid overlapping input", async () => {
  const h = await fixture();
  try {
    await h.waitReady();
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.home-hero__bar--active'),'::after').width"), "3px");
    await h.step(1800);
    assert.equal(await h.browser.evaluate("Number(document.querySelector('.home-hero__playback').style.getPropertyValue('--hero-progress'))"), 0.6);
    assert.ok(await h.browser.evaluate("(() => {const bar=document.querySelector('.home-hero__bar--active');return Math.abs(parseFloat(getComputedStyle(bar,'::after').width)-bar.getBoundingClientRect().width*0.6)<1/64;})()"));
    await h.click(-1); assert.equal((await h.state()).index, 3);
    await h.browser.evaluate("for(let i=0;i<20;i++)document.querySelector('.home-hero__arrow--next').click()"); await h.settle();
    assert.equal((await h.state()).index, 3); assert.equal(await h.browser.evaluate("document.querySelectorAll('.home-hero__slide--previous').length"), 1);
    await h.step(300); await h.click(1); assert.equal((await h.state()).index, 0);
    await h.step(300); await h.step(2999); assert.equal((await h.state()).index, 0);
    await h.step(1); assert.equal((await h.state()).index, 1);
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
  } finally { await h.close(); }
});

rendered("Hero crossfade keeps coherent image/copy layers, one interactive slide and stable geometry", async () => {
  const h = await fixture();
  try {
    await h.waitReady(); const before = await h.browser.evaluate("document.querySelector('.home-hero').getBoundingClientRect().toJSON()");
    await h.click(1);
    const result = await h.browser.evaluate(`(() => {const current=document.querySelector('.home-hero__slide--active'),old=document.querySelector('.home-hero__slide--previous');
      const animation=current.getAnimations()[0];animation.pause();animation.currentTime=150;
      return {opacity:Number(getComputedStyle(current).opacity),oldOpacity:Number(getComputedStyle(old).opacity),
        duration:animation.effect.getTiming().duration,easing:getComputedStyle(current).animationTimingFunction,
        active:current.querySelector('h2').textContent,src:current.querySelector('.movie-image img').src,
        old:old.querySelector('h2').textContent,oldInert:old.inert,hidden:old.getAttribute('aria-hidden'),
        activeLinks:document.querySelectorAll('.home-hero__slide:not([inert]) a').length,
        rect:document.querySelector('.home-hero').getBoundingClientRect().toJSON()};})()`);
    assert.ok(result.opacity > 0 && result.opacity < 1); assert.equal(result.oldOpacity, 1);
    assert.equal(result.duration, 300); assert.equal(result.easing, "ease-out");
    assert.equal(result.active, film(2).title); assert.match(result.src, /backdrop-1/); assert.equal(result.old, film(1).title);
    assert.equal(result.oldInert, true); assert.equal(result.hidden, "true"); assert.equal(result.activeLinks, 2); assert.deepEqual(result.rect, before);
    await h.step(300); assert.equal(await h.browser.evaluate("document.querySelector('.home-hero__slide--previous')"), null);
  } finally { await h.close(); }
});

for (const key of ["Enter", " "]) rendered(`Hero ${key === " " ? "Space" : key} activates real arrow buttons and preserves visible keyboard focus`, async () => {
  const h = await fixture();
  const press = async value => { const code = value === " " ? 32 : value === "Enter" ? 13 : 9;
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: value, code: value === " " ? "Space" : value, windowsVirtualKeyCode: code,
      ...(value === "Enter" ? { text: "\r" } : {}) });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: value, code: value === " " ? "Space" : value, windowsVirtualKeyCode: code }); };
  try {
    await h.waitReady();
    for (let i = 0; i < 30 && !(await h.browser.evaluate("document.activeElement===document.querySelector('.home-hero__arrow--next')")); i++) await press("Tab");
    assert.equal(await h.browser.evaluate("document.activeElement===document.querySelector('.home-hero__arrow--next') && document.activeElement.matches(':focus-visible')"), true);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
    await press(key); await h.settle(); assert.equal((await h.state()).index, 1); await h.step(300);
    await h.step(30000); assert.equal((await h.state()).index, 1); assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 0);
    assert.equal(await h.browser.evaluate("document.activeElement===document.querySelector('.home-hero__arrow--next')"), true);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).cursor"), "pointer");
  } finally { await h.close(); }
});

rendered("Hero reduced motion disables autoplay/fades and live preference changes remain usable", async () => {
  const h = await fixture({ reduced: true });
  try {
    await h.waitReady(); assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 0);
    await h.step(60000); assert.equal((await h.state()).index, 0); await h.click(-1);
    assert.equal((await h.state()).index, 3); assert.equal((await h.state()).phase, "holding");
    assert.equal(await h.browser.evaluate("document.querySelector('.home-hero__slide--active').getAnimations().length"), 0);
    await h.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await h.browser.wait("window.heroQA.pending()===1"); await h.step(3000); assert.equal((await h.state()).index, 0);
    await h.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await h.browser.wait("window.heroQA.pending()===0"); assert.equal((await h.state()).phase, "holding");
  } finally { await h.close(); }
});

rendered("Hero pauses offscreen without catch-up and unmount/remount cleans the StrictMode clock", async () => {
  const h = await fixture();
  try {
    await h.waitReady(); await h.step(1000);
    await h.browser.evaluate("const spacer=document.createElement('div');spacer.style.height='1500px';document.body.append(spacer);window.scrollTo(0,document.body.scrollHeight)");
    await h.browser.wait("window.heroQA.pending()===0");
    await h.step(60000); assert.equal((await h.state()).index, 0);
    await h.browser.evaluate("window.scrollTo(0,0)"); await h.browser.wait("window.heroQA.pending()===1");
    await h.step(1999); assert.equal((await h.state()).index, 0); await h.step(1); assert.equal((await h.state()).index, 1);
    await h.browser.evaluate("document.querySelector('.home-hero__slide--active a').click()");
    await h.browser.wait("location.pathname==='/movies/server-hero-2'"); await h.browser.wait("window.heroQA.pending()===0");
    await h.step(60000); await h.browser.evaluate("history.back()"); await h.browser.wait("location.pathname==='/' && document.querySelector('.home-hero__playback')");
    await h.waitReady(); assert.equal((await h.state()).index, 0); assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 1);
    assert.equal(await h.browser.evaluate("window.heroQA.maxPending"), 1);
  } finally { await h.close(); }
});

rendered("Hero native document visibility pauses the clock without accumulating background time", async () => {
  const h = await fixture(); let foreground;
  try {
    await h.waitReady(); await h.step(1000);
    foreground = await connectProfileBrowser(endpoint); await foreground.send("Page.bringToFront");
    await h.browser.wait("document.hidden && window.heroQA.pending()===0");
    // Native requestAnimationFrame is suspended in a hidden tab; do not wait for a paint there.
    await h.browser.evaluate("window.heroQA.step(60000)"); assert.equal((await h.state()).index, 0);
    await h.browser.send("Page.bringToFront"); await h.browser.wait("!document.hidden && window.heroQA.pending()===1");
    await h.step(1999); assert.equal((await h.state()).index, 0); await h.step(1); assert.equal((await h.state()).index, 1);
  } finally { await foreground?.close(); await h.close(); }
});

rendered("Hero pointer hover uses the Figma arrow state and pauses/resumes synchronized progress", async () => {
  const h = await fixture();
  try {
    await h.waitReady(); await h.step(1000);
    const point = await h.browser.evaluate("(() => {const r=document.querySelector('.home-hero__arrow--next').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await h.browser.wait("window.heroQA.pending()===0"); await h.step(60000);
    assert.equal((await h.state()).index, 0);
    const hover = await h.browser.evaluate("(() => {const b=document.querySelector('.home-hero__arrow--next');return {hover:b.matches(':hover'),duration:getComputedStyle(b).transitionDuration,cursor:getComputedStyle(b).cursor};})()");
    assert.deepEqual(hover, { hover: true, duration: "0.7s, 0.7s", cursor: "pointer" });
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 900 });
    await h.browser.wait("window.heroQA.pending()===1"); await h.step(1999);
    assert.equal((await h.state()).index, 0); await h.step(1); assert.equal((await h.state()).index, 1);
  } finally { await h.close(); }
});

for (const kind of ["empty", "single", "error"]) rendered(`Hero ${kind} featured data keeps the rest of Home usable`, async () => {
  const h = await fixture({ featured: kind === "empty" ? [] : kind === "single" ? [film(1)] : movies, failed: kind === "error" });
  try {
    await h.browser.wait("document.querySelector('.movie-card__buy') && document.querySelector('.coming-soon-card__notify')");
    if (kind === "single") {
      await h.waitReady(); assert.equal(await h.browser.evaluate("document.querySelectorAll('.home-hero__arrow:disabled').length"), 2);
      assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 0); await h.step(60000); assert.equal((await h.state()).index, 0);
    } else if (kind === "empty") {
      await h.browser.wait("document.querySelector('.home-hero .home-section-state')?.textContent.includes('No featured movies')");
      assert.equal(await h.browser.evaluate("document.querySelector('.home-hero__arrow')"), null);
    } else {
      await h.browser.wait("document.querySelector('.home-hero button')?.textContent.includes('Retry')");
      await h.resolveFeatured(); await h.browser.evaluate("document.querySelector('.home-hero button').click()");
      await h.waitReady(); assert.equal((await h.state()).index, 0); assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 1);
    }
  } finally { await h.close(); }
});

rendered("Hero loading is independent and resolves to current featured API data", async () => {
  const h = await fixture({ pauseFeatured: true });
  try {
    await h.waitCall("featured"); await h.browser.wait("document.querySelector('.movie-card__buy')");
    assert.match(await h.browser.evaluate("document.querySelector('.home-hero').textContent"), /Loading/);
    assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 0);
    await h.resolveFeatured(); await h.waitReady(); assert.equal((await h.state()).index, 0);
  } finally { await h.close(); }
});

rendered("Hero waits for a delayed backdrop without a blank swap and recovers from an unavailable image", async () => {
  const h = await fixture({ pauseImage: 1, brokenImage: 2 });
  try {
    await h.waitReady(); await h.waitCall("images", e => e.request.url.includes("backdrop-1")); await h.step(3000);
    assert.equal((await h.state()).index, 0); assert.equal(await h.browser.evaluate("window.heroQA.pending()"), 0);
    await h.resolveImage(1); await h.browser.wait("window.heroQA.states.at(-1).index===1"); await h.step(300);
    await h.click(1); assert.equal((await h.state()).index, 2);
    assert.equal(await h.browser.evaluate("document.querySelector('.home-hero__slide--active .movie-image img')"), null);
    assert.match(await h.browser.evaluate("document.querySelector('.home-hero__slide--active').textContent"), /Backdrop unavailable/);
  } finally { await h.close(); }
});

for (const target of ["Buy tickets", "All sessions"]) rendered(`Hero current ${target} link retains the original destination without booking`, async () => {
  const h = await fixture();
  try {
    await h.waitReady(); await h.click(1); await h.step(300);
    await h.browser.evaluate(`[...document.querySelectorAll('.home-hero__slide--active a')].find(a=>a.textContent.includes(${JSON.stringify(target)})).click()`);
    await h.browser.wait(`location.pathname===${JSON.stringify(target === "Buy tickets" ? "/movies/server-hero-2" : "/sessions")}`);
    assert.equal(await h.browser.evaluate("document.querySelector('.seat-selection')"), null);
  } finally { await h.close(); }
});

for (const [width, height] of [[1920, 1080], [1728, 900]]) rendered(`Hero Figma geometry and reference crossfade captures at ${width}x${height}`, async () => {
  const h = await fixture({ width, height, referenceImages: true });
  try {
    await h.waitReady(); await h.capture(`hero-${width}-initial`);
    const geometry = await h.browser.evaluate(`(() => {const q=s=>document.querySelector(s),r=s=>q(s).getBoundingClientRect().toJSON(),css=s=>getComputedStyle(q(s));return {
      hero:r('.home-hero'),copy:r('.home-hero__slide--active .home-hero__copy'),navigation:r('.home-hero__navigation'),arrow:r('.home-hero__arrow'),
      image:r('.home-hero__slide--active .movie-image'),fit:css('.home-hero__slide--active .movie-image img').objectFit,
      progressGap:css('.home-hero__progress').gap,navigationGap:css('.home-hero__navigation').gap,arrowsGap:css('.home-hero__arrows').gap,
      bar:r('.home-hero__bar'),titleFont:css('.home-hero__slide--active h2').fontFamily,overflow:document.documentElement.scrollWidth>innerWidth,
      ticket:r('.home-hero__slide--active .home-hero__actions img'),timer:r('.home-hero__slide--active .home-hero__badge img'),
      icons:[...q('.home-hero__navigation').querySelectorAll('img')].map(img=>({loaded:img.complete&&img.naturalWidth>0,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}))};})()`);
    await writeFile(`node_modules/.cache/kino-hero-ui/geometry-${width}.json`, JSON.stringify(geometry, null, 2));
    assert.equal(geometry.hero.height, 760); assert.equal(geometry.hero.width, width); assert.equal(geometry.copy.x, 67);
    assert.equal(geometry.navigation.x, 67); assert.equal(width - geometry.navigation.right, 67); assert.equal(760 - geometry.navigation.bottom, 42);
    assert.equal(geometry.arrow.width, 54); assert.equal(geometry.arrow.height, 54); assert.equal(geometry.bar.height, 3);
    assert.equal(geometry.progressGap, "8px"); assert.equal(geometry.navigationGap, "24px"); assert.equal(geometry.arrowsGap, "12px");
    assert.ok(Math.abs(geometry.image.y + 88.56) < 1 / 64); assert.ok(Math.abs(geometry.image.height - 1062.72) < 1 / 64); assert.equal(geometry.fit, "cover");
    assert.match(geometry.titleFont, /Archivo/); assert.equal(geometry.overflow, false);
    assert.deepEqual(geometry.icons, [{ loaded: true, width: 34, height: 34 }, { loaded: true, width: 34, height: 34 }]);
    // Intrinsic fractional SVG size and CSS layout each quantize to 1/64 px; preserve the asset's root dimensions.
    assert.ok(Math.abs(geometry.ticket.width - 15.9991) < 2 / 64); assert.ok(Math.abs(geometry.ticket.height - 16.0011) < 2 / 64);
    assert.equal(geometry.timer.width, 14); assert.equal(geometry.timer.height, 14);
    await h.click(1); await h.browser.evaluate("const animation=document.querySelector('.home-hero__slide--active').getAnimations()[0];animation.pause();animation.currentTime=150;");
    await h.capture(`hero-${width}-midfade`); await h.step(300); await h.capture(`hero-${width}-second`);
  } finally { await h.close(); }
});
