const ARRAY_FILTERS = ["venues", "formats", "languages", "bands"];

export function localCalendarDate(date = new Date()) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function nextSevenLocalDates(now = new Date()) {
  const day = new Date(now);
  day.setHours(12, 0, 0, 0);
  return Array.from({ length: 7 }, () => {
    const value = localCalendarDate(day);
    day.setDate(day.getDate() + 1);
    return value;
  });
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysPerMonth[month - 1];
}

function normalizePage(value) {
  const page = /^\d+$/.test(String(value)) ? Number(value) : 1;
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function uniqueValues(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))]
    .sort();
}

function allowedValues(values, options, key) {
  const allowed = new Set(options.map((option) => option[key]));
  return values.filter((value) => allowed.has(value));
}

export function availableSessionFormats(filterOptions, selectedVenues) {
  if (selectedVenues.length === 0) return filterOptions.formats;

  const supported = new Set(filterOptions.venues
    .filter((venue) => selectedVenues.includes(venue.slug))
    .flatMap((venue) => venue.formats.map((format) => format.slug)));
  return filterOptions.formats.filter((format) => supported.has(format.slug));
}

export function normalizeSessionsQuery(query, { filterOptions, now } = {}) {
  const normalized = {
    date: isCalendarDate(query.date) ? query.date : localCalendarDate(now),
    ...Object.fromEntries(ARRAY_FILTERS.map((key) => [key, uniqueValues(query[key])])),
    search: query.search ?? "",
    sort: query.sort ?? "",
    page: normalizePage(query.page),
  };

  if (filterOptions) {
    normalized.venues = allowedValues(normalized.venues, filterOptions.venues, "slug");
    normalized.formats = allowedValues(normalized.formats,
      availableSessionFormats(filterOptions, normalized.venues), "slug");
    normalized.languages = allowedValues(normalized.languages, filterOptions.languages, "slug");
    normalized.bands = allowedValues(normalized.bands, filterOptions.timeBands, "id");
    if (!filterOptions.sorts.some((sort) => sort.id === normalized.sort)) {
      normalized.sort = "";
    }
  }

  return normalized;
}

export function parseSessionsQuery(searchParams, options) {
  return normalizeSessionsQuery({
    date: searchParams.get("date"),
    ...Object.fromEntries(ARRAY_FILTERS.map((key) => [key, searchParams.getAll(`${key}[]`)])),
    search: searchParams.get("search"),
    sort: searchParams.get("sort"),
    page: searchParams.get("page"),
  }, options);
}

export function reconcileSessionsPage(query, lastPage) {
  return Number.isInteger(lastPage) && lastPage >= 1 && query.page > lastPage
    ? { ...query, page: lastPage }
    : query;
}

// Both the browser URL and the API request use this exact, deterministic encoding.
export function writeSessionsQuery(query) {
  const searchParams = new URLSearchParams();
  searchParams.set("date", query.date);
  for (const key of ARRAY_FILTERS) {
    for (const value of uniqueValues(query[key])) searchParams.append(`${key}[]`, value);
  }
  if (query.search) searchParams.set("search", query.search);
  if (query.sort) searchParams.set("sort", query.sort);
  searchParams.set("page", String(query.page));
  return searchParams;
}

export function updateSessionsFilters(query, changes, filterOptions) {
  return normalizeSessionsQuery({ ...query, ...changes, page: 1 }, { filterOptions });
}
