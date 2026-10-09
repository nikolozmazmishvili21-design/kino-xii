import { test } from "node:test";
import assert from "node:assert/strict";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// Exercise the real exported helper; only Chrome's transport and timers are fake.
function fixture(t, { open = true, onSend, fetchError, constructorError } = {}) {
  const timers = new Map(), history = new Map(), requests = [], sent = [];
  const owned = "owned-target", unrelated = "unrelated-target";
  let socket, browser, nextTimer = 0, targetPresent = true;
  class FakeSocket extends EventTarget {
    readyState = 0;
    closeCalls = 0;
    constructor() {
      super();
      if (constructorError) throw constructorError;
      socket = this;
      if (open) queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
    }
    respond(id, result = {}, error) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result, error }) }));
    }
    event(method, params = {}) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ method, params }) }));
    }
    disconnect(code = 1000, reason = "fixture disconnect") {
      this.readyState = 3;
      const event = new Event("close");
      Object.assign(event, { code, reason });
      this.dispatchEvent(event);
    }
    fail(error) {
      const event = new Event("error");
      Object.assign(event, { error });
      this.dispatchEvent(event);
    }
    send(payload) {
      const command = JSON.parse(payload);
      sent.push(command);
      if (onSend?.(command, this) === true) return;
      if (command.method === "Page.close") targetPresent = false;
      if (["Page.enable", "Runtime.enable", "Page.close"].includes(command.method)) {
        queueMicrotask(() => this.respond(command.id));
      }
    }
    close() { this.closeCalls++; this.disconnect(); }
  }
  const options = {
    commandTimeoutMs: 50, connectionTimeoutMs: 80, WebSocket: FakeSocket,
    async fetch(url, init) {
      const path = new URL(url).pathname;
      requests.push({ path, method: init.method, signal: init.signal });
      if (fetchError && path !== "/json/new") throw fetchError;
      assert.ok(init.signal instanceof AbortSignal, "Target HTTP operations are bounded");
      if (path === "/json/new") {
        assert.equal(init.method, "PUT");
        return { ok: true, json: async () => ({ id: owned, webSocketDebuggerUrl: "ws://fake/owned-target" }) };
      }
      if (path === "/json/list") return { ok: true, json: async () => [...(targetPresent ? [{ id: owned }] : []), { id: unrelated }] };
      assert.equal(path, "/json/close/" + owned, "Only the helper's owned target may be closed");
      targetPresent = false;
      return { ok: true };
    },
    setTimer(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay }); history.set(id, callback);
      return id;
    },
    clearTimer(id) { timers.delete(id); },
  };
  t.after(() => assert.equal(timers.size, 0, "All helper timer resources were cleared"));
  return {
    timers, history, requests, sent, options,
    get socket() { return socket; },
    get browser() { return browser; },
    setTargetPresent(value) { targetPresent = value; },
    async connect(overrides) { browser = await connectProfileBrowser("http://fake", { ...options, ...overrides }); return browser; },
    fire(id = timers.keys().next().value) {
      const timer = timers.get(id); assert.ok(timer, "Expected an active timer");
      timers.delete(id); timer.callback();
    },
    last() { return sent.at(-1); },
  };
}

test("successful command and duplicate reply settle once and clear timers", async t => {
  const h = fixture(t), browser = await h.connect();
  assert.deepEqual(h.sent.map(command => command.method), ["Page.enable", "Runtime.enable"]);
  const result = browser.send("Example.command", { value: 1 });
  const { id, params } = h.last(); assert.deepEqual(params, { value: 1 });
  h.socket.respond(id, { value: 2 });
  h.socket.respond(id, { value: 3 });
  assert.deepEqual(await result, { value: 2 });
  assert.equal(h.timers.size, 0);
  await browser.close();
  for (const callback of h.history.values()) callback(); // Even stale timer callbacks are harmless.
});

for (const code of [1000, 1006]) {
  test(`socket closure (${code}) rejects outstanding commands and prevents new sends`, async t => {
    const h = fixture(t), browser = await h.connect();
    const rejected = assert.rejects(browser.send("Example.pending"), error => error.name === "SocketClosedError" && error.message.includes(String(code)));
    h.socket.disconnect(code); h.setTargetPresent(false);
    await rejected;
    const count = h.sent.length;
    await assert.rejects(browser.send("Example.afterClose"), { name: "SocketClosedError" });
    assert.equal(h.sent.length, count);
    await browser.close();
  });
}

