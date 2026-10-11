import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { clearTimeout as clearTimer, setTimeout as setTimer } from "node:timers";
import { setTimeout } from "node:timers/promises";
import { connectProfileBrowser } from "./profileBrowser.js";

const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [],
  ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1 }], maxSeatsPerOrder: 3, holdMinutes: 8 };
const user = { id: 12, username: "Startup Fixture", email: "startup@example.test", avatar: null, profileComplete: true,
  fullName: "Startup Fixture", mobileNumber: "599123456", dateOfBirth: "1990-01-01", age: 36, preferredVenue: null };

export async function startupBrowser({ endpoint, origin, path = "/", width = 1920, height = 1080,
  pauseScripts = false, pauseStyles = false, pauseBootstrap = false, failScript = null,
  authenticated = false, reducedMotion = false, throttle = false, assetsPath } = {}) {
  const browser = await connectProfileBrowser(endpoint, { navigationTimeoutMs: 15000, commandTimeoutMs: 15000 });
  const assets = assetsPath ? JSON.parse(await readFile(assetsPath, "utf8")) : {};
  const heldScripts = [], heldStyles = [], heldBootstrap = [], tasks = new Set(), errors = [];
  const calls = { api: [], forbidden: [], exceptions: [] };
  let closing = false, bootstrapFailure = false;
  const intercept = async (method, params) => {
    try { return await browser.send(method, params); }
    catch (error) {
      // Refresh/navigation cancels old requests and invalidates their CDP IDs.
      if (error.code === -32602 && /^Invalid InterceptionId[.]?$/.test(error.message)) return { aborted: true };
      throw error;
    }
  };
  const fulfill = (event, body, status = 200, type = "application/json") => intercept("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    ], body: status === 204 ? "" : Buffer.from(body).toString("base64"),
  });
  const json = (event, data, status = 200) => fulfill(event, JSON.stringify(data), status);
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", event => {
    if (closing) return;
    const task = (async () => {
      const url = new URL(event.request.url), method = event.request.method;
      if (url.origin === origin.origin) {
        if (pauseStyles && url.pathname.endsWith(".css")) { heldStyles.push(event); return; }
        if (event.resourceType === "Script") {
          const entry = /\/src\/main\.jsx$|\/assets\/index-[^/]+\.js$/.test(url.pathname);
          const app = /\/src\/mountApp\.jsx$|\/assets\/mountApp-[^/]+\.js$/.test(url.pathname);
          if ((failScript === "entry" && entry) || (failScript === "app" && app)) {
            return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
          }
          if (failScript === "evaluation" && app) return fulfill(event, "throw new Error('Synthetic startup evaluation failure');", 200, "text/javascript");
          if (pauseScripts) { heldScripts.push(event); return; }
        }
        if (pauseStyles && event.resourceType === "Stylesheet") { heldStyles.push(event); return; }
        return intercept("Fetch.continueRequest", { requestId: event.requestId });
      }
      if (pauseStyles && ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) { heldStyles.push(event); return; }
      const asset = assets[event.request.url];
      if (asset) return fulfill(event, Buffer.from(asset.base64, "base64"), 200, asset.contentType);
      if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return json(event, null, 204);
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        calls.api.push({ method, path: url.pathname });
        assert.equal(method, "GET", "Startup/navigation QA must not mutate the API");
        if (url.pathname === "/api/filter-options") {
          if (pauseBootstrap) { heldBootstrap.push(event); return; }
          return json(event, bootstrapFailure ? { message: "Synthetic bootstrap failure" } : { data: filters }, bootstrapFailure ? 500 : 200);
        }
        if (url.pathname === "/api/me") return json(event, { data: user });
        if (url.pathname === "/api/tickets") return json(event, { data: [] });
        if (url.pathname === "/api/sessions") return json(event, { data: [], meta: {
          currentPage: 1, lastPage: 1, perPage: 10, totalMovies: 0, totalSessions: 0 } });
        if (/^\/api\/movies\/(featured|now-playing|coming-soon)$/.test(url.pathname)) return json(event, { data: [] });
      }
      calls.forbidden.push({ method, path: url.pathname });
      return intercept("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => tasks.delete(task));
    tasks.add(task);
  });
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const apiCount = path => calls.api.filter(call => call.path === path).length;
  const waitForReads = async expected => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (expected.every(([path, count]) => apiCount(path) >= count)) return;
      await setTimeout(25);
    }
    assert.fail(`Timed out waiting for API reads: ${JSON.stringify(expected.map(([path, count]) => ({ path, expected: count, actual: apiCount(path) })))}`);
  };
  const close = async () => {
    closing = true; await Promise.all([...tasks]); await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.forbidden, []);
    if (!failScript) assert.deepEqual(calls.exceptions, []);
  };
  try {
    await browser.send("Network.enable");
    await browser.send("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });
    if (throttle) await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 128000, uploadThroughput: 128000 });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.clear();sessionStorage.clear();${authenticated ? "localStorage.setItem('kino-xii.auth.token','synthetic-startup-token');" : ""}` });
    await browser.send("Page.navigate", { url: new URL(path, origin).href });
    await browser.send("Page.bringToFront"); await browser.wait("document.getElementById('root')"); await settle();
  } catch (error) { await close(); throw error; }
  return { browser, calls, close, settle,
    // Only throttled development cases opt into 90s; other readiness budgets stay unchanged.
    async waitForBootstrap(timeoutMs = 60000) {
      const started = Date.now();
      const deadline = started + timeoutMs;
      while (Date.now() < deadline) {
        if (await browser.evaluate("Boolean(document.querySelector('.startup-loader') && !document.querySelector('[data-startup-static]'))")) return Date.now() - started;
        await setTimeout(25);
      }
      throw new Error(`React bootstrap did not mount within ${timeoutMs / 1000}s`);
    },
    async reloadPage(selector, readPath) {
      const paths = ["/api/filter-options", ...(authenticated ? ["/api/me"] : []), readPath];
      // Establish the old page's reads before measuring a new document's reads.
      await waitForReads(paths.map(path => [path, 1]));
      const expectedReads = paths.map(path => [path, apiCount(path) + 1]);
      const { frameTree: { frame: oldFrame } } = await browser.send("Page.getFrameTree");
      const old = await browser.evaluate(`(() => {
        document.documentElement.setAttribute('data-startup-reload-pending', 'true');
        return {timeOrigin:performance.timeOrigin,location:location.pathname+location.search};
      })()`);
      let timer, active = true;
      const newDocument = new Promise((resolve, reject) => {
        browser.on("Page.frameNavigated", ({ frame }) => {
          if (active && frame.id === oldFrame.id && frame.loaderId !== oldFrame.loaderId) resolve();
        });
        timer = setTimer(() => reject(new Error("Reload did not commit a new document within 10s")), 10000);
      });
      try {
        // A completed Page.reload command alone does not prove a new document.
        await Promise.all([browser.send("Page.reload"), newDocument]);
      } finally { active = false; clearTimer(timer); }
      await browser.wait(`performance.timeOrigin !== ${old.timeOrigin}
        && !document.documentElement.hasAttribute('data-startup-reload-pending')
        && location.pathname+location.search === ${JSON.stringify(old.location)}
        && document.querySelector(${JSON.stringify(selector)})`);
      await waitForReads(expectedReads);
      for (const [path, count] of expectedReads) assert.equal(apiCount(path), count, `Reload must issue exactly one new ${path} read`);
    },
    async releaseScripts() {
      pauseScripts = false;
      for (const event of heldScripts.splice(0)) await intercept("Fetch.continueRequest", { requestId: event.requestId });
    },
    async releaseStyles() {
      pauseStyles = false;
      for (const event of heldStyles.splice(0)) {
        const asset = assets[event.request.url];
        if (asset) await fulfill(event, Buffer.from(asset.base64, "base64"), 200, asset.contentType);
        else if (new URL(event.request.url).origin === origin.origin) await intercept("Fetch.continueRequest", { requestId: event.requestId });
        else await json(event, null, 204);
      }
    },
    async releaseBootstrap({ fail = false } = {}) {
      pauseBootstrap = false; bootstrapFailure = fail;
      for (const event of heldBootstrap.splice(0)) await json(event, fail ? { message: "Synthetic bootstrap failure" } : { data: filters }, fail ? 500 : 200);
      await settle();
    },
    recoverBootstrap() { bootstrapFailure = false; },
    async capture(directory, name) {
      await settle();
      const { data } = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await mkdir(directory, { recursive: true }); await writeFile(`${directory}/${name}.png`, Buffer.from(data, "base64"));
    },
  };
}
