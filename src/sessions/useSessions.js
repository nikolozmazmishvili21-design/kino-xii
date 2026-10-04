import { useCallback, useEffect, useState } from "react";
import { getSessions } from "../api/sessionsApi.js";
import { writeSessionsQuery } from "./sessionsQuery.js";

export default function useSessions(query) {
  const requestKey = writeSessionsQuery(query).toString();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    Promise.resolve()
      .then(() => getSessions(requestKey, {
        signal: controller.signal,
      }))
      .then((response) => {
        if (!current) return;
        if (!Array.isArray(response?.data) || !response.meta
          || !Number.isInteger(response.meta.currentPage) || response.meta.currentPage < 1
          || !Number.isInteger(response.meta.lastPage) || response.meta.lastPage < 1) {
          throw new Error("The sessions response could not be read.");
        }
        setResult({ requestKey, attempt, status: "success", data: response.data, meta: response.meta });
      })
      .catch((error) => {
        if (!current || controller.signal.aborted || error?.name === "AbortError") return;
        setResult({ requestKey, attempt, status: "error", error });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [requestKey, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // Do not expose a preceding URL's result while the next effect starts.
  const state = result?.requestKey === requestKey && result.attempt === attempt
    ? result : { status: "loading" };

  return { data: null, meta: null, error: null, ...state, retry };
}
