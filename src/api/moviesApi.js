import { apiRequest } from "./client.js";

export async function getFeaturedMovies({ signal } = {}) {
  const response = await apiRequest("/movies/featured", { signal });
  return response.data?.data;
}

async function getCatalogue(path, { limit, signal } = {}) {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  const response = await apiRequest(`${path}${suffix}`, { signal });
  return response.data?.data;
}

export function getNowPlayingMovies(options) {
  return getCatalogue("/movies/now-playing", options);
}

export function getComingSoonMovies(options) {
  return getCatalogue("/movies/coming-soon", options);
}

export async function getMovie(slug, { signal } = {}) {
  const response = await apiRequest(`/movies/${encodeURIComponent(slug)}`, { signal });
  return response.data?.data;
}

export async function getMovieSessions(slug, date, { signal } = {}) {
  const query = new URLSearchParams({ date });
  const response = await apiRequest(`/movies/${encodeURIComponent(slug)}/sessions?${query}`, { signal });
  return response.data?.data;
}
