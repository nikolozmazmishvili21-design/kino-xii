import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const film = (id, extra = {}) => ({ id, slug: `preview-${id}`, title: `API Movie ${id}`, posterUrl: `https://preview-fixture.test/poster-${id}.svg`,
  backdropUrl: null, genres: [{ id: 1, name: "Drama" }], runtimeMinutes: 134, fromPrice: 15,
  ageRating: { code: "12+", minAge: 12 }, formats: [], isComingSoon: false, availableDates: [], ...extra });
const movies = [1, 2, 3, 4, 5, 6].map(id => film(id));
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [], maxSeatsPerOrder: 3,
  ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1, blockedFromRatingAge: null }] };
let server, origin, assets;
before(async () => {
  if (!endpoint) return;
  if (process.env.KINO_NOTIFY_QA_ASSETS) assets = JSON.parse(await readFile(process.env.KINO_NOTIFY_QA_ASSETS, "utf8"));
  server = await createServer({ cacheDir: "node_modules/.cache/kino-preview-vite", server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "preview-strict", resolveId(id) { if (id === "/preview-strict.jsx") return "\0preview-strict.jsx"; },
      load(id) { if (id === "\0preview-strict.jsx") return 'import {StrictMode,createElement} from "react";import {createRoot} from "react-dom/client";import App from "/src/app/App.jsx";import "/src/styles/main.css";const app=createElement(App);createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).get("strict")==="false"?app:createElement(StrictMode,null,app));'; },
      transformIndexHtml: { order: "pre", handler(html) { return html.replace("/src/main.jsx", "/preview-strict.jsx"); } } }],
  });
  await server.listen(); origin = new URL(server.resolvedUrls.local[0]);
});
after(async () => { await server?.close(); });

