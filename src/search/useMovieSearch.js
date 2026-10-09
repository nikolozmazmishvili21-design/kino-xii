import { useCallback, useEffect, useRef, useState } from "react";
import { searchMovies } from "../api/moviesApi.js";

// Frontend timing choice: coalesce a short typing burst without delaying the
// prompt or clearing. OpenAPI requires debounce but specifies no duration.
export const SEARCH_DEBOUNCE_MS = 300;

const emptyRead = query => ({ query, status: query.trim() ? "debouncing" : "prompt", movies: [], error: null });

export default function useMovieSearch() {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState(() => emptyRead(""));
  const generation = useRef(0), controllerRef = useRef(null), timerRef = useRef(null);
  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);
  const changeQuery = useCallback(value => {
    cancel(); // Fence old success/error before React commits the new query.
    setQuery(value);
    setRead(emptyRead(value));
  }, [cancel]);
  const retry = useCallback(() => {
    cancel();
    setRead(emptyRead(query));
    setAttempt(value => value + 1);
  }, [cancel, query]);

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController(), request = ++generation.current;
    controllerRef.current = controller;
    const current = () => generation.current === request && !controller.signal.aborted;
    const timer = setTimeout(() => {
      if (timerRef.current === timer) timerRef.current = null;
      if (!current()) return;
      setRead({ query, status: "loading", movies: [], error: null });
      searchMovies(query, { signal: controller.signal }).then(movies => {
        if (current()) setRead({ query, status: movies.length ? "results" : "empty", movies, error: null });
      }).catch(error => {
        if (current() && error.name !== "AbortError") {
          setRead({ query, status: "error", movies: [], error: "Search could not be loaded. Please try again." });
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [query, attempt]);

  return { ...read, query, changeQuery, retry, cancel };
}
