export default function AgeBadge({ rating, hero = false }) {
  if (!rating?.code) return null;
  return (
    <span className={`movie-age${hero ? " movie-age--hero" : ""}`} title={rating.description}>
      <span className="visually-hidden">Age rating: </span>{rating.code}
    </span>
  );
}
