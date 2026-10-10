import { useEffect } from "react";
import { useAuth } from "../../src/auth/AuthContext.js";

// Installed only by the isolated test server. No credentials in observations.
export default function NotifyProbe() {
  const { login, logout, pendingAction } = useAuth();
  useEffect(() => {
    window.notifyProbe = { pendingAction, login: () => login({ email: "switch@example.test", password: "synthetic" }), logout };
    return () => { delete window.notifyProbe; };
  }, [login, logout, pendingAction]);
  return null;
}
