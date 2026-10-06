import { createContext, useContext } from "react";

export const ProfileAccessContext = createContext(null);

export function useProfileAccess() {
  const context = useContext(ProfileAccessContext);
  if (!context) throw new Error("useProfileAccess must be used within AppShell.");
  return context;
}
