import { groupSessionsByHall } from "../../movie-detail/movieDetailPresentation.js";
import MovieTicket from "./MovieTicket.jsx";

export default function MovieVenues({ groups, movie, selectedDate, underage, onActivate }) {
  return groups.filter((group) => group.sessions.length > 0).map((group) => (
    <section className="movie-venue" key={group.venue.id} aria-label={group.venue.name}>
      <h3>{group.venue.name}</h3>
      <div className="movie-venue__halls">
        {groupSessionsByHall(group.sessions).map(({ hall, sessions }) => (
          <section className="movie-hall" key={hall.id} aria-label={`Hall ${hall.name}`}>
            <h4>Hall {hall.name}</h4>
            <div className="movie-hall__tickets">{sessions.map((session) => (
              <MovieTicket key={session.id} session={session} movieTitle={movie.title}
                venueName={group.venue.name} selectedDate={selectedDate} underage={underage} onActivate={onActivate} />
            ))}</div>
          </section>
        ))}
      </div>
    </section>
  ));
}
