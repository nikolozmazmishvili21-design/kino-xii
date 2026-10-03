import { useCallback, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/navigation/Navbar.jsx";
import AuthModal from "../auth/AuthModal.jsx";

export default function AppShell() {
  const [authMode, setAuthMode] = useState("closed");
  const openerRef = useRef(null);
  const closeAuth = useCallback(() => setAuthMode("closed"), []);

  function openAuth(mode, opener) {
    openerRef.current = opener;
    setAuthMode(mode);
  }

  return (
    <>
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
    </>
  );
}
