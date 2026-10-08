import { ApiError, apiRequest } from "./client.js";

export async function getTickets({ filter, token, signal } = {}) {
  if (filter !== undefined && !["upcoming", "past"].includes(filter)) {
    throw new TypeError("Tickets filter must be upcoming or past.");
  }
  const path = filter === undefined ? "/tickets" : `/tickets?filter=${filter}`;
  const response = await apiRequest(path, { token, signal });
  const envelope = response.data;
  if (response.status !== 200 || !envelope || typeof envelope !== "object"
    || Array.isArray(envelope) || !Array.isArray(envelope.data)
    || !envelope.data.every((order) => order && typeof order === "object" && !Array.isArray(order))) {
    throw new ApiError("The tickets response could not be read.", { status: response.status });
  }
  // Domain/display usability is a separate pure check; refunded Orders are valid.
  return envelope.data;
}

// Preserve HTTP status/envelope for Refund outcome versus display classification.
export function refundOrder(reference, { token, signal } = {}) {
  if (typeof reference !== "string" || !reference.trim()) {
    throw new TypeError("Refund requires an exact server Order reference.");
  }
  return apiRequest(`/orders/${encodeURIComponent(reference)}/refund`, { method: "POST", token, signal });
}
