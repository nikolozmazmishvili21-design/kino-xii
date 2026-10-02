import { createContext, useContext } from "react";

export const AppBootstrapContext = createContext(null);

export function useAppBootstrap() {
  const context = useContext(AppBootstrapContext);

  if (context === null) {
    throw new Error(
      "useAppBootstrap must be used within AppBootstrapProvider.",
    );
  }

  return context;
}