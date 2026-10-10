import { useCallback, useMemo, useRef, useState } from "react";
import * as authApi from "../api/authApi.js";
import { AuthContext } from "./AuthContext.js";
import { clearToken, getToken, setToken } from "./tokenStorage.js";
import { isSamePendingAction, normalizePendingAction } from "./pendingAction.js";

const INITIAL_STATE = {
  status: "restoring",
  user: null,
  mutation: null,
  error: null,
};
const EMPTY_ACTION_STATE = { pendingAction: null, bookingReadyAction: null };

export default function AuthProvider({ children }) {
  const [authState, setAuthState] = useState(INITIAL_STATE);
  const restoration = useRef(null);
  const mutation = useRef(null);
  const revision = useRef(0);
  const currentUser = useRef(null);
  // Session identity is independent of User replacement and React render identity.
  // Credentials stay behind this private getter, never in context snapshots.
  const session = useRef(null), sessionGeneration = useRef(0);
  const authListeners = useRef(new Set());
  const registerAuthLifecycle = useCallback((handler) => {
    authListeners.current.add(handler);
    return () => authListeners.current.delete(handler);
  }, []);
  const notifyAuthLifecycle = useCallback((type) => {
    for (const handler of [...authListeners.current]) {
      try { handler(type); } catch { /* One observer cannot prevent auth cleanup. */ }
    }
  }, []);
  const invalidateSession = useCallback((type = "changed") => {
    sessionGeneration.current++;
    session.current = null;
    notifyAuthLifecycle(type);
  }, [notifyAuthLifecycle]);
  const adoptSession = useCallback((nextUser, token) => {
    if (session.current?.accountId !== nextUser.id || session.current.token !== token) {
      sessionGeneration.current++;
    }
    session.current = Object.freeze({ accountId: nextUser.id, generation: sessionGeneration.current, token });
    notifyAuthLifecycle("changed");
  }, [notifyAuthLifecycle]);
  const getRequestAuth = useCallback(() => mutation.current ? null : session.current, []);
  const getSessionIdentity = useCallback(() => {
    const current = getRequestAuth();
    return current ? { accountId: current.accountId, generation: current.generation } : null;
  }, [getRequestAuth]);
  const bookingLogout = useRef(null);
  const registerBookingLogout = useCallback((handler) => {
    bookingLogout.current = handler;
    return () => { if (bookingLogout.current === handler) bookingLogout.current = null; };
  }, []);
  const protectedActions = useRef(EMPTY_ACTION_STATE);
  const [actionState, setActionState] = useState(EMPTY_ACTION_STATE);

  const updateActions = useCallback((next) => {
    // Update synchronously before React renders so effect replay cannot consume twice.
    protectedActions.current = next;
    setActionState(next);
  }, []);

  const setPendingAction = useCallback((action, { newIntent = false } = {}) => {
    const descriptor = normalizePendingAction(action);
    if (!descriptor || mutation.current?.type === "logout") return false;
    const current = protectedActions.current;
    if (!newIntent && (isSamePendingAction(current.pendingAction, descriptor)
      || isSamePendingAction(current.bookingReadyAction, descriptor))) return true;

    // Explicit clicks get fresh identity, even for the same bounded descriptor.
    // Internal repeats keep identity so replay guards still process intent once.
    updateActions({ pendingAction: descriptor, bookingReadyAction: null });
    return true;
  }, [updateActions]);

  const clearProtectedAction = useCallback(() => {
    updateActions({ pendingAction: null, bookingReadyAction: null });
  }, [updateActions]);

  const markBookingReady = useCallback((action) => {
    if (action?.type !== "OPEN_BOOKING" || mutation.current || authState.status !== "authenticated"
      || currentUser.current?.profileComplete !== true
      || protectedActions.current.pendingAction !== action) return false;

    updateActions({ pendingAction: null, bookingReadyAction: action });
    return true;
  }, [authState.status, updateActions]);

  const consumeNotifyAction = useCallback((expectedAction) => {
    const action = protectedActions.current.pendingAction;
    if (action?.type !== "NOTIFY_MOVIE" || action !== expectedAction || mutation.current
      || !session.current || !currentUser.current) return null;
    updateActions({ pendingAction: null, bookingReadyAction: null });
    return action;
  }, [updateActions]);

  // Future consumers pass their ready snapshot and proceed only on a non-null return.
  const consumeBookingReady = useCallback((expectedAction) => {
    const action = protectedActions.current.bookingReadyAction;
    if (!action || action !== expectedAction || mutation.current
      || currentUser.current?.profileComplete !== true) return null;
    updateActions({ pendingAction: null, bookingReadyAction: null });
    return action;
  }, [updateActions]);

  // Pass the complete API-returned User; older auth snapshots cannot replace it.
  const replaceUser = useCallback((nextUser) => {
    if (mutation.current || authState.status !== "authenticated"
      || currentUser.current !== authState.user
      || !nextUser || typeof nextUser !== "object" || nextUser.id !== authState.user?.id
      || typeof nextUser.profileComplete !== "boolean") return false;

    revision.current += 1;
    restoration.current = null;
    currentUser.current = nextUser;
    setAuthState((current) => current.status === "authenticated" && current.user === authState.user
      ? { ...current, user: nextUser }
      : current);

    const ready = protectedActions.current.bookingReadyAction;
    if (nextUser.profileComplete === false && ready) {
      updateActions({ pendingAction: ready, bookingReadyAction: null });
    }
    return true;
  }, [authState.status, authState.user, updateActions]);

  // A future protected consumer can report expiry with its active bounded intent.
  // This is deliberately not a global API interceptor.
  const expireSession = useCallback((action) => {
    const descriptor = normalizePendingAction(action);
    if (!descriptor || mutation.current) return false;
    revision.current += 1;
    restoration.current = null;
    currentUser.current = null;
    invalidateSession();
    clearToken();
    setAuthState({ ...INITIAL_STATE, status: "guest" });
    updateActions({ pendingAction: descriptor, bookingReadyAction: null });
    return true;
  }, [updateActions, invalidateSession]);

  const isCurrentUser = useCallback((expectedUser) => {
    return Boolean(expectedUser && currentUser.current === expectedUser && !mutation.current);
  }, []);
  const getCurrentUser = useCallback(() => mutation.current ? null : currentUser.current, []);

  // Profile expiry needs no invented booking intent and cannot clear newer auth.
  const expireProfileSession = useCallback((expectedUser) => {
    if (!isCurrentUser(expectedUser)) return false;
    revision.current += 1;
    restoration.current = null;
    currentUser.current = null;
    invalidateSession();
    clearToken();
    setAuthState({ ...INITIAL_STATE, status: "guest" });
    const actions = protectedActions.current;
    updateActions({
      pendingAction: actions.pendingAction ?? actions.bookingReadyAction,
      bookingReadyAction: null,
    });
    return true;
  }, [isCurrentUser, updateActions, invalidateSession]);

  const restoreSession = useCallback(() => {
    if (mutation.current) {
      // Boot waits for an active auth action instead of starting an older read.
      return mutation.current.promise.then(() => currentUser.current, () => null);
    }

    if (restoration.current?.revision === revision.current) {
      return restoration.current.promise;
    }

    const requestRevision = revision.current;

    const promise = Promise.resolve()
      .then(async () => {
        if (revision.current !== requestRevision) {
          return null;
        }

        const token = getToken();

        if (!token) {
          if (revision.current === requestRevision) {
            currentUser.current = null;
            invalidateSession();
            setAuthState({ ...INITIAL_STATE, status: "guest" });
          }

          return null;
        }

        if (revision.current === requestRevision) {
          // A fresh read must not erase the current account's editable draft.
          setAuthState((current) => current.user
            ? { ...current, error: null }
            : { ...INITIAL_STATE, status: "restoring" });
        }

        const response = await authApi.me({ token });

        if (revision.current !== requestRevision) {
          return mutation.current?.promise.then(() => currentUser.current, () => null) ?? currentUser.current;
        }

        currentUser.current = response.data;
        adoptSession(response.data, token);
        setAuthState({
          ...INITIAL_STATE,
          status: "authenticated",
          user: response.data,
        });

        return response.data;
      })
      .catch((error) => {
        if (revision.current !== requestRevision) {
          return null;
        }

        if (error.status === 401) {
          currentUser.current = null;
          invalidateSession();
          clearToken();
          setAuthState({ ...INITIAL_STATE, status: "guest" });
        } else {
          // A transient failure does not prove that the saved token is stale.
          setAuthState((current) => ({ ...current, error }));
          throw error;
        }

        return null;
      })
      .finally(() => {
        // Deduplicate only in-flight reads; a User snapshot is not a fresh /me.
        if (restoration.current?.promise === promise) {
          restoration.current = null;
        }
      });

    restoration.current = { promise, revision: requestRevision };
    return promise;
  }, [adoptSession, invalidateSession]);

  const runMutation = useCallback((type, fields) => {
    if (mutation.current) {
      if (mutation.current.type === type) {
        return mutation.current.promise;
      }

      return Promise.reject(
        new Error("Another authentication request is already in progress."),
      );
    }

    // Invalidate any restoration response before starting a newer auth action.
    if (type === "logout") {
      // Booking captures and initiates cleanup while this auth context is usable.
      bookingLogout.current?.();
      currentUser.current = null;
      clearProtectedAction();
    }
    invalidateSession(type === "logout" ? "logout" : "changed");
    revision.current += 1;
    restoration.current = null;
    setAuthState((current) => ({
      ...current,
      status: current.status === "restoring" ? "guest" : current.status,
      mutation: type,
      error: null,
    }));

    const promise = Promise.resolve()
      .then(async () => {
        if (type === "logout") {
          try {
            return await authApi.logout();
          } catch {
            // Remote revocation failure must not prevent local logout.
            return null;
          }
        }

        const response = await authApi[type](fields);
        const { user, token } = response.data;

        setToken(token);
        currentUser.current = user;
        adoptSession(user, token);
        setAuthState((current) => ({
          ...current,
          status: "authenticated",
          user,
        }));

        return user;
      })
      .catch((error) => {
        setAuthState((current) => ({ ...current, error }));
        // Keep ApiError's status, field errors and server message for callers.
        throw error;
      })
      .finally(() => {
        if (type === "logout") {
          clearToken();
          restoration.current = null;
        }

        mutation.current = null;
        // A failed login from an existing session must not strand protected reads.
        if (type !== "logout" && !session.current && currentUser.current && getToken()) {
          adoptSession(currentUser.current, getToken());
        }
        notifyAuthLifecycle("changed");
        setAuthState((current) => ({
          ...current,
          ...(type === "logout"
            ? { status: "guest", user: null, error: null }
            : {}),
          mutation: null,
        }));
      });

    mutation.current = { type, promise };
    return promise;
  }, [clearProtectedAction, invalidateSession, adoptSession, notifyAuthLifecycle]);

  const login = useCallback(
    (fields) => runMutation("login", fields),
    [runMutation],
  );
  const register = useCallback(
    (fields) => runMutation("register", fields),
    [runMutation],
  );
  const logout = useCallback(() => runMutation("logout"), [runMutation]);

  const value = useMemo(
    () => ({
      ...authState,
      ...actionState,
      isAuthenticated: authState.status === "authenticated",
      login,
      register,
      logout,
      restoreSession,
      setPendingAction,
      clearProtectedAction,
      markBookingReady,
      consumeBookingReady,
      consumeNotifyAction,
      replaceUser,
      expireSession,
      expireProfileSession,
      isCurrentUser,
      getCurrentUser,
      registerBookingLogout,
      registerAuthLifecycle,
      getRequestAuth,
      getSessionIdentity,
    }),
    [authState, actionState, login, register, logout, restoreSession,
      setPendingAction, clearProtectedAction, markBookingReady, consumeBookingReady, consumeNotifyAction,
      replaceUser, expireSession, expireProfileSession, isCurrentUser, getCurrentUser, registerBookingLogout, registerAuthLifecycle, getRequestAuth, getSessionIdentity],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
