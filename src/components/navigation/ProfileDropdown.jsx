import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.js";
import { ROUTES, profileTicketsPath } from "../../routing/routes.js";
import Avatar from "../Avatar.jsx";
import chevronDown from "../../assets/icons/chevron-down.svg";
import chevronUp from "../../assets/icons/chevron-up.svg";
import userIcon from "../../assets/icons/user.svg";
import ticketsIcon from "../../assets/icons/tickets.svg";
import logoutIcon from "../../assets/icons/logout.svg";
import completeIcon from "../../assets/icons/profile-complete.svg";

export default function ProfileDropdown({ user, logoutFocusRef }) {
  const { logout, mutation } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const toggleRef = useRef(null);
  const profileLinkRef = useRef(null);
  const logoutPending = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    profileLinkRef.current?.focus();

    function handleOutsidePointer(event) {
      if (!containerRef.current?.contains(event.target)) {
        // Restore from the removed panel; the clicked target can then take focus.
        if (containerRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  function closeAndRestore() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  async function handleLogout() {
    if (logoutPending.current || mutation) return;
    logoutPending.current = true;
    closeAndRestore();
    try {
      await logout();
    } finally {
      logoutPending.current = false;
      // The authenticated toggle disappears on logout; the logo remains mounted.
      logoutFocusRef.current?.focus();
    }
  }

  return (
    <div
      className="profile-dropdown"
      ref={containerRef}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          closeAndRestore();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="profile-dropdown__toggle"
        aria-label={`Account for ${user.username}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={Boolean(mutation)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-dropdown__control-identity">
          <Avatar user={user} />
          <span className="profile-dropdown__username">{user.username}</span>
        </span>
        <img src={open ? chevronUp : chevronDown} alt="" />
      </button>
      {open && (
        <div id={panelId} className="profile-dropdown__panel">
          <div className="profile-dropdown__summary">
            <div className="profile-dropdown__identity">
              <Avatar user={user} size="large" />
              <div className="profile-dropdown__identity-copy">
                <p className="profile-dropdown__name">{user.fullName || user.username}</p>
                <p className="profile-dropdown__email">{user.email}</p>
              </div>
            </div>
            {typeof user.profileComplete === "boolean" && (
              <div className={`profile-dropdown__status profile-dropdown__status--${user.profileComplete ? "complete" : "incomplete"}`}>
                <p className="profile-dropdown__status-title">
                  {user.profileComplete ? "Profile Complete" : "Profile incomplete"}
                  {user.profileComplete && <img src={completeIcon} alt="" />}
                </p>
                {!user.profileComplete && <p className="profile-dropdown__status-description">Please complete your profile to enable booking</p>}
              </div>
            )}
          </div>
          <nav className="profile-dropdown__links" aria-label="Account navigation">
            <Link ref={profileLinkRef} to={ROUTES.profile} className="profile-dropdown__item" onClick={closeAndRestore}>
              <img src={userIcon} alt="" />My Profile
            </Link>
            <Link to={profileTicketsPath()} className="profile-dropdown__item" onClick={closeAndRestore}>
              <img src={ticketsIcon} alt="" />My Tickets
            </Link>
          </nav>
          <div className="profile-dropdown__divider" />
          <button type="button" className="profile-dropdown__item profile-dropdown__logout" onClick={handleLogout} disabled={Boolean(mutation)}>
            <img src={logoutIcon} alt="" />Log out
          </button>
        </div>
      )}
    </div>
  );
}
