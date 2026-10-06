export const PROFILE_FIELDS = ["fullName", "mobileNumber", "dateOfBirth", "preferredVenueId"];

export function normalizeMobile(value) {
  return value.replaceAll(" ", "");
}

function validateName(value) {
  if (!value) return "Name is required";
  if (value.length < 3) return "Name must be at least 3 characters";
  if (value.length > 50) return "Name must not exceed 50 characters";
  return null;
}

function validateMobile(value) {
  const number = normalizeMobile(value);
  if (!number) return "Mobile number is required";
  if (!/^\d+$/.test(number)) return "Please enter a valid Georgian mobile number (9 digits starting with 5)";
  if (!number.startsWith("5")) return "Georgian mobile numbers must start with 5";
  if (number.length !== 9) return "Mobile number must be exactly 9 digits";
  return null;
}

export function validateDateOfBirth(value, today = new Date()) {
  if (!value) return "Date of birth is required";
  const invalid = "Please enter a valid date of birth";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1
    || date.getDate() !== day) return invalid;

  // Compare calendar components, not elapsed milliseconds or a derived account age.
  const calendarDate = year * 10000 + month * 100 + day;
  const current = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  if (calendarDate > current) return invalid;
  const boundary = (today.getFullYear() - 12) * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  if (calendarDate > boundary) return "You must be at least 12 years old to create an account";
  return null;
}

export function validateProfile(draft, { venues, baseline, today } = {}) {
  const selected = draft.preferredVenueId;
  const validVenue = selected === "" ? baseline.preferredVenueId === ""
    : venues.some((venue) => Number.isInteger(venue.id) && String(venue.id) === selected);
  return {
    fullName: validateName(draft.fullName),
    mobileNumber: validateMobile(draft.mobileNumber),
    dateOfBirth: validateDateOfBirth(draft.dateOfBirth, today),
    preferredVenueId: validVenue ? null : "Please select an available venue",
  };
}
