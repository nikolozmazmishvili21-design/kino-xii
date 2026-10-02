import { apiRequest } from "./client.js";

export async function getFilterOptions({ signal } = {}) {
  const response = await apiRequest("/filter-options", {
    signal,
  });

  return response.data?.data;
}