async function fixture({ width = 1920, height = 1080, strict = true, reduced = false, list = movies,
  held = [], holdRetry = false, broken = null, slowImage = null, missingSynopsis = false, failure = 0,
  synopsis, referencePoster = false } = {}) {
  const browser = await connectProfileBrowser(endpoint, { commandTimeoutMs: 15000 });
  const tasks = new Set(), errors = [], calls = { details: [], images: [], forbidden: [], exceptions: [] };
  let closing = false;
  const intercept = async (method, params) => { try { return await browser.send(method, params); }
    catch (error) { if (/^Invalid InterceptionId[.]?$/.test(error.message)) return; throw error; } };
  const fulfill = (event, bytes, type = "application/json", status = 200) => intercept("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,OPTIONS" }, { name: "Cache-Control", value: "no-store" },
    ], body: status === 204 ? "" : Buffer.from(bytes).toString("base64"),
  });
  const json = (event, data, status = 200) => fulfill(event, JSON.stringify(data), "application/json", status);
  const resolveDetail = (event, status = failure) => {
    const id = Number(new URL(event.request.url).pathname.split("-").at(-1));
    return json(event, status ? { message: "Preview temporarily unavailable" } : { data: film(id, { synopsis: missingSynopsis ? undefined : synopsis ?? `Real server synopsis ${id}. A journey described by the documented MovieDetail API.` }) }, status || 200);
  };
  const resolveImage = event => fulfill(event, Number(new URL(event.request.url).pathname.match(/\d+/)[0]) === broken ? "Broken image" :
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#305070"/><circle cx="300" cy="350" r="180" fill="#d09050"/></svg>', broken ? "image/png" : "image/svg+xml");
  const poster = referencePoster && process.env.KINO_NOW_PLAYING_QA_POSTER
    ? await readFile(process.env.KINO_NOW_PLAYING_QA_POSTER) : null;
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", event => {
    if (closing) return;
    const task = (async () => {
      const url = new URL(event.request.url), method = event.request.method;
      if (url.origin === origin.origin) return intercept("Fetch.continueRequest", { requestId: event.requestId });
      const asset = assets?.[event.request.url];
      if (asset) return fulfill(event, Buffer.from(asset.base64, "base64"), asset.contentType);
      if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return json(event, null, 204);
      if (url.hostname === "preview-fixture.test") {
        calls.images.push(event);
        if (Number(url.pathname.match(/\d+/)[0]) === slowImage) return;
        if (poster) return fulfill(event, poster, "image/jpeg");
        return resolveImage(event);
      }
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        if (method === "GET" && url.pathname === "/api/filter-options") return json(event, { data: filters });
        if (method === "GET" && ["/api/movies/featured", "/api/movies/coming-soon"].includes(url.pathname)) return json(event, { data: [] });
        if (method === "GET" && url.pathname === "/api/movies/now-playing") return json(event, { data: list });
        if (method === "GET" && /^\/api\/movies\/preview-\d+$/.test(url.pathname)) {
          calls.details.push(event);
          if (held.includes(Number(url.pathname.split("-").at(-1))) || (holdRetry && calls.details.length > 1)) return;
          return resolveDetail(event);
        }
        if (method === "GET" && url.pathname === "/api/sessions") return json(event, { data: [], meta: { currentPage: 1, lastPage: 1, perPage: 15, total: 0 } });
      }
      calls.forbidden.push({ method, url: event.request.url });
      return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => tasks.delete(task)); tasks.add(task);
  });
  const close = async () => { closing = true; await Promise.all([...tasks]); await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.exceptions, []); assert.deepEqual(calls.forbidden, []); };
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const selector = id => `.movie-card[data-movie-slug="preview-${id}"]`;
  const geometry = id => browser.evaluate(`(() => {const card=document.querySelector('${selector(id)}'), rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {card:rect(card),image:rect(card.querySelector('.movie-image')),footer:rect(card.querySelector('.movie-card__footer')),title:rect(card.querySelector('h3')),synopsis:rect(card.querySelector('.movie-card__preview')),opacity:Number(getComputedStyle(card.querySelector('.movie-card__preview')).opacity),transform:getComputedStyle(card).transform};})()`);
  const pointer = async (x, y) => { await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await settle(); };
  const hover = async id => { const point = await browser.evaluate(`(() => {const c=document.querySelector('${selector(id)}');c.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=c.getBoundingClientRect();return {x:r.x+Math.min(80,r.width/2),y:r.y+50}})()`); await pointer(point.x, point.y); };
  const done = id => browser.wait(`(() => {const card=document.querySelector('${selector(id)}'),preview=getComputedStyle(card.querySelector('.movie-card__preview'));return Math.abs(card.getBoundingClientRect().width-447)<.1&&preview.visibility==='visible'&&Number(preview.opacity)===1;})()`);
  const leave = async () => { await pointer(10, 100); await browser.wait("[...document.querySelectorAll('.movie-card')].every(c=>Math.abs(c.getBoundingClientRect().width-260)<.1)"); };
  const press = async key => { await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === " " ? "Space" : key,
    windowsVirtualKeyCode: key === " " ? 32 : key === "Enter" ? 13 : 9, ...(key === "Enter" ? { text: "\r" } : {}) });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key }); await settle(); };
  const click = async query => { const point = await browser.evaluate(`(() => {const n=document.querySelector(${JSON.stringify(query)});n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await pointer(point.x, point.y); await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point }); await settle(); };
  try {
    await browser.send("Network.enable"); await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.clear();" });
    await browser.send("Page.navigate", { url: `${origin.href}?strict=${strict}` });
    await browser.wait("document.querySelectorAll('.movie-card').length===6 && !document.querySelector('.navbar__auth-loading')");
    await browser.evaluate("document.querySelector('.home-row-viewport--now-playing').scrollIntoView({block:'center'});document.fonts.ready"); await settle();
  } catch (error) { await close(); throw error; }
  return { browser, calls, close, selector, geometry, hover, done, leave, press, click, settle,
    async release(id) { const event = calls.details.findLast(e => e.request.url.endsWith(`/preview-${id}`)); assert.ok(event); await resolveDetail(event, 0); await settle(); },
    async releaseImage() { const event = calls.images.find(e => Number(new URL(e.request.url).pathname.match(/\d+/)[0]) === slowImage); assert.ok(event); await resolveImage(event); await settle(); },
    async capture(name) { await settle(); const result = await browser.send("Page.captureScreenshot", { format: "png" });
      const dir = "node_modules/.cache/kino-now-playing-ui"; await mkdir(dir, { recursive: true }); await writeFile(`${dir}/${name}.png`, Buffer.from(result.data, "base64")); return result.data; },
  };
}

const near = (actual, expected, tolerance = .15) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

// Compare actual browser PNG paint with only this synopsis suppressed. This
// detects visible overlap/stacking defects that unchanged DOMRects cannot.
async function synopsisPaint(h, id, name, { fade = true } = {}) {
  const style = `#precision-paint-mask`;
  await h.browser.evaluate(`document.querySelector('${style}')?.remove();true`);
  const actual = await h.capture(name);
  await h.browser.evaluate(`(() => {const s=document.createElement('style');s.id='precision-paint-mask';s.textContent='${h.selector(id)} .movie-card__synopsis { visibility: hidden !important; }';document.head.append(s);return true;})()`);
  const hidden = (await h.browser.send("Page.captureScreenshot", { format: "png" })).data;
  await h.browser.evaluate(`document.querySelector('${style}').remove();true`);
  return h.browser.evaluate(`(async () => {
    const read=async src=>{const image=new Image();image.src='data:image/png;base64,'+src;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);return {pixels:x.getImageData(0,0,c.width,c.height).data,width:c.width};};
    const a=await read(${JSON.stringify(actual)}),b=await read(${JSON.stringify(hidden)});
    const card=document.querySelector('${h.selector(id)}'),box=card.getBoundingClientRect(),row=card.parentElement,viewport=row.getBoundingClientRect(),p=card.querySelector('.movie-card__preview'),text=p.querySelector('p'),base=text.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(text);
    const neighbor=card.nextElementSibling,protectedRects=neighbor?[...neighbor.querySelectorAll('h3,.movie-card__metadata')].map(n=>n.getBoundingClientRect()):[];
    const inside=(x,y,r)=>x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom;
    let painted=0,outsideCard=0,outsideViewport=0,neighborText=0,edgeSignal=0,edgePixels=0;
    for(let i=0;i<a.pixels.length;i+=4){const signal=Math.abs(a.pixels[i]-b.pixels[i])+Math.abs(a.pixels[i+1]-b.pixels[i+1])+Math.abs(a.pixels[i+2]-b.pixels[i+2]);if(!signal)continue;const x=(i/4)%a.width,y=Math.floor(i/4/a.width);painted++;if(!inside(x,y,box))outsideCard++;if(!inside(x,y,viewport))outsideViewport++;if(protectedRects.some(r=>inside(x,y,r)))neighborText++;if(x>=viewport.right-110&&inside(x,y,viewport)){edgeSignal+=signal;edgePixels++;}}
    return {painted,outsideCard,outsideViewport,neighborText,edgeSignal,edgePixels,fade:${fade},opacity:Number(getComputedStyle(p).opacity),
      width:base.width,lines:[...range.getClientRects()].map(r=>({x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height})),
      card:box.toJSON(),footer:card.querySelector('.movie-card__footer').getBoundingClientRect().toJSON(),
      visibility:getComputedStyle(p).visibility,
      scrollWidth:row.scrollWidth,expectedScrollWidth:Math.max(row.clientWidth,[...row.children].reduce((sum,n)=>sum+n.getBoundingClientRect().width,0)+(row.children.length-1)*17),
      pageOverflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
}

for (const id of [1, 3, 6]) rendered(`Now Playing precision painted synopsis stays contained on card ${id}`, async () => {
  const h = await fixture({ width: 1728, height: 900, synopsis: "A projectionist discovers a forgotten film reel and follows its trail through the city, finding an unexpected connection along the way. ".repeat(5) });
  let fadeControl;
  const samples = [], seek = async ms => {
    await h.browser.evaluate(`document.querySelector('${h.selector(id)}').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${ms}})`); await h.settle();
  };
  try {
    await h.hover(id); await h.done(id); await h.browser.wait(`document.querySelector('${h.selector(id)} .movie-card__synopsis').textContent.startsWith('A projectionist')`); await h.leave();
    const initial = await h.geometry(id);
    await h.browser.evaluate(`window.precisionEvents=[];const c=document.querySelector('${h.selector(id)}');for(const type of ['pointerenter','pointerleave'])c.addEventListener(type,e=>window.precisionEvents.push(e.type));true`);
    await h.hover(id);
    for (const ms of [0, 75, 150, 225, 300]) { await seek(ms); samples.push({phase:"expand",ms,...await synopsisPaint(h,id,`precision-card-${id}-expand-${ms}`)}); }
    await h.browser.evaluate(`document.querySelector('${h.selector(id)}').getAnimations({subtree:true}).forEach(a=>a.finish())`); await h.settle();
    const settled = await synopsisPaint(h,id,`precision-card-${id}-settled`);
    if (id === 6) {
      await h.browser.evaluate("const s=document.createElement('style');s.id='precision-no-fade';s.textContent='.home-row-viewport--now-playing::after {display:none!important}';document.head.append(s);true");
      const noFade = await synopsisPaint(h,id,`precision-card-${id}-fade-control`,{fade:false});
      await h.browser.evaluate("document.querySelector('#precision-no-fade').remove();true");
      fadeControl={withFade:settled.edgeSignal,withoutFade:noFade.edgeSignal,controlPixels:noFade.edgePixels};
      assert.ok(noFade.edgePixels>50, "control contains actual text paint under the edge fade");
      assert.ok(settled.edgeSignal<noFade.edgeSignal*.95, `edge fade must attenuate synopsis paint: ${settled.edgeSignal}/${noFade.edgeSignal}`);
    }
    await h.browser.send("Input.dispatchMouseEvent", {type:"mouseMoved",x:10,y:100}); await h.settle();
    for (const ms of [0, 75, 150, 225, 300]) { await seek(ms); samples.push({phase:"collapse",ms,...await synopsisPaint(h,id,`precision-card-${id}-collapse-${ms}`)}); }
    await writeFile(`node_modules/.cache/kino-now-playing-ui/precision-card-${id}-paint.json`,JSON.stringify({samples,settled,fadeControl},null,2));
    for (const sample of samples) {
      const visible = sample.phase==="expand"&&sample.ms===300;
      assert.equal(sample.opacity,visible?1:0,`${sample.phase} ${sample.ms}ms opacity`);
      assert.equal(sample.visibility,visible?"visible":"hidden");
      assert.ok(visible?sample.painted>50:sample.painted===0,`${sample.phase} ${sample.ms}ms actual text paint: ${sample.painted}`);
      assert.equal(sample.outsideCard,0); assert.equal(sample.outsideViewport,0); assert.equal(sample.neighborText,0);
      assert.deepEqual(sample.lines,settled.lines); near(sample.width,397);
      near(sample.card.width,sample.phase==="expand"?260+187*sample.ms/300:447-187*sample.ms/300,.2);
      near(sample.card.height,452); near(sample.footer.y,initial.footer.y);
      near(sample.scrollWidth,sample.expectedScrollWidth,1); assert.equal(sample.pageOverflow,false);
    }
    assert.ok(settled.painted>50); near(settled.card.width,447);
    assert.deepEqual(await h.browser.evaluate("window.precisionEvents"),["pointerenter","pointerleave"]);
    await h.browser.evaluate(`document.querySelector('${h.selector(id)}').getAnimations({subtree:true}).forEach(a=>a.finish())`); await h.leave();
    await h.hover(id); await h.done(id); await h.click(`${h.selector(id)} .movie-card__buy`); await h.browser.wait(`location.pathname==='/movies/preview-${id}'`);
  } finally { await h.close(); }
});

rendered("Now Playing precision reduced motion reveals and hides complete painted blocks immediately", async () => {
  const h = await fixture({width:1728,height:900,reduced:true,synopsis:"A projectionist follows a forgotten film reel through the city, discovering an unexpected connection. ".repeat(5)});
  try {
    for (const id of [1,3,6]) {
      await h.hover(id); await h.browser.wait(`document.querySelector('${h.selector(id)} .movie-card__synopsis').textContent.startsWith('A projectionist')`);
      const open=await synopsisPaint(h,id,`precision-reduced-card-${id}-open`);
      assert.equal(open.opacity,1); assert.ok(open.painted>50); assert.equal(open.outsideCard,0); assert.equal(open.outsideViewport,0); assert.equal(open.neighborText,0);
      near(open.card.width,447); near(open.scrollWidth,open.expectedScrollWidth,1); assert.equal(open.pageOverflow,false);
      assert.equal(await h.browser.evaluate(`document.querySelector('${h.selector(id)}').getAnimations({subtree:true}).length`),0);
      await h.leave();
      const closed=await synopsisPaint(h,id,`precision-reduced-card-${id}-closed`);
      assert.equal(closed.opacity,0); assert.equal(closed.painted,0); near(closed.card.width,260);
      near(closed.scrollWidth,closed.expectedScrollWidth,1); assert.deepEqual(closed.lines,open.lines);
    }
  } finally { await h.close(); }
});

rendered("Now Playing precision rapid re-entry reveals at the actual shortened expansion endpoint", async () => {
  const h=await fixture({synopsis:"A projectionist follows a forgotten film reel through the city, discovering an unexpected connection. ".repeat(5)});
  const seek=async ms=>{await h.browser.evaluate(`document.querySelector('.movie-card').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${ms}})`);await h.settle();};
  try {
    await h.hover(1); await h.done(1); await h.leave();
    await h.hover(1); await seek(150);
    await h.browser.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:10,y:100});await h.settle();await seek(75);
    await h.hover(1);
    const duration=await h.browser.evaluate("document.querySelector('.movie-card').getAnimations().find(a=>a.transitionProperty==='flex-basis').effect.getTiming().duration");
    assert.ok(duration<300,"native reversal shortens expansion");await seek(duration);
    const endpoint=await synopsisPaint(h,1,"precision-rapid-reentry-endpoint");
    near(endpoint.card.width,447);assert.equal(endpoint.opacity,1);assert.equal(endpoint.visibility,"visible");assert.ok(endpoint.painted>50);
    assert.equal(endpoint.outsideCard,0);assert.equal(endpoint.neighborText,0);assert.equal(endpoint.pageOverflow,false);
    await h.browser.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:10,y:100});await h.settle();await seek(0);
    const exit=await synopsisPaint(h,1,"precision-rapid-reentry-exit");assert.equal(exit.painted,0);assert.equal(exit.opacity,0);
    await writeFile("node_modules/.cache/kino-now-playing-ui/precision-rapid-reentry.json",JSON.stringify({duration,endpoint,exit},null,2));
  } finally {await h.close();}
});

for (const width of [1920, 1728, 390]) rendered(`Now Playing synopsis is one stable text block throughout pointer expansion and exit at ${width}px`, async () => {
  const synopsis = "While her husband maps a coast he will never sail, she keeps a second atlas of the places he leaves out, and it becomes the more accurate of the two";
  const h = await fixture({ width, synopsis, held: [1] });
  const frame = () => h.browser.evaluate(`(() => {
    const card=document.querySelector('.movie-card'), text=card.querySelector('.movie-card__synopsis'), preview=text.parentElement;
    const base=text.getBoundingClientRect(), style=getComputedStyle(preview), range=document.createRange();range.selectNodeContents(text);
    return {width:base.width,height:base.height,opacity:Number(style.opacity),visibility:style.visibility,hidden:preview.getAttribute('aria-hidden'),
      content:text.textContent,sameNode:text===window.synopsisNode,
      rowWidth:document.querySelector('.home-row-viewport--now-playing').getBoundingClientRect().width,
      glyphs:[...range.getClientRects()].map(r=>({x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height})),
      animations:card.getAnimations({subtree:true}).map(a=>({property:a.transitionProperty,duration:a.effect.getTiming().duration,delay:a.effect.getTiming().delay})),
      textAnimations:preview.getAnimations({subtree:true}).map(a=>a.transitionProperty),
      expanded:[...document.querySelectorAll('.movie-card--expanded')].map(n=>n.dataset.movieSlug)};
  })()`);
  const seek = async ms => {
    await h.browser.evaluate(`document.querySelector('.movie-card').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${ms}})`);
    await h.settle();
  };
  try {
    const initial = await frame(); assert.equal(initial.visibility, "hidden"); assert.equal(initial.opacity, 0); assert.equal(initial.hidden, "true");
    near((await h.geometry(1)).card.width, 260); near((await h.geometry(1)).card.height, 452);
    assert.equal(h.calls.details.length, 0);
    // A first response arriving during expansion must also use the stable block.
    await h.hover(1);
    await seek(150);
    assert.match((await frame()).content, /Loading synopsis/);
    await h.release(1);
    await h.browser.wait("document.querySelector('.movie-card__synopsis').textContent.startsWith('While')");
    const loaded = await frame(); near(loaded.width, initial.width);
    await h.browser.evaluate("document.querySelector('.movie-card').getAnimations({subtree:true}).forEach(a=>a.finish())"); await h.settle();
    const final = await frame(), expanded = await h.geometry(1);
    assert.deepEqual(loaded.glyphs, final.glyphs); near(loaded.width, final.width);
    // Re-entry isolates layout changes from asynchronous copy changes.
    await h.browser.evaluate("window.synopsisNode=document.querySelector('.movie-card__synopsis');true");
    await h.leave();
    const collapsed = await frame(), start = await h.geometry(1), neighbor = await h.geometry(2);
    assert.equal(collapsed.visibility, "hidden"); assert.equal(collapsed.hidden, "true");
    await h.browser.evaluate(`window.synopsisPointerEvents=[];const card=document.querySelector('.movie-card');
      for(const type of ['pointerenter','pointerleave'])card.addEventListener(type,event=>window.synopsisPointerEvents.push(event.type));true`);
    await h.hover(1);
    for (const ms of [0, 75, 150, 225, 300]) {
      await seek(ms);
      const value = await frame(), geometry = await h.geometry(1), next = await h.geometry(2);
      near(value.width, final.width); assert.deepEqual(value.glyphs, final.glyphs, `unchanged line wrapping at ${ms}ms`);
      assert.equal(value.content, synopsis); assert.equal(value.sameNode, true); assert.equal(value.hidden, "false");
      assert.equal(value.opacity, ms === 300 ? 1 : 0); assert.deepEqual(value.expanded, ["preview-1"]);
      near(geometry.card.width, 260 + (expanded.card.width - 260) * ms / 300, .2); near(geometry.card.height, 452);
      near(next.card.x - geometry.card.right, 17); near(next.card.width, 260); near(next.card.y, neighbor.card.y);
      near((next.card.x - geometry.card.x) - (neighbor.card.x - start.card.x), geometry.card.width - start.card.width);
      near(geometry.footer.y, start.footer.y);
      assert.ok(value.animations.every(a=>a.duration===300 && a.delay===0));
      assert.ok(value.textAnimations.every(property=>['opacity','visibility'].includes(property)));
      if (ms === 150) await h.capture(`synopsis-stable-midpoint-${width}`);
    }
    near(final.width, width >= 768 ? 397 : expanded.image.width - 20); assert.equal(final.visibility, "visible"); assert.equal(final.opacity, 1);
    assert.ok(final.glyphs.length >= 3); assert.ok(final.height <= 54);
    await h.browser.evaluate("document.querySelector('.movie-card').getAnimations({subtree:true}).forEach(a=>a.finish())"); await h.settle();
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 100 }); await h.settle();
    await seek(150);
    const exit = await frame(); assert.equal(exit.hidden, "true"); assert.equal(exit.opacity, 0);
    assert.deepEqual(exit.glyphs, final.glyphs); near(exit.width, final.width);
    // At narrow widths the existing expanded min-width is removed on exit;
    // CSS interpolates its underlying row-wide flex basis back to 260px.
    near((await h.geometry(1)).card.width, (260 + Math.min(447, exit.rowWidth)) / 2, .2);
    await h.browser.evaluate("document.querySelector('.movie-card').getAnimations({subtree:true}).forEach(a=>a.finish())"); await h.leave();
    const closed = await frame(); assert.equal(closed.visibility, "hidden"); assert.equal(closed.opacity, 0);
    near((await h.geometry(2)).card.x - (await h.geometry(1)).card.x, neighbor.card.x - start.card.x);
    assert.deepEqual(closed.glyphs, final.glyphs);
    assert.deepEqual(await h.browser.evaluate("window.synopsisPointerEvents"), ["pointerenter", "pointerleave"]);
    assert.equal(h.calls.details.length, 1);
  } finally { await h.close(); }
});
rendered("Now Playing visual polish matches Figma text geometry and painted synopsis at 1920x1080", async () => {
  const synopsis = "A projectionist discovers a forgotten film reel. Searching for its owner, she follows a trail through the city and uncovers an unexpected connection. ".repeat(4);
  const h = await fixture({ referencePoster: true, synopsis, list: movies.map(m => ({ ...m,
    title: "Nine Red Doors", genres: [{ id: 1, name: "Thriller" }], runtimeMinutes: 102,
    ageRating: { code: "16+", minAge: 16 }, fromPrice: 14 })) });
  try {
    assert.deepEqual(await h.browser.evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scale:visualViewport.scale,zoom:getComputedStyle(document.documentElement).zoom})"),
      { width: 1920, height: 1080, dpr: 1, scale: 1, zoom: "1" });
    const start = await h.geometry(1), neighbor = await h.geometry(2);
    await h.capture("visual-polish-default-1920");
    await h.hover(1);
    await h.browser.evaluate("document.querySelectorAll('.movie-card,.movie-card .movie-image,.movie-card__preview').forEach(n=>n.getAnimations().forEach(a=>{a.pause();a.currentTime=150}))"); await h.settle();
    const middle = await h.geometry(1);
    near(middle.card.width, 353.5, 1); assert.equal(middle.opacity, 0);
    near((await h.geometry(2)).card.x - neighbor.card.x, 93.5, 1); near(middle.footer.y, start.footer.y);
    await h.capture("visual-polish-intermediate-1920");
    await h.browser.evaluate("document.getAnimations().forEach(a=>a.finish())"); await h.done(1);
    await h.browser.wait("document.querySelector('.movie-card__synopsis')?.textContent.startsWith('A projectionist')");
    const expanded = await h.geometry(1);
    near(expanded.card.width, 447); near(expanded.card.height, 452);
    near((await h.geometry(2)).card.x - neighbor.card.x, 187); near(expanded.footer.y, start.footer.y);
    const text = await h.browser.evaluate(`(() => {
      const card=document.querySelector('.movie-card'), base=card.getBoundingClientRect();
      const measure=selector=>{const n=card.querySelector(selector),r=n.getBoundingClientRect(),s=getComputedStyle(n),range=document.createRange();range.selectNodeContents(n);const glyph=range.getBoundingClientRect();
        return {x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height,bottom:r.bottom-base.y,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,lineClamp:s.webkitLineClamp,clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,glyphY:glyph.y-base.y};};
      return {title:measure('h3'),metadata:measure('.movie-card__metadata'),badge:measure('.movie-age'),synopsis:measure('.movie-card__synopsis'),preview:measure('.movie-card__preview'),footer:measure('.movie-card__footer'),price:measure('.movie-card__price'),buy:measure('.movie-card__buy'),shadow:getComputedStyle(card).boxShadow};
    })()`);
    near(text.title.y, 249.2163, .04); near(text.title.height, 22);
    assert.equal(text.title.fontSize, "20px"); assert.equal(text.title.fontWeight, "800");
    near(text.metadata.y, 279.2163, .04); near(text.metadata.height, 18);
    assert.equal(text.metadata.lineHeight, "18.2px");
    near(text.badge.y, 305.2163, .04); near(text.badge.height, 21);
    near(text.synopsis.y, 338.2163, .04); near(text.synopsis.width, 397); near(text.synopsis.height, 54);
    assert.equal(text.synopsis.lineHeight, "18.2px"); assert.equal(text.synopsis.color, "rgb(169, 169, 169)");
    assert.equal(text.synopsis.lineClamp, "3"); assert.ok(text.synopsis.scrollHeight > text.synopsis.clientHeight);
    assert.ok(text.synopsis.bottom <= text.preview.bottom + .04);
    near(text.footer.y, 404.2163, .04); near(text.footer.height, 35);
    near(text.price.y, 414.2163, .04); near(text.price.height, 15); near(text.price.glyphY, text.buy.glyphY, .04);
    assert.equal(text.shadow, "rgba(0, 0, 0, 0.2) 0px 1px 4px 0px");
    const png = await h.capture("visual-polish-expanded-1920");
    // Inspect actual PNG paint: the old white synopsis produces channel values up to 255.
    const paint = await h.browser.evaluate(`(async () => {
      const image=new Image();image.src=${JSON.stringify(`data:image/png;base64,${png}`)};await image.decode();
      const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const r=document.querySelector('.movie-card__synopsis').getBoundingClientRect();
      const pixels=context.getImageData(Math.ceil(r.x),Math.ceil(r.y),Math.floor(r.width)-1,Math.floor(r.height)-1).data;
      let max=0,textPixels=0;for(let i=0;i<pixels.length;i+=4){max=Math.max(max,pixels[i],pixels[i+1],pixels[i+2]);if(pixels[i]>90&&pixels[i+1]>90&&pixels[i+2]>90)textPixels++;}
      return {max,textPixels};
    })()`);
    assert.ok(paint.max <= 170 && paint.max >= 160, JSON.stringify(paint)); assert.ok(paint.textPixels > 50);
    await writeFile("node_modules/.cache/kino-now-playing-ui/visual-polish-metrics.json", JSON.stringify({ start, middle, expanded, text, paint }, null, 2));
  } finally { await h.close(); }
});
for (const [width, height] of [[1920, 1080], [1728, 900]]) rendered(`Now Playing default, intermediate, expanded and reverse geometry ${width}x${height}`, async t => {
  const h = await fixture({ width, height });
  try {
    const start = await h.geometry(1), neighbor = await h.geometry(2);
    near(start.card.width, 260); near(start.card.height, 452); near(start.image.width, 232); near(start.image.height, 300);
    near(start.footer.y - start.card.y, 404.216, .2); await h.capture(`default-${width}`);
    await h.hover(1);
    // Pause real browser CSS transitions at a reproducible intermediate frame.
    await h.browser.evaluate("document.querySelectorAll('.movie-card,.movie-card .movie-image,.movie-card__preview').forEach(n=>n.getAnimations().forEach(a=>{a.pause();a.currentTime=150}))"); await h.settle();
    const middle = await h.geometry(1), shifted = await h.geometry(2);
    near(middle.card.width, 353.5, 1); near(middle.image.height, 262.2165, 1); assert.equal(middle.opacity, 0);
    near(shifted.card.x - neighbor.card.x, 93.5, 1); near(middle.footer.y, start.footer.y); assert.equal(middle.transform, "none");
    await h.capture(`intermediate-${width}`);
    await h.browser.evaluate("document.getAnimations().forEach(a=>a.finish())"); await h.done(1);
    const expanded = await h.geometry(1);
    near(expanded.card.width, 447); near(expanded.card.height, 452); near(expanded.image.width, 417); near(expanded.image.height, 224.433);
    near(expanded.footer.y, start.footer.y); near((await h.geometry(2)).card.x - neighbor.card.x, 187); near(expanded.synopsis.height, 54);
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card__synopsis').textContent.includes('Real server synopsis 1')"), true);
    await h.capture(`expanded-${width}`);
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 100 }); await h.settle();
    await h.browser.evaluate("document.querySelectorAll('.movie-card,.movie-card .movie-image,.movie-card__preview').forEach(n=>n.getAnimations().forEach(a=>{a.pause();a.currentTime=150}))"); await h.settle();
    const reverse = await h.geometry(1); near(reverse.card.width, 353.5, 1); near(reverse.image.height, 262.2165, 1); near(reverse.footer.y, start.footer.y);
    await h.capture(`reverse-${width}`); await h.browser.evaluate("document.getAnimations().forEach(a=>a.finish())"); await h.leave(); near((await h.geometry(2)).card.x, neighbor.card.x);
    t.diagnostic(JSON.stringify({ width, height, start, middle, expanded }));
  } finally { await h.close(); }
});
for (const id of [3, 5, 6]) rendered(`Now Playing pointer enters ${id === 3 ? "middle" : "final visible"} card ${id} and keeps actions in viewport`, async () => {
  const h = await fixture({ width: 1728, height: 900 });
  try { await h.hover(id); await h.done(id); await h.settle(); const value = await h.geometry(id);
    const row = await h.browser.evaluate("document.querySelector('.home-section__row--now-playing').getBoundingClientRect().toJSON()");
    assert.ok(value.card.right <= row.right + 1); assert.ok(value.card.x >= row.x - 1);
    assert.equal(await h.browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true); await h.leave();
  } finally { await h.close(); }
});
rendered("Now Playing rapid A B C, late responses and cache keep real synopses and history isolated", async () => {
  const h = await fixture({ held: [1, 2, 3] });
  try {
    const storage = await h.browser.evaluate("JSON.stringify(localStorage)");
    for (const id of [1, 2, 3]) { await h.hover(id); await h.browser.wait(`document.querySelector('${h.selector(id)}').classList.contains('movie-card--expanded')`); }
    await h.release(3); await h.release(1); await h.release(2); await h.done(3);
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card--expanded .movie-card__synopsis').textContent.includes('Real server synopsis 3')"), true);
    assert.equal(await h.browser.evaluate("JSON.stringify(localStorage)"), storage);
    assert.equal(await h.browser.evaluate("!!document.querySelector('[aria-labelledby=recently-viewed-title]')"), false);
    await h.leave(); await h.hover(1); await h.done(1); await h.leave(); await h.hover(1); await h.done(1);
    assert.equal(h.calls.details.filter(e => e.request.url.endsWith("/preview-1")).length, 1);
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card--expanded .movie-card__synopsis').textContent.includes('Real server synopsis 1')"), true);
  } finally { await h.close(); }
});
rendered("Now Playing pending re-entry deduplicates, then unmount safely invalidates the read", async () => {
  const h = await fixture({ held: [1] });
  try { await h.hover(1); await h.done(1); await h.leave(); await h.hover(1); await h.done(1);
    assert.equal(h.calls.details.length, 1); await h.click('[aria-label="See all Now Playing sessions"]');
    await h.browser.wait("location.pathname==='/sessions'"); await h.release(1); assert.equal(await h.browser.evaluate("document.querySelectorAll('.movie-card').length"), 0);
  } finally { await h.close(); }
});
rendered("Now Playing rapid pointer reversals preserve poster identity, order and non-overlapping layout", async () => {
  const h = await fixture();
  try {
    await h.browser.evaluate("window.previewPoster=document.querySelector('.movie-card img');true");
    for (let i = 0; i < 8; i++) {
      await h.hover(1);
      await h.browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 100 }); await h.settle();
      const pair = await h.browser.evaluate("[...document.querySelectorAll('.movie-card')].slice(0,2).map(c=>c.getBoundingClientRect().toJSON())");
      assert.ok(pair[0].width >= 260 && pair[0].width <= 447); near(pair[1].x - pair[0].right, 17);
      near(pair[0].height, 452);
    }
    await h.leave(); await h.hover(1); await h.done(1);
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card img')===window.previewPoster"), true);
    assert.equal(h.calls.details.filter(e => e.request.url.endsWith('/preview-1')).length, 1);
    assert.deepEqual(await h.browser.evaluate("[...document.querySelectorAll('.movie-card')].map(c=>c.dataset.movieSlug)"), movies.map(m => m.slug));
  } finally { await h.close(); }
});
rendered("Now Playing long API title and metadata remain bounded during expansion", async () => {
  const title = "An unusually long server title ".repeat(8);
  const h = await fixture({ list: movies.map(m => ({ ...m, title, genres: [{ name: "An unusually long server genre ".repeat(8) }] })) });
  try { await h.hover(1); await h.done(1); const geometry = await h.geometry(1);
    assert.ok(geometry.title.width <= geometry.image.width); near(geometry.title.height, 22); near(geometry.card.height, 452);
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card h3').textContent"), title);
    assert.equal(await h.browser.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
  } finally { await h.close(); }
});
for (const options of [{ broken: 1 }, { list: movies.map(m => ({ ...m, posterUrl: null })) }, { slowImage: 1 }]) rendered(`Now Playing image safety ${options.broken ? "failure" : options.slowImage ? "slow load" : "missing poster and backdrop"}`, async () => {
  const h = await fixture(options);
  try { await h.hover(1); await h.done(1); near((await h.geometry(1)).card.height, 452);
    if (options.slowImage) { await h.releaseImage(); await h.browser.wait("document.querySelector('.movie-card img').complete"); }
    else { await h.browser.wait("document.querySelector('.movie-card .movie-image__fallback')"); assert.equal(await h.browser.evaluate("document.querySelector('.movie-card .movie-image img')===null"), true); }
    await h.leave(); near((await h.geometry(1)).image.height, 300);
  } finally { await h.close(); }
});
rendered("Now Playing missing synopsis uses a neutral fallback and preserves server card data", async () => {
  const h = await fixture({ missingSynopsis: true });
  try { await h.hover(1); await h.done(1); await h.browser.wait("document.querySelector('.movie-card__synopsis').textContent==='No synopsis available.'");
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card h3').textContent"), "API Movie 1");
    assert.match(await h.browser.evaluate("document.querySelector('.movie-card__metadata').textContent"), /Drama.*134 min/);
    assert.match(await h.browser.evaluate("document.querySelector('.movie-card__price').textContent"), /15/);
    const style = await h.browser.evaluate("(()=>{const c=document.querySelector('.movie-card'),t=c.querySelector('h3'),m=c.querySelector('.movie-card__metadata');return {padding:getComputedStyle(c).padding,radius:getComputedStyle(c).borderRadius,title:getComputedStyle(t).fontSize,weight:getComputedStyle(t).fontWeight,metadata:getComputedStyle(m).fontSize,border:getComputedStyle(c).borderTopWidth}})()");
    assert.deepEqual(style, { padding: "14px", radius: "20px", title: "20px", weight: "800", metadata: "14px", border: "1px" });
  } finally { await h.close(); }
});
rendered("Now Playing error retry is keyboard usable without nested controls or fetch storms", async () => {
  const h = await fixture({ failure: 500, holdRetry: true });
  try { await h.hover(1); await h.done(1); await h.browser.wait("document.querySelector('.movie-card__retry')"); await h.leave(); await h.hover(1); await h.done(1); assert.equal(h.calls.details.length, 1);
    await h.browser.evaluate("document.querySelector('.movie-card__retry').focus()"); await h.press(" ");
    await h.browser.wait("document.querySelector('.movie-card__retry[aria-disabled=true]')"); assert.equal(h.calls.details.length, 2);
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.movie-card__retry')"), true);
    const focusPaint=await h.capture("precision-retry-focus");
    await h.browser.evaluate("document.querySelector('.movie-card__preview').style.overflow='visible';true");
    const unclippedFocusPaint=await h.capture("precision-retry-focus-control");
    await h.browser.evaluate("document.querySelector('.movie-card__preview').style.removeProperty('overflow');true");
    assert.ok(focusPaint===unclippedFocusPaint,"Retry focus paint is identical with and without preview clipping");
    await h.press(" "); assert.equal(h.calls.details.length, 2);
    await h.release(1); await h.browser.wait("document.activeElement.matches('.movie-card__main')");
    assert.equal(await h.browser.evaluate("document.querySelectorAll('a a,a button,button a').length"), 0);
  } finally { await h.close(); }
});
for (const strict of [false, true]) rendered(`Now Playing keyboard focus, Enter detail visit and stable focus ${strict ? "StrictMode" : "normal"}`, async () => {
  const h = await fixture({ strict });
  try { await h.browser.evaluate("document.querySelector('.home-section__row--now-playing').focus()"); await h.press("Tab"); await h.done(1);
    assert.equal(await h.browser.evaluate("document.activeElement.matches('.movie-card__main:focus-visible')"), true);
    assert.equal(await h.browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
    await h.press("Tab"); assert.equal(await h.browser.evaluate("document.activeElement.matches('.movie-card__buy')"), true); near((await h.geometry(1)).card.width, 447);
    assert.equal(h.calls.details.length, 1); await h.press("Enter"); await h.browser.wait("location.pathname==='/movies/preview-1'");
    await h.browser.wait("Object.keys(localStorage).some(key=>key.includes('recently'))");
  } finally { await h.close(); }
});
for (const target of [".movie-card__main", ".movie-card__synopsis", ".movie-card__buy", '[aria-label="See all Now Playing sessions"]']) rendered(`Now Playing pointer navigation ${target}`, async () => {
  const h = await fixture();
  try { if (target.includes("synopsis")) { await h.hover(1); await h.done(1); } await h.click(target); await h.browser.wait(`location.pathname==='${target.includes("See all") ? "/sessions" : "/movies/preview-1"}'`); }
  finally { await h.close(); }
});
rendered("Now Playing reduced motion expands instantly and keeps the correct data", async () => {
  const h = await fixture({ reduced: true });
  try { await h.hover(1); near((await h.geometry(1)).card.width, 447);
    assert.equal(await h.browser.evaluate("document.querySelector('.movie-card').getAnimations({subtree:true}).length"), 0); await h.leave();
  } finally { await h.close(); }
});
rendered("Now Playing pressed Variant3 keeps expanded geometry and releases to the same movie", async () => {
  const h = await fixture();
  try {
    await h.hover(1); await h.done(1);
    const card = (await h.geometry(1)).card, point = { x: card.x + 100, y: card.y + 100 };
    await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point }); await h.settle();
    assert.equal(await h.browser.evaluate("getComputedStyle(document.querySelector('.movie-card__preview')).paddingRight"), "0px");
    near((await h.geometry(1)).card.width, 447); assert.equal(h.calls.details.length, 1);
    await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    await h.browser.wait("location.pathname==='/movies/preview-1'");
  } finally { await h.close(); }
});
for (const width of [1280, 768, 390]) rendered(`Now Playing smaller viewport ${width} keeps a horizontally clipped row without page overflow`, async () => {
  const h = await fixture({ width, height: 900 });
  try { await h.hover(1); await h.browser.wait("document.querySelector('.movie-card').getAnimations().length===0");
    assert.equal(await h.browser.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
    if (width >= 768) near((await h.geometry(1)).card.width, 447);
  } finally { await h.close(); }
});
