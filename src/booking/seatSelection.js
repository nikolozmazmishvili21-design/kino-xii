export const CONFIGURATION_ERROR = "Booking configuration is unavailable. Reload the page and try again.";
export const CONTEXT_ERROR = "Booking details are incomplete. Try again.";

export function hasRatingContext(session) {
  return Number.isSafeInteger(session?.movie?.ageRating?.minAge);
}

export function hasPreviewContext(session) {
  return hasRatingContext(session) && typeof session.price === "number" && Number.isFinite(session.price);
}

function validTicketType(type) {
  return type && Number.isSafeInteger(type.id) && typeof type.slug === "string"
    && typeof type.name === "string" && type.name.length > 0
    && typeof type.priceRatio === "number" && Number.isFinite(type.priceRatio)
    && (type.blockedFromRatingAge === null || Number.isSafeInteger(type.blockedFromRatingAge));
}

export function allowedTicketTypes(options, session) {
  if (!hasRatingContext(session)) return [];
  return (Array.isArray(options?.ticketTypes) ? options.ticketTypes : []).filter((type) => validTicketType(type)
    && (type.blockedFromRatingAge == null || session.movie.ageRating.minAge < type.blockedFromRatingAge));
}

export function selectionConfiguration(options, session) {
  const adult = Array.isArray(options?.ticketTypes)
    ? options.ticketTypes.find((type) => type?.slug === "adult" && validTicketType(type)) : null;
  if (!adult || !Number.isSafeInteger(options?.maxSeatsPerOrder) || options.maxSeatsPerOrder < 0) {
    return { ready: false, error: CONFIGURATION_ERROR, recovery: "reload" };
  }
  if (!hasPreviewContext(session)) return { ready: false, error: CONTEXT_ERROR, recovery: "retry" };
  const types = allowedTicketTypes(options, session);
  if (!types.includes(adult)) return { ready: false, error: CONFIGURATION_ERROR, recovery: "reload" };
  return { ready: true, adult, types, max: options.maxSeatsPerOrder };
}

export function seatPresentation(seat, locallySelected = false, verifiedOwn = false, contested = false) {
  if (seat.state === "unavailable") return { kind: "gap", disabled: true, description: "unavailable" };
  if (contested) return { kind: "sold", disabled: true, description: "contested; waiting for seat map refresh" };
  if (seat.isMine && !verifiedOwn) return { kind: "own", disabled: true, description: "own held seat; unavailable for editing in this booking" };
  if (seat.state === "sold") return { kind: "sold", disabled: true, description: "sold" };
  if (seat.isMine && verifiedOwn) return { kind: locallySelected ? "selected" : "own", disabled: false, description: "held in this booking" };
  if (seat.state === "held") return { kind: "held", disabled: true, description: "held by another user" };
  return { kind: locallySelected ? "selected" : "available", disabled: false,
    description: locallySelected ? "selected locally" : "available" };
}

export function rowSlots(row) {
  return row.seats.flatMap((seat) => [
    { kind: seat.state === "unavailable" ? "gap" : "seat", key: seat.id, seat },
    ...(seat.aisleAfter ? [{ kind: "aisle", key: `aisle-${seat.id}` }] : []),
  ]);
}

export function findSeat(map, id) {
  for (const section of map?.sections ?? []) {
    for (const row of section.rows) {
      const seat = row.seats.find((candidate) => candidate.id === Number(id));
      if (seat) return seat;
    }
  }
  return null;
}

export function isSeatMap(map, sessionId) {
  if (map?.sessionId !== sessionId || !map.hall || !Array.isArray(map.sections)) return false;
  const ids = new Set();
  return map.sections.every((section) => typeof section.name === "string" && Array.isArray(section.rows)
    && section.rows.every((row) => typeof row.label === "string" && Array.isArray(row.seats)
      && row.seats.every((seat) => {
        if (!Number.isSafeInteger(seat.id) || ids.has(seat.id)) return false;
        ids.add(seat.id);
        return typeof seat.code === "string" && typeof seat.label === "string"
          && ["available", "sold", "held", "unavailable"].includes(seat.state)
          && typeof seat.aisleAfter === "boolean" && typeof seat.isMine === "boolean";
      })));
}

// Multiply the decimal values as integers before rounding, avoiding binary .005 ties.
function decimalParts(value) {
  const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
  const decimals = coefficient.split(".")[1]?.length ?? 0;
  return { integer: BigInt(coefficient.replace(".", "")), scale: decimals - Number(exponent) };
}

export function previewCents(price, ratio) {
  if (![price, ratio].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const a = decimalParts(price);
  const b = decimalParts(ratio);
  let product = a.integer * b.integer;
  const scale = a.scale + b.scale - 2;
  if (scale > 0) {
    const divisor = 10n ** BigInt(scale);
    const sign = product < 0n ? -1n : 1n;
    const magnitude = product * sign;
    product = ((magnitude + divisor / 2n) / divisor) * sign;
  } else product *= 10n ** BigInt(-scale);
  const cents = Number(product);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function selectedSeatPreviews(selection, map, session, options, hold = null) {
  const config = selectionConfiguration(options, session);
  if (!config.ready) return [];
  return Object.entries(selection).flatMap(([id, assignment]) => {
    const seat = findSeat(map, id);
    const type = config.types.find((candidate) => candidate.slug === assignment.ticketTypeSlug);
    const held = hold?.seats.find((entry) => entry.seatId === Number(id));
    if (!seat || ["sold", "unavailable"].includes(seat.state) || (seat.isMine ? !held : seat.state !== "available") || !type) return [];
    const cents = held?.ticketType.slug === type.slug ? held.price * 100 : previewCents(session.price, type.priceRatio);
    return cents === null ? [] : [{ seat, type: held?.ticketType.slug === type.slug ? { ...type, name: held.ticketType.name } : type, cents }];
  });
}

export function subtotalCents(previews) {
  return previews.reduce((total, preview) => total + preview.cents, 0);
}

const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function formatGEL(cents) {
  return `₾ ${amountFormat.format(cents / 100)}`;
}
