import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { createServer, preview } from "vite";
import { startupBrowser } from "./helpers/startupBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const targets = process.env.KINO_STARTUP_QA_TARGET ? [process.env.KINO_STARTUP_QA_TARGET] : ["dev", "preview"];
const servers = new Map(), origins = new Map();
const output = process.env.KINO_STARTUP_QA_OUTPUT || "node_modules/.cache/kino-startup-ui/after";
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome and a production build" }, run);

before(async () => {
  if (!endpoint) return;
  for (const target of targets) {
    assert.ok(["dev", "preview"].includes(target));
    if (target === "dev") {
      const server = await createServer({ cacheDir: "node_modules/.cache/kino-startup-vite", server: { host: "127.0.0.1", port: 0 } });
      await server.listen(); servers.set(target, server); origins.set(target, new URL(server.resolvedUrls.local[0]));
    } else {
      const server = await preview({ preview: { host: "127.0.0.1", port: 0 } });
      servers.set(target, server); origins.set(target, new URL(server.resolvedUrls.local[0]));
    }
  }
});
after(async () => {
  for (const [target, server] of servers) {
    if (target === "dev") await server.close();
    else await new Promise((resolve, reject) => {
      server.httpServer.close(error => error ? reject(error) : resolve());
      // Failed assertions can leave unfinished preload responses on this owned server.
      server.httpServer.closeAllConnections();
    });
  }
});

const fixture = (target, options) => startupBrowser({ endpoint, origin: origins.get(target),
  assetsPath: process.env.KINO_NOTIFY_QA_ASSETS, ...options });

async function snapshot(h) {
  return h.browser.evaluate(`(() => {
    const loader=document.querySelector('.startup-loader'),brand=loader.querySelector('.startup-loader__brand'),
      indicator=loader.querySelector('.startup-loader__indicator'),message=loader.querySelector('.startup-loader__message'),
      css=getComputedStyle(loader),spin=getComputedStyle(indicator),r=loader.getBoundingClientRect(),
      b=brand.getBoundingClientRect(),m=message.getBoundingClientRect();
    return {count:document.querySelectorAll('.startup-loader').length,static:loader.hasAttribute('data-startup-static'),
      role:loader.getAttribute('role'),live:loader.getAttribute('aria-live'),message:message.textContent,
      textColor:css.color,background:css.backgroundColor,brandColor:getComputedStyle(brand).color,
      accentColor:getComputedStyle(brand.querySelector('span')).color,indicatorHidden:indicator.getAttribute('aria-hidden'),
      animation:spin.animationName,indicatorWidth:parseFloat(spin.width),
      focusables:loader.querySelectorAll('a,button,input,select,textarea,[tabindex]').length,
      focus:document.activeElement.tagName,overflow:document.documentElement.scrollWidth>innerWidth,
      width:r.width,height:r.height,centerX:b.x+b.width/2,centerY:(b.top+m.bottom)/2,
      paints:performance.getEntriesByType('paint').map(e=>e.name)};
  })()`);
}

function centered(state, width, height, reducedMotion) {
  assert.equal(state.count, 1); assert.equal(state.role, "status"); assert.equal(state.live, "polite");
  assert.equal(state.message, "Loading Kino XII..."); assert.equal(state.background, "rgb(7, 12, 28)");
  assert.equal(state.textColor, "rgb(169, 169, 169)"); assert.equal(state.brandColor, "rgb(255, 255, 255)");
  assert.equal(state.accentColor, "rgb(236, 48, 19)"); assert.equal(state.indicatorHidden, "true");
  assert.equal(state.animation, reducedMotion ? "none" : "startup-spin"); assert.equal(state.indicatorWidth, 24);
  assert.equal(state.focusables, 0); assert.equal(state.focus, "BODY"); assert.equal(state.overflow, false);
  assert.equal(state.width, width); assert.equal(state.height, height);
  assert.ok(Math.abs(state.centerX - width / 2) < 1); assert.ok(Math.abs(state.centerY - height / 2) < 1);
}

