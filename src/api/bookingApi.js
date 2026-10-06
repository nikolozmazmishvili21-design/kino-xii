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
