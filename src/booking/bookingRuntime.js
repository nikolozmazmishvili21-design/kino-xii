import * as bookingApi from "../api/bookingApi.js";
import { getSession, getSessionSeats } from "../api/sessionsApi.js";
import { getToken } from "../auth/tokenStorage.js";
import { me } from "../api/authApi.js";
import { bookingReducer, initialBookingState, createBookingReadScope } from "./bookingReducer.js";
import { createHoldStorage } from "./holdStorage.js";
import { selectionConfiguration } from "./seatSelection.js";
import { readBookingData } from "./useBookingReads.js";
import { HOLD_COPY, canCreateHold, eligibleAssignment, holdSelection, isHoldId, remainingHoldMs, sameAssignments } from "./holdLifecycle.js";
import { createHoldOperations } from "./holdOperations.js";

// One coordinator per BookingProvider. React observes this reducer store; identities
// and locks change synchronously, before queued renders or repeated input events.
export function createBookingRuntime(dependencies) {
  const deps = { api: bookingApi, getSession, getSessionSeats, me, getToken, storage: createHoldStorage(), now: Date.now, ...dependencies };
  const scope = createBookingReadScope();
  let state = initialBookingState(), operation = null, requestId = 0, continuation = null, bootUser = null;
  const listeners = new Set();
  const releases = new Set();
  const pendingCreates = new Map();
  const emit = (action) => {
    const next = bookingReducer(state, action);
    if (next !== state) { state = next; for (const listener of listeners) listener(); }
  };
  const patch = (changes) => emit({ type: "HOLD_TRANSITION", instanceId: state.instanceId, patch: changes });
  // A server refresh creates a new User object for the same authenticated account.
  // Keep booking ownership stable while retaining Auth's exact-snapshot guard for
  // other consumers. Guest/mutation/account changes still invalidate this scope.
  const isCurrentAccount = (expectedUser) => {
    const user = deps.getUser ? deps.getUser() : expectedUser;
    return Boolean(expectedUser && user?.id === expectedUser.id && deps.isCurrentUser(user));
  };
  const current = (request) => Boolean(request && operation === request
    && scope.active()?.instanceId === request.instanceId && state.sessionId === request.sessionId
    && isCurrentAccount(request.expectedUser) && request.token === deps.getToken()
    && request.revision === state.selectionRevision);
  const begin = (extra = {}) => {
    const active = scope.active();
    if (!active || !isCurrentAccount(active.expectedUser) || active.token !== deps.getToken() || operation) return null;
    operation = { ...active, token: deps.getToken(), revision: state.selectionRevision, requestId: ++requestId, ...extra };
    return operation;
  };
  const finish = (request) => { if (operation === request) operation = null; };

  function release(reference, token, visibleInstance = null) {
    if (!isHoldId(reference?.holdId) || !token) return Promise.resolve();
    const key = `${reference.holdId}:${requestId}`;
    if (releases.has(key)) return Promise.resolve();
    releases.add(key);
    const releaseRevision = state.selectionRevision, releaseRequestId = requestId;
    const expectedUser = scope.active()?.expectedUser;
    // Initiate now, including before logout clears auth. Completion is never authority.
    return deps.api.releaseHold(reference.holdId, { token }).catch(() => {
      if (visibleInstance !== null && state.instanceId === visibleInstance && scope.active()
        && requestId === releaseRequestId && state.selectionRevision === releaseRevision
        && isCurrentAccount(expectedUser) && token === deps.getToken()) patch({ releaseWarning: HOLD_COPY.release });
    });
  }
  function close({ abandon = true, discard = true } = {}) {
    const reference = state.hold.data ?? state.recovery?.reference ?? deps.storage.read();
    const previousReference = state.recovery?.previousReference;
    const active = scope.active();
    const validatedUser = deps.getUser?.() ?? active?.expectedUser;
    const expectedOwner = active?.expectedUser ?? continuation?.expectedUser;
    const token = validatedUser && deps.isCurrentUser(validatedUser)
      && (!expectedOwner || expectedOwner.id === validatedUser.id) ? deps.getToken() : null;
    operation = null;
    if (discard) continuation = null;
    if (abandon) deps.storage.clear();
    if (abandon && token && isHoldId(reference?.holdId)) patch({ hold: { phase: "releasing", data: null }, step: "seats" });
    scope.close();
    if (active) emit({ type: "CLOSE", instanceId: active.instanceId });
    if (abandon) void release(reference, token);
    if (abandon && previousReference?.holdId !== reference?.holdId) void release(previousReference, token);
  }
  function suspend(sessionId) {
    close({ abandon: false, discard: false });
    deps.reauthenticate(sessionId);
  }
  async function read(kind, { preserve = false, reconcile = false } = {}) {
    const request = scope.start(kind);
    const currentRead = () => scope.isCurrent(request, isCurrentAccount) && request.token === deps.getToken();
    if (!request || !currentRead()) return null;
    const { sessionId, instanceId, attempt, controller } = request;
    const identity = { kind, sessionId, instanceId, attempt, preserve };
    emit({ type: "READ_START", ...identity });
    try {
      const data = await readBookingData(kind, sessionId, { signal: controller.signal }, deps);
      if (!currentRead()) return null;
      emit({ type: "READ_SUCCESS", ...identity, data });
      if (kind === "seatMapRead") {
        const changes = { contested: [] };
        if (reconcile) {
          const config = selectionConfiguration(deps.options(), state.sessionRead.data);
          changes.selection = Object.fromEntries(Object.entries(state.selection).filter(([id, value]) => eligibleAssignment({ seatId: Number(id), ticketType: value.ticketTypeSlug }, data, config, state.hold.data)));
        }
        patch(changes);
      }
      return data;
    } catch (error) {
      if (error?.name === "AbortError" || !currentRead()) return null;
      if (error.status === 401) { continuation = null; suspend(sessionId); return null; }
      emit({ type: "READ_ERROR", ...identity, error });
      throw error;
    }
  }
  function open(sessionId, user, opener) {
    const active = scope.open(sessionId, user, opener);
    active.token = deps.getToken();
    emit({ type: "OPEN", sessionId, instanceId: active.instanceId });
    return active;
  }
  const runtime = {
    deps, scope, state: () => state, patch, current, begin, finish, read, release, suspend,
    configureDependencies(changes) { Object.assign(deps, changes); runtime.configure(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setContinuation(value) { continuation = value; },
    replaceCurrentUser(request, freshUser) {
      if (!current(request) || freshUser?.id !== request.expectedUser.id
        || typeof freshUser.profileComplete !== "boolean") return false;
      if (!deps.replaceUser(freshUser) || !current(request) || !deps.isCurrentUser(freshUser)) return false;
      // Keep continuation snapshots current without reopening the booking or
      // resetting its draft. Account ownership above does not depend on this object.
      scope.active().expectedUser = freshUser;
      request.expectedUser = freshUser;
      return true;
    },
    pendingCreates,
    async cleanupLate(hold, request) {
      if (!isHoldId(hold?.holdId)) return;
      // A backend may reuse hold IDs. Wait for newer same-account/session creates
      // before deciding whether this ID is safe to release.
      const newer = [...pendingCreates.entries()].filter(([id, entry]) => id > request.requestId
        && entry.request.sessionId === request.sessionId && entry.request.expectedUser.id === request.expectedUser.id);
      await Promise.allSettled(newer.map(([, entry]) => entry.completed));
      if (state.hold.data?.holdId === hold.holdId || state.recovery?.reference?.holdId === hold.holdId
        || state.recovery?.previousReference?.holdId === hold.holdId
        || deps.storage.read()?.holdId === hold.holdId) return;
      void release(hold, request.token);
    },
    adopt(hold, step = "checkout") {
      deps.storage.write(hold);
      patch({ hold: { phase: "active", data: hold }, step, selection: holdSelection(hold), recovery: null,
        selectionRevision: state.selectionRevision + 1, contested: [], fieldErrors: {} });
    },
    terminal(message = null) {
      deps.storage.clear();
      patch({ hold: { phase: message === HOLD_COPY.expired ? "expired" : "error", data: null }, recovery: null, step: "seats", selection: {},
        selectionRevision: state.selectionRevision + 1, feedback: message });
    },
    close,
    cancelContinuation() { close(); },
    newIntent(sessionId) {
      const reference = deps.storage.read(), expectedOwner = continuation?.expectedUser;
      continuation = null;
      // A newer explicit intent supersedes an unresolved POST and its /me
      // remediation even for the same session. Verified restoration can still
      // be shared; rejected creation must never navigate for this newer intent.
      if (scope.active() && (state.sessionId !== sessionId || pendingCreates.has(operation?.requestId))) close();
      else if (!scope.active() && reference && reference.sessionId !== sessionId) {
        deps.storage.clear();
        const validatedUser = deps.getUser?.();
        if (validatedUser && deps.isCurrentUser(validatedUser) && (!expectedOwner || expectedOwner.id === validatedUser.id)) void release(reference, deps.getToken());
      }
    },
    syncAuth(user, allowed) {
      if (!allowed) {
        if (scope.active()) close({ abandon: false, discard: false });
        return;
      }
      if (scope.active() && (!isCurrentAccount(scope.active().expectedUser) || scope.active().token !== deps.getToken())) close();
      if (bootUser === user.id) return;
      bootUser = user.id;
      if (!scope.active() && !continuation) {
        const reference = deps.storage.read();
        if (reference) {
          open(reference.sessionId, user, null);
          void runtime.restore(reference);
        }
      }
    },
    async enter(sessionId, user, opener) {
      if (scope.active()?.sessionId === sessionId && ["restoring", "active"].includes(state.hold.phase)) return;
      if (scope.active()?.sessionId === sessionId && state.recovery?.retryable) return runtime.restore(state.recovery.reference, state.recovery);
      const resume = continuation;
      continuation = null;
      if (scope.active()) close();
      const saved = deps.storage.read();
      if (saved && saved.sessionId !== sessionId) {
        deps.storage.clear();
        void release(saved, deps.getToken());
      }
      open(sessionId, user, opener);
      if (resume && resume.sessionId === sessionId && resume.expectedUser.id === user.id) {
        await runtime.resume(resume);
      } else if (saved?.sessionId === sessionId) await runtime.restore(saved);
      else await Promise.allSettled([read("sessionRead"), read("seatMapRead")]);
    },
    edit(type, values) { emit({ type, instanceId: state.instanceId, options: deps.options(), ...values }); },
    configure() {
      emit({ type: "CONFIG_CHANGED", instanceId: state.instanceId, options: deps.options() });
      if (operation && operation.revision !== state.selectionRevision) {
        const request = operation;
        operation = null;
        patch({ hold: { phase: "uncertain", data: null }, step: "seats", feedback: HOLD_COPY.uncertain,
          recovery: { retryable: false, snapshot: request.snapshot,
            reference: request.previous ? { holdId: request.previous.holdId, sessionId: request.sessionId } : null } });
      }
    },
    canNext: (replayProof = null) => !operation && canCreateHold(state, deps.options(), deps.now(), replayProof),
    back() {
      const hold = state.hold.data;
      if (!hold || state.hold.phase !== "active" || operation) return;
      if (remainingHoldMs(hold.expiresAt, deps.now()) <= 0) { runtime.expire(hold); return; }
      patch({ step: "seats", selection: holdSelection(hold), selectionRevision: state.selectionRevision + 1, feedback: null });
    },
    expire(hold) {
      if (!hold || state.hold.data !== hold || !scope.active() || !isCurrentAccount(scope.active().expectedUser)
        || scope.active().token !== deps.getToken()
        || remainingHoldMs(hold.expiresAt, deps.now()) > 0) return false;
      operation = null;
      deps.storage.clear();
      patch({ hold: { phase: "expired", data: null }, step: "seats", selection: {}, recovery: null,
        selectionRevision: state.selectionRevision + 1, feedback: HOLD_COPY.expired });
      void read("seatMapRead", { preserve: true }).catch(() => {});
      return true;
    },
    async startOver() {
      const reference = state.recovery?.reference ?? state.hold.data;
      const previousReference = state.recovery?.previousReference;
      const active = scope.active();
      if (!active || !isCurrentAccount(active.expectedUser) || active.token !== deps.getToken()) return;
      operation = null;
      continuation = null;
      deps.storage.clear();
      patch({ hold: { phase: "idle", data: null }, step: "seats", recovery: null, selection: {},
        selectionRevision: state.selectionRevision + 1, fieldErrors: {}, contested: [], feedback: null, releaseWarning: null, startedOver: true });
      void release(reference, deps.getToken(), active.instanceId);
      if (previousReference?.holdId !== reference?.holdId) void release(previousReference, deps.getToken(), active.instanceId);
      await Promise.allSettled([read("sessionRead", { preserve: true }), read("seatMapRead", { preserve: true })]);
    },
    retry(kind) {
      if (state.recovery?.retryable) return runtime.restore(state.recovery.reference, state.recovery);
      if (state.recovery) return Promise.resolve();
      if (operation) return Promise.resolve();
      return read(kind, { preserve: true, reconcile: true }).catch(() => {});
    },
    isChanged: () => Boolean(state.hold.data && !sameAssignments(state.selection, state.hold.data)),
    hasUnknownOwn: () => Boolean(state.startedOver && state.seatMapRead.data?.sections.some((section) => section.rows.some((row) => row.seats.some((seat) => seat.isMine && !state.hold.data?.seats.some((held) => held.seatId === seat.id))))),
    verifiedIds: () => state.hold.data?.seats.map((seat) => seat.seatId) ?? [],
    profileMessage: (userId) => continuation?.kind === "profile" && continuation.expectedUser.id === userId ? continuation.feedback : null,
  };
  Object.assign(runtime, createHoldOperations(runtime));
  return runtime;
}
