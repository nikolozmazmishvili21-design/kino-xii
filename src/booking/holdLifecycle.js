import { findSeat, selectionConfiguration } from "./seatSelection.js";

export const HOLD_COPY = {
  uncertain: "We couldn't confirm whether your seats were held. Start over to try again.",
  restore: "We couldn't restore your seat hold. Check your connection and try again.",
  mismatch: "We couldn't verify your saved seat hold. Retry or start over.",
  expired: "Your hold time expired. Please re-select your seats.",
  release: "We couldn't release your seats immediately. They will expire automatically.",
  unknown: "Some seats may remain temporarily unavailable until the previous hold expires.",
  changed: "Changes are not held until you continue.",
};
export const isHoldId = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const money = (value) => typeof value === "number" && Number.isFinite(value);
export function remainingHoldMs(expiresAt, now = Date.now()) {
  return Math.max(0, Date.parse(expiresAt) - now);
}
export function formatHoldTime(remainingMs) {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function observeHoldClock(hold, onTick, onExpire, { clock = Date.now, page = document, view = window } = {}) {
  let expired = false;
  const recalculate = () => {
    const now = clock();
    onTick(now);
    if (!expired && remainingHoldMs(hold.expiresAt, now) === 0) { expired = true; onExpire(hold); }
  };
  const onVisibility = () => { if (page.visibilityState === "visible") recalculate(); };
  const interval = view.setInterval(recalculate, 1000);
  page.addEventListener("visibilitychange", onVisibility);
  view.addEventListener("focus", recalculate);
  recalculate();
  return () => {
    view.clearInterval(interval);
    page.removeEventListener("visibilitychange", onVisibility);
    view.removeEventListener("focus", recalculate);
  };
}
export function usableHold(hold, sessionId, snapshot = null, now = Date.now()) {
  if (!isHoldId(hold?.holdId) || hold.sessionId !== sessionId || hold.isLive !== true
    || typeof hold.expiresAt !== "string" || !Number.isFinite(Date.parse(hold.expiresAt))
    || remainingHoldMs(hold.expiresAt, now) <= 0 || !money(hold.subtotal)
    || !Array.isArray(hold.seats) || !hold.seats.length) return false;
  const ids = new Set();
  if (!hold.seats.every((seat) => {
    if (!Number.isSafeInteger(seat?.seatId) || ids.has(seat.seatId) || !text(seat.code)
      || !text(seat.ticketType?.slug) || !text(seat.ticketType?.name) || !money(seat.price)) return false;
    ids.add(seat.seatId);
    return !snapshot || snapshot.some((entry) => entry.seatId === seat.seatId && entry.ticketType === seat.ticketType.slug);
  })) return false;
  return !snapshot || snapshot.length === ids.size;
}
export function holdMatchesMap(hold, map) {
  return hold.seats.every(({ seatId, code }) => {
    const seat = findSeat(map, seatId);
    return seat?.isMine === true && seat.code === code && !["sold", "unavailable"].includes(seat.state);
  });
}
export function holdSelection(hold) {
  return Object.fromEntries(hold.seats.map((seat) => [seat.seatId, { ticketTypeSlug: seat.ticketType.slug }]));
}
export function sameAssignments(selection, hold) {
  return Boolean(hold && Object.keys(selection).length === hold.seats.length
    && hold.seats.every((seat) => selection[seat.seatId]?.ticketTypeSlug === seat.ticketType.slug));
}
export function snapshotSelection(selection, map) {
  return Object.freeze(Object.entries(selection).map(([id, assignment]) => Object.freeze({
    seatId: Number(id), ticketType: assignment.ticketTypeSlug, code: findSeat(map, id)?.code,
  })));
}
export function eligibleAssignment(entry, map, config, previousHold, contested = []) {
  const seat = findSeat(map, entry.seatId);
  const verifiedOwn = previousHold?.seats.some((held) => held.seatId === entry.seatId);
  return Boolean(config.ready && config.types.some((type) => type.slug === entry.ticketType)
    && seat && !contested.includes(seat.code) && !["sold", "unavailable"].includes(seat.state)
    && (entry.code === undefined || entry.code === seat.code)
    && (seat.isMine ? verifiedOwn : seat.state === "available"));
}
export function eligibleReplayAssignment(entry, map, config, previousHold) {
  const previouslyHeld = previousHold?.seats.some((seat) => seat.seatId === entry.seatId);
  return eligibleAssignment(entry, map, config, previousHold)
    && (!previouslyHeld || findSeat(map, entry.seatId)?.isMine === true);
}
export function canCreateHold(state, options, now = Date.now(), replayProof = null) {
  const config = selectionConfiguration(options, state.sessionRead.data);
  const snapshot = snapshotSelection(state.selection, state.seatMapRead.data);
  return state.step === "seats" && ["idle", "active", "error", "expired"].includes(state.hold.phase)
    && !state.recovery && state.sessionRead.status === "ready" && state.seatMapRead.status === "ready"
    && config.ready && snapshot.length > 0 && snapshot.length <= config.max
    && (!state.hold.data || remainingHoldMs(state.hold.data.expiresAt, now) > 0)
    && snapshot.every((entry) => ["adult", "child", "student"].includes(entry.ticketType)
      && eligibleAssignment(entry, state.seatMapRead.data, config, state.hold.data ?? replayProof, state.contested));
}
export function mapHoldErrors(errors, snapshot) {
  const fields = {}, unmatched = [];
  for (const [key, value] of Object.entries(errors && typeof errors === "object" ? errors : {})) {
    const messages = (Array.isArray(value) ? value : [value]).filter(text).join(" ");
    if (!messages) continue;
    const match = /^seats\.(\d+)(?:\.(seatId|ticketType))?$/.exec(key);
    const seatId = match && snapshot[Number(match[1])] ? snapshot[Number(match[1])].seatId
      : ["seatId", "ticketType"].includes(key) && snapshot.length === 1 ? snapshot[0].seatId : null;
    if (seatId !== null) fields[seatId] = [fields[seatId], messages].filter(Boolean).join(" ");
    else unmatched.push(`${key}: ${messages}`);
  }
  return { fields, unmatched };
}
