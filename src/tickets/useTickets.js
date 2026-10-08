import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useProfileAccess } from "../auth/ProfileAccessContext.js";
import { getTickets } from "../api/ticketsApi.js";
import { groupTicketOrders } from "./ticketGroups.js";

export default function useTickets(consumeRecovery) {
  const { status, mutation, user: observedUser, isCurrentUser } = useAuth();
  const { reauthenticateProfile } = useProfileAccess();
  const user = status === "authenticated" && !mutation ? observedUser : null;
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState({ owner: null, attempt: -1, status: "idle", data: [], error: null });
  const recovery = useRef(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!user) return;
    const intent = consumeRecovery();
    if (intent) recovery.current = intent;
    if (recovery.current?.accountId !== user.id) recovery.current = null;
    const controller = new AbortController();
    let active = true;
    const current = () => active && !controller.signal.aborted && isCurrentUser(user);
    getTickets({ signal: controller.signal }).then((data) => {
      if (!current()) return;
      const groups = groupTicketOrders(data);
      setRead({ owner: user, attempt, status: data.length ? "success" : "empty", data, groups, error: null, identity: recovery.current?.identity ?? null });
    }).catch((error) => {
      if (!current() || error.name === "AbortError") return;
      if (error.status === 401) {
        reauthenticateProfile(user);
        return;
      }
      setRead({ owner: user, attempt, status: "error", data: [], error: error.message || "Unable to load your tickets. Try again." });
    });
    return () => { active = false; controller.abort(); };
  }, [user, attempt, isCurrentUser, reauthenticateProfile, consumeRecovery]);
  // Mask synchronously, before effects abort the previous account/retry. No
  // previous-account Orders are ever exposed during auth or User replacement.
  if (!user) return { status: "unauthenticated", data: [], error: null, retry };
  if (read.owner !== user || read.attempt !== attempt) return { status: "loading", data: [], error: null, retry };
  return { status: read.status, data: read.data, groups: read.groups, error: read.error, identity: read.identity, retry };
}
