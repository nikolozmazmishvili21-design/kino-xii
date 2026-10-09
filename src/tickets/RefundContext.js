import { createContext, useContext } from "react";

// Only the runtime interface; Orders remain local to the Tickets reader.
export const RefundContext = createContext(null);
export const useRefund = () => useContext(RefundContext);
