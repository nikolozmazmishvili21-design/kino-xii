import { refundOrder } from "../api/ticketsApi.js";
import {
  captureRefundIdentity, classifyRefundError, classifyRefundResponse,
  matchesRefundIdentity, refundEligible,
} from "./refundLifecycle.js";

export const REFUND_WAIT_MS = 30_000;
const IDLE = Object.freeze({ busy: false, phase: "idle", confirmation: null,
  records: Object.freeze([]), generation: 0 });

const GUEST_BUSY = Object.freeze({ ...IDLE, busy: true });

// One instance per future app shell, not per consumer. No React/auth/GET wiring.
// getAuth returns current { accountId, generation, token }; generation must change
// across logout/credential replacement, including a later login to the same account.
export function createRefundRuntime({
  getAuth, post = refundOrder, now = () => performance.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
  isContextCurrent = () => true, onObserverError = () => {},
} = {}) {
  if (typeof getAuth !== "function") throw new TypeError("Refund runtime requires current auth ownership.");
  let pending = null, consent = null, consentAuth = null, consentGeneration = 0;
  let requestGeneration = 0, notifying = false, dirty = false, queued = false, observedAuth = null, revokedAuth = null, cache = null;
  const accounts = new Map(), listeners = new Set(), outcomeListeners = new Set();
  function auth() {
    const value = getAuth();
    if (value && revokedAuth?.accountId === value.accountId && revokedAuth.generation === value.generation) return null;
    return value && Number.isSafeInteger(value.accountId)
      && Number.isSafeInteger(value.generation) && value.generation >= 0
      && typeof value.token === "string" && value.token.length ? value : null;
  }
  const sameAuth = (expected) => {
    const current = auth();
    return Boolean(expected && current && current.accountId === expected.accountId
      && current.generation === expected.generation && current.token === expected.token);
  };
  const account = (id) => {
    if (!accounts.has(id)) accounts.set(id, { generation: 0, records: new Map() });
    return accounts.get(id);
  };
  function report(error) {
    try { onObserverError(error); } catch { /* Observers cannot own mutation finalization. */ }
  }
  function notify() {
    cache = null;
    dirty = true;
    if (notifying) return;
    notifying = true;
    try {
      // A later listener can change state after an earlier listener sampled it.
      // Coalesce a second synchronous pass without recursive stack growth.
      for (let pass = 0; dirty && pass < 2; pass++) {
        dirty = false;
        for (const listener of [...listeners]) {
          try { listener(); } catch (error) { report(error); }
        }
      }
    } finally { notifying = false; }
    if (dirty && !queued) {
      queued = true;
      queueMicrotask(() => { queued = false; if (dirty) notify(); });
    }
  }
  function snapshot() {
    const current = auth();
    if (!current) return pending ? GUEST_BUSY : IDLE;
    const state = account(current.accountId);
    if (cache?.accountId === current.accountId && cache.authGeneration === current.generation
      && cache.authToken === current.token) return cache.value;
    const confirmation = consent && sameAuth(consentAuth) ? consent : null;
    const records = Object.freeze([...state.records.values()]);
    const value = Object.freeze({ busy: Boolean(pending),
      phase: confirmation ? "confirming" : records.at(-1)?.phase ?? "idle",
      confirmation, records, generation: state.generation });
    cache = { accountId: current.accountId, authGeneration: current.generation, authToken: current.token, value };
    return value;
  }
  function readGuard() {
    const current = auth();
    return current ? Object.freeze({ accountId: current.accountId,
      authGeneration: current.generation, generation: account(current.accountId).generation }) : null;
  }
  function isReadCurrent(guard) {
    const current = auth();
    return Boolean(guard && current && guard.accountId === current.accountId
      && guard.authGeneration === current.generation
      && guard.generation === account(current.accountId).generation);
  }
  function revokeContinuations() {
    for (const state of accounts.values()) {
      for (const [reference, record] of state.records) {
        if (record.continuation) state.records.set(reference, Object.freeze({
          ...record, phase: "blocked", continuation: null,
        }));
      }
    }
  }
  function cancelIntent() {
    const retained = [...accounts.values()].some((state) =>
      [...state.records.values()].some((record) => record.continuation));
    if (!consent && !pending?.allowContinuation && !retained) return;
    consent = null;
    consentAuth = null;
    consentGeneration++;
    if (pending) pending.allowContinuation = false;
    revokeContinuations();
    notify();
  }
  function logout() {
    const current = auth();
    if (current) revokedAuth = { accountId: current.accountId, generation: current.generation };
    cancelIntent();
  }
  function syncAuth() {
    const current = auth();
    if ((!observedAuth && !current) || (observedAuth && sameAuth(observedAuth))) return;
    if (observedAuth && !sameAuth(observedAuth)) {
      consent = null;
      consentAuth = null;
      consentGeneration++;
      if (pending) pending.allowContinuation = false;
    }
    // Expected guest reauth preserves a descriptor; different-account auth does not.
    if (current) {
      for (const [id, state] of accounts) {
        if (id === current.accountId) continue;
        for (const [reference, record] of state.records) {
          if (record.continuation) state.records.set(reference, Object.freeze({
            ...record, phase: "blocked", continuation: null,
          }));
        }
      }
    }
    observedAuth = current ? { ...current } : null;
    notify();
  }
  function createConsent(order, { confirmed = false } = {}) {
    checkDeadline();
    const current = auth(), identity = captureRefundIdentity(order);
    // Renewed attempts need the later factual-verification coordinator. Fail closed
    // for every recorded reference (including acknowledged success/refusal).
    if (notifying || pending || !current || confirmed !== true || !isContextCurrent()
      || !refundEligible(order, identity) || account(current.accountId).records.has(identity.reference)) return null;
    revokeContinuations(); // A new explicit intent supersedes any retained 401 intent.
    consent = Object.freeze({ accountId: current.accountId, authGeneration: current.generation,
      identity, consentGeneration: ++consentGeneration });
    consentAuth = { ...current };
    observedAuth = { ...current };
    notify();
    return consent;
  }
  function store(request, outcome, disposition) {
    const state = account(request.accountId);
    const previous = state.records.get(request.identity.reference);
    const continuation = outcome.kind === "unauthenticated" && request.allowContinuation
      && sameAuth(request.auth) && isContextCurrent()
      ? Object.freeze({ type: "REFUND_REAUTH", accountId: request.accountId,
        identity: request.identity, consentGeneration: request.consentGeneration,
        replayCount: 0, purpose: "definite-401" }) : null;
    const phase = outcome.kind === "unauthenticated" ? (continuation ? "reauth" : "blocked") : outcome.kind;
    const record = Object.freeze({ identity: request.identity, accountId: request.accountId,
      requestId: request.id, authGeneration: request.auth.generation,
      consentGeneration: request.consentGeneration, phase, disposition,
      settledGeneration: ++state.generation, priorUncertainty: Boolean(previous?.priorUncertainty || phase === "uncertain"),
      reportedRefunded: Boolean(previous?.reportedRefunded || outcome.reportedRefunded),
      displayStatus: outcome.displayStatus ?? null,
      reason: outcome.kind === "unauthenticated" ? "unauthenticated" : outcome.reason ?? null,
      message: outcome.message ?? null, continuation });
    state.records.set(request.identity.reference, record);
  }
  function finish(request, outcome, deadline = false) {
    if (pending !== request || request.terminal) return;
    // Fence before abort: abort event listeners execute synchronously.
    request.terminal = true;
    if (deadline) request.allowContinuation = false;
    const currentOwner = sameAuth(request.auth);
    const factualOutcome = currentOwner || deadline ? outcome
      : { kind: "uncertain", reason: "obsolete-auth" };
    store(request, factualOutcome, deadline ? "deadline-retired" : "settled");
    if (request.timer !== null) clearTimer(request.timer);
    request.timer = null;
    if (deadline) {
      try { request.controller.abort(); } catch (error) { report(error); }
    }
    if (pending === request) pending = null;
    request.resolve(Object.freeze({ kind: currentOwner ? outcome.kind : "stale", requestId: request.id }));
    // Full Orders are delivered only to attached readers; never cached in the
    // runtime snapshot/ledger or replayed on subscription/remount.
    if (currentOwner && outcome.kind === "succeeded" && outcome.order) {
      const event = Object.freeze({ guard: readGuard(), identity: request.identity,
        requestId: request.id, order: outcome.order });
      notifying = true;
      try {
        for (const listener of [...outcomeListeners]) {
          if (!sameAuth(request.auth) || !isReadCurrent(event.guard)) break;
          try { listener(event); } catch (error) { report(error); }
        }
      } finally { notifying = false; }
    }
    notify();
  }
  function checkDeadline() {
    const request = pending;
    if (request && request.dispatched && !request.terminal && now() >= request.deadline) {
      finish(request, { kind: "uncertain", reason: "deadline" }, true);
    }
  }
  function arm(request) {
    request.timer = setTimer(() => {
      if (pending !== request || request.terminal) return;
      checkDeadline();
      // A timer waking early (including a clock that paused during sleep) uses
      // only the remaining monotonic budget; never Date.now or a new deadline.
      if (pending === request && !request.terminal) arm(request);
    }, Math.max(0, request.deadline - now()));
  }
  function complete(request, outcome) {
    if (pending !== request || request.terminal) return;
    checkDeadline(); // Body completion after the budget cannot beat a delayed timer.
    if (pending === request && !request.terminal) finish(request, outcome);
  }
  function submit(authorization, order) {
    checkDeadline();
    if (notifying || pending || !authorization || authorization !== consent
      || !sameAuth(consentAuth) || !isContextCurrent()
      || !refundEligible(order, authorization.identity)) return Promise.resolve({ kind: "blocked" });
    const request = { id: ++requestGeneration, accountId: authorization.accountId,
      identity: authorization.identity, consentGeneration: authorization.consentGeneration,
      auth: { ...consentAuth }, controller: new AbortController(), allowContinuation: true,
      terminal: false, dispatched: false, timer: null };
    const result = new Promise((resolve) => { request.resolve = resolve; });
    pending = request; // Synchronous slot acquired before ANY subscriber/factory.
    consent = null;
    consentAuth = null;
    account(request.accountId).records.set(request.identity.reference, Object.freeze({
      identity: request.identity, accountId: request.accountId, requestId: request.id,
      phase: "submitting", priorUncertainty: false, reportedRefunded: false, continuation: null,
    }));
    notify();
    if (!sameAuth(request.auth) || !isContextCurrent() || !request.allowContinuation
      || request.consentGeneration !== consentGeneration
      || !matchesRefundIdentity(order, request.identity) || !refundEligible(order, request.identity)) {
      // No dispatch happened; discard this provisional record and its own slot.
      account(request.accountId).records.delete(request.identity.reference);
      if (pending === request) pending = null;
      request.terminal = true;
      request.resolve(Object.freeze({ kind: "blocked", requestId: request.id }));
      notify();
      return result;
    }
    account(request.accountId).generation++;
    request.dispatched = true;
    request.deadline = now() + REFUND_WAIT_MS;
    arm(request);
    checkDeadline();
    if (pending !== request || request.terminal) return result;
    let transport;
    try {
      transport = post(request.identity.reference, {
        token: request.auth.token, signal: request.controller.signal,
      });
    } catch (error) { transport = Promise.reject(error); }
    // Observe both branches, including losing branches after deadline retirement.
    // No factory/payload is saved for replay. API promise includes response.text().
    Promise.resolve(transport).then(
      (response) => {
        if (pending === request && !request.terminal) complete(request, classifyRefundResponse(response, request.identity));
      },
      (error) => {
        if (pending === request && !request.terminal) complete(request, classifyRefundError(error));
      },
    ).catch((error) => {
      report(error);
      complete(request, { kind: "uncertain", reason: "observer-error" });
    });
    notify();
    return result;
  }
  return Object.freeze({
    createConsent, submit, snapshot, readGuard, isReadCurrent, syncAuth,
    cancelIntent, logout, checkDeadline,
    hasActivePost: () => Boolean(pending),
    subscribeOutcome(listener) {
      outcomeListeners.add(listener);
      return () => outcomeListeners.delete(listener);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener); // Unsubscribe never owns a timer/lock.
    },
  });
}
