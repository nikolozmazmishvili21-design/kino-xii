import { useState } from "react";

export default function MovieImage({ src, title, backdrop = false }) {
  const [failedSource, setFailedSource] = useState(null);
  const unavailable = !src || failedSource === src;

  return (
    <div className={`movie-image${backdrop ? " movie-image--backdrop" : ""}`}>
      {unavailable ? (
        <span className={backdrop ? "visually-hidden" : "movie-image__fallback"}>
          {backdrop ? "Backdrop" : "Poster"} unavailable for {title}
        </span>
      ) : (
        <img
          src={src}
          alt={backdrop ? "" : `${title} poster`}
          loading={backdrop ? "eager" : "lazy"}
          onError={() => setFailedSource(src)}
        />
      )}
    </div>
  );
}
