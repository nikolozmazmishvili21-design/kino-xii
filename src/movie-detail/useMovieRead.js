import { useCallback, useEffect, useState } from "react";
import { getMovie, getMovieSessions } from "../api/moviesApi.js";

export default function useMovieRead(slug, date) {
  const isDetail = date === undefined;
  const enabled = isDetail || date !== null;
  const requestKey = JSON.stringify([slug, date]);
  const [request, setRequest] = useState({ key: requestKey, revision: 0 });
  if (request.key !== requestKey) {
    setRequest({ key: requestKey, revision: request.revision + 1 });
  }
  const revision = request.revision;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let current = true;
    Promise.resolve()
      .then(() => isDetail ? getMovie(slug, { signal: controller.signal })
        : getMovieSessions(slug, date, { signal: controller.signal }))
      .then((data) => {
        if (!current) return;
        if (isDetail ? !data || typeof data.title !== "string" || !Array.isArray(data.availableDates)
          : !Array.isArray(data)) throw new Error("The movie response could not be read.");
        setResult({ requestKey, revision, attempt, status: "success", data });
      })
      .catch((error) => {
        if (!current || controller.signal.aborted || error?.name === "AbortError") return;
        setResult({ requestKey, revision, attempt, status: "error", error });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [slug, date, isDetail, enabled, requestKey, revision, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // A revision also invalidates cached results when rapidly returning to the same date/slug.
  const state = !enabled ? { status: "idle" }
    : request.key === requestKey && result?.requestKey === requestKey
      && result.revision === revision && result.attempt === attempt ? result : { status: "loading" };
  return { data: null, error: null, ...state, retry };
}
