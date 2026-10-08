const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const money = (value) => typeof value === "number" && Number.isFinite(value);
const dateTime = (value) => text(value) && Number.isFinite(Date.parse(value));
const CONTACT_FIELDS = ["fullName", "email", "mobileNumber"];

function usableSession(session) {
  if (!object(session) || !Number.isSafeInteger(session.id) || !text(session.date) || !text(session.time)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(session.date);
  if (!match) return false;
  const parsed = new Date(`${session.date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3])) return false;
  return text(session.movie?.title) && text(session.venue?.name) && text(session.hall?.name)
    && text(session.format?.name) && text(session.language?.name);
}

// Frontend display-usability checks, not a claim that OpenAPI marks these fields
// required. Optional contact/date/card requirements follow actual display needs.
export function readableOrder(order, { sessionId, contactFields = [], showPaidAt = false, showCardLastFour = false } = {}) {
  if (!object(order) || !text(order.reference) || !["paid", "refunded"].includes(order.status)
    || !money(order.totalPrice) || !usableSession(order.session)
    || (sessionId !== undefined && order.session.id !== sessionId)
    || !Array.isArray(order.tickets) || !order.tickets.length
    || !order.tickets.every((ticket) => object(ticket) && text(ticket.seatCode)
      && text(ticket.ticketType?.slug) && text(ticket.ticketType?.name) && money(ticket.price))) return false;
  if (!contactFields.every((field) => CONTACT_FIELDS.includes(field) && object(order.contact) && text(order.contact[field]))) return false;
  if (showPaidAt && !dateTime(order.paidAt)) return false;
  if (showCardLastFour && !(typeof order.cardLastFour === "string" && /^\d{4}$/.test(order.cardLastFour))) return false;
  return true;
}

export function confirmationReadyOrder(order, options) {
  return order?.status === "paid" && readableOrder(order, options);
}

// Call only with server Order evidence, never with the submitted request. Do not
// crawl session/contact/tickets or infer an association from their values.
export function orderRecoveryIdentity(order) {
  if (!object(order)) return null;
  const identity = {};
  if (Object.hasOwn(order, "id") && Number.isSafeInteger(order.id)) identity.id = order.id;
  if (Object.hasOwn(order, "reference") && text(order.reference)) identity.reference = order.reference;
  return Object.keys(identity).length ? identity : null;
}

export function classifyOrderResponse(response, options) {
  const envelope = response?.data;
  const order = object(envelope) && Object.hasOwn(envelope, "data") ? envelope.data : null;
  if (response?.status === 201) {
    if (confirmationReadyOrder(order, options)) return { kind: "usable-order", order };
    return { kind: "malformed-success", recovery: orderRecoveryIdentity(order) };
  }
  return { kind: "uncertain", recovery: null };
}

// Classification only: locks, auth guards, release and UI transitions belong to
// the later coordinator. Unknown/transport/abort errors establish no rollback.
export function classifyOrderError(error) {
  const body = error && Object.hasOwn(error, "data") ? (object(error.data) ? error.data : null) : error;
  const message = text(body?.message) ? body.message : null;
  if (error?.status === 401) return { kind: "unauthenticated", message };
  if (error?.status === 403) return { kind: "forbidden", message };
  // D-028 defensive policy, not an endpoint-defined missing-Order meaning.
  if (error?.status === 404) return { kind: "terminal-context", status: 404, message };
  if (error?.status === 409) {
    const contested = body?.contested;
    return { kind: "conflict", message,
      contested: Array.isArray(contested) && contested.every(text) ? [...contested] : null };
  }
  if (error?.status === 422) {
    if (body && Object.hasOwn(body, "errors")) return { kind: "validation", message, errors: body.errors };
    if (message) return { kind: "business", message };
    return { kind: "rejected", status: 422, message: null };
  }
  return { kind: "uncertain", recovery: null };
}
