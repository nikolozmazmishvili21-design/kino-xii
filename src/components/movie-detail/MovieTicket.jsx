import availabilityIcon from "../../assets/icons/movie-detail-availability.svg";

export default function MovieTicket({ session, movieTitle, venueName, selectedDate, underage, onActivate }) {
  const soldOut = session.isSoldOut === true;
  const disabled = soldOut || underage;
  const label = `${movieTitle}, ${selectedDate}, ${session.time}, ${venueName}, Hall ${session.hall.name}, `
    + `${session.language.name}, ${session.format.name}, ₾${session.price}, `
    + (soldOut ? "Sold out" : `${session.seatsLeft} seats left`)
    + (underage ? ". This account does not meet the film's age rating." : "");
  return (
    <div className="movie-ticket-slot" tabIndex={disabled ? 0 : undefined}
      role={disabled ? "group" : undefined} aria-label={disabled ? label : undefined}
      aria-describedby={underage ? "movie-age-restriction" : undefined}
      onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}>
      <button type="button" className="movie-ticket" disabled={disabled} aria-label={label}
        aria-describedby={underage ? "movie-age-restriction" : undefined}
        onClick={onActivate ? () => onActivate(session.id) : undefined}>
        <span className="movie-ticket__left">
          <span className="movie-ticket__time">{session.time}</span>
          <span className="movie-ticket__language" title={session.language.name}>{session.language.name}</span>
        </span>
        <span className="movie-ticket__right">
          <span className="movie-ticket__price">₾ {session.price}</span>
          <span className="movie-ticket__format" title={session.format.name}>{session.format.name}</span>
          <span className="movie-ticket__availability">
            {soldOut ? "Sold out" : <><img src={availabilityIcon} width="12" height="12" alt="" />{session.seatsLeft} left</>}
          </span>
        </span>
      </button>
    </div>
  );
}
