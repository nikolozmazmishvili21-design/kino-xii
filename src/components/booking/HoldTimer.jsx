import useHoldTimer from "../../booking/useHoldTimer.js";
import { formatHoldTime } from "../../booking/holdLifecycle.js";

export default function HoldTimer({ hold, onExpire }) {
  const remaining = useHoldTimer(hold, onExpire);
  return <div className="hold-timer"><span>SEATS HELD</span><strong role="timer" aria-label="Seat hold time remaining" aria-live="off">{formatHoldTime(remaining)}</strong></div>;
}
