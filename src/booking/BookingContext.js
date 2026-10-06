import { createContext, useContext } from "react";

export const BookingContext = createContext(null);
export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) throw new Error("useBooking must be used within BookingProvider.");
  return context;
}
