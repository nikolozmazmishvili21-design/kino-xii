import { readableOrder } from "../booking/orderLifecycle.js";

// The unfiltered server list owns ordering and grouping. Dates are display data.
// Reject an unreadable/contradictory list instead of guessing a group or count.
export function groupTicketOrders(orders) {
  const groups = { upcoming: [], past: [] };
  const references = new Set();
  if (!Array.isArray(orders)) throw new TypeError("The tickets response could not be read.");
  for (const order of orders) {
    if (!readableOrder(order) || typeof order.isUpcoming !== "boolean"
      || (order.status === "refunded" && order.isUpcoming)
      || references.has(order.reference)) {
      throw new TypeError("The tickets response could not be read.");
    }
    references.add(order.reference);
    groups[order.isUpcoming ? "upcoming" : "past"].push(order);
  }
  return groups;
}

export function findRecoveredOrder(orders, identity) {
  const fields = Object.entries(identity ?? {}).filter(([field]) => field === "id" || field === "reference");
  if (!fields.length) return null;
  const matches = orders.filter((order) => fields.every(([field, value]) => order[field] === value));
  return matches.length === 1 ? matches[0] : null;
}
