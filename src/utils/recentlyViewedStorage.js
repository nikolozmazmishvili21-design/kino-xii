// Browser-local capacity, not an API/business limit. Existing account keys survive.
export const RECENTLY_VIEWED_LIMIT = 20;
export const isRecentSlug = slug => typeof slug === "string" && Boolean(slug.trim()) && slug.length <= 512;
export function recentlyViewedKey(userId) {
  if (userId === null) return "kino-xii:recently-viewed:guest";
  return Number.isSafeInteger(userId) && userId > 0 ? `kino-xii:recently-viewed:${userId}` : null;
}

export function readRecentlyViewed(userId, { repair = false } = {}) {
  const key = recentlyViewedKey(userId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    let stored;
    try { stored = JSON.parse(raw); } catch { stored = null; }
    const slugs = Array.isArray(stored) ? [...new Set(stored.filter(isRecentSlug))].slice(0, RECENTLY_VIEWED_LIMIT) : [];
    if (repair && raw !== null && raw !== JSON.stringify(slugs)) writeRecentlyViewed(userId, slugs);
    return slugs;
  } catch { return []; }
}

function writeRecentlyViewed(userId, slugs) {
  const key = recentlyViewedKey(userId);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(slugs));
    return true;
  } catch { return false; } // Storage restrictions never prevent navigation.
}

export function recordRecentlyViewed(userId, slug) {
  if (!isRecentSlug(slug)) return false;
  return writeRecentlyViewed(userId, [slug, ...readRecentlyViewed(userId).filter(value => value !== slug)].slice(0, RECENTLY_VIEWED_LIMIT));
}

export function pruneRecentlyViewed(userId, missing) {
  // Read again so a completed read cannot overwrite a newer visit in another tab.
  const removed = new Set(missing);
  return writeRecentlyViewed(userId, readRecentlyViewed(userId).filter(slug => !removed.has(slug)));
}
