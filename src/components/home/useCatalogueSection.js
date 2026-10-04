import { useCallback, useEffect, useState } from "react";

export default function useCatalogueSection(loadMovies) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    Promise.resolve()
      .then(() => loadMovies({ signal: controller.signal }))
      .then((movies) => {
        if (!current) return;
        if (!Array.isArray(movies)) {
          throw new Error("The movie catalogue response could not be read.");
        }
        setResult({ attempt, status: "success", movies });
      })
      .catch((error) => {
        if (!current || controller.signal.aborted) return;
        setResult({ attempt, status: "error", error });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [loadMovies, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // A retry immediately hides the preceding request's result.
  const state = result?.attempt === attempt
    ? result
    : { status: "loading" };

  return { ...state, retry };
}
