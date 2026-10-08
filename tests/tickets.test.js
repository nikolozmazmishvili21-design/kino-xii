import test from "node:test";
import assert from "node:assert/strict";
import { getTickets } from "../src/api/ticketsApi.js";
import { ApiError } from "../src/api/client.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

test("Tickets GET omits filter by default and accepts both factual Order statuses", async (t) => {
  const orders = [{ id: 7, reference: "SYNTHETIC-PAID", status: "paid" }, { id: 8, reference: "SYNTHETIC-REFUNDED", status: "refunded" }];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, "/api/tickets");
    assert.equal(new URL(url).search, "");
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.get("Authorization"), "Bearer synthetic-tickets-token");
    return json({ data: orders });
  });
  assert.deepEqual(await getTickets({ token: "synthetic-tickets-token" }), orders);
  assert.equal(calls, 1);
});

test("only upcoming/past filters are supported and valid empty data remains empty", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => { paths.push(new URL(url).pathname + new URL(url).search); return json({ data: [] }); });
  for (const filter of ["upcoming", "past"]) assert.deepEqual(await getTickets({ filter, token: null }), []);
  assert.deepEqual(paths, ["/api/tickets?filter=upcoming", "/api/tickets?filter=past"]);
  for (const filter of ["all", "", null, "upcoming&extra=value"]) {
    await assert.rejects(getTickets({ filter }), { name: "TypeError", message: "Tickets filter must be upcoming or past." });
  }
  assert.equal(paths.length, 2);
});

test("malformed successful envelopes produce read errors, never fake empty data", async (t) => {
  for (const body of [null, {}, [], { data: null }, { data: {} }, { data: "invalid" }, { data: [null] }, { data: [7] }, { data: [[]] }]) {
    t.mock.method(globalThis, "fetch", async () => json(body));
    await assert.rejects(getTickets({ token: null }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 200);
      assert.equal(error.message, "The tickets response could not be read.");
      assert.equal(error.data, undefined);
      return true;
    });
  }
});

test("invalid JSON and unexpected successful status are read errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{invalid", { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(getTickets({ token: null }), { message: "The tickets response could not be read." });
  t.mock.method(globalThis, "fetch", async () => json({ data: [] }, 201));
  await assert.rejects(getTickets({ token: null }), { message: "The tickets response could not be read.", status: 201 });
});

test("Tickets forwards AbortSignal and preserves abort for caller cancellation", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    return json({ data: [] });
  });
  await getTickets({ token: null, signal: controller.signal });
  controller.abort();
  t.mock.method(globalThis, "fetch", async (_url, options) => { throw options.signal.reason; });
  await assert.rejects(getTickets({ token: null, signal: controller.signal }), { name: "AbortError" });
});

test("Tickets 401 remains caller-handled, without anonymous fallback or retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json({ message: "Unauthenticated" }, 401); });
  await assert.rejects(getTickets({ token: "synthetic-expired-token" }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.message, "Unauthenticated");
    return true;
  });
  assert.equal(calls, 1);
});

test("read failures and repeated calls do not add caching or automatic retries", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) throw new Error("Synthetic transport failure");
    return json({ data: [] });
  });
  await assert.rejects(getTickets({ token: null }), { message: "Network request failed." });
  assert.equal(calls, 1);
  await getTickets({ token: null });
  await getTickets({ token: null });
  assert.equal(calls, 3);
});
