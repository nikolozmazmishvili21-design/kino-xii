import { classifyOrderResponse, classifyOrderError, orderRecoveryIdentity } from "./orderLifecycle.js";
import { mapCheckout422Errors } from "../validation/checkoutValidation.js";
import { HOLD_COPY, usableHold, holdMatchesMap, eligibleAssignment, remainingHoldMs, sameAssignments } from "./holdLifecycle.js";
import { selectionConfiguration } from "./seatSelection.js";

const UNCERTAIN = "We couldn't confirm whether your order was completed.";
const result = (kind, extra = {}) => ({ kind, clearPayment: true, ...extra });
const referenceOf = (request) => ({ holdId: request.holdId, sessionId: request.sessionId });

// Separate from the HOLD operation: no callback, payload, buyer draft or Promise
// is retained in request records. Only the settlement stack awaits the result.
export function createOrderOperations(runtime) {
  const { deps, state, patch, emit } = runtime;
  const pending = new Map(), protectedHolds = new Map();
  const listeners = new Set();
  let info = { notice: null, reauth: null, recovery: null, ticketsIntent: null };
  let hiddenInfo = info;
  let noticeId = 0, noticeToken = null, noticeEpoch = 0, authEpoch = 0;
  let seenAccount = deps.getUser?.()?.id ?? null, seenToken = deps.getToken();
  let reauthBudget = null;
  const update = (changes) => {
    info = { ...info, ...changes };
    hiddenInfo = { ...info, notice: null, recovery: null, ticketsIntent: null };
    for (const listener of listeners) listener();
  };
  const userNow = () => deps.getUser?.() ?? runtime.scope.active()?.expectedUser;
  const authenticated = (accountId, token, epoch = authEpoch) => {
    const user = userNow();
    return Boolean(user && user.id === accountId && deps.isCurrentUser(user)
      && token === deps.getToken() && epoch === authEpoch);
  };
  const activeRequest = (request) => Boolean(!request.detached
    && authenticated(request.accountId, request.token, request.authEpoch)
    && runtime.scope.active()?.instanceId === request.instanceId && state().sessionId === request.sessionId
    && state().selectionRevision === request.revision && state().order.phase === "submitting"
    && state().hold.data?.holdId === request.holdId);
  const transition = (request, type, extra = {}) => emit({ type, instanceId: request.instanceId, sessionId: request.sessionId, ...extra });
  const clearReference = (request) => {
    const reference = deps.storage.read();
    if (reference?.holdId === request.holdId && reference.sessionId === request.sessionId) deps.storage.clear();
  };
  const keyOf = (accountId, holdId) => `${accountId}:${holdId}`;
  const forgetExpiredHolds = () => {
    for (const [key, record] of protectedHolds) {
      if (remainingHoldMs(record.expiresAt, deps.now()) <= 0) protectedHolds.delete(key);
    }
  };
  const protect = (request) => {
    forgetExpiredHolds();
    const key = keyOf(request.accountId, request.holdId);
    if ((protectedHolds.get(key)?.instanceId ?? -1) > request.instanceId) return;
    protectedHolds.set(key, { accountId: request.accountId, instanceId: request.instanceId,
      ...referenceOf(request), expiresAt: request.expiresAt });
  };
  function protectsHold(reference, ownerInstance = null) {
    if (!reference) return false;
    forgetExpiredHolds();
    return [...pending.values()].some((record) => record.holdId === reference.holdId)
      || [...protectedHolds.values()].some((record) => record.holdId === reference.holdId
        && (ownerInstance === null || ownerInstance <= record.instanceId));
  }
  function blocksHoldMutation() {
    if (["submitting", "success", "uncertain"].includes(state().order.phase)) return true;
    return [...pending.values()].some((request) => request.accountId === userNow()?.id && request.sessionId === state().sessionId);
  }
  function readyContext() {
    const current = state(), active = runtime.scope.active(), user = userNow();
    const config = selectionConfiguration(deps.options(), current.sessionRead.data);
    return Boolean(active && user && deps.isCurrentUser(user) && user.profileComplete === true
      && active.expectedUser.id === user.id && active.token === deps.getToken() && deps.getToken()
      && Number.isSafeInteger(current.sessionId) && current.sessionId > 0 && active.sessionId === current.sessionId
      && active.instanceId === current.instanceId && current.step === "checkout" && current.hold.phase === "active"
      && usableHold(current.hold.data, current.sessionId, null, deps.now())
      && current.sessionRead.status === "ready" && current.seatMapRead.status === "ready" && config.ready
      && current.sessionRead.data?.id === current.sessionId && sameAssignments(current.selection, current.hold.data)
      && current.hold.data.seats.length <= config.max
      && current.hold.data.seats.every((seat) => eligibleAssignment({ seatId: seat.seatId, ticketType: seat.ticketType.slug, code: seat.code },
        current.seatMapRead.data, config, current.hold.data))
      && !current.recovery && !runtime.hasHoldOperation());
  }
  function canSubmitOrder() {
    return readyContext() && ["idle", "error"].includes(state().order.phase)
      && ![...pending.values()].some((request) => request.accountId === userNow()?.id);
  }
  function detach() {
    let detached = false;
    for (const request of pending.values()) {
      if (request.instanceId !== state().instanceId || request.detached) continue;
      request.detached = true;
      clearReference(request);
      transition(request, "ORDER_RESET", { detached: true });
      detached = true;
    }
    return detached;
  }
  function clearOrderError() {
    if (state().order.phase === "error") emit({ type: "ORDER_RESET", instanceId: state().instanceId, sessionId: state().sessionId });
  }
  function cancelOrderReauth() {
    if (info.reauth) clearReference(info.reauth);
    if (info.reauth || info.recovery) update({ reauth: null, recovery: null });
    reauthBudget = null;
  }
  function syncOrderAuth(user) {
    const accountId = user?.id ?? null, token = deps.getToken();
    if (accountId !== seenAccount || token !== seenToken) {
      authEpoch++;
      seenAccount = accountId;
      seenToken = token;
      if (info.notice || info.recovery || info.ticketsIntent) update({ notice: null, recovery: null, ticketsIntent: null });
    }
    if (user && info.reauth && user.id !== info.reauth.accountId) cancelOrderReauth();
    if (user && info.recovery && user.id !== info.recovery.accountId) update({ recovery: null });
  }
  function logout() {
    authEpoch++;
    cancelOrderReauth();
    update({ notice: null, recovery: null, ticketsIntent: null });
  }
  function notify(request, kind) {
    if (!authenticated(request.accountId, request.token, request.authEpoch) || request.requestId <= noticeId) return;
    noticeId = request.requestId;
    noticeToken = request.token;
    noticeEpoch = request.authEpoch;
    update({ notice: { id: request.requestId, kind, message: kind === "success" ? "Your order was completed." : UNCERTAIN,
      action: "tickets", accountId: request.accountId } });
  }
  function dismissOrderNotice(id) {
    if (info.notice?.id === id) update({ notice: null });
  }
  // One account-scoped memory slot for Slice E. Capture exact evidence before
  // Close clears Order recovery; never infer a match from booking/buyer data.
  function prepareTicketsRecovery({ noticeId: requestedNotice } = {}) {
    const user = userNow();
    if (!user || !deps.isCurrentUser(user) || !deps.getToken()) return false;
    if (requestedNotice !== undefined) {
      if (info.notice?.id !== requestedNotice || !authenticated(info.notice.accountId, noticeToken, noticeEpoch)) return false;
    } else if (state().order.phase !== "uncertain" || info.recovery?.accountId !== user.id) return false;
    update({ ticketsIntent: { accountId: user.id, identity: requestedNotice === undefined ? orderRecoveryIdentity(info.recovery.identity) : null } });
    return true;
  }
  function consumeTicketsRecovery() {
    const intent = info.ticketsIntent;
    const user = userNow();
    update({ ticketsIntent: null });
    return intent && user?.id === intent.accountId && deps.isCurrentUser(user) ? intent : null;
  }
  function reauthenticate(origin) {
    const key = keyOf(origin.accountId, origin.holdId);
    if (reauthBudget?.key === key && reauthBudget.count >= 1) {
      update({ reauth: null });
      runtime.terminal("Please sign in again before continuing your booking.");
      return false;
    }
    reauthBudget = { key, count: 1 };
    update({ reauth: { kind: "ORDER_REAUTH", instanceId: origin.instanceId, sessionId: origin.sessionId,
      holdId: origin.holdId, accountId: origin.accountId, replayCount: 1 } });
    runtime.suspend(origin.sessionId);
    return true;
  }
  function takeOrderReauth(sessionId, user) {
    const continuation = info.reauth;
    if (!continuation) return null;
    if (continuation.accountId !== user.id || continuation.sessionId !== sessionId) {
      cancelOrderReauth();
      return null;
    }
    update({ reauth: null, recovery: null });
    return continuation;
  }

  // Reuse the existing HOLD lock, read scope, validation and adoption helpers.
  // Order recovery preserves a factual draft and treats contradictions as blocked
  // verification, while still exposing the established Retry / Start over API.
  async function verifyOrderHold(reference, { failureFeedback = null, step = "seats", fallbackSelection = {}, purpose = "conflict" } = {}) {
    const request = runtime.begin({ reference });
    if (!request || !reference) return;
    const recovery = { order: true, reference, retryable: true, failureFeedback, step, fallbackSelection, purpose };
    patch({ hold: { phase: "restoring", data: null }, step: "seats", recovery, selection: fallbackSelection, feedback: failureFeedback });
    let terminal = false;
    try {
      const map = await runtime.read("seatMapRead", { preserve: true, reauthenticate: false });
      if (!runtime.current(request)) return;
      const session = await runtime.read("sessionRead", { preserve: true, reauthenticate: false });
      if (!runtime.current(request)) return;
      const hold = await deps.api.getHold(reference.holdId, { token: request.token });
      if (!runtime.current(request)) return;
      if (!usableHold(hold, request.sessionId, null, deps.now()) || hold.holdId !== reference.holdId) {
        terminal = true;
        const expired = hold?.sessionId === request.sessionId
          && (hold.isLive === false || remainingHoldMs(hold.expiresAt, deps.now()) <= 0);
        throw new Error(expired ? HOLD_COPY.expired : "Your saved seat hold is no longer available.");
      }
      const config = selectionConfiguration(deps.options(), session);
      if (!usableHold(hold, request.sessionId, null, deps.now())) { terminal = true; throw new Error(HOLD_COPY.expired); }
      if (!config.ready || !holdMatchesMap(hold, map) || hold.seats.length > config.max
        || !hold.seats.every((seat) => config.types.some((type) => type.slug === seat.ticketType.slug))) throw new Error(HOLD_COPY.mismatch);
      runtime.adopt(hold, step);
      patch({ feedback: failureFeedback });
    } catch (error) {
      if (!runtime.current(request)) return;
      if (error.status === 401) {
        runtime.finish(request);
        reauthenticate({ instanceId: request.instanceId, sessionId: request.sessionId, holdId: reference.holdId, accountId: request.expectedUser.id });
      } else if (terminal || [403, 404].includes(error.status)) {
        runtime.terminal(failureFeedback ?? error.message);
        runtime.finish(request);
        const revision = state().selectionRevision;
        const same = () => runtime.scope.active()?.instanceId === request.instanceId
          && state().selectionRevision === revision && authenticated(request.expectedUser.id, request.token);
        if (state().seatMapRead.status !== "ready") await runtime.read("seatMapRead", { preserve: true, reauthenticate: false }).catch(() => {});
        if (!same()) return;
        const config = selectionConfiguration(deps.options(), state().sessionRead.data);
        const selection = Object.fromEntries(Object.entries(fallbackSelection).filter(([id, value]) =>
          eligibleAssignment({ seatId: Number(id), ticketType: value.ticketTypeSlug }, state().seatMapRead.data, config, null)));
        patch({ selection });
      } else patch({ hold: { phase: "error", data: null }, recovery, feedback: failureFeedback ?? HOLD_COPY.restore });
    } finally { runtime.finish(request); }
  }

  async function releaseDetached(request, outcome) {
    if (!["validation", "conflict", "rejected"].includes(outcome.kind)
      || !authenticated(request.accountId, request.token, request.authEpoch)
      || remainingHoldMs(request.expiresAt, deps.now()) <= 0) return;
    const newerOwns = () => state().hold.data?.holdId === request.holdId
      || state().recovery?.reference?.holdId === request.holdId || deps.storage.read()?.holdId === request.holdId
      || (runtime.scope.active()?.instanceId !== request.instanceId && state().sessionId === request.sessionId)
      || [...runtime.pendingCreates.values()].some((entry) => entry.request.sessionId === request.sessionId);
    if (newerOwns()) return;
    try {
      const hold = await deps.api.getHold(request.holdId, { token: request.token });
      if (authenticated(request.accountId, request.token, request.authEpoch) && !newerOwns()
        && hold?.holdId === request.holdId && usableHold(hold, request.sessionId, null, deps.now())) {
        void runtime.release(referenceOf(request), request.token);
      }
    } catch { /* Best effort only; do not resurrect old UI. */ }
  }

  async function settleResult(request, promise) {
    let outcome;
    try { outcome = classifyOrderResponse(await promise, { sessionId: request.sessionId }); }
    catch (error) { outcome = classifyOrderError(error); }
    if (pending.get(request.requestId) !== request) return result("stale");
    if (activeRequest(request) && remainingHoldMs(request.expiresAt, deps.now()) <= 0) runtime.expire(state().hold.data);
    const isCurrent = activeRequest(request);
    pending.delete(request.requestId); // Only this request releases its lock.
    if (!isCurrent) {
      update({}); // Detached cleanup may wait on a read; the settled lock is already free.
      if (outcome.kind === "usable-order") { protect(request); notify(request, "success"); }
      else if (["uncertain", "malformed-success"].includes(outcome.kind)) { protect(request); notify(request, "uncertain"); }
      else await releaseDetached(request, outcome);
      return result("stale");
    }
    if (outcome.kind === "usable-order") {
      protect(request);
      clearReference(request);
      update({ recovery: null });
      transition(request, "ORDER_SUCCESS", { order: outcome.order });
      return result("success");
    }
    if (["uncertain", "malformed-success"].includes(outcome.kind)) {
      protect(request);
      clearReference(request);
      update({ recovery: { accountId: request.accountId, ...referenceOf(request), identity: outcome.recovery ?? null } });
      transition(request, "ORDER_UNCERTAIN", { feedback: UNCERTAIN });
      return result("uncertain");
    }
    transition(request, "ORDER_ERROR", { feedback: outcome.kind === "validation" ? null : outcome.message });
    if (outcome.kind === "validation") {
      if (!usableHold(state().hold.data, request.sessionId, null, deps.now())) {
        runtime.expire(state().hold.data);
        return result("expired");
      }
      return { kind: "validation", clearPayment: false, ...mapCheckout422Errors(outcome.errors), message: outcome.message };
    }
    if (outcome.kind === "unauthenticated") {
      reauthenticate(request);
      return result("auth-required");
    }
    if (["business", "rejected"].includes(outcome.kind)) {
      runtime.terminal(outcome.message ?? HOLD_COPY.expired);
      patch({ hold: { phase: "expired", data: null } });
      void runtime.read("seatMapRead", { preserve: true }).catch(() => {});
      return result("expired");
    }
    if (outcome.kind === "terminal-context") {
      runtime.terminal(outcome.message ?? "This booking context is unavailable.");
      return result("context-error");
    }
    const reference = referenceOf(request);
    if (outcome.kind === "forbidden") {
      void verifyOrderHold(reference, { failureFeedback: outcome.message, purpose: "forbidden", step: "checkout" });
      return result("forbidden");
    }
    const codes = outcome.contested ?? [];
    const ids = new Set(request.assignments.filter((entry) => codes.includes(entry.code)).map((entry) => entry.seatId));
    const selection = Object.fromEntries(Object.entries(state().selection).filter(([id]) => !ids.has(Number(id))));
    const feedback = [outcome.message, codes.length ? codes.join(", ") : null].filter(Boolean).join(" ");
    patch({ step: "seats", contested: codes.filter((code) => request.assignments.some((entry) => entry.code === code)), selection, feedback });
    void verifyOrderHold(reference, { failureFeedback: feedback, fallbackSelection: selection });
    return result("conflict");
  }
  async function settle(request, promise) {
    try { return await settleResult(request, promise); }
    finally { update({}); }
  }

  // Intentionally not async: the factory's call frame ends before awaiting. It
  // cannot remain in a saved continuation/operation for mutation replay.
  function submitOrder(factory, { valid = false } = {}) {
    if (valid !== true || typeof factory !== "function" || !canSubmitOrder()) return Promise.resolve({ kind: "blocked", clearPayment: false });
    const current = state(), hold = current.hold.data, user = userNow();
    const request = { requestId: runtime.nextRequestId(), instanceId: current.instanceId, revision: current.selectionRevision,
      accountId: user.id, token: deps.getToken(), authEpoch, sessionId: current.sessionId, holdId: hold.holdId,
      expiresAt: hold.expiresAt, detached: false,
      assignments: hold.seats.map((seat) => ({ seatId: seat.seatId, code: seat.code, ticketType: seat.ticketType.slug })) };
    pending.set(request.requestId, request);
    transition(request, "ORDER_SUBMITTING");
    // Store subscribers run synchronously. They can close/expire the booking or
    // invalidate auth before dispatch; recheck authority without retaining Pay.
    if (!activeRequest(request) || !readyContext()) {
      if (activeRequest(request) && remainingHoldMs(request.expiresAt, deps.now()) <= 0) runtime.expire(hold);
      pending.delete(request.requestId);
      transition(request, "ORDER_RESET", { detached: true });
      update({});
      return Promise.resolve(result("blocked"));
    }
    let promise;
    try { promise = factory({ holdId: request.holdId, token: request.token }); }
    catch (error) { promise = Promise.reject(error); }
    return settle(request, promise);
  }
  return {
    submitOrder, canSubmitOrder, blocksHoldMutation, protectsHold, detach, clearOrderError,
    prepareTicketsRecovery, consumeTicketsRecovery,
    hasPendingOrderForSession: () => [...pending.values()].some((request) => request.accountId === userNow()?.id && request.sessionId === state().sessionId),
    cancelOrderReauth, syncOrderAuth, logout, takeOrderReauth, verifyOrderHold,
    hasOrderReauth: () => Boolean(info.reauth),
    hasCurrentOrder: () => ["submitting", "success", "uncertain"].includes(state().order.phase),
    canRestoreHold: (reference) => !blocksHoldMutation() && !protectsHold(reference),
    resumeOrder: (continuation) => verifyOrderHold(referenceOf(continuation), { step: "checkout", purpose: "reauth" }),
    invalidateChangedContext() {
      const request = [...pending.values()].find((entry) => entry.instanceId === state().instanceId && !entry.detached);
      if (request && request.revision !== state().selectionRevision) {
        detach();
        patch({ hold: { phase: "idle", data: null }, step: "seats", selection: {} });
      }
    },
    snapshot: () => (info.notice && !authenticated(info.notice.accountId, noticeToken, noticeEpoch))
      || (info.recovery && info.recovery.accountId !== userNow()?.id)
      || (info.ticketsIntent && info.ticketsIntent.accountId !== userNow()?.id) ? hiddenInfo : info,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dismissOrderNotice,
  };
}
