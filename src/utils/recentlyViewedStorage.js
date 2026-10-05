// Only user-scoped, ordered slugs cross this storage boundary.
export function recordRecentlyViewed(userId, slug) {
  if (userId === null || userId === undefined || !slug || typeof slug !== "string") return false;
  try {
    const key = `kino-xii:recently-viewed:${userId}`;
    let previous = [];
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(stored)) previous = stored.filter((value) => typeof value === "string" && value);
    } catch { /* An invalid record can be replaced with a valid slug list. */ }
    const ordered = [slug, ...new Set(previous.filter((value) => value !== slug))];
    localStorage.setItem(key, JSON.stringify(ordered));
    return true;
  } catch {
    // Storage restrictions must not prevent viewing a movie.
    return false;
  }
}
