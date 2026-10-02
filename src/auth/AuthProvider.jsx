import { useCallback, useMemo, useRef, useState } from "react";
import * as authApi from "../api/authApi.js";
import { AuthContext } from "./AuthContext.js";
import { clearToken, getToken, setToken } from "./tokenStorage.js";

const INITIAL_STATE = {
  status: "restoring",
  user: null,
  mutation: null,
  error: null,
};

export default function AuthProvider({ children }) {
  const [authState, setAuthState] = useState(INITIAL_STATE);
  const restoration = useRef(null);
  const mutation = useRef(null);
  const revision = useRef(0);

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
  }, []);

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
      isAuthenticated: authState.status === "authenticated",
      login,
      register,
      logout,
      restoreSession,
    }),
    [authState, login, register, logout, restoreSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
