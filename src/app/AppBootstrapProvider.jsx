import { useCallback, useEffect, useMemo, useState } from "react";
import { bootstrapApp } from "./bootstrap.js";
import { AppBootstrapContext } from "./AppBootstrapContext.js";

const INITIAL_STATE = {
  status: "loading",
  filterOptions: null,
  error: null,
};

export default function AppBootstrapProvider({ children }) {
  const [bootstrapState, setBootstrapState] = useState(INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;

    bootstrapApp()
      .then(({ filterOptions }) => {
        if (ignore) {
          return;
        }

        setBootstrapState({
          status: "ready",
          filterOptions,
          error: null,
        });
      })
      .catch((error) => {
        if (ignore) {
          return;
        }

        setBootstrapState({
          status: "error",
          filterOptions: null,
          error,
        });
      });

    return () => {
      ignore = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setBootstrapState(INITIAL_STATE);
    setAttempt((currentAttempt) => currentAttempt + 1);
  }, []);

  const value = useMemo(
    () => ({
      ...bootstrapState,
      retry,
    }),
    [bootstrapState, retry],
  );

  let content = children;

  if (bootstrapState.status === "loading") {
    content = (
      <main>
        <p role="status">Loading application...</p>
      </main>
    );
  }

  if (bootstrapState.status === "error") {
    content = (
      <main>
        <p role="alert">
          {bootstrapState.error?.message ?? "Failed to load application data."}
        </p>

        <button type="button" onClick={retry}>
          Retry
        </button>
      </main>
    );
  }

  return (
    <AppBootstrapContext.Provider value={value}>
      {content}
    </AppBootstrapContext.Provider>
  );
}