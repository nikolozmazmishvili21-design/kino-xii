export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return localDateKey(date) === value ? date : null;
}

export function movieDateModel(availableDates, today, comingSoon = false) {
  const validDates = [...new Set(availableDates.filter((value) => parseLocalDate(value)))].sort();
  const pastDates = validDates.filter((value) => value < today);
  const upcomingDates = validDates.filter((value) => value >= today);
  const minimumEnd = parseLocalDate(today);
  minimumEnd.setDate(minimumEnd.getDate() + 6);
  // ISO calendar keys sort chronologically; API array position has no meaning.
  const latest = validDates.at(-1);
  const end = latest && latest > localDateKey(minimumEnd) ? latest : localDateKey(minimumEnd);
  const days = [];
  for (const date = parseLocalDate(today); localDateKey(date) <= end; date.setDate(date.getDate() + 1)) {
    days.push(localDateKey(date));
  }
  const selectableDates = new Set(comingSoon ? [] : upcomingDates);
  const initialDate = selectableDates.has(today) ? today : [...selectableDates][0] ?? null;
  return { days, selectableDates, initialDate, pastDates };
}

export function formatMovieDate(value, options = { day: "numeric", month: "long", year: "numeric" }) {
  const date = parseLocalDate(value);
  return date ? new Intl.DateTimeFormat("en-GB", options).format(date) : "Not available";
}

export function groupSessionsByHall(sessions) {
  const halls = new Map();
  for (const session of sessions) {
    if (!halls.has(session.hall.id)) halls.set(session.hall.id, { hall: session.hall, sessions: [] });
    halls.get(session.hall.id).sessions.push(session);
  }
  return [...halls.values()];
}

export function isUnderage(user, rating) {
  return user?.profileComplete === true && typeof user.age === "number" && Number.isFinite(user.age)
    && typeof rating?.minAge === "number" && Number.isFinite(rating.minAge) && user.age < rating.minAge;
}
