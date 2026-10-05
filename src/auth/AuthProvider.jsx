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
    if (mutation.current || authState.status !== "authenticated"
      || currentUser.current?.profileComplete !== true
      || protectedActions.current.pendingAction !== action) return false;

    updateActions({ pendingAction: null, bookingReadyAction: action });
    return true;
  }, [authState.status, updateActions]);

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
    restoration.current = Promise.resolve(nextUser);
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
    restoration.current = Promise.resolve(null);
    currentUser.current = null;
    clearToken();
    setAuthState({ ...INITIAL_STATE, status: "guest" });
    updateActions({ pendingAction: descriptor, bookingReadyAction: null });
    return true;
  }, [updateActions]);

  const restoreSession = useCallback(() => {
    if (mutation.current) {
      // Boot waits for an active auth action instead of starting an older read.
      return mutation.current.promise.then(() => null, () => null);
    }

    if (restoration.current) {
      return restoration.current;
    }

    const requestRevision = revision.current;
    let retryable = false;

    const promise = Promise.resolve()
      .then(async () => {
        if (revision.current !== requestRevision) {
          return null;
        }

        const token = getToken();

        if (!token) {
          if (revision.current === requestRevision) {
            currentUser.current = null;
            setAuthState({ ...INITIAL_STATE, status: "guest" });
          }

          return null;
        }

        if (revision.current === requestRevision) {
          setAuthState({ ...INITIAL_STATE, status: "restoring" });
        }

        const response = await authApi.me({ token });

        if (revision.current !== requestRevision) {
          return null;
        }

        currentUser.current = response.data;
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
          clearToken();
          setAuthState({ ...INITIAL_STATE, status: "guest" });
        } else {
          // A transient failure does not prove that the saved token is stale.
          retryable = true;
          setAuthState((current) => ({ ...current, error }));
          throw error;
        }

        return null;
      })
      .finally(() => {
        if (retryable && restoration.current === promise) {
          restoration.current = null;
        }
      });

    restoration.current = promise;
    return promise;
  }, []);

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
      currentUser.current = null;
      clearProtectedAction();
    }
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
        restoration.current = Promise.resolve(user);
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
          restoration.current = Promise.resolve(null);
        }

        mutation.current = null;
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
  }, [clearProtectedAction]);

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
      replaceUser,
      expireSession,
    }),
    [authState, actionState, login, register, logout, restoreSession,
      setPendingAction, clearProtectedAction, markBookingReady, consumeBookingReady,
      replaceUser, expireSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
