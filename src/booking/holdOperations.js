import { selectionConfiguration } from "./seatSelection.js";
import { HOLD_COPY, eligibleAssignment, eligibleReplayAssignment, holdMatchesMap, isHoldId, mapHoldErrors, sameAssignments, snapshotSelection, usableHold } from "./holdLifecycle.js";

const terminalRead = (error) => [403, 404].includes(error?.status) || error?.terminal === true;
const invalid = (message, mismatch = false) => Object.assign(new Error(message), { terminal: !mismatch, mismatch });
const expiredHold = (hold, sessionId, now) => hold?.sessionId === sessionId
  && (hold.isLive === false || (typeof hold.expiresAt === "string" && Date.parse(hold.expiresAt) <= now));

// Imperative event-driven mutations and bounded recoveries, separated from rendering.
export function createHoldOperations(runtime) {
  const { deps, state, patch, begin, current, finish } = runtime;

  function uncertain(request, known = null) {
    if (!current(request)) return;
    // Keep only recovery evidence, never old hold/timer authority.
    const reference = isHoldId(known?.holdId) ? { holdId: known.holdId, sessionId: request.sessionId }
      : request.previous ? { holdId: request.previous.holdId, sessionId: request.sessionId } : null;
    patch({ hold: { phase: "uncertain", data: null }, step: "seats", feedback: HOLD_COPY.uncertain,
      selection: {}, recovery: { reference, snapshot: request.snapshot, retryable: false,
        previousReference: request.previous ? { holdId: request.previous.holdId, sessionId: request.sessionId } : null } });
  }
  async function restore(reference, { failureFeedback = null, step = "checkout", previous = false, fallbackSelection = {} } = {}) {
    const request = begin({ reference });
    if (!request || !reference) return;
    patch({ hold: { phase: "restoring", data: null }, step: "seats", selection: {},
      recovery: { reference, retryable: true, failureFeedback, previous, fallbackSelection, step }, feedback: failureFeedback });
    try {
      const hold = await deps.api.getHold(reference.holdId, { token: request.token });
      if (!current(request)) return;
      if (!usableHold(hold, request.sessionId, null, deps.now()) || hold.holdId !== reference.holdId) {
        const expired = expiredHold(hold, request.sessionId, deps.now());
        throw invalid(expired ? HOLD_COPY.expired : "Your saved seat hold is no longer available.");
      }
      const session = await runtime.read("sessionRead", { preserve: true });
      if (!current(request)) return;
      const map = await runtime.read("seatMapRead", { preserve: true });
      if (!current(request)) return;
      if (!usableHold(hold, request.sessionId, null, deps.now())) throw invalid(HOLD_COPY.expired);
      const config = selectionConfiguration(deps.options(), session);
      if (!config.ready || !holdMatchesMap(hold, map)
        || hold.seats.length > config.max || !hold.seats.every((seat) => config.types.some((type) => type.slug === seat.ticketType.slug))) throw invalid(HOLD_COPY.mismatch, !previous);
      runtime.adopt(hold, step);
      patch({ feedback: failureFeedback });
    } catch (error) {
      if (!current(request)) return;
      if (error.status === 401) { runtime.suspend(request.sessionId); return; }
      if (terminalRead(error)) {
        runtime.terminal(error.message === HOLD_COPY.expired ? HOLD_COPY.expired : failureFeedback ?? error.message);
        if (error.message === HOLD_COPY.expired && failureFeedback) patch({ feedback: `${failureFeedback} ${HOLD_COPY.expired}` });
        if (previous && error.message !== HOLD_COPY.expired) patch({ selection: fallbackSelection });
        finish(request);
        await Promise.allSettled([runtime.read("sessionRead", { preserve: true }), runtime.read("seatMapRead", { preserve: true, reconcile: true })]);
      } else patch({ hold: { phase: "error", data: null }, feedback: error.mismatch ? HOLD_COPY.mismatch : HOLD_COPY.restore,
        recovery: { reference, retryable: true, failureFeedback, previous, fallbackSelection, step }, selection: {} });
    } finally { finish(request); }
  }

  async function reject(request, error) {
    if (!current(request)) return;
    if (error.status === 401) {
      runtime.setContinuation(request.replayCount ? null : {
        kind: "create", sessionId: request.sessionId, snapshot: request.snapshot,
        expectedUser: request.expectedUser, replayCount: 1, previous: request.previous,
      });
      runtime.suspend(request.sessionId);
      return;
    }
    if (![403, 404, 409, 422].includes(error.status)) { uncertain(request); return; }

    const mapped = error.errors !== undefined ? mapHoldErrors(error.errors, request.snapshot) : { fields: {}, unmatched: [] };
    const codes = error.status === 409 && Array.isArray(error.contested) && error.contested.every((code) => typeof code === "string") ? error.contested : [];
    const contested = codes.filter((code) => request.snapshot.some((entry) => entry.code === code));
    const feedback = error.status === 409 ? `${error.message}${codes.length ? ` ${codes.join(", ")}` : ""}` : error.errors !== undefined
      ? ([...mapped.unmatched, ...Object.entries(mapped.fields).map(([id, message]) => `${request.snapshot.find((entry) => entry.seatId === Number(id))?.code ?? id}: ${message}`)].join(" ") || error.message)
      : error.message;
    const reconciled = Object.fromEntries(Object.entries(state().selection).filter(([id]) => !request.snapshot.some((entry) => entry.seatId === Number(id) && contested.includes(entry.code))));
    patch({ hold: { phase: "restoring", data: null }, feedback, fieldErrors: mapped.fields, contested, step: "seats", selection: reconciled });

    if (error.status === 422 && error.errors === undefined) {
      try {
        const response = await deps.me({ token: request.token });
        if (!current(request)) return;
        const freshUser = response?.data;
        const adopted = runtime.replaceCurrentUser(request, freshUser);
        if (adopted && current(request) && freshUser.profileComplete === false) {
          runtime.setContinuation({ kind: "profile", sessionId: request.sessionId, snapshot: request.snapshot,
            expectedUser: request.expectedUser, previous: request.previous, feedback });
          finish(request);
          runtime.close({ abandon: false, discard: false });
          deps.profileRequired(freshUser, request.sessionId);
          return;
        }
        if (adopted && current(request) && freshUser.profileComplete === true) runtime.setContinuation(null);
      } catch (profileError) {
        if (!current(request)) return;
        if (profileError.status === 401) { runtime.setContinuation(null); runtime.suspend(request.sessionId); return; }
        // A failed remediation read does not change the exact rejection message.
      }
    }
    if (!current(request)) return;
    if (request.previous) {
      finish(request);
      const fallbackSelection = Object.fromEntries(Object.entries(state().selection).filter(([id]) => !request.snapshot.some((entry) => entry.seatId === Number(id) && contested.includes(entry.code))));
      await restore({ holdId: request.previous.holdId, sessionId: request.sessionId }, { failureFeedback: feedback, step: "seats", previous: true, fallbackSelection });
    } else {
      const selection = Object.fromEntries(Object.entries(state().selection).filter(([id]) => !request.snapshot.some((entry) => entry.seatId === Number(id) && contested.includes(entry.code))));
      patch({ hold: { phase: "error", data: null }, selection, selectionRevision: state().selectionRevision + 1 });
      finish(request);
      await runtime.read("seatMapRead", { preserve: true, reconcile: true }).catch(() => {});
    }
  }

  async function submit({ snapshot = null, replayCount = 0, replayProof = null } = {}) {
    if (!runtime.canNext(replayProof)) return;
    if (sameAssignments(state().selection, state().hold.data)) { patch({ step: "checkout", feedback: null }); return; }
    const request = begin({ snapshot: snapshot ?? snapshotSelection(state().selection, state().seatMapRead.data), previous: state().hold.data ?? replayProof, replayCount });
    if (!request) return;
    patch({ hold: { phase: "creating", data: state().hold.data }, feedback: null, fieldErrors: {}, releaseWarning: null });
    // Do not abort POST: an aborted fetch does not prove the server cancelled it.
    const promise = deps.api.createHold(request.sessionId, request.snapshot, { token: request.token });
    let settle;
    const completed = new Promise((resolve) => { settle = resolve; });
    runtime.pendingCreates.set(request.requestId, { request, completed });
    try {
      let hold = await promise;
      if (!current(request)) { void runtime.cleanupLate(hold, request); return; }
      if (!usableHold(hold, request.sessionId, request.snapshot, deps.now())) {
        if (!isHoldId(hold?.holdId)) { uncertain(request); return; }
        const knownId = hold.holdId;
        try {
          hold = await deps.api.getHold(knownId, { token: request.token });
          if (!current(request)) { void runtime.cleanupLate(hold, request); return; }
          if (!usableHold(hold, request.sessionId, request.snapshot, deps.now()) || hold.holdId !== knownId) {
            runtime.terminal(expiredHold(hold, request.sessionId, deps.now()) ? HOLD_COPY.expired : "Your seat hold could not be verified. Please re-select your seats.");
            finish(request);
            await runtime.read("seatMapRead", { preserve: true }).catch(() => {});
            return;
          }
        } catch (error) {
          if (!current(request)) return;
          if (terminalRead(error)) {
            runtime.terminal(error.message);
            finish(request);
            await runtime.read("seatMapRead", { preserve: true }).catch(() => {});
          } else if (error.status === 401) {
            runtime.setContinuation({ kind: "restore", sessionId: request.sessionId, expectedUser: request.expectedUser,
              reference: { holdId: knownId, sessionId: request.sessionId } });
            runtime.suspend(request.sessionId);
          } else uncertain(request, { holdId: knownId });
          return;
        }
      }
      runtime.adopt(hold);
    } catch (error) { await reject(request, error); }
    finally { runtime.pendingCreates.delete(request.requestId); finish(request); settle(); }
  }

  async function resume(continuation) {
    if (continuation.kind === "restore") return restore(continuation.reference);
    const request = begin();
    if (!request) return;
    patch({ hold: { phase: "restoring", data: null }, feedback: continuation.feedback ?? null });
    try {
      await runtime.read("sessionRead", { preserve: true });
      if (!current(request)) return;
      await runtime.read("seatMapRead", { preserve: true });
      if (!current(request)) return;
      const config = selectionConfiguration(deps.options(), state().sessionRead.data);
      // Prior proof permits only the submitted IDs that are still owned in the
      // freshly authenticated map. Additional arbitrary isMine seats never qualify.
      const validEntries = continuation.snapshot.filter((entry) => eligibleReplayAssignment(entry, state().seatMapRead.data, config, continuation.previous));
      const replayValid = validEntries.length === continuation.snapshot.length && validEntries.length > 0 && validEntries.length <= config.max;
      if (continuation.kind === "create" && replayValid) {
        patch({ hold: { phase: "idle", data: null }, selection: Object.fromEntries(validEntries.map((entry) => [entry.seatId, { ticketTypeSlug: entry.ticketType }])), selectionRevision: state().selectionRevision + 1 });
        finish(request);
        await submit({ snapshot: continuation.snapshot, replayCount: 1, replayProof: continuation.previous });
        return;
      }
      let previous = null;
      if (continuation.previous) {
        const candidate = await deps.api.getHold(continuation.previous.holdId, { token: request.token });
        if (!current(request)) return;
        if (candidate?.holdId === continuation.previous.holdId && expiredHold(candidate, request.sessionId, deps.now())) {
          runtime.terminal(HOLD_COPY.expired);
          if (continuation.feedback) patch({ feedback: `${continuation.feedback} ${HOLD_COPY.expired}` });
          return;
        }
        if (candidate?.holdId === continuation.previous.holdId && usableHold(candidate, request.sessionId, null, deps.now()) && holdMatchesMap(candidate, state().seatMapRead.data)) previous = candidate;
      }
      const valid = replayValid
        && (!continuation.previous || Boolean(previous));
      const selection = Object.fromEntries(validEntries.filter((entry) => !state().seatMapRead.data || eligibleAssignment(entry, state().seatMapRead.data, config, previous)).map((entry) => [entry.seatId, { ticketTypeSlug: entry.ticketType }]));
      patch({ hold: { phase: previous ? "active" : "idle", data: previous }, selection, selectionRevision: state().selectionRevision + 1,
        feedback: continuation.feedback ?? (valid ? null : "Your seat selection changed. Check the map and continue again.") });
      if (previous) deps.storage.write(previous); else deps.storage.clear();
      finish(request);
    } catch (error) {
      if (!current(request)) return;
      if (error.status === 401) { runtime.setContinuation(null); runtime.suspend(request.sessionId); return; }
      if (continuation.previous && !terminalRead(error)) {
        const reference = { holdId: continuation.previous.holdId, sessionId: request.sessionId };
        patch({ hold: { phase: "error", data: null }, selection: {}, feedback: HOLD_COPY.restore,
          recovery: { reference, retryable: true, failureFeedback: continuation.feedback, previous: true, step: "seats" } });
      } else {
        runtime.terminal(continuation.feedback ?? error.message);
        const config = selectionConfiguration(deps.options(), state().sessionRead.data);
        const selection = Object.fromEntries(continuation.snapshot.filter((entry) => eligibleAssignment(entry, state().seatMapRead.data, config, null)).map((entry) => [entry.seatId, { ticketTypeSlug: entry.ticketType }]));
        patch({ selection });
      }
    } finally { finish(request); }
  }
  return { restore, submit, resume };
}