for (const target of targets) {
  for (const [width, height] of [[1920, 1080], [1728, 900]]) {
    for (const reducedMotion of [false, true]) rendered(`${target} ${width}x${height} ${reducedMotion ? "reduced motion" : "animated"}: first paint before JS/CSS, React bootstrap handoff and removal`, async () => {
      const h = await fixture(target, { width, height, reducedMotion, pauseScripts: true, pauseStyles: true, pauseBootstrap: true, throttle: true });
      const name = `${target}-${width}x${height}-${reducedMotion ? "reduced" : "animated"}`;
      try {
        await h.capture(output, `${name}-before-js`);
        const before = await snapshot(h); centered(before, width, height, reducedMotion);
        assert.equal(before.static, true); assert.ok(before.paints.includes("first-contentful-paint"));
        assert.deepEqual(h.calls.api, [], "First paint must precede React and API bootstrap");
        await h.releaseStyles(); await h.releaseScripts();
        const bootstrapLimitMs = target === "dev" ? 90000 : 60000;
        const bootstrapMs = await h.waitForBootstrap(bootstrapLimitMs);
        console.log(`${name}: throttled React bootstrap readiness ${bootstrapMs}ms (${bootstrapLimitMs / 1000}s limit)`);
        await h.settle(); centered(await snapshot(h), width, height, reducedMotion);
        await h.capture(output, `${name}-bootstrap`);
        await h.releaseBootstrap(); await h.browser.wait("document.querySelector('.navbar')");
        assert.equal(await h.browser.evaluate("document.querySelectorAll('.startup-loader').length"), 0);
        assert.equal(h.calls.api.filter(call => call.path === "/api/filter-options").length, 1);
        // The early failure handler must stop observing once React owns the root.
        await h.browser.evaluate("window.dispatchEvent(new ErrorEvent('error',{message:'Synthetic postmount event'}))");
        assert.equal(await h.browser.evaluate("document.querySelector('.startup-loader--error')"), null);
      } finally { await h.close(); }
    });

    rendered(`${target} ${width}x${height}: delayed CSS alone cannot block the static first paint`, async () => {
      const h = await fixture(target, { width, height, pauseStyles: true, pauseBootstrap: true });
      try {
        // Paint entries are delivered after the rendering frame, not during rAF.
        await h.browser.wait("performance.getEntriesByName('first-contentful-paint').length > 0");
        const state = await snapshot(h); centered(state, width, height, false);
        assert.equal(state.static, true); assert.ok(state.paints.includes("first-contentful-paint"));
        assert.deepEqual(h.calls.api, []);
        await h.capture(output, `${target}-${width}x${height}-css-pending`);
        await h.releaseStyles(); await h.waitForBootstrap();
        await h.releaseBootstrap(); await h.browser.wait("document.querySelector('.navbar')");
        assert.equal(await h.browser.evaluate("document.querySelector('.startup-loader')"), null);
      } finally { await h.close(); }
    });

    rendered(`${target} ${width}x${height}: normal Home, /sessions refresh, /profile?tab=tickets refresh and Home return`, async () => {
      const h = await fixture(target, { width, height, authenticated: true });
      try {
        await h.browser.wait("document.querySelector('.navbar')");
        await h.browser.evaluate("document.querySelector('.navbar__sessions').click()");
        await h.browser.wait("location.pathname==='/sessions' && document.querySelector('.sessions-page')");
        await h.reloadPage(".sessions-page", "/api/sessions");
        assert.equal(await h.browser.evaluate("location.pathname"), "/sessions");
        await h.browser.send("Page.navigate", { url: new URL("/profile?tab=tickets", origins.get(target)).href });
        await h.browser.wait("document.querySelector('.my-tickets')");
        await h.reloadPage(".my-tickets", "/api/tickets");
        assert.equal(await h.browser.evaluate("location.pathname+location.search"), "/profile?tab=tickets");
        await h.browser.evaluate("document.querySelector('.navbar__logo').click()");
        await h.browser.wait("location.pathname==='/' && document.querySelector('#coming-soon-title')");
        const ui = await h.browser.evaluate("({loader:document.querySelector('.startup-loader'),overflow:document.documentElement.scrollWidth>innerWidth,navbars:document.querySelectorAll('.navbar').length})");
        assert.deepEqual(ui, { loader: null, overflow: false, navbars: 1 });
        assert.equal(h.calls.api.filter(call => call.path === "/api/filter-options").length, 4);
        await h.capture(output, `${target}-${width}x${height}-home-ready`);
      } finally { await h.close(); }
    });
  }

  for (const failScript of ["entry", "app", "evaluation"]) rendered(`${target}: ${failScript} startup failure stops the indicator and shows an alert`, async () => {
    const h = await fixture(target, { failScript });
    try {
      await h.browser.wait("document.querySelector('.startup-loader--error[role=alert]')");
      const ui = await h.browser.evaluate("({text:document.querySelector('.startup-loader__message').textContent,indicator:getComputedStyle(document.querySelector('.startup-loader__indicator')).display,overflow:document.documentElement.scrollWidth>innerWidth})");
      assert.deepEqual(ui, { text: "Kino XII couldn't start. Please refresh to try again.", indicator: "none", overflow: false });
      assert.deepEqual(h.calls.api, []);
      await h.capture(output, `${target}-${failScript}-failure`);
    } finally { await h.close(); }
  });

  rendered(`${target}: bootstrap API failure retains the existing error and Retry behavior`, async () => {
    const h = await fixture(target, { pauseBootstrap: true });
    try {
      await h.browser.wait("document.querySelector('.startup-loader') && !document.querySelector('[data-startup-static]')");
      await h.releaseBootstrap({ fail: true }); await h.browser.wait("document.querySelector('[role=alert]')");
      assert.equal(await h.browser.evaluate("document.querySelector('[role=alert]').textContent"), "Synthetic bootstrap failure");
      assert.equal(await h.browser.evaluate("document.querySelector('.startup-loader')"), null);
      h.recoverBootstrap(); await h.browser.evaluate("document.querySelector('main button').click()");
      await h.browser.wait("document.querySelector('.navbar')");
      assert.equal(h.calls.api.filter(call => call.path === "/api/filter-options").length, 2);
    } finally { await h.close(); }
  });
}
