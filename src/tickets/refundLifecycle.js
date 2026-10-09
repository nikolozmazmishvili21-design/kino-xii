import { readableOrder } from "../booking/orderLifecycle.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const usableRefundReference = (value) => typeof value === "string" && value.trim().length > 0;

// Capture only server identity; never normalize a reference or coerce IDs.
export function captureRefundIdentity(order) {
  if (!object(order) || !usableRefundReference(order.reference)) return null;
  const identity = { reference: order.reference };
  if (Object.hasOwn(order, "id")) {
    if (!Number.isSafeInteger(order.id)) return null;
    identity.orderId = order.id;
  }
  if (object(order.session) && Object.hasOwn(order.session, "id")) {
    if (!Number.isSafeInteger(order.session.id)) return null;
    identity.sessionId = order.session.id;
  }
  return Object.freeze(identity);
}

const validIdentity = (identity) => object(identity) && usableRefundReference(identity.reference)
  && (identity.orderId === undefined || Number.isSafeInteger(identity.orderId))
  && (identity.sessionId === undefined || Number.isSafeInteger(identity.sessionId));

export function matchesRefundReference(order, identity) {
  return object(order) && validIdentity(identity)
    && order.reference === identity.reference;
}

export function matchesRefundIdentity(order, identity) {
  return matchesRefundReference(order, identity)
    && (identity.orderId === undefined || order.id === identity.orderId)
    && (identity.sessionId === undefined || order.session?.id === identity.sessionId);
}

export function readableRefundOrder(order, identity = captureRefundIdentity(order)) {
  return captureRefundIdentity(order) !== null && matchesRefundIdentity(order, identity) && readableOrder(order)
    && typeof order.isUpcoming === "boolean" && typeof order.isRefundable === "boolean"
    && (order.status !== "refunded" || (!order.isUpcoming && !order.isRefundable))
    && (!order.isRefundable || (order.status === "paid" && order.isUpcoming));
}

export function refundEligible(order, identity = captureRefundIdentity(order)) {
  return readableRefundOrder(order, identity) && order.status === "paid"
    && order.isUpcoming === true && order.isRefundable === true;
}

export function classifyRefundResponse(response, identity) {
  const order = object(response?.data) ? response.data.data : null;
  if (response?.status === 200 && matchesRefundReference(order, identity)
    && order.status === "refunded") {
    // Identity/display contradictions cannot erase matching reference/status proof.
    const complete = readableRefundOrder(order, identity);
    return { kind: "succeeded", reportedRefunded: true,
      displayStatus: complete ? "ready" : "refreshing", order: complete ? order : null };
  }
  return { kind: "uncertain", reason: "unconfirmed-response" };
}

export function classifyRefundError(error) {
  const body = object(error?.data) ? error.data : null;
  const message = typeof body?.message === "string" && body.message.trim()
    ? body.message : null;
  if (error?.status === 401) return { kind: "unauthenticated", message };
  if ([403, 404, 422].includes(error?.status)) {
    return { kind: "rejected", status: error.status, message,
      reason: error.status === 403 ? "ownership" : error.status === 404 ? "missing" : "refused",
      ...(error.status === 422 && body && Object.hasOwn(body, "errors") ? { errors: body.errors } : {}) };
  }
  // Includes abort/body/network/500 and unclassified statuses. No rollback inference.
  return { kind: "uncertain", reason: "unknown-outcome" };
}

// These are coordinator/read guards, not additional API fields. A generation
// advances at dispatch AND finalization; a fresh read captures it after retirement.
export function verificationPrerequisites(attempt, read, current) {
  return Boolean(attempt && read && current && attempt.phase === "uncertain"
    && ["settled", "deadline-retired"].includes(attempt.disposition)
    && validIdentity(attempt.identity)
    && Number.isSafeInteger(attempt.accountId) && attempt.accountId === current.accountId
    && read.accountId === current.accountId && read.authGeneration === current.authGeneration
    && Number.isSafeInteger(current.authGeneration)
    && read.unfiltered === true && current.hasActivePost === false
    && Number.isSafeInteger(attempt.settledGeneration)
    && Number.isSafeInteger(read.generation) && read.generation === current.generation
    && read.generation >= attempt.settledGeneration
    && Number.isSafeInteger(read.requestId) && read.requestId === current.readRequestId);
}

export function classifyRefundVerification(orders, attempt, read, current) {
  if (!verificationPrerequisites(attempt, read, current) || !Array.isArray(orders)) {
    return { kind: "blocked" };
  }
  return inspectRefundVerification(orders, attempt.identity);
}

// Target evidence only. The runtime owns settlement, read and auth admission.
export function inspectRefundVerification(orders, identity) {
  if (!Array.isArray(orders)) return { kind: "inconclusive" };
  const matches = orders.filter((order) => matchesRefundReference(order, identity));
  if (matches.length !== 1) return { kind: "inconclusive" };
  const order = matches[0];
  if (order.status === "refunded") {
    return classifyRefundResponse({ status: 200, data: { data: order } }, identity);
  }
  if (!matchesRefundIdentity(order, identity)) return { kind: "inconclusive" };
  if (refundEligible(order, identity)) return { kind: "retry_available" };
  return { kind: readableRefundOrder(order, identity) ? "ineligible" : "inconclusive" };
}

export function reconfirmationEligible(orders, attempt, read, current) {
  return classifyRefundVerification(orders, attempt, read, current).kind === "retry_available";
}
