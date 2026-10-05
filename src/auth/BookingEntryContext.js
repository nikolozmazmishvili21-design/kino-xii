import { createContext, useContext } from "react";

export const BookingEntryContext = createContext(null);

export function useBookingEntry() {
  const context = useContext(BookingEntryContext);
  if (context === null) throw new Error("useBookingEntry must be used within AppShell.");
  return context;
}
