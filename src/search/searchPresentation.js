export function searchMovieMetadata(movie) {
  const kind = movie.kind === "film" ? "Film" : movie.kind === "event" ? "Live event" : null;
  const rating = typeof movie.ageRating?.code === "string" && movie.ageRating.code.trim() ? movie.ageRating.code : null;
  const runtime = Number.isInteger(movie.runtimeMinutes) && movie.runtimeMinutes >= 0 ? `${movie.runtimeMinutes} min` : null;
  return [kind, rating, runtime].filter(Boolean).join(" · ");
}

export function searchMoviePrice(movie) {
  if (movie.isComingSoon === true) return "Coming Soon";
  return typeof movie.fromPrice === "number" && Number.isFinite(movie.fromPrice) && movie.fromPrice >= 0
    ? `from ₾${movie.fromPrice}` : null;
}

export function searchTitleParts(title, query) {
  const term = query.trim(), index = term ? title.toLowerCase().indexOf(term.toLowerCase()) : -1;
  return index < 0 ? { before: title, match: "", after: "" }
    : { before: title.slice(0, index), match: title.slice(index, index + term.length), after: title.slice(index + term.length) };
}
