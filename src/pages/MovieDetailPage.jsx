import { useParams } from "react-router-dom";

export default function MovieDetailPage() {
  const { slug } = useParams();

  return (
    <main>
      <h1>Movie Detail</h1>
      <p>{slug}</p>
    </main>
  );
}
