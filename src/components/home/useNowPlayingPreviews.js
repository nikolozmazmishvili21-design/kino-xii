import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getMovie } from "../../api/moviesApi.js";
import { createNowPlayingPreviews } from "../../home/nowPlayingPreviews.js";

export default function useNowPlayingPreviews() {
  const cache = useRef(null);
  const [previews, setPreviews] = useState({});
  useLayoutEffect(() => {
    const owned = createNowPlayingPreviews({
      readMovie: getMovie,
      onChange: (slug, state) => setPreviews(previous => ({ ...previous, [slug]: state })),
    });
    cache.current = owned;
    return () => { owned.dispose(); cache.current = null; };
  }, []);
  const load = useCallback((slug, options) => cache.current?.load(slug, options), []);
  return { previews, load };
}
