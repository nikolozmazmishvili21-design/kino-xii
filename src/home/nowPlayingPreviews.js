// A section-owned read cache. Fetching a preview never invokes the Detail visit writer.
export function createNowPlayingPreviews({ readMovie, onChange }) {
  const entries = new Map();
  let disposed = false;

  function load(slug, { retry = false } = {}) {
    if (disposed || !slug) return Promise.resolve();
    const previous = entries.get(slug);
    if (previous && !(retry && previous.state.status === "error")) return previous.promise;
    const controller = new AbortController();
    const entry = { controller, state: { status: "loading", ...(retry ? { retrying: true } : {}) } };
    entries.set(slug, entry);
    const publish = state => {
      if (disposed || entries.get(slug) !== entry) return;
      entry.state = state;
      onChange(slug, state);
    };
    publish(entry.state);
    entry.promise = Promise.resolve().then(async () => {
      if (disposed) return;
      try {
        const movie = await readMovie(slug, { signal: controller.signal });
        if (!movie || typeof movie !== "object" || Array.isArray(movie) || movie.slug !== slug) {
          throw new Error("Invalid movie preview response.");
        }
        publish({ status: "success", synopsis: typeof movie.synopsis === "string" ? movie.synopsis.trim() : "" });
      } catch {
        publish({ status: "error" });
      }
    });
    return entry.promise;
  }

  return {
    load,
    dispose() {
      disposed = true;
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
    },
  };
}