test("socket error rejects multiple pending commands with the original error", async t => {
  const h = fixture(t), browser = await h.connect(), failure = new Error("Original socket failure");
  const results = [browser.send("Example.one"), browser.send("Example.two")].map(promise => assert.rejects(promise, error => error === failure));
  h.socket.fail(failure); h.socket.disconnect(1006);
  await Promise.all(results);
  await assert.rejects(browser.send("Example.afterError"), error => error === failure);
  await assert.rejects(browser.close(), error => error === failure);
  assert.equal(h.socket.closeCalls, 1);
  assert.ok(h.requests.some(request => request.path === "/json/close/owned-target"));
});

test("timeout rejects only its own command; late reply cannot settle a newer ID", async t => {
  const h = fixture(t), browser = await h.connect();
  const first = browser.send("Example.lost"), firstId = h.last().id;
  const rejection = assert.rejects(first, /Example.lost .*timed out after 50ms/);
  const second = browser.send("Example.current"), secondId = h.last().id;
  assert.ok(secondId > firstId);
  h.fire(); await rejection;
  let settled = false; void second.then(() => { settled = true; });
  h.socket.respond(firstId, { stale: true }); await flush();
  assert.equal(settled, false); assert.equal(h.timers.size, 1);
  h.socket.respond(secondId, { current: true });
  assert.deepEqual(await second, { current: true });
  await browser.close();
});

test("simultaneous commands match out-of-order responses and protocol failure independently", async t => {
  const h = fixture(t), browser = await h.connect();
  const first = browser.send("Example.first"), firstId = h.last().id;
  const second = browser.send("Example.second"), secondId = h.last().id;
  const third = browser.send("Example.third"), thirdId = h.last().id;
  const rejected = assert.rejects(second, error => error.message === "Unrelated protocol failure" && error.code === -32000);
  h.socket.respond(thirdId, { value: 3 });
  h.socket.respond(secondId, undefined, { code: -32000, message: "Unrelated protocol failure" });
  h.socket.respond(firstId, { value: 1 });
  assert.deepEqual(await first, { value: 1 }); assert.deepEqual(await third, { value: 3 }); await rejected;
  await browser.close();
});

test("Page.close disconnect without reply completes only after verifying the owned target is absent", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method !== "Page.close") return;
    h.setTargetPresent(false); socket.disconnect(1006); return true;
  } });
  const browser = await h.connect();
  await browser.close();
  assert.equal(h.socket.closeCalls, 1);
  assert.deepEqual(h.requests.map(request => request.path), ["/json/new", "/json/list"]);
});

test("disconnect with a still-live target cleans that target but fails teardown", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method === "Page.close") { socket.disconnect(); return true; }
  } });
  const browser = await h.connect();
  await assert.rejects(browser.close(), { name: "SocketClosedError" });
  assert.ok(h.requests.some(request => request.path === "/json/close/owned-target"));
});

test("native Node empty-error/1006 sequence during Page.close requires confirmed target absence", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method !== "Page.close") return;
    h.setTargetPresent(false); socket.fail(new TypeError("")); socket.disconnect(1006); return true;
  } });
  const browser = await h.connect(); await browser.close();
  assert.equal(h.socket.closeCalls, 1);
});

test("native empty-error/1006 sequence with a still-live target remains a failure", async t => {
  const failure = new TypeError("");
  const h = fixture(t, { onSend(command, socket) {
    if (command.method !== "Page.close") return;
    socket.fail(failure); socket.disconnect(1006); return true;
  } });
  const browser = await h.connect(); await assert.rejects(browser.close(), error => error === failure);
});

test("empty socket error before Page.close is never classified as expected shutdown", async t => {
  const h = fixture(t), browser = await h.connect(), failure = new TypeError("");
  h.setTargetPresent(false); h.socket.fail(failure); h.socket.disconnect(1006);
  await assert.rejects(browser.close(), error => error === failure);
});

test("meaningful socket error during Page.close stays visible even if the target disappears", async t => {
  const failure = new TypeError("Meaningful transport failure");
  const h = fixture(t, { onSend(command, socket) {
    if (command.method !== "Page.close") return;
    h.setTargetPresent(false); socket.fail(failure); socket.disconnect(1006); return true;
  } });
  const browser = await h.connect(); await assert.rejects(browser.close(), error => error === failure);
});

