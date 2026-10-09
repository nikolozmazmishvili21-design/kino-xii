// Only connect to an explicitly supplied disposable Chrome, never a user browser.
// Five seconds bounds a lost protocol reply below the fixtures' 10-second UI
// waits. Slow QA hosts can override commandTimeoutMs / connectionTimeoutMs.
const DEFAULT_TIMEOUT_MS = 5000;

class SocketClosedError extends Error {
  constructor(event) {
    super(`CDP socket closed (code ${event.code ?? "unknown"}${event.reason ? `: ${event.reason}` : ""}).`);
    this.name = "SocketClosedError";
  }
}

function connection(socket, { commandTimeoutMs, connectionTimeoutMs, setTimer, clearTimer }) {
  let sequence = 0, terminalError, openingTimer, rejectOpening, closingSocket = false;
  let closeEvent, emptyErrorDuringPageClose;
  const pending = new Map(), handlers = new Map(), tasks = new Set(), handlerErrors = [];
  const settle = (id, error, result) => {
    const request = pending.get(id);
    if (!request) return; // Late/duplicate replies never match a newer command.
    pending.delete(id);
    clearTimer(request.timer);
    if (error) request.reject(error); else request.resolve(result);
  };
  const disconnect = (error) => {
    terminalError ??= error; // Keep the first meaningful transport error.
    clearTimer(openingTimer);
    rejectOpening?.(terminalError);
    for (const id of pending.keys()) settle(id, terminalError);
    handlers.clear();
  };
  const ready = new Promise((resolve, reject) => {
    rejectOpening = reject;
    openingTimer = setTimer(() => disconnect(new Error(`CDP socket open timed out after ${connectionTimeoutMs}ms.`)), connectionTimeoutMs);
    socket.addEventListener("open", () => {
      clearTimer(openingTimer);
      if (!terminalError) resolve();
    }, { once: true });
  });
  socket.addEventListener("close", event => {
    closeEvent ??= event;
    disconnect(new SocketClosedError(event));
  });
  socket.addEventListener("error", event => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || "CDP WebSocket error.");
    // Node's native WebSocket reports an abrupt EOF as an empty TypeError,
    // immediately followed by close(1006). Record this exact Page.close race;
    // retain the error itself for command rejection and target verification.
    if (!terminalError && error instanceof TypeError && error.message === ""
      && pending.size === 1 && pending.values().next().value.method === "Page.close") emptyErrorDuringPageClose = error;
    disconnect(error);
  });
  socket.addEventListener("message", event => {
    if (terminalError) return;
    let message;
    try { message = JSON.parse(event.data); }
    catch (error) { disconnect(error); return; }
    if (message.id !== undefined) {
      const error = message.error ? new Error(message.error.message) : null;
      if (error) error.code = message.error.code;
      settle(message.id, error, message.result);
    } else {
      for (const handler of handlers.get(message.method) ?? []) {
        // Existing fixtures use async event callbacks. Observe their failures
        // immediately and report them during close, including assertion errors.
        const task = Promise.resolve().then(() => handler(message.params))
          .catch(error => { handlerErrors.push(error); })
          .finally(() => tasks.delete(task));
        tasks.add(task);
      }
    }
  });
  return {
    ready, tasks, handlerErrors,
    expectedShutdown(error) {
      return error instanceof SocketClosedError || (error === emptyErrorDuringPageClose && closeEvent?.code === 1006);
    },
    on(method, callback) { handlers.set(method, [...(handlers.get(method) ?? []), callback]); },
    stopEvents() { handlers.clear(); },
    send(method, params = {}) {
      if (terminalError) return Promise.reject(terminalError);
      if (socket.readyState !== 1) {
        disconnect(new SocketClosedError({ reason: "socket is not open" }));
        return Promise.reject(terminalError);
      }
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimer(() => settle(id, new Error(`CDP ${method} (id ${id}) timed out after ${commandTimeoutMs}ms.`)), commandTimeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { disconnect(error); }
      });
    },
    release() {
      disconnect(new SocketClosedError({ reason: "helper cleanup" }));
      tasks.clear();
      if (!closingSocket) {
        closingSocket = true;
        socket.close();
      }
    },
  };
}

