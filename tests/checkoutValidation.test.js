import test from "node:test";
import assert from "node:assert/strict";
import { CHECKOUT_FIELDS, CHECKOUT_COPY, normalizeCheckoutField, normalizeCheckoutFields,
  validateCheckoutField, validateCheckout, mapCheckout422Errors, firstInvalidCheckoutField } from "../src/validation/checkoutValidation.js";

const today = new Date(2026, 9, 7, 12);
const valid = { fullName: "Synthetic Buyer", email: "buyer@example.test", mobileNumber: "599000000",
  cardNumber: "0000000000000000", expiry: "10/26", cvv: "000" };
const validate = (field, value, date = today) => validateCheckoutField(field, value, { today: date });

test("name trims surrounding whitespace and applies only required/3–50 rules", () => {
  assert.equal(validate("fullName", "  "), CHECKOUT_COPY.nameRequired);
  assert.equal(validate("fullName", " ab "), CHECKOUT_COPY.nameShort);
  assert.equal(validate("fullName", "x".repeat(51)), CHECKOUT_COPY.nameLong);
  for (const value of ["abc", "x".repeat(50), " A-B ", "მარიამ", "123", "!?@"]) assert.equal(validate("fullName", value), null);
  assert.equal(normalizeCheckoutField("fullName", " Buyer "), "Buyer");
});

test("name length boundaries apply after trimming surrounding spaces", () => {
  assert.equal(validate("fullName", `  ${"x".repeat(50)}  `), null);
  assert.equal(validate("fullName", `  ${"x".repeat(51)}  `), CHECKOUT_COPY.nameLong);
});

test("email trims and checks basic format without restricting domains or plus addresses", () => {
  assert.equal(validate("email", "  "), CHECKOUT_COPY.emailRequired);
  for (const value of ["buyer@example.test", " buyer+checkout@example.test ", "buyer@localhost"]) assert.equal(validate("email", value), null);
  for (const value of ["invalid", "buyer@", "@example.test", "a@@example.test", "a b@example.test", "buyer@.test", "buyer@example..test"]) assert.equal(validate("email", value), CHECKOUT_COPY.emailFormat);
  assert.equal(normalizeCheckoutField("email", " buyer@example.test "), "buyer@example.test");
});

test("mobile accepts ordinary spaces and rejects other normalization/format shortcuts", () => {
  assert.equal(validate("mobileNumber", "   "), CHECKOUT_COPY.mobileRequired);
  for (const value of ["599000000", "599 000 000"]) assert.equal(validate("mobileNumber", value), null);
  for (const value of ["499000000", "59900000", "5990000000", "599-000-000", "+995599000000", "599\t000000", "599\u00a0000000", "59900000x"]) assert.equal(validate("mobileNumber", value), CHECKOUT_COPY.mobileFormat);
  assert.equal(normalizeCheckoutField("mobileNumber", "599 000 000"), "599000000");
});

test("card requires sixteen digits and does not add Luhn or brand rules", () => {
  assert.equal(validate("cardNumber", "   "), CHECKOUT_COPY.cardRequired);
  for (const value of ["0000000000000000", "0000 0000 0000 0000", "0000000000000001"]) assert.equal(validate("cardNumber", value), null);
  for (const value of ["0".repeat(15), "0".repeat(17), "000000000000000x", "0000-0000-0000-0000", "0000\t000000000000"]) assert.equal(validate("cardNumber", value), CHECKOUT_COPY.cardFormat);
});

test("expiry has exact format, valid month, and calendar month boundary", () => {
  assert.equal(validate("expiry", ""), CHECKOUT_COPY.expiryRequired);
  for (const value of ["00/26", "13/26", "1/26", "10/2026", "10-26", " 10/26 ", "bad"]) assert.equal(validate("expiry", value), CHECKOUT_COPY.expiryFormat);
  for (const value of ["09/26", "12/25"]) assert.equal(validate("expiry", value), CHECKOUT_COPY.expiryPast);
  for (const value of ["10/26", "11/26", "01/27"]) assert.equal(validate("expiry", value), null);
  assert.equal(validate("expiry", "10/26", new Date(2026, 9, 31, 23, 59, 59)), null);
  assert.equal(validate("expiry", "10/26", new Date(2026, 10, 1)), CHECKOUT_COPY.expiryPast);
  assert.equal(validate("expiry", "01/27", new Date(2026, 11, 31)), null);
  assert.equal(normalizeCheckoutField("expiry", " 10/26 "), " 10/26 ");
});