test("empty Page.close socket error without the observed 1006 event remains a failure", async t => {
  const failure = new TypeError("");
  const h = fixture(t, { onSend(command, socket) {
    if (command.method !== "Page.close") return;
    h.setTargetPresent(false); socket.fail(failure); return true;
  } });
  const browser = await h.connect(); await assert.rejects(browser.close(), error => error === failure);
});

test("Page.close protocol rejection releases socket and target, and remains idempotently rejected", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method === "Page.close") {
      socket.respond(command.id, undefined, { message: "Unrelated Page.close refusal", code: -32000 }); return true;
    }
  } });
  const browser = await h.connect(), closing = browser.close();
  assert.equal(browser.close(), closing);
  await assert.rejects(closing, /Unrelated Page.close refusal/);
  await assert.rejects(browser.close(), /Unrelated Page.close refusal/);
  assert.equal(h.socket.closeCalls, 1);
  assert.equal(h.sent.filter(command => command.method === "Page.close").length, 1);
  assert.ok(h.requests.some(request => request.path === "/json/close/owned-target"));
});

test("Page.close timeout fails visibly and still releases resources", async t => {
  const h = fixture(t, { onSend: command => command.method === "Page.close" });
  const browser = await h.connect(), closing = browser.close();
  const rejection = assert.rejects(closing, /CDP Page.close .*timed out/);
  await flush(); h.fire(); await rejection;
  assert.equal(h.socket.closeCalls, 1);
});

test("successful cleanup is idempotent, rejects other pending commands and blocks new ones", async t => {
  const h = fixture(t), browser = await h.connect();
  const rejected = assert.rejects(browser.send("Example.pending"), { name: "SocketClosedError" });
  const closing = browser.close(); assert.equal(browser.close(), closing);
  await assert.rejects(browser.send("Example.duringClose"), /helper is closing/);
  await closing; await rejected; assert.equal(browser.close(), closing);
  assert.equal(h.socket.closeCalls, 1);
  assert.equal(h.sent.filter(command => command.method === "Page.close").length, 1);
});

test("setup protocol failure closes socket and only its owned target", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method === "Runtime.enable") {
      socket.respond(command.id, undefined, { message: "Runtime setup failure" }); return true;
    }
  } });
  await assert.rejects(h.connect(), /Runtime setup failure/);
  assert.equal(h.socket.closeCalls, 1);
  assert.ok(h.requests.some(request => request.path === "/json/close/owned-target"));
});

test("WebSocket construction failure releases the newly created target", async t => {
  const failure = new Error("Socket construction failure"), h = fixture(t, { constructorError: failure });
  await assert.rejects(h.connect(), error => error === failure);
  assert.ok(h.requests.some(request => request.path === "/json/close/owned-target"));
});

test("socket opening timeout releases socket and target", async t => {
  const h = fixture(t, { open: false }), connecting = h.connect();
  const rejection = assert.rejects(connecting, /socket open timed out after 80ms/);
  await flush(); h.fire(); await rejection;
  assert.equal(h.socket.closeCalls, 1);
});

test("socket closing before open fails setup without waiting for the timeout", async t => {
  const h = fixture(t, { open: false }), connecting = h.connect();
  const rejection = assert.rejects(connecting, { name: "SocketClosedError" });
  await flush(); h.socket.disconnect(); await rejection;
  assert.equal(h.socket.closeCalls, 1);
});

test("synchronous send failure rejects all pending commands without leaking timers", async t => {
  const failure = new Error("Socket send failure");
  const h = fixture(t, { onSend(command) { if (command.method === "Example.throw") throw failure; } });
  const browser = await h.connect();
  const first = assert.rejects(browser.send("Example.pending"), error => error === failure);
  await assert.rejects(browser.send("Example.throw"), error => error === failure); await first;
  await assert.rejects(browser.close(), error => error === failure);
});

test("cleanup HTTP failure preserves the original socket error as the cause", async t => {
  const cleanupError = new Error("Target cleanup failed"), h = fixture(t, { fetchError: cleanupError });
  const browser = await h.connect(), original = new Error("Original transport error");
  h.socket.fail(original);
  await assert.rejects(browser.close(), error => error instanceof AggregateError
    && error.cause === original && error.errors.includes(original) && error.errors.includes(cleanupError));
  assert.equal(h.socket.closeCalls, 1);
});

