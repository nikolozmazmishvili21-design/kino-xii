import { useCallback, useRef, useState } from "react";
import { Outlet, useMatch } from "react-router-dom";
import { ROUTES } from "../routing/routes.js";
import Navbar from "../components/navigation/Navbar.jsx";
import AuthModal from "../auth/AuthModal.jsx";

export default function AppShell() {
  const isHome = useMatch(ROUTES.home);
  const isMovieDetail = useMatch(ROUTES.movieDetail);
  const [authMode, setAuthMode] = useState("closed");
  const openerRef = useRef(null);
  const closeAuth = useCallback(() => setAuthMode("closed"), []);

  function openAuth(mode, opener) {
    openerRef.current = opener;
    setAuthMode(mode);
  }

  return (
    <div className={`app-shell${isHome ? " app-shell--home" : ""}${isMovieDetail ? " app-shell--movie-detail" : ""}`}>
      <Navbar onOpenAuth={openAuth} />
      <Outlet />
      {authMode !== "closed" && (
        <AuthModal
          mode={authMode}
          onSwitchMode={setAuthMode}
          onClose={closeAuth}
          openerRef={openerRef}
        />
      )}
    </div>
  );
}
