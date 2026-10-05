import { formatMovieDate } from "../../movie-detail/movieDetailPresentation.js";

export default function MovieDetails({ movie }) {
  const fields = [
    ["DIRECTOR", movie.director || "Not available"],
    ["MAIN CAST", movie.cast || "Not available"],
    ["DURATION", `${movie.runtimeMinutes} minutes`],
    ["RELEASE DATE", formatMovieDate(movie.releaseDate)],
    ["FORMATS", movie.formats?.map((format) => format.name).join(", ") || "Not available"],
    ["FROM", `₾${movie.fromPrice}`],
    ["GENRES", movie.genres?.map((genre) => genre.name).join(", ") || "Not available"],
  ];
  return (
    <aside className="movie-details" aria-labelledby="movie-details-heading">
      <h2 id="movie-details-heading">Details</h2>
      <dl>{fields.map(([label, value]) => (
        <div className="movie-details__field" key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}</dl>
      {movie.ageRating && <div className="movie-details__rating">
        <h3>RATING NOTE</h3>
        <div><span>{movie.ageRating.code}</span><p>{movie.ageRating.description}</p></div>
      </div>}
    </aside>
  );
}
