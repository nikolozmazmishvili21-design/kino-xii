// Banner prototype reactions: 3 s AFTER_TIMEOUT, 300 ms EASE_OUT dissolve.
export const HERO_DWELL_MS = 3000;
export const HERO_FADE_MS = 300;
export const HERO_LAST_PREVIOUS_MS = 700;

// One clock owns both slide changes and progress. Rendering and API reads stay outside it.
export function createHeroPlayback({ count, ready = [], onChange, onProgress,
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, now = () => performance.now() }) {
  let index = 0, previous = null, generation = 0, duration = HERO_FADE_MS;
  let phase = "holding", elapsed = 0, lastTime = null, frame = null, pending = null;
  let reduced = false, destroyed = false;
  const loaded = new Set(ready), pauses = new Set();
  const autoplay = () => count > 1 && !reduced && pauses.size === 0;
  const visible = () => !pauses.has("hidden") && !pauses.has("offscreen");
  const snapshot = () => ({ index, previous, generation, phase, duration, playing: autoplay() });
  const emit = () => { onChange(snapshot()); onProgress(phase === "holding" ? elapsed / HERO_DWELL_MS : 0); };
  const cancel = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null; lastTime = null;
  };
  const needsFrame = () => !destroyed && !pending && visible()
    && (phase === "fading" || (autoplay() && loaded.has(index)));
  const schedule = () => {
    if (frame === null && needsFrame()) { lastTime ??= now(); frame = requestFrame(tick); }
  };
  function start(next, fadeDuration) {
    pending = null; previous = index; index = next; generation++;
    elapsed = 0; lastTime = null; duration = reduced ? 0 : fadeDuration;
    phase = duration ? "fading" : "holding";
    if (!duration) previous = null;
    emit(); schedule();
  }
  function advance(direction, automatic = false) {
    if (destroyed || count < 2 || phase === "fading" || (pending && automatic)) return;
    const next = (index + direction + count) % count;
    // The last Banner variant's Previous reaction explicitly uses 700 ms.
    const fadeDuration = direction < 0 && index === count - 1 ? HERO_LAST_PREVIOUS_MS : HERO_FADE_MS;
    // Explicit intent replaces the pending target; late readiness only caches the old image.
    // The fade guard above still prevents overlapping transitions.
    cancel();
    if (!loaded.has(next)) {
      pending = { next, duration: fadeDuration, automatic }; elapsed = HERO_DWELL_MS; emit();
    } else start(next, fadeDuration);
  }
  function tick(time) {
    frame = null;
    if (!needsFrame()) { lastTime = null; return; }
    if (lastTime !== null) elapsed += Math.max(0, time - lastTime);
    lastTime = time;
    if (phase === "fading" && elapsed >= duration) {
      phase = "holding"; previous = null; elapsed = 0; emit();
    } else if (phase === "holding" && elapsed >= HERO_DWELL_MS) {
      advance(1, true); return;
    } else if (phase === "holding") onProgress(elapsed / HERO_DWELL_MS);
    schedule();
  }
  return {
    start() { if (!destroyed) { emit(); schedule(); } },
    move: direction => advance(direction),
    ready(position) {
      if (destroyed) return;
      loaded.add(position);
      if (pending?.next === position && (!pending.automatic || autoplay())) start(position, pending.duration);
      else schedule();
    },
    pause(reason, paused) {
      if (destroyed || pauses.has(reason) === paused) return;
      if (paused) pauses.add(reason); else pauses.delete(reason);
      cancel();
      if (pending && loaded.has(pending.next) && (!pending.automatic || autoplay())) start(pending.next, pending.duration);
      else { emit(); schedule(); }
    },
    reduceMotion(value) {
      if (destroyed || reduced === value) return;
      reduced = value;
      cancel();
      if (reduced && pending?.automatic) { pending = null; elapsed = 0; }
      if (reduced && phase === "fading") { phase = "holding"; previous = null; elapsed = 0; }
      emit(); schedule();
    },
    destroy() { destroyed = true; pending = null; cancel(); },
  };
}