for (const asyncHandler of [false, true]) {
  test(`${asyncHandler ? "async" : "sync"} event assertion failure remains visible through cleanup`, async t => {
    const h = fixture(t), browser = await h.connect();
    const failure = new assert.AssertionError({ message: "Fixture HTTP assertion failed" });
    browser.on("Example.event", asyncHandler ? async () => { throw failure; } : () => { throw failure; });
    h.socket.event("Example.event"); await flush();
    await assert.rejects(browser.send("Example.afterAssertion"), error => error === failure);
    await assert.rejects(browser.close(), error => error === failure);
    assert.equal(h.socket.closeCalls, 1);
  });
}

test("test-body assertion remains visible when finally performs successful shutdown", async t => {
  const h = fixture(t), browser = await h.connect();
  const failure = new assert.AssertionError({ message: "Original test assertion" });
  await assert.rejects(async () => { try { throw failure; } finally { await browser.close(); } }, error => error === failure);
});

test("cleanup drains in-flight intercepted commands before closing and ignores new events", async t => {
  const h = fixture(t), browser = await h.connect();
  let calls = 0;
  browser.on("Fetch.requestPaused", () => { calls++; return browser.send("Fetch.fulfillRequest"); });
  h.socket.event("Fetch.requestPaused"); await flush();
  const id = h.last().id, closing = browser.close();
  h.socket.event("Fetch.requestPaused"); await flush();
  assert.equal(calls, 1); assert.equal(h.sent.some(command => command.method === "Page.close"), false);
  h.socket.respond(id); await closing;
});

test("an event immediately followed by cleanup still finishes its intercepted command", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method === "Fetch.fulfillRequest") { queueMicrotask(() => socket.respond(command.id)); return true; }
  } });
  const browser = await h.connect();
  browser.on("Fetch.requestPaused", () => browser.send("Fetch.fulfillRequest"));
  h.socket.event("Fetch.requestPaused");
  await browser.close();
  assert.equal(h.sent.filter(command => command.method === "Fetch.fulfillRequest").length, 1);
});

test("cleanup allows an in-flight event handler to finish its next command", async t => {
  const h = fixture(t, { onSend(command, socket) {
    if (command.method === "Fetch.failRequest") { queueMicrotask(() => socket.respond(command.id)); return true; }
  } });
  const browser = await h.connect();
  browser.on("Example.event", async () => {
    await browser.send("Example.firstStep");
    await browser.send("Fetch.failRequest");
  });
  h.socket.event("Example.event"); await flush();
  const firstId = h.last().id, closing = browser.close();
  h.socket.respond(firstId);
  await closing;
  assert.equal(h.sent.filter(command => command.method === "Fetch.failRequest").length, 1);
});

test("a never-settling event handler cannot hang cleanup", async t => {
  const h = fixture(t), browser = await h.connect();
  browser.on("Example.event", () => new Promise(() => {}));
  h.socket.event("Example.event"); await flush();
  const closing = browser.close(), rejected = assert.rejects(closing, /event handlers timed out after 50ms during cleanup/);
  h.fire(); await rejected;
  assert.equal(h.socket.closeCalls, 1);
  assert.equal(h.sent.filter(command => command.method === "Page.close").length, 1);
});

test("drain timeout still disconnects pending handler commands without unhandled rejection", async t => {
  const h = fixture(t), browser = await h.connect();
  browser.on("Example.event", () => browser.send("Example.stalled"));
  h.socket.event("Example.event"); await flush();
  const closing = browser.close(), rejected = assert.rejects(closing, /event handlers timed out/);
  h.fire([...h.timers.keys()].at(-1));
  await rejected; await flush();
  assert.equal(h.socket.closeCalls, 1);
});

test("malformed CDP input fails outstanding work and remains visible", async t => {
  const h = fixture(t), browser = await h.connect();
  const rejected = assert.rejects(browser.send("Example.pending"), SyntaxError);
  h.socket.dispatchEvent(new MessageEvent("message", { data: "invalid JSON" }));
  await rejected; await assert.rejects(browser.close(), SyntaxError);
});

test("command timeout is configurable and invalid timer values are rejected before allocation", async t => {
  const h = fixture(t), browser = await h.connect({ commandTimeoutMs: 123 });
  const rejection = assert.rejects(browser.send("Example.customTimeout"), /timed out after 123ms/);
  assert.equal([...h.timers.values()][0].delay, 123); h.fire(); await rejection;
  await browser.close();
  const count = h.requests.length;
  for (const value of [0, -1, Infinity, NaN, 1.5, 2147483648]) {
    await assert.rejects(h.connect({ commandTimeoutMs: value }), RangeError);
    await assert.rejects(h.connect({ connectionTimeoutMs: value }), RangeError);
  }
  assert.equal(h.requests.length, count);
});