export async function connectProfileBrowser(endpoint, {
  commandTimeoutMs = DEFAULT_TIMEOUT_MS,
  connectionTimeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchTarget = fetch,
  WebSocket: Socket = WebSocket,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  for (const value of [commandTimeoutMs, connectionTimeoutMs]) {
    if (!Number.isInteger(value) || value <= 0 || value > 2147483647) throw new RangeError("CDP timeouts must be positive timer-safe integers.");
  }
  const request = async (path, options) => {
    const response = await fetchTarget(`${endpoint}${path}`, { ...options, signal: AbortSignal.timeout(connectionTimeoutMs) });
    if (!response.ok) throw new Error(`Chrome target request ${path} failed (${response.status}).`);
    return response;
  };
  const target = await (await request("/json/new?about:blank", { method: "PUT" })).json();
  // This helper owns only the target it just created. Never close the browser
  // or another target, even when the WebSocket cannot complete Page.close.
  const removeTarget = async () => {
    const targets = await (await request("/json/list")).json();
    if (!targets.some(item => item.id === target.id)) return false;
    await request(`/json/close/${encodeURIComponent(target.id)}`);
    return true;
  };
  let cdp;
  try {
    cdp = connection(new Socket(target.webSocketDebuggerUrl), { commandTimeoutMs, connectionTimeoutMs, setTimer, clearTimer });
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
  } catch (error) {
    const errors = [error];
    try { cdp?.release(); } catch (cleanupError) { errors.push(cleanupError); }
    try { await removeTarget(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length > 1) throw new AggregateError(errors, "CDP setup and cleanup failed.", { cause: error });
    throw error;
  }
  let closePromise, targetClosing = false;
  const send = (method, params) => {
    if (targetClosing) return Promise.reject(new Error("CDP helper is closing."));
    if (cdp.handlerErrors.length) return Promise.reject(cdp.handlerErrors[0]);
    return cdp.send(method, params);
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return {
    send, evaluate, on: cdp.on,
    async wait(expression) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${expression}`);
    },
    close() {
      if (closePromise) return closePromise;
      cdp.stopEvents(); // Keep Fetch interception enabled until the target closes.
      closePromise = (async () => {
        const errors = [];
        // Already-started event handlers may need subsequent commands to finish
        // interception. Stop new events first, then prohibit sends after draining.
        // Use the command budget for draining too: arbitrary stalled callbacks
        // must not introduce a new unbounded teardown wait.
        if (cdp.tasks.size) {
          let drainTimer;
          try {
            await Promise.race([Promise.all([...cdp.tasks]), new Promise((_, reject) => {
              drainTimer = setTimer(() => reject(new Error(`CDP event handlers timed out after ${commandTimeoutMs}ms during cleanup.`)), commandTimeoutMs);
            })]);
          } catch (error) { errors.push(error); }
          finally { clearTimer(drainTimer); }
        }
        targetClosing = true;
        let closeError;
        errors.push(...cdp.handlerErrors);
        try { await cdp.send("Page.close"); }
        catch (error) { closeError = error; }
        finally {
          try { cdp.release(); } catch (error) { errors.push(error); }
        }
        if (closeError) {
          try {
            const wasPresent = await removeTarget();
            // A disconnect is expected ONLY if this exact target is already
            // absent. Timeouts, meaningful socket errors and protocol errors fail.
            if (!cdp.expectedShutdown(closeError) || wasPresent) errors.push(closeError);
          } catch (error) { errors.push(closeError, error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, "CDP teardown failed.", { cause: errors[0] });
      })();
      return closePromise;
    },
  };
}
