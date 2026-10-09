import { useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.js";
import { ROUTES } from "../../routing/routes.js";
import ProfileDropdown from "./ProfileDropdown.jsx";
import NavbarSearchShell from "./NavbarSearchShell.jsx";

export default function Navbar({ onOpenAuth }) {
  const { isAuthenticated, user } = useAuth();
  const logoRef = useRef(null);
  const location = useLocation();

  return (
    <header className="navbar">
      <nav className="navbar__content" aria-label="Main navigation">
        <div className="navbar__links">
          <Link ref={logoRef} className="navbar__logo" to={ROUTES.home} aria-label="Kino XII home">
            <span>KINO</span><span className="navbar__logo-accent">XII</span>
          </Link>
          <Link className="navbar__sessions" to={ROUTES.sessions}>Sessions</Link>
        </div>
        <div className="navbar__right">
          <NavbarSearchShell key={location.key} />
          {isAuthenticated && user ? (
            <ProfileDropdown user={user} logoutFocusRef={logoRef} />
          ) : (
            <div className="navbar__actions">
              <button className="button button--primary" type="button" onClick={(event) => onOpenAuth("signup", event.currentTarget)}>
                Sign up
              </button>
              <button className="button button--secondary" type="button" onClick={(event) => onOpenAuth("login", event.currentTarget)}>
                Log in
              </button>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
