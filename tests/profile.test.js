import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobile, validateDateOfBirth, validateProfile } from "../src/validation/profileValidation.js";
import { createProfilePayload, updateProfile } from "../src/api/profileApi.js";
import { isProfileDirty, profileDraft, profileEligibility } from "../src/profile/profileForm.js";

const draft = { fullName: "Jane Dolidze", mobileNumber: "599 123 456", dateOfBirth: "2000-01-01", preferredVenueId: "" };
const options = { baseline: draft, venues: [{ id: 4, name: "API venue" }], today: new Date(2026, 9, 6) };
const validate = (field, value) => validateProfile({ ...draft, [field]: value }, options)[field];

test("full name uses the exact required and length messages without added grammar", () => {
  assert.equal(validate("fullName", ""), "Name is required");
  assert.equal(validate("fullName", "ab"), "Name must be at least 3 characters");
  assert.equal(validate("fullName", "x".repeat(51)), "Name must not exceed 50 characters");
  for (const value of ["abc", "x".repeat(50), "A-B", "   "]) assert.equal(validate("fullName", value), null);
});

test("mobile removes only ordinary spaces and follows accepted error precedence", () => {
  assert.equal(normalizeMobile("599 123 456"), "599123456");
  assert.equal(normalizeMobile("599\t123-456"), "599\t123-456");
  for (const [value, expected] of [
    ["   ", "Mobile number is required"],
    ["4x", "Please enter a valid Georgian mobile number (9 digits starting with 5)"],
    ["4", "Georgian mobile numbers must start with 5"],
    ["59", "Mobile number must be exactly 9 digits"],
    ["5991234567", "Mobile number must be exactly 9 digits"],
    ["599 123 456", null],
  ]) assert.equal(validate("mobileNumber", value), expected);
});

test("DOB rejects invalid dates, future dates, and dates just below twelve", () => {
  const today = new Date(2026, 9, 6, 1);
  assert.equal(validateDateOfBirth("", today), "Date of birth is required");
  for (const value of ["not-date", "2001-02-29", "2000-13-01", "0000-01-01", "2026-10-07"]) {
    assert.equal(validateDateOfBirth(value, today), "Please enter a valid date of birth");
  }
  assert.equal(validateDateOfBirth("2014-10-07", today), "You must be at least 12 years old to create an account");
  assert.equal(validateDateOfBirth("2014-10-06", today), null);
  assert.equal(validateDateOfBirth("2014-10-05", today), null);
});

test("DOB calendar boundary handles leap days and local dates independently of UTC", () => {
  assert.equal(validateDateOfBirth("2012-02-29", new Date(2024, 1, 29)), null);
  assert.equal(validateDateOfBirth("2012-03-01", new Date(2024, 1, 29)), "You must be at least 12 years old to create an account");
  assert.equal(validateDateOfBirth("2088-02-29", new Date(2100, 1, 28)), "You must be at least 12 years old to create an account");
  assert.equal(validateDateOfBirth("2088-02-29", new Date(2100, 2, 1)), null);
});

test("venue validates API identity and permits empty only for a null baseline", () => {
  assert.equal(validate("preferredVenueId", ""), null);
  assert.equal(validate("preferredVenueId", "4"), null);
  for (const value of ["99", "API venue", "null", "4.0"]) assert.ok(validate("preferredVenueId", value));
  assert.ok(validateProfile(draft, { ...options, baseline: { ...draft, preferredVenueId: "4" } }).preferredVenueId);
});

test("nullable initialization, exact dirty comparison, and normalized payload", () => {
  assert.deepEqual(profileDraft({}), { fullName: "", mobileNumber: "", dateOfBirth: "", preferredVenueId: "" });
  assert.equal(profileDraft({ preferredVenue: { id: 4 } }).preferredVenueId, "4");
  assert.equal(isProfileDirty({ ...draft }, draft), false);
  assert.equal(isProfileDirty({ ...draft, fullName: "Changed" }, draft), true);
  assert.deepEqual(Object.fromEntries(createProfilePayload({ ...draft, email: "ignored", username: "ignored", avatar: "ignored", age: 26, profileComplete: true })), {
    fullName: "Jane Dolidze", mobileNumber: "599123456", dateOfBirth: "2000-01-01",
  });
  assert.equal(createProfilePayload({ ...draft, preferredVenueId: "4" }).get("preferredVenueId"), "4");
});

test("eligibility uses returned age and complete API ratings, never DOB", () => {
  const user = { profileComplete: true, age: 18, dateOfBirth: "2025-01-01" };
  assert.equal(profileEligibility(user, [{ minAge: 12 }, { minAge: 18 }]), "You are 18, you can buy tickets for all age ratings.");
  const conservative = "Age on your account: 18. Film age restrictions are applied when booking.";
  for (const ratings of [[], null, [{ minAge: null }], [{ minAge: 21 }]]) assert.equal(profileEligibility(user, ratings), conservative);
  for (const age of [null, undefined, "18", NaN]) assert.equal(profileEligibility({ ...user, age }, [{ minAge: 12 }]), null);
  assert.equal(profileEligibility({ ...user, profileComplete: false }, [{ minAge: 12 }]), null);
});

test("profile API sends browser multipart with bearer auth and returns exact User; errors survive", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "test-token" };
  const user = { id: 7, profileComplete: true, age: 26 };
  try {
    globalThis.fetch = async (url, init) => {
      assert.ok(url.endsWith("/profile"));
      assert.equal(init.method, "PUT");
      assert.equal(init.headers.get("Authorization"), "Bearer test-token");
      assert.equal(init.headers.get("Content-Type"), null);
      assert.ok(init.body instanceof FormData);
      return new Response(JSON.stringify({ data: user }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    assert.deepEqual(await updateProfile(draft), user);
    for (const status of [401, 422, 500]) {
      const body = { message: "Exact server message", errors: { fullName: ["Exact field message"] } };
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      await assert.rejects(updateProfile(draft), (error) => error.status === status && error.message === body.message
        && error.errors.fullName[0] === body.errors.fullName[0] && error.data.message === body.message);
    }
    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(updateProfile(draft), { message: "Network request failed." });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});
