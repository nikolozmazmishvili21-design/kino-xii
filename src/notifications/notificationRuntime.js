import { getComingSoonMovies, notifyMovie } from "../api/moviesApi.js";
import { createNotifyAction } from "../auth/pendingAction.js";

const sameSession = (a, b) => a?.accountId === b?.accountId && a?.generation === b?.generation;
export const IDLE_NOTIFICATION = Object.freeze({ phase: "idle" });

function failureMessage(error) {
  if (error.status === 404) return "This movie is no longer available. Please refresh the page.";
  if (error.status === undefined) return "Could not connect. Please try Notify Me again.";
  if (error.status === 403) return "Notifications are not available for this account.";
  if ([409, 422].includes(error.status)) return error.message;
  if (error.status === 201) return error.message;
  return "Could not set your notification. Please try again.";
}

// App-shell lifetime retains confirmed results during Home remounts. Nothing is
// persisted locally. Both catalogue reads and POSTs belong to an auth generation.
export function createNotificationRuntime({ getAuth, requestAuthentication,
  notify = notifyMovie, getCatalogue = getComingSoonMovies }) {
  let owner = null, snapshot = { cards: {} };
  const listeners = new Set(), active = new Map(), movies = new Map();
  const emit = () => { for (const listener of listeners) listener(); };
  const setCard = (slug, value) => {
    snapshot = { cards: { ...snapshot.cards, [slug]: value } }; emit();
  };
  function syncAuth() {
    const next = getAuth();
    if (sameSession(owner, next)) return;
    owner = next ? { accountId: next.accountId, generation: next.generation } : null;
    for (const attempt of active.values()) attempt.controller.abort();
    active.clear();
    snapshot = { cards: {} }; emit();
  }
  async function request(slug, { replay = false } = {}) {
    const action = createNotifyAction(slug);
    if (!action) return false;
    syncAuth();
    if (active.has(slug) || ["success", "awaiting-auth"].includes(snapshot.cards[slug]?.phase)) return false;
    const auth = getAuth();
    if (!auth) {
      if (replay) return false;
      if (requestAuthentication(action, false)) setCard(slug, { phase: "awaiting-auth" });
      return false;
    }
    const attempt = { auth, controller: new AbortController() };
    active.set(slug, attempt); // Synchronous lock before subscribers can re-enter.
    setCard(slug, { phase: "pending" });
    const current = () => active.get(slug) === attempt && sameSession(auth, getAuth());
    try {
      if (!current()) return false;
      await notify(slug, { token: auth.token, signal: attempt.controller.signal, movieId: movies.get(slug)?.id });
      if (!current()) return false;
      setCard(slug, { phase: "success" });
      return true;
    } catch (error) {
      if (!current()) return false;
      if (error.status === 401) {
        // One automatic continuation per explicit intent. A replayed 401 ends
        // that intent, expires auth, and leaves a recoverable message.
        requestAuthentication(action, true, { replay });
        setCard(slug, replay
          ? { phase: "error", message: "Your session could not be verified. Please log in and try again." }
          : { phase: "awaiting-auth" });
      } else {
        setCard(slug, { phase: "error", message: failureMessage(error) });
      }
      return false;
    } finally {
      if (active.get(slug) === attempt) active.delete(slug);
    }
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    state: () => snapshot,
    syncAuth,
    request,
    cancelContinuation() {
      for (const [slug, card] of Object.entries(snapshot.cards)) {
        if (card.phase === "awaiting-auth") setCard(slug, IDLE_NOTIFICATION);
      }
    },
    async loadCatalogue({ signal, limit } = {}) {
      syncAuth();
      const auth = getAuth();
      const data = await getCatalogue({ signal, limit, token: auth?.token ?? null });
      if (signal?.aborted || !sameSession(auth, getAuth())) throw new DOMException("Obsolete catalogue", "AbortError");
      if (!Array.isArray(data) || !data.every(movie => movie && Number.isSafeInteger(movie.id)
        && movie.id > 0 && createNotifyAction(movie.slug) && typeof movie.title === "string" && movie.title.trim())) {
        throw new Error("The movie catalogue response could not be read.");
      }
      for (const movie of data) {
        movies.set(movie.slug, { id: movie.id });
        // Optional server extension: only an explicit boolean true from a read
        // made by this authenticated session restores success. Missing is unknown.
        if (auth && movie.isNotified === true && !active.has(movie.slug)
          && snapshot.cards[movie.slug]?.phase !== "success") setCard(movie.slug, { phase: "success" });
      }
      return data;
    },
  };
}
