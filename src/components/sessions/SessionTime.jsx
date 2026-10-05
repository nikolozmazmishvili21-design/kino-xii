import availabilityIcon from "../../assets/icons/sessions-availability.svg";

export default function SessionTime({ session, movieTitle, onActivate }) {
  const label = `${movieTitle}, ${session.time}, ${session.venue.name}, Hall ${session.hall.name}, `
    + `${session.format.name}, ${session.language.name}, from ₾${session.price}, `
    + (session.isSoldOut ? "Sold out" : `${session.seatsLeft} seats left`);
  return (
    // A focusable wrapper exposes disabled showtimes in the horizontal row to keyboard users.
    <div className="session-time-slot" tabIndex={session.isSoldOut ? 0 : undefined}
      role={session.isSoldOut ? "group" : undefined}
      aria-label={session.isSoldOut ? label : undefined}
      onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}>
      <button type="button" className="session-time" disabled={session.isSoldOut}
        aria-label={label} onClick={onActivate ? () => onActivate(session.id) : undefined}>
        <span className="session-time__header">
          <span className="session-time__time">{session.time}</span>
          <span className="session-time__format">{session.format.name}</span>
        </span>
        <span className="session-time__details">
          <span className="session-time__location">
            <span className="session-time__language" title={session.language.name}>{session.language.name}</span>
            <span className="session-time__venue" title={`${session.venue.name} · Hall ${session.hall.name}`}>
              {session.venue.name} · Hall {session.hall.name}
            </span>
          </span>
          <span className="session-time__availability">
            <span className={`session-time__seats${session.isSoldOut ? " session-time__seats--sold" : ""}`}>
              {session.isSoldOut ? "Sold out" : <><img src={availabilityIcon} alt="" />{session.seatsLeft} left</>}
            </span>
            <span className="session-time__price">from ₾{session.price}</span>
          </span>
        </span>
      </button>
    </div>
  );
}
