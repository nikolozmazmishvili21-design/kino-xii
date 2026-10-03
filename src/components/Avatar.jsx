import incompleteDot from "../assets/icons/profile-incomplete-dot.svg";
import completeDot from "../assets/icons/profile-complete-dot.svg";

export default function Avatar({ user, size = "default" }) {
  const name = user.fullName || user.username;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {user.avatar ? <img className="avatar__image" src={user.avatar} alt="" /> : initials}
      {typeof user.profileComplete === "boolean" && (
        <img className="avatar__status" src={user.profileComplete ? completeDot : incompleteDot} alt="" />
      )}
    </span>
  );
}
