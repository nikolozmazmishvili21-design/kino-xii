import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useProfileAccess } from "../auth/ProfileAccessContext.js";
import { getTickets } from "../api/ticketsApi.js";
import { groupTicketOrders } from "./ticketGroups.js";
import { useRefund } from "./RefundContext.js";
import { matchesRefundIdentity, readableRefundOrder } from "./refundLifecycle.js";

const NO_REFUND = Object.freeze({ generation: 0, records: [] });
const noSubscribe = () => () => {};
const noSnapshot = () => NO_REFUND;

export default function useTickets(consumeRecovery) {
  const { status, mutation, user: observedUser, isCurrentUser, getSessionIdentity } = useAuth();
  const { reauthenticateProfile } = useProfileAccess();
  const refund = useRefund();
  const barrier = useSyncExternalStore(refund?.subscribe ?? noSubscribe, refund?.snapshot ?? noSnapshot, noSnapshot);
  const user = status === "authenticated" && !mutation ? observedUser : null;
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState({ owner: null, attempt: -1, status: "idle", data: [], error: null });
  const recovery = useRef(null), sequence = useRef(0), controllerRef = useRef(null), withheldAuthRead = useRef(null);
  const retry = useCallback(() => {
    if (refund?.hasContinuation()) { void refund.retryVerification(); return; }
    const details = refund?.snapshot().records.find(record => record.reportedRefunded && record.displayStatus !== "ready");
    if (details) { void refund.checkStatus(details.identity.reference); return; }
    setAttempt((value) => value + 1);
  }, [refund]);
  const generation = barrier.generation;
  const coordinatedPhase = refund?.hasContinuation()
    ? barrier.records.find(record => record.continuation || record.recoveryPurpose)?.phase ?? "waiting" : null;
  const authGeneration = user ? getSessionIdentity?.()?.generation ?? null : null;

  useEffect(() => {
    if (!refund || !user) return;
    return refund.subscribeOutcome((event) => {
      if (!isCurrentUser(user) || !refund.isReadCurrent(event.guard)
        || event.guard.authGeneration !== authGeneration) return;
      if (event.orders) {
        const groups = groupTicketOrders(event.orders);
        sequence.current++;
        controllerRef.current?.abort();
        setRead(previous => {
          if (!isCurrentUser(user) || !refund.isReadCurrent(event.guard)) return previous;
          return { owner: user, attempt, authGeneration, generation: event.guard.generation,
            status: event.orders.length ? "success" : "empty", data: event.orders, groups,
            error: null, identity: recovery.current?.identity ?? null, adopted: true };
        });
        return;
      }
      if (!readableRefundOrder(event.order, event.identity)) return;
      sequence.current++;
      controllerRef.current?.abort();
      setRead((previous) => {
        if (!isCurrentUser(user) || !refund.isReadCurrent(event.guard)
          || previous.owner !== user || previous.authGeneration !== authGeneration
          || previous.attempt !== attempt) return previous;
        const matches = previous.data.filter((order) => order.reference === event.identity.reference);
        if (matches.length !== 1 || !matchesRefundIdentity(matches[0], event.identity)) return previous;
        const data = previous.data.map((order) => order === matches[0] ? event.order : order);
        return { ...previous, data, groups: groupTicketOrders(data), status: "success", error: null,
          generation: event.guard.generation, adopted: true };
      });
    });
  }, [refund, user, attempt, authGeneration, isCurrentUser]);

  useEffect(() => {
    if (!user) return;
    const intent = consumeRecovery();
    if (intent) recovery.current = intent;
    if (recovery.current?.accountId !== user.id) recovery.current = null;
    const guard = refund?.readGuard();
    const needsAuthCoordination = refund?.hasContinuation() || barrier.records.some((record) =>
      record.reason === "unauthenticated" && record.authGeneration === authGeneration
      && record.settledGeneration === generation);
    // Continuation verification owns its fresh GET. Ordinary readers cannot
    // compete with it or route a second 401 through Profile's generic gate.
    if (needsAuthCoordination && (refund?.hasContinuation() || withheldAuthRead.current !== generation)) {
      withheldAuthRead.current = generation;
      setRead({ owner: user, attempt, authGeneration, generation, status: refund?.isVerifying() ? "loading" : "error", data: [],
        error: "Unable to load your tickets. Try again.", adopted: false });
      return;
    }
    // A complete returned Order already replaced this account's matching card.
    // Every remount/new auth/retry still obtains fresh unfiltered server facts.
    if (read.adopted && read.owner === user && read.attempt === attempt
      && read.authGeneration === authGeneration && read.generation === generation) return;
    const details = barrier.records.find(record => record.reportedRefunded && record.displayStatus !== "ready");
    if (details) {
      if (details.displayStatus === "refreshing") void refund.checkStatus(details.identity.reference);
      return;
    }
    refund?.invalidateEligibility(); // A new ordinary read supersedes renewed consent authority.
    const controller = new AbortController(), requestId = ++sequence.current;
    controllerRef.current = controller;
    let active = true;
    const current = () => active && !controller.signal.aborted && requestId === sequence.current
      && isCurrentUser(user) && (!refund || refund.isReadCurrent(guard));
    getTickets({ signal: controller.signal }).then((data) => {
      if (!current()) return;
      const groups = groupTicketOrders(data);
      // A contradictory fresh paid list cannot undo a reported refund, nor can
      // a partial/missing card be completed by merging guesses from old data.
      for (const record of refund?.snapshot().records ?? []) {
        if (!record.reportedRefunded) continue;
        const matches = data.filter((order) => order.reference === record.identity.reference);
        if (matches.length !== 1 || matches[0].status !== "refunded"
          || !readableRefundOrder(matches[0], record.identity)) {
          throw new Error("Refund details could not be restored. Retry tickets.");
        }
      }
      if (refund && !refund.observeTickets(data, guard)) throw new Error("Refund details could not be restored. Retry tickets.");
      if (!current()) return;
      setRead({ owner: user, attempt, authGeneration, generation, status: data.length ? "success" : "empty",
        data, groups, error: null, identity: recovery.current?.identity ?? null, adopted: false });
    }).catch((error) => {
      if (!current() || error.name === "AbortError") return;
      if (error.status === 401) {
        if (!reauthenticateProfile(user)) {
          setRead({ owner: user, attempt, authGeneration, generation, status: "error", data: [],
            error: "Please sign in again to load your tickets.", adopted: false });
        }
        return;
      }
      setRead({ owner: user, attempt, authGeneration, generation, status: "error", data: [],
        error: error.message || "Unable to load your tickets. Try again.", adopted: false });
    });
    return () => {
      active = false;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // Read state is an output, not a fetch dependency. Generation changes and
    // explicit Retry each own one replacement request, never completion loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, attempt, authGeneration, generation, coordinatedPhase, refund, isCurrentUser, reauthenticateProfile, consumeRecovery]);

  // Mask before cleanup effects: account, session, Retry and mutation generations
  // are all required, including reads that began during a pending mutation.
  if (!user) return { status: "unauthenticated", data: [], error: null, retry };
  if (!refund?.hasReadRecovery() && barrier.records.some(record => record.reportedRefunded && record.displayStatus === "error")) {
    return { status: "error", data: [], error: "Refund details could not be restored. Retry tickets.", retry };
  }
  if (read.owner !== user || read.attempt !== attempt || read.authGeneration !== authGeneration
    || read.generation !== generation) return { status: "loading", data: [], error: null, retry };
  return { status: read.status, data: read.data, groups: read.groups, error: read.error, identity: read.identity, retry };
}
