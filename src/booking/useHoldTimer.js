import { useEffect, useState } from "react";
import { observeHoldClock, remainingHoldMs } from "./holdLifecycle.js";

export default function useHoldTimer(hold, onExpire) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!hold) return;
    return observeHoldClock(hold, setNow, onExpire);
  }, [hold, onExpire]);
  return hold ? remainingHoldMs(hold.expiresAt, now) : null;
}
