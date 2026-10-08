export const CHECKOUT_FIELDS = Object.freeze([
  "fullName", "email", "mobileNumber", "cardNumber", "expiry", "cvv",
]);

// Client messages are project UX, not API/Figma-provided copy.
export const CHECKOUT_COPY = Object.freeze({
  nameRequired: "Name is required",
  nameShort: "Name must be at least 3 characters",
  nameLong: "Name must not exceed 50 characters",
  emailRequired: "Email is required",
  emailFormat: "Please enter a valid email address",
  mobileRequired: "Mobile number is required",
  mobileFormat: "Enter 9 digits starting with 5",
  cardRequired: "Card number is required",
  cardFormat: "Card number must be 16 digits",
  expiryRequired: "Expiry is required",
  expiryFormat: "Enter expiry as MM/YY",
  expiryPast: "Expiry must not be in the past",
  cvvRequired: "CVV is required",
  cvvFormat: "CVV must be 3 digits",
});

export function normalizeCheckoutField(field, value) {
  const text = typeof value === "string" ? value : "";
  if (["fullName", "email"].includes(field)) return text.trim();
  if (["mobileNumber", "cardNumber"].includes(field)) return text.replaceAll(" ", "");
  return text;
}

// Six local form fields only. bookingApi constructs the seven-field API body.
export function normalizeCheckoutFields(fields) {
  return Object.fromEntries(CHECKOUT_FIELDS.map((field) => [field, normalizeCheckoutField(field, fields[field])]));
}

export function validateCheckoutField(field, draftValue, { today = new Date() } = {}) {
  const value = normalizeCheckoutField(field, draftValue);
  switch (field) {
    case "fullName":
      if (!value) return CHECKOUT_COPY.nameRequired;
      if (value.length < 3) return CHECKOUT_COPY.nameShort;
      return value.length > 50 ? CHECKOUT_COPY.nameLong : null;
    case "email":
      if (!value) return CHECKOUT_COPY.emailRequired;
      // Basic format only; no restrictive RFC grammar or domain whitelist.
      return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*$/.test(value) ? null : CHECKOUT_COPY.emailFormat;
    case "mobileNumber":
      if (!value) return CHECKOUT_COPY.mobileRequired;
      return /^5\d{8}$/.test(value) ? null : CHECKOUT_COPY.mobileFormat;
    case "cardNumber":
      if (!value) return CHECKOUT_COPY.cardRequired;
      return /^\d{16}$/.test(value) ? null : CHECKOUT_COPY.cardFormat;
    case "expiry": {
      if (!value) return CHECKOUT_COPY.expiryRequired;
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(value)) return CHECKOUT_COPY.expiryFormat;
      const [month, year] = value.split("/").map(Number);
      const currentYear = today.getFullYear();
      const expiryYear = Math.floor(currentYear / 100) * 100 + year;
      return expiryYear * 12 + month < currentYear * 12 + today.getMonth() + 1
        ? CHECKOUT_COPY.expiryPast : null;
    }
    case "cvv":
      if (!value) return CHECKOUT_COPY.cvvRequired;
      return /^\d{3}$/.test(value) ? null : CHECKOUT_COPY.cvvFormat;
    default:
      throw new TypeError("Unknown Checkout field.");
  }
}

export function validateCheckout(fields, options) {
  return Object.fromEntries(CHECKOUT_FIELDS.map((field) => [field, validateCheckoutField(field, fields[field], options)]));
}

const messages = (value) => (Array.isArray(value) ? value : [value])
  .filter((message) => typeof message === "string" && message.trim().length > 0);

export function mapCheckout422Errors(errors) {
  const fields = {}, general = [];
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) return { fields, general };
  for (const [field, value] of Object.entries(errors)) {
    const supplied = messages(value);
    if (!supplied.length) continue;
    if (CHECKOUT_FIELDS.includes(field)) fields[field] = supplied;
    else general.push({ field, messages: supplied }); // Includes holdId; no aliases.
  }
  return { fields, general };
}

export function firstInvalidCheckoutField(errors) {
  return CHECKOUT_FIELDS.find((field) => messages(errors?.[field]).length > 0) ?? null;
}
