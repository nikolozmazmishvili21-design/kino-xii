// An explicitly supplied isolated Chrome endpoint enables live rendered tests.
// The endpoint must use a disposable profile, never a user's signed-in browser.
export async function connectProfileBrowser(endpoint) {
  const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map(), handlers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else for (const handler of handlers.get(message.method) ?? []) void handler(message.params);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable"); await send("Runtime.enable");
  return {
    send, evaluate,
    on(method, callback) { handlers.set(method, [...(handlers.get(method) ?? []), callback]); },
    async wait(expression) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${expression}`);
    },
    async close() { await send("Page.close"); socket.close(); },
  };
}
