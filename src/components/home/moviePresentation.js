const releaseDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function movieMetadata(movie) {
  const genres = movie.genres?.map((genre) => genre.name).join(", ");
  const runtime = movie.runtimeMinutes != null
    ? `${movie.runtimeMinutes} min`
    : null;
  return [genres, runtime].filter(Boolean).join(" · ");
}

export function movieReleaseDate(releaseDate) {
  if (!releaseDate) return null;
  const date = new Date(`${releaseDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : releaseDateFormatter.format(date);
}
