import test from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "../src/api/bookingApi.js";
import { ApiError } from "../src/api/client.js";
import { normalizeCheckoutFields } from "../src/validation/checkoutValidation.js";
import { classifyOrderError, classifyOrderResponse } from "../src/booking/orderLifecycle.js";
import { setToken, clearToken } from "../src/auth/tokenStorage.js";

const fields = {
  holdId: "11111111-2222-3333-4444-555555555555", fullName: "Synthetic Buyer",
  email: "buyer@example.test", mobileNumber: "599000000", cardNumber: "0000000000000000",
  expiry: "12/39", cvv: "000",
};
const json = (data, status = 201) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

test("Order API sends exactly the seven fields with existing JSON/Bearer conventions", async (t) => {
  const returned = { id: 7, reference: "SYNTHETIC-ORDER" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, "/api/orders");
    assert.equal(new URL(url).search, "");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("Authorization"), "Bearer synthetic-order-token");
    assert.equal(options.headers.get("Content-Type"), "application/json");
    assert.equal(options.headers.get("Accept"), "application/json");
    assert.deepEqual(JSON.parse(options.body), fields);
    assert.equal(options.signal, undefined);
    return json({ data: returned });
  });
  const result = await createOrder({ ...fields, seats: [], sessionId: 10, subtotal: 9, totalPrice: 9,
    total: 9, price: 9, cardholderName: "Ignored", paymentMethod: "Ignored", billingAddress: {},
    ticketTypes: [], movie: {}, session: {} }, { token: "synthetic-order-token" });
  assert.deepEqual(result, { status: 201, data: { data: returned } });
  assert.equal(calls, 1);
});

test("normalized request-ready values pass through without changing the visible draft", async (t) => {
  const draft = { ...fields, fullName: " Synthetic Buyer ", email: " buyer@example.test ",
    mobileNumber: "599 000 000", cardNumber: "0000 0000 0000 0000" };
  const original = structuredClone(draft);
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), fields);
    return json({ data: {} });
  });
  await createOrder({ holdId: draft.holdId, ...normalizeCheckoutFields(draft) }, { token: null });
  assert.deepEqual(draft, original);
});

test("Order API defaults to existing token storage and null intentionally omits auth", async (t) => {
  const authorizations = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    authorizations.push(options.headers.get("Authorization"));
    return json({ data: {} });
  });
  setToken("synthetic-stored-token");
  try {
    await createOrder(fields);
    await createOrder(fields, { token: null });
    assert.deepEqual(authorizations, ["Bearer synthetic-stored-token", null]);
  } finally { clearToken(); }
});

test("missing/non-string fields fail before dispatch with no payment values in error text", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected dispatch"); });
  for (const field of Object.keys(fields)) {
    for (const value of [undefined, null, 123]) {
      await assert.rejects(createOrder({ ...fields, [field]: value }), (error) => {
        assert.equal(error.name, "TypeError");
        assert.equal(error.message, "All seven Order fields must be strings.");
        return true;
      });
    }
  }
  assert.equal(calls, 0);
});

for (const status of [401, 403, 409, 422, 500]) {
  test(`Order API preserves received status ${status} and never retries`, async (t) => {
    let calls = 0;
    const body = { message: "Synthetic server feedback", ...(status === 409 ? { contested: ["A1"] } : {}),
      ...(status === 422 ? { errors: { cvv: ["Synthetic validation feedback"] } } : {}) };
    t.mock.method(globalThis, "fetch", async () => { calls++; return json(body, status); });
    await assert.rejects(createOrder(fields, { token: null }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.deepEqual(error.data, body);
      assert.equal(classifyOrderError(error).kind, { 401: "unauthenticated", 403: "forbidden", 409: "conflict", 422: "validation", 500: "uncertain" }[status]);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("message-only expiry response remains distinct from field validation", async (t) => {
  const message = "Your hold time expired. Please re-select your seats.";
  t.mock.method(globalThis, "fetch", async () => json({ message }, 422));
  await assert.rejects(createOrder(fields, { token: null }), (error) => {
    assert.deepEqual(classifyOrderError(error), { kind: "business", message });
    return true;
  });
});

test("malformed success envelopes and unexpected successful status preserve evidence", async (t) => {
  const bodies = [{ data: { id: 7, reference: "SYNTHETIC-PARTIAL" } }, {}, { data: null }, { data: [] }];
  for (const body of bodies) {
    t.mock.method(globalThis, "fetch", async () => json(body));
    const response = await createOrder(fields, { token: null });
    assert.deepEqual(response, { status: 201, data: body });
    assert.equal(classifyOrderResponse(response).kind, "malformed-success");
  }
  t.mock.method(globalThis, "fetch", async () => json({ data: {} }, 200));
  assert.equal(classifyOrderResponse(await createOrder(fields, { token: null })).kind, "uncertain");
});

test("invalid JSON success is evidence of unusable success, not a rejection", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{invalid", { status: 201, headers: { "Content-Type": "application/json" } }));
  const response = await createOrder(fields, { token: null });
  assert.equal(response.status, 201);
  assert.deepEqual(classifyOrderResponse(response), { kind: "malformed-success", recovery: null });
});

test("transport and response-body read failure remain ambiguous and do not retry", async (t) => {
  for (const bodyFailure of [false, true]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (!bodyFailure) throw new Error("Synthetic transport failure");
      return { status: 201, ok: true, text: async () => { throw new Error("Synthetic body read failure"); } };
    });
    await assert.rejects(createOrder(fields, { token: null }), (error) => {
      assert.equal(error.status, undefined);
      assert.equal(error.message, "Network request failed.");
      assert.equal(classifyOrderError(error).kind, "uncertain");
      return true;
    });
    assert.equal(calls, 1);
  }
});
