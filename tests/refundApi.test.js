import test from "node:test";
import assert from "node:assert/strict";
import { refundOrder } from "../src/api/ticketsApi.js";
import { ApiError } from "../src/api/client.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

test("Refund POST uses exact encoded reference, Bearer, no body, and the supplied signal", async (t) => {
  const reference = "  Synthetic/a?b#c% &თ  ", signal = new AbortController().signal;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, "/api/orders/" + encodeURIComponent(reference) + "/refund");
    assert.equal(new URL(url).search, "");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("Authorization"), "Bearer synthetic-refund-auth");
    assert.equal(options.headers.get("Accept"), "application/json");
    assert.equal(options.headers.has("Content-Type"), false);
    assert.equal(options.body, undefined);
    assert.equal(options.signal, signal);
    return json({ data: { reference, status: "refunded" } });
  });
  assert.deepEqual(await refundOrder(reference, { token: "synthetic-refund-auth", signal }),
    { status: 200, data: { data: { reference, status: "refunded" } } });
  assert.equal(calls, 1);
});

test("invalid references fail before transport; no numeric ID fallback", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; throw new Error("must not dispatch"); });
  for (const reference of [undefined, null, "", " \t ", 7, {}, []]) {
    assert.throws(() => refundOrder(reference), TypeError);
  }
  assert.equal(calls, 0);
});

test("partial/malformed success stays available to the domain classifier", async (t) => {
  for (const data of [{ data: { reference: "R", status: "refunded" } }, null, {}, { data: [] }]) {
    t.mock.method(globalThis, "fetch", async () => json(data));
    assert.deepEqual(await refundOrder("R", { token: null }), { status: 200, data });
  }
  t.mock.method(globalThis, "fetch", async () => json({ data: {} }, 201));
  assert.equal((await refundOrder("R", { token: null })).status, 201);
  t.mock.method(globalThis, "fetch", async () => new Response("{invalid", {
    headers: { "Content-Type": "application/json" },
  }));
  assert.equal((await refundOrder("R", { token: null })).data, "{invalid");
});

for (const status of [401, 403, 422, 500]) {
  test("Refund preserves received " + status + " server message and never retries", async (t) => {
    let calls = 0;
    const data = { message: "Synthetic server business message." };
    t.mock.method(globalThis, "fetch", async () => { calls++; return json(data, status); });
    await assert.rejects(refundOrder("R", { token: null }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, data.message);
      assert.deepEqual(error.data, data);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("unexpected 422 field errors remain intact without inventing Refund fields", async (t) => {
  const data = { message: "Synthetic validation.", errors: { synthetic: ["Server detail"] } };
  t.mock.method(globalThis, "fetch", async () => json(data, 422));
  await assert.rejects(refundOrder("R", { token: null }), (error) => {
    assert.deepEqual(error.errors, data.errors);
    assert.deepEqual(error.data, data);
    return true;
  });
});

test("network and abort failures propagate without replay", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("Synthetic network"); });
  await assert.rejects(refundOrder("R", { token: null }), { name: "ApiError", message: "Network request failed." });
  const abort = new DOMException("Synthetic abort", "AbortError");
  t.mock.method(globalThis, "fetch", async () => { calls++; throw abort; });
  await assert.rejects(refundOrder("R", { token: null }), (error) => error === abort);
  assert.equal(calls, 2);
});

test("headers alone do not finish the API operation; body read failure is not a definite 401", async (t) => {
  let release;
  const body = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200, ok: true, headers: new Headers({ "Content-Type": "application/json" }),
    text: () => body,
  }));
  let completed = false;
  const result = refundOrder("R", { token: null }).then((value) => { completed = true; return value; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(completed, false);
  release(JSON.stringify({ data: { reference: "R", status: "refunded" } }));
  assert.equal((await result).status, 200);
  t.mock.method(globalThis, "fetch", async () => ({
    status: 401, ok: false, headers: new Headers(),
    text: async () => { throw new TypeError("Synthetic body loss"); },
  }));
  await assert.rejects(refundOrder("R", { token: null }), (error) => {
    assert.equal(error.status, undefined);
    return error instanceof ApiError;
  });
});