test("CVV preserves leading zeros and requires exactly three digits", () => {
  assert.equal(validate("cvv", ""), CHECKOUT_COPY.cvvRequired);
  for (const value of ["000", "012", "123"]) assert.equal(validate("cvv", value), null);
  for (const value of ["00", "0000", "ab0", " 012 "]) assert.equal(validate("cvv", value), CHECKOUT_COPY.cvvFormat);
  assert.equal(normalizeCheckoutField("cvv", "012"), "012");
});

test("normalized form copies are exact, leave drafts intact, and expose no extra state", () => {
  const draft = Object.freeze({ ...valid, fullName: " Synthetic Buyer ", email: " buyer@example.test ",
    mobileNumber: "599 000 000", cardNumber: "0000 0000 0000 0000", holdId: "ignored", touched: {}, totalPrice: 5 });
  const copy = normalizeCheckoutFields(draft);
  assert.deepEqual(copy, valid);
  assert.deepEqual(Object.keys(copy), CHECKOUT_FIELDS);
  assert.equal(draft.cardNumber, "0000 0000 0000 0000");
  assert.deepEqual(validateCheckout(draft, { today }), Object.fromEntries(CHECKOUT_FIELDS.map((field) => [field, null])));
});

test("422 maps only flat form keys, preserving Hold and unknown feedback verbatim", () => {
  const errors = Object.freeze({ cvv: ["Server CVV message", "Another server message"], email: "Server email message",
    holdId: ["Server hold message"], "contact.email": ["Unknown nested message"], "tickets.0": "Unknown indexed message" });
  const mapped = mapCheckout422Errors(errors);
  assert.deepEqual(mapped.fields, { cvv: errors.cvv, email: [errors.email] });
  assert.deepEqual(mapped.general, [
    { field: "holdId", messages: ["Server hold message"] },
    { field: "contact.email", messages: ["Unknown nested message"] },
    { field: "tickets.0", messages: ["Unknown indexed message"] },
  ]);
  assert.equal(firstInvalidCheckoutField(mapped.fields), "email");
});

test("holdId-only 422 stays general feedback with no invalid form field", () => {
  const mapped = mapCheckout422Errors({ holdId: ["Server hold message"] });
  assert.deepEqual(mapped, { fields: {}, general: [{ field: "holdId", messages: ["Server hold message"] }] });
  assert.equal(firstInvalidCheckoutField(mapped.fields), null);
});

test("all recognized keys map and focus follows fixed display order, not response order", () => {
  const errors = Object.fromEntries([...CHECKOUT_FIELDS].reverse().map((field) => [field, [`Server ${field} message`]]));
  const mapped = mapCheckout422Errors(errors);
  assert.deepEqual(mapped.fields, errors);
  for (const field of CHECKOUT_FIELDS) {
    assert.equal(firstInvalidCheckoutField(mapped.fields), field);
    delete mapped.fields[field];
  }
  assert.equal(firstInvalidCheckoutField(mapped.fields), null);
  assert.equal(firstInvalidCheckoutField({ holdId: ["Hold message"], cvv: [] }), null);
});

test("malformed error containers and non-string drafts are handled without leaking values", () => {
  for (const errors of [null, undefined, [], "invalid"]) assert.deepEqual(mapCheckout422Errors(errors), { fields: {}, general: [] });
  assert.deepEqual(mapCheckout422Errors({ cvv: [null, 0, "", "Visible message"] }).fields, { cvv: ["Visible message"] });
  for (const field of CHECKOUT_FIELDS) assert.ok(validate(field, null));
  assert.throws(() => validate("unknown", "synthetic"), { message: "Unknown Checkout field." });
});
