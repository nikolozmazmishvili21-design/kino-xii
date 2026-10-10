import { useEffect } from "react";
import { useAuth } from "../../src/auth/AuthContext.js";

// Added only by the isolated browser fixture; no credentials in observations.
export default function RecentlyViewedProbe() {
  const { login, logout, restoreSession } = useAuth();
  useEffect(() => {
    window.recentProbe = { login: () => login({ email: "recent@example.test", password: "synthetic" }), logout, restoreSession };
    return () => { delete window.recentProbe; };
  }, [login, logout, restoreSession]);
  return null;
}
