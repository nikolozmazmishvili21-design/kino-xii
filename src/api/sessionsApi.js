import { apiRequest } from "./client.js";

export async function getSession(sessionId, { signal } = {}) {
  const response = await apiRequest(`/sessions/${sessionId}`, { signal });
  return response.data?.data;
}

export async function getSessionSeats(sessionId, { signal } = {}) {
  const response = await apiRequest(`/sessions/${sessionId}/seats`, { signal });
  return response.data?.data;
}

// Forward the canonical query string unchanged; it is also the hook's request identity.
export async function getSessions(queryString, { signal } = {}) {
  const response = await apiRequest(`/sessions?${queryString}`, { signal });
  return response.data;
}

export async function getFilterOptions({ signal } = {}) {
  const response = await apiRequest("/filter-options", {
    signal,
  });

  return response.data?.data;
}
