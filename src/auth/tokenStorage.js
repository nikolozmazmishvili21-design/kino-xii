const TOKEN_STORAGE_KEY = "kino-xii.auth.token";
let fallbackToken = null;
let useMemoryFallback = false;

export function getToken() {
  if (useMemoryFallback) {
    return fallbackToken;
  }

  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return fallbackToken;
  }
}

export function setToken(token) {
  fallbackToken = token;

  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    useMemoryFallback = false;
  } catch {
    useMemoryFallback = true;
    // Storage can be unavailable or full; authentication must not crash.
  }
}

export function clearToken() {
  fallbackToken = null;

  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    useMemoryFallback = false;
  } catch {
    useMemoryFallback = true;
    // Storage access failure must not prevent local logout.
  }
}
