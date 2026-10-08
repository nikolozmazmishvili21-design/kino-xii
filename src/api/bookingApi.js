import { apiRequest } from "./client.js";

export async function createHold(sessionId, assignments, { token } = {}) {
  const response = await apiRequest(`/sessions/${sessionId}/holds`, {
    method: "POST", token,
    body: { seats: assignments.map(({ seatId, ticketType }) => ({ seatId, ticketType })) },
  });
  return response.status === 201 ? response.data?.data : null;
}

export async function getHold(holdId, { token, signal } = {}) {
  const response = await apiRequest(`/holds/${encodeURIComponent(holdId)}`, { token, signal });
  return response.data?.data;
}

export async function releaseHold(holdId, { token } = {}) {
  return apiRequest(`/holds/${encodeURIComponent(holdId)}`, { method: "DELETE", token });
}

// Keep status/envelope evidence intact: a successful HTTP response alone does not
// prove that the returned Order is usable. The caller classifies it separately.
export async function createOrder(fields, { token } = {}) {
  const { holdId, fullName, email, mobileNumber, cardNumber, expiry, cvv } = fields;
  const body = { holdId, fullName, email, mobileNumber, cardNumber, expiry, cvv };
  if (!Object.values(body).every((value) => typeof value === "string")) {
    throw new TypeError("All seven Order fields must be strings.");
  }
  return apiRequest("/orders", { method: "POST", token, body });
}
