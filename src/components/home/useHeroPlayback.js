import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createHeroPlayback, HERO_FADE_MS } from "../../home/heroPlayback.js";

export default function useHeroPlayback(movies, elementRef) {
  const controller = useRef(null);
  const [slide, setSlide] = useState({ index: 0, previous: null, generation: 0,
    phase: "holding", duration: HERO_FADE_MS, playing: false });

  useLayoutEffect(() => {
    const element = elementRef.current;
    const playback = createHeroPlayback({ count: movies.length,
      ready: movies.flatMap((movie, index) => movie.backdropUrl ? [] : [index]),
      onChange: setSlide,
      onProgress: progress => element.style.setProperty("--hero-progress", String(progress)),
    });
    controller.current = playback;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => playback.reduceMotion(motion.matches);
    const syncVisibility = () => playback.pause("hidden", document.hidden);
    const observer = new IntersectionObserver(([entry]) => playback.pause("offscreen", !entry.isIntersecting));
    observer.observe(element);
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    syncMotion(); syncVisibility(); playback.start();
    return () => {
      observer.disconnect(); motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      playback.destroy(); controller.current = null;
    };
  }, [movies, elementRef]);

  const move = useCallback(direction => controller.current?.move(direction), []);
  const pause = useCallback((reason, paused) => controller.current?.pause(reason, paused), []);
  const imageReady = useCallback((index, event) => {
    if (!event.target.closest(".movie-image--backdrop")) return;
    const owner = controller.current;
    // Keep the preceding frame visible until the incoming API backdrop is decoded (or fails).
    const decoded = event.type === "load" ? event.target.decode() : Promise.resolve();
    decoded.catch(() => {}).then(() => owner?.ready(index));
  }, []);
  return { ...slide, move, pause, imageReady };
}
