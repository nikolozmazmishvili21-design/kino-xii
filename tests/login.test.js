import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLogin, validateSignup } from "../src/validation/authValidation.js";
import { getAuthFormErrors } from "../src/forms/authFormErrors.js";
import { login } from "../src/api/authApi.js";

test("Login requires email format and only the documented three-character password minimum", () => {
  assert.deepEqual(validateLogin({ email: "", password: "" }), { email: "Email is required", password: "Password is required" });
  assert.equal(validateLogin({ email: "invalid", password: "12" }).email, "Please enter a valid email address");
  assert.equal(validateLogin({ email: "person@example.test", password: "12" }).password, "Password must be at least 3 characters");
  for (const password of ["123", "abc", "   "]) {
    assert.deepEqual(validateLogin({ email: "person@example.test", password }), { email: null, password: null });
  }
});

test("Registration retains its existing username, confirmation and password validation", () => {
  const fields = { username: "Person", email: "person@example.test", password: "123", password_confirmation: "123" };
  assert.ok(Object.values(validateSignup(fields)).every(value => value === null));
  assert.equal(validateSignup({ ...fields, username: "ab" }).username, "Username must be at least 3 characters");
  assert.equal(validateSignup({ ...fields, password_confirmation: "other" }).password_confirmation, "Passwords must match");
});

test("Login 401 keeps the exact generic server message without inventing field errors", () => {
  assert.deepEqual(getAuthFormErrors({ status: 401, message: "Invalid credentials." }, ["email", "password"], "Fallback"), {
    fieldErrors: {}, message: "Invalid credentials.",
  });
});

test("Auth 422 field and message-only errors retain their existing mapping", () => {
  assert.deepEqual(getAuthFormErrors({ status: 422, message: "Invalid input", errors: { email: ["Server email validation"] } }, ["email", "password"], "Fallback"), {
    fieldErrors: { email: ["Server email validation"] }, message: "",
  });
  assert.deepEqual(getAuthFormErrors({ status: 422, message: "Sign in is unavailable." }, ["email", "password"], "Fallback"), {
    fieldErrors: {}, message: "Sign in is unavailable.",
  });
});

test("Login API retains its exact JSON payload and public authentication request", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/login");
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).has("Authorization"), false);
    assert.deepEqual(JSON.parse(options.body), { email: "person@example.test", password: "123" });
    return new Response(JSON.stringify({ data: { user: { id: 1 }, token: "synthetic-login-token" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const result = await login({ email: "person@example.test", password: "123", ignored: true });
  assert.equal(result.data.user.id, 1);
});

test("Login API propagates a rejected sign-in once without changing its message", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ message: "Invalid credentials." }), { status: 401, headers: { "Content-Type": "application/json" } });
  });
  await assert.rejects(login({ email: "person@example.test", password: "123" }), error => error.status === 401 && error.message === "Invalid credentials.");
  assert.equal(requests, 1);
});
