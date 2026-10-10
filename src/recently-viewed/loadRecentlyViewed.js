import { getMovie } from "../api/moviesApi.js";
import { isRecentSlug, readRecentlyViewed, pruneRecentlyViewed } from "../utils/recentlyViewedStorage.js";

// Display data is always fresh; only definite 404s prune valid stored slugs.
export async function loadRecentlyViewed(userId, { signal, isCurrent = () => true, loadMovie = getMovie } = {}) {
  const current = () => !signal?.aborted && isCurrent();
  const assertCurrent = () => { if (!current()) throw new DOMException("Obsolete history read", "AbortError"); };
  assertCurrent();
  const slugs = readRecentlyViewed(userId, { repair: true }), movies = [], missing = [];
  let failed = false;
  for (const slug of slugs) {
    assertCurrent();
    try {
      const movie = await loadMovie(slug, { signal });
      assertCurrent();
      if (!movie || !isRecentSlug(movie.slug) || movie.slug !== slug || typeof movie.title !== "string" || !movie.title.trim()) {
        throw new Error("The recently viewed movie response could not be read.");
      }
      movies.push(movie);
    } catch (error) {
      assertCurrent();
      if (error?.name === "AbortError") throw error;
      if (error?.status === 404) missing.push(slug);
      else failed = true;
    }
    if (movies.length === 2) break;
  }
  assertCurrent();
  if (missing.length) pruneRecentlyViewed(userId, missing);
  return { movies, failed, hasHistory: slugs.some(slug => !missing.includes(slug)) };
}
