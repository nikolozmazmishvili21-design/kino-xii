import { getTickets, refundOrder } from "../api/ticketsApi.js";
import {
  captureRefundIdentity, classifyRefundError, classifyRefundResponse,
  matchesRefundIdentity, refundEligible, inspectRefundVerification, readableRefundOrder,
} from "./refundLifecycle.js";
import { groupTicketOrders } from "./ticketGroups.js";

export const REFUND_WAIT_MS = 30_000;
export const REFUND_RECONFIRMATION_WARNING = "We couldn't confirm the earlier refund. Your tickets currently show this order as paid and refundable, but the earlier request may still complete. Confirming sends a new refund request.";
const IDLE = Object.freeze({ busy: false, phase: "idle", confirmation: null,
  records: Object.freeze([]), generation: 0 });

const GUEST_BUSY = Object.freeze({ ...IDLE, busy: true });

// One application-lifetime coordinator. Only explicit auth success may start
// definite-401 verification; subscribers and auth observations never replay.
// getAuth returns current { accountId, generation, token }; generation must change
// across logout/credential replacement, including a later login to the same account.
export function createRefundRuntime({
  getAuth, post = refundOrder, read = getTickets, onUnauthorized = () => true, now = () => performance.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer),
  isContextCurrent = () => true, onObserverError = () => {},
} = {}) {
  if (typeof getAuth !== "function") throw new TypeError("Refund runtime requires current auth ownership.");
  let pending = null, consent = null, consentAuth = null, consentGeneration = 0;
  let requestGeneration = 0, notifying = false, dirty = false, queued = false, observedAuth = null, revokedAuth = null, cache = null;
  const accounts = new Map(), listeners = new Set(), outcomeListeners = new Set();
  let verification = null, continuationAuth = null;
  let recovery = null, consentEvidence = null;
  const CLOSED_AUTH = Object.freeze({ loginRequired: false, suppressProfileGate: false, requestId: null });
  const SUPPRESSED_AUTH = Object.freeze({ ...CLOSED_AUTH, suppressProfileGate: true });
  let authGate = CLOSED_AUTH, authGateAccountId = null;
  function setAuthGate(value, accountId = authGateAccountId) {
    authGate = value;
    authGateAccountId = value === CLOSED_AUTH ? null : accountId;
  }
  function authSnapshot() {
    const current = auth();
    // A's guest interval/budget may suppress A recovery, never B recovery.
    return current && current.accountId !== authGateAccountId ? CLOSED_AUTH : authGate;
  }
  function retainedIntent() {
    for (const state of accounts.values()) {
      for (const record of state.records.values()) if (record.continuation) return record.continuation;
    }
    return null;
  }
  function patchIntent(intent, changes) {
    const state = account(intent.accountId), record = state.records.get(intent.identity.reference);
    if (record?.continuation !== intent) return false;
    state.records.set(intent.identity.reference, Object.freeze({ ...record, ...changes }));
    return true;
  }
  function expireOwnedAuth(expected) {
    if (!sameAuth(expected)) return false;
    try {
      return onUnauthorized(Object.freeze({ accountId: expected.accountId, generation: expected.generation })) === true;
    } catch (error) { report(error); return false; }
  }
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
    if (!accounts.has(id)) accounts.set(id, { generation: 0, records: new Map(), eligibility: new Map() });
    return accounts.get(id);
  };
  function clearEligibility(state) {
    state.eligibility.clear();
    for (const [reference, record] of state.records) {
      if (record.phase === "retry_available") state.records.set(reference, Object.freeze({ ...record, phase: "uncertain" }));
    }
  }
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
    const hadRead = Boolean(verification || recovery);
    if (verification) {
      const old = verification;
      verification = null; // Fence before synchronous abort callbacks.
      old.controller.abort();
    }
    continuationAuth = null;
    cancelRecovery();
    if (authGate.loginRequired) setAuthGate(SUPPRESSED_AUTH);
    const retained = retainedIntent();
    if (!consent && !pending?.allowContinuation && !retained && !hadRead) return;
    if (retained) setAuthGate(SUPPRESSED_AUTH, retained.accountId);
    consent = null;
    consentAuth = null;
    consentEvidence = null;
    consentGeneration++;
    if (pending) pending.allowContinuation = false;
    revokeContinuations();
    notify();
  }
  function logout() {
    const current = auth();
    if (current) revokedAuth = { accountId: current.accountId, generation: current.generation };
    cancelIntent();
    for (const state of accounts.values()) clearEligibility(state);
  }
  function syncAuth() {
    const current = auth();
    if ((!observedAuth && !current) || (observedAuth && sameAuth(observedAuth))) return;
    const intent = retainedIntent();
    const record = intent && account(intent.accountId).records.get(intent.identity.reference);
    // Only the expected guest/login interval preserves confirmed 401 consent.
    // Once verification starts, any credential change ends that continuation.
    const expectedReauth = record?.phase === "reauth"
      && (!current || current.accountId === intent.accountId);
    const expectedReadAuth = recovery?.awaitingAuth
      && (!current || current.accountId === recovery.accountId);
    if (recovery && !expectedReadAuth && !sameAuth(recovery.auth)) cancelIntent();
    if (observedAuth && !sameAuth(observedAuth)) {
      consent = null;
      consentAuth = null;
      consentEvidence = null;
      for (const state of accounts.values()) clearEligibility(state);
      if (!expectedReauth && !expectedReadAuth) consentGeneration++;
      if (pending) pending.allowContinuation = false;
    }
    if (intent && ((!expectedReauth && !sameAuth(continuationAuth))
      || (current && current.accountId !== intent.accountId))) cancelIntent();
    if (current && authGateAccountId !== current.accountId) setAuthGate(CLOSED_AUTH);
    observedAuth = current ? { ...current } : null;
    notify();
  }
  function evidenceCurrent(evidence, order) {
    return Boolean(evidence && sameAuth(evidence.auth) && isReadCurrent(evidence.guard)
      && account(evidence.guard.accountId).eligibility.get(evidence.identity.reference) === evidence
      && matchesRefundIdentity(order, evidence.identity) && refundEligible(order, evidence.identity));
  }
  // Read-only presentation authority. Opening a dialog neither creates consent
  // nor acknowledges the warning; only its explicit confirm action may do that.
  function confirmationDetails(order) {
    const current = auth(), identity = captureRefundIdentity(order);
    const state = current && account(current.accountId), record = state?.records.get(identity?.reference);
    if (notifying || pending || !current || !isContextCurrent() || !refundEligible(order, identity)
      || record?.reportedRefunded || (record && !evidenceCurrent(state.eligibility.get(identity.reference), order))) return null;
    return Object.freeze({ accountId: current.accountId, authGeneration: current.generation,
      intentGeneration: consentGeneration, readGeneration: state.generation, identity,
      warning: record?.priorUncertainty ? REFUND_RECONFIRMATION_WARNING : null });
  }
  function createConsent(order, { confirmed = false, warningAcknowledged = false } = {}) {
    checkDeadline();
    const current = auth(), identity = captureRefundIdentity(order);
    const state = current && account(current.accountId), record = state?.records.get(identity?.reference);
    const evidence = record && state.eligibility.get(identity.reference);
    if (notifying || pending || !current || confirmed !== true || !isContextCurrent()
      || !refundEligible(order, identity) || record?.reportedRefunded
      || (record && (!evidenceCurrent(evidence, order)
        || (record.priorUncertainty && warningAcknowledged !== true)))) return null;
    cancelRecovery();
    revokeContinuations(); // A new explicit intent supersedes any retained 401 intent.
    consent = Object.freeze({ accountId: current.accountId, authGeneration: current.generation,
      identity, consentGeneration: ++consentGeneration,
      ...(record?.priorUncertainty ? { warning: REFUND_RECONFIRMATION_WARNING } : {}) });
    consentEvidence = evidence ?? null;
    consentAuth = { ...current };
    observedAuth = { ...current };
    notify();
    return consent;
  }
  function store(request, outcome, disposition) {
    const state = account(request.accountId);
    const previous = state.records.get(request.identity.reference);
    const continuation = outcome.kind === "unauthenticated" && request.allowContinuation
      && request.replayCount === 0 && request.consentGeneration === consentGeneration
      && sameAuth(request.auth) && isContextCurrent()
      ? Object.freeze({ type: "REFUND_REAUTH", accountId: request.accountId,
        identity: request.identity, consentGeneration: request.consentGeneration, requestId: request.id,
        authGeneration: request.auth.generation, replayCount: 0, purpose: "definite-401" }) : null;
    const phase = outcome.kind === "unauthenticated" ? (continuation ? "reauth" : "blocked") : outcome.kind;
    const record = Object.freeze({ identity: request.identity, accountId: request.accountId,
      requestId: request.id, authGeneration: request.auth.generation,
      consentGeneration: request.consentGeneration, phase, disposition,
      settledGeneration: ++state.generation, priorUncertainty: Boolean(previous?.priorUncertainty || phase === "uncertain"),
      reportedRefunded: Boolean(previous?.reportedRefunded || outcome.reportedRefunded),
      displayStatus: outcome.displayStatus ?? null,
      reason: outcome.kind === "unauthenticated" ? "unauthenticated" : outcome.reason ?? null,
      message: outcome.message ?? null, replayCount: request.replayCount, continuation });
    state.eligibility.clear();
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
    if (currentOwner && outcome.kind === "unauthenticated" && request.allowContinuation && isContextCurrent()) {
      const intent = retainedIntent();
      setAuthGate(intent ? Object.freeze({ loginRequired: true, suppressProfileGate: true, requestId: request.id })
        : SUPPRESSED_AUTH, request.accountId);
      if (!expireOwnedAuth(request.auth) && intent) {
        patchIntent(intent, { phase: "blocked", continuation: null });
        setAuthGate(SUPPRESSED_AUTH, request.accountId);
      }
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
  function dispatch(authorization, order, replayCount = 0) {
    checkDeadline();
    if (notifying || pending || !authorization || authorization !== consent
      || !sameAuth(consentAuth) || !isContextCurrent()
      || !refundEligible(order, authorization.identity)
      || (consentEvidence && !evidenceCurrent(consentEvidence, order))) return Promise.resolve({ kind: "blocked" });
    const previous = account(authorization.accountId).records.get(authorization.identity.reference);
    const request = { id: ++requestGeneration, accountId: authorization.accountId,
      identity: authorization.identity, consentGeneration: authorization.consentGeneration,
      auth: { ...consentAuth }, controller: new AbortController(), allowContinuation: true, replayCount,
      terminal: false, dispatched: false, timer: null, evidence: consentEvidence };
    const result = new Promise((resolve) => { request.resolve = resolve; });
    pending = request; // Synchronous slot acquired before ANY subscriber/factory.
    consent = null;
    consentAuth = null;
    consentEvidence = null;
    account(request.accountId).records.set(request.identity.reference, Object.freeze({
      identity: request.identity, accountId: request.accountId, requestId: request.id,
      authGeneration: request.auth.generation, consentGeneration: request.consentGeneration,
      disposition: null, settledGeneration: null,
      phase: "submitting", priorUncertainty: Boolean(previous?.priorUncertainty), reportedRefunded: false, replayCount, continuation: null,
      reason: null, message: null, displayStatus: null, recoveryPurpose: null,
    }));
    notify();
    if (!sameAuth(request.auth) || !isContextCurrent() || !request.allowContinuation
      || request.consentGeneration !== consentGeneration
      || !matchesRefundIdentity(order, request.identity) || !refundEligible(order, request.identity)
      || (request.evidence && !evidenceCurrent(request.evidence, order))) {
      // No dispatch happened; discard this provisional record and its own slot.
      if (previous) account(request.accountId).records.set(request.identity.reference,
        request.evidence && !evidenceCurrent(request.evidence, order)
          ? Object.freeze({ ...previous, phase: previous.priorUncertainty ? "uncertain" : "blocked" }) : previous);
      else account(request.accountId).records.delete(request.identity.reference);
      if (pending === request) pending = null;
      request.terminal = true;
      request.resolve(Object.freeze({ kind: "blocked", requestId: request.id }));
      notify();
      return result;
    }
    account(request.accountId).generation++;
    account(request.accountId).eligibility.clear();
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
  function updateRecord(owner, changes) {
    const state = account(owner.accountId), record = state.records.get(owner.identity.reference);
    if (!record || record.requestId !== owner.originRequestId) return false;
    state.records.set(owner.identity.reference, Object.freeze({ ...record, ...changes }));
    return true;
  }
  function cancelRecovery() {
    const old = recovery;
    if (!old) return;
    recovery = null;
    if (verification?.recovery === old) {
      const request = verification; verification = null;
      request.controller.abort();
    }
    const record = account(old.accountId).records.get(old.identity.reference);
    updateRecord(old, { phase: record?.reportedRefunded ? "succeeded"
      : record?.priorUncertainty ? "uncertain" : "blocked", recoveryPurpose: null });
  }
  function invalidateEligibility() {
    const current = auth();
    if (!current) return;
    const state = account(current.accountId);
    if (!state.eligibility.size) return;
    clearEligibility(state);
    if (consentEvidence) {
      consent = null; consentAuth = null; consentEvidence = null; consentGeneration++;
    }
    notify();
  }
  function coherentTickets(orders) {
    try { groupTicketOrders(orders); } catch { return false; }
    for (const record of snapshot().records) {
      if (!record.reportedRefunded) continue;
      const matches = orders.filter(order => order.reference === record.identity.reference);
      if (matches.length !== 1 || matches[0].status !== "refunded"
        || !readableRefundOrder(matches[0], record.identity)) return false;
    }
    return true;
  }
  function observeTickets(orders, guard) {
    if (!isReadCurrent(guard)) return false;
    const coherent = coherentTickets(orders), state = account(guard.accountId);
    let changed = false;
    for (const [reference, record] of state.records) {
      if (!record.reportedRefunded) continue;
      const displayStatus = coherent ? "ready" : "error";
      if (record.displayStatus !== displayStatus) {
        state.records.set(reference, Object.freeze({ ...record, displayStatus })); changed = true;
      }
    }
    if (changed) notify();
    return coherent;
  }
  function publishTickets(orders, expectedAuth) {
    const event = Object.freeze({ guard: readGuard(), orders });
    notifying = true;
    try {
      for (const listener of [...outcomeListeners]) {
        if (!sameAuth(expectedAuth) || !isReadCurrent(event.guard)) break;
        try { listener(event); } catch (error) { report(error); }
      }
    } finally { notifying = false; }
  }
  function recoveryCurrent(request) {
    return verification === request && recovery === request.recovery
      && recovery.consentGeneration === consentGeneration && sameAuth(request.auth)
      && isReadCurrent(request.guard) && isContextCurrent() && !pending
      && account(recovery.accountId).records.get(recovery.identity.reference)?.requestId === recovery.originRequestId;
  }
  async function verifyRecovery(owner) {
    if (!owner || recovery !== owner || verification || pending || !sameAuth(owner.auth)
      || owner.awaitingAuth || owner.consentGeneration !== consentGeneration || !isContextCurrent()) return { kind: "blocked" };
    const state = account(owner.accountId);
    state.eligibility.clear();
    state.generation++; // Obsolete reads begun before this explicit verification.
    const request = { recovery: owner, auth: { ...owner.auth }, guard: readGuard(), controller: new AbortController() };
    verification = request;
    const original = state.records.get(owner.identity.reference);
    updateRecord(owner, { phase: original.reportedRefunded ? "succeeded" : "verifying",
      recoveryPurpose: owner.purpose, ...(original.reportedRefunded ? { displayStatus: "refreshing" } : {}) });
    notify();
    if (!recoveryCurrent(request)) return { kind: "stale" };
    let orders;
    try {
      orders = await read({ token: request.auth.token, signal: request.controller.signal });
    } catch (error) {
      if (!recoveryCurrent(request)) return { kind: "stale" };
      verification = null;
      state.generation++;
      const unauthorized = error?.status === 401;
      const exhausted = unauthorized && owner.authAttempts === 1;
      updateRecord(owner, { phase: original.reportedRefunded ? "succeeded" : exhausted ? "blocked" : "verification_retry",
        reason: unauthorized ? "unauthenticated" : "verification-read-failed",
        ...(original.reportedRefunded ? { displayStatus: "error" } : {}) });
      if (unauthorized) {
        owner.awaitingAuth = !exhausted;
        owner.authAttempts = 1;
        setAuthGate(exhausted ? SUPPRESSED_AUTH : Object.freeze({
          loginRequired: true, suppressProfileGate: true, requestId: owner.requestId,
        }), owner.accountId);
        if (exhausted) recovery = null;
        if (!expireOwnedAuth(request.auth) && recovery === owner) {
          recovery = null;
          updateRecord(owner, { phase: original.reportedRefunded ? "succeeded" : "blocked" });
          setAuthGate(SUPPRESSED_AUTH, owner.accountId);
        }
      }
      notify();
      return { kind: exhausted ? "blocked" : "verification_retry" };
    }
    if (!recoveryCurrent(request)) return { kind: "stale" };
    let outcome = inspectRefundVerification(orders, owner.identity);
    const coherent = coherentTickets(orders);
    if ((original.reportedRefunded && outcome.kind !== "succeeded")
      || (outcome.kind === "retry_available" && !coherent)) outcome = { kind: "inconclusive" };
    verification = null;
    recovery = null;
    state.generation++; // Fence every competing GET, including reads during verification.
    const reportedRefunded = original.reportedRefunded || outcome.kind === "succeeded";
    const eligible = !reportedRefunded && outcome.kind === "retry_available";
    updateRecord(owner, { phase: reportedRefunded ? "succeeded" : eligible
      ? original.priorUncertainty ? "retry_available" : "idle"
      : original.priorUncertainty ? "uncertain" : "blocked",
    reportedRefunded, recoveryPurpose: null,
    reason: ["ineligible", "inconclusive"].includes(outcome.kind) ? outcome.kind : null,
    displayStatus: reportedRefunded ? coherent && outcome.order ? "ready"
      : outcome.kind === "succeeded" && !original.reportedRefunded ? "refreshing" : "error" : original.displayStatus });
    if (eligible) state.eligibility.set(owner.identity.reference, Object.freeze({
      identity: owner.identity, auth: { ...request.auth }, guard: readGuard(), verificationId: owner.requestId,
    }));
    if (coherent && (!reportedRefunded || outcome.order)) publishTickets(orders, request.auth);
    notify();
    return { kind: outcome.kind };
  }
  function checkStatus(reference) {
    checkDeadline();
    const current = auth(), record = current && account(current.accountId).records.get(reference);
    // Only completed local settlement/retirement may begin an authorizing read.
    if (notifying || pending || verification || retainedIntent() || !current || !isContextCurrent()
      || !record || !["settled", "deadline-retired"].includes(record.disposition)) return Promise.resolve({ kind: "blocked" });
    if (recovery) {
      if (recovery.identity.reference === reference) return verifyRecovery(recovery);
      cancelRecovery();
    }
    invalidateEligibility();
    consent = null; consentAuth = null; consentEvidence = null;
    recovery = { accountId: current.accountId, identity: record.identity, originRequestId: record.requestId,
      requestId: ++requestGeneration, consentGeneration: ++consentGeneration,
      purpose: record.reportedRefunded ? "display" : record.priorUncertainty ? "uncertainty" : "context",
      auth: { ...current }, authAttempts: 0, awaitingAuth: false };
    return verifyRecovery(recovery);
  }
  function verificationCurrent(request) {
    return verification === request && retainedIntent() === request.intent
      && request.intent.consentGeneration === consentGeneration
      && sameAuth(request.auth) && isReadCurrent(request.guard) && isContextCurrent();
  }
  function blockVerification(request, reason = "verification-ineligible") {
    if (!verificationCurrent(request)) return;
    verification = null;
    continuationAuth = null;
    patchIntent(request.intent, { phase: "blocked", continuation: null, reason });
    notify();
  }
  async function verifyIntent(intent, expectedAuth) {
    if (!intent || retainedIntent() !== intent || intent.replayCount !== 0
      || intent.consentGeneration !== consentGeneration || !sameAuth(expectedAuth)
      || expectedAuth.accountId !== intent.accountId || !isContextCurrent() || pending) return { kind: "blocked" };
    const request = { intent, auth: { ...expectedAuth }, guard: readGuard(), controller: new AbortController() };
    verification = request; // Own the read before any reentrant observer.
    continuationAuth = { ...expectedAuth };
    patchIntent(intent, { phase: "verifying", reason: null });
    notify();
    if (!verificationCurrent(request)) return { kind: "stale" };
    let orders;
    try {
      // Starts only after explicit successful reauthentication; never filtered.
      orders = await read({ token: request.auth.token, signal: request.controller.signal });
    } catch (error) {
      if (!verificationCurrent(request)) return { kind: "stale" };
      verification = null;
      if (error?.status === 200) {
        continuationAuth = null;
        patchIntent(intent, { phase: "blocked", continuation: null, reason: "malformed-verification" });
      } else if (error?.status === 401) {
        patchIntent(intent, { phase: "blocked", continuation: null, reason: "unauthenticated" });
        continuationAuth = null;
        setAuthGate(SUPPRESSED_AUTH, request.auth.accountId); // Profile's guest gate cannot reset this budget.
        expireOwnedAuth(request.auth);
      } else {
        patchIntent(intent, { phase: "verification_retry", reason: "verification-read-failed" });
      }
      notify();
      return { kind: [200, 401].includes(error?.status) ? "blocked" : "verification_retry" };
    }
    if (!verificationCurrent(request)) return { kind: "stale" };
    const matches = Array.isArray(orders) ? orders.filter((order) => order?.reference === intent.identity.reference) : [];
    const order = matches.length === 1 ? matches[0] : null;
    if (!order) {
      blockVerification(request);
      return { kind: "blocked" };
    }
    if (order.status === "refunded") {
      // D-029 separates exact-reference/status evidence from complete-card
      // correspondence. Incomplete/contradictory details require GET restoration.
      const outcome = classifyRefundResponse({ status: 200, data: { data: order } }, intent.identity);
      const state = account(intent.accountId), previous = state.records.get(intent.identity.reference);
      verification = null;
      continuationAuth = null;
      state.records.set(intent.identity.reference, Object.freeze({ ...previous,
        phase: "succeeded", continuation: null, reason: null, reportedRefunded: true,
        displayStatus: outcome.displayStatus, settledGeneration: ++state.generation }));
      notify(); // Attached Tickets readers restore complete factual state with GET.
      return { kind: "succeeded" };
    }
    // Paid authorization requires complete coherent data and every captured ID.
    if (!refundEligible(order, intent.identity) || pending) {
      blockVerification(request);
      return { kind: "blocked" };
    }
    // Consume the original authorization and replay budget synchronously BEFORE
    // dispatch acquires the global POST slot or notifies observers.
    verification = null;
    continuationAuth = null;
    patchIntent(intent, { continuation: null, replayCount: 1 });
    consent = Object.freeze({ accountId: intent.accountId, authGeneration: request.auth.generation,
      identity: intent.identity, consentGeneration: intent.consentGeneration });
    consentAuth = { ...request.auth };
    return dispatch(consent, order, 1);
  }
  function authenticationSucceeded(requestId) {
    if (recovery?.requestId === requestId && recovery.awaitingAuth) {
      const current = auth(), owner = recovery;
      if (!current || current.accountId !== owner.accountId || current.generation === owner.auth.generation
        || !isContextCurrent() || owner.consentGeneration !== consentGeneration) return Promise.resolve({ kind: "blocked" });
      owner.auth = { ...current };
      owner.awaitingAuth = false;
      setAuthGate(CLOSED_AUTH);
      return verifyRecovery(owner); // Read-only: authentication never grants POST consent.
    }
    const intent = retainedIntent(), current = auth();
    if (!intent || intent.requestId !== requestId || !current
      || account(intent.accountId).records.get(intent.identity.reference)?.phase !== "reauth"
      || current.accountId !== intent.accountId || current.generation === intent.authGeneration
      || intent.consentGeneration !== consentGeneration || !isContextCurrent()) return Promise.resolve({ kind: "blocked" });
    setAuthGate(CLOSED_AUTH);
    return verifyIntent(intent, current);
  }
  function retryVerification() {
    if (recovery) return verifyRecovery(recovery);
    const intent = retainedIntent();
    if (!intent || account(intent.accountId).records.get(intent.identity.reference)?.phase !== "verification_retry") {
      return Promise.resolve({ kind: "blocked" });
    }
    return verifyIntent(intent, continuationAuth);
  }
  function leaveContext() {
    cancelIntent();
    for (const state of accounts.values()) clearEligibility(state);
    setAuthGate(CLOSED_AUTH);
    notify();
  }
  return Object.freeze({
    createConsent, confirmationDetails, submit: (authorization, order) => dispatch(authorization, order),
    snapshot, readGuard, isReadCurrent, syncAuth,
    cancelIntent, logout, checkDeadline, leaveContext, authenticationSucceeded, retryVerification,
    checkStatus, invalidateEligibility, observeTickets,
    hasContinuation: () => Boolean(retainedIntent() || recovery),
    hasReadRecovery: () => Boolean(recovery),
    isRecovering: () => Boolean(verification?.recovery),
    isVerifying: () => Boolean(verification),
    beginExplicitAuthentication() {
      if (!retainedIntent() && !recovery) { setAuthGate(CLOSED_AUTH); notify(); }
    },
    authSnapshot,
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
