import { isHoldId } from "./holdLifecycle.js";

export const HOLD_STORAGE_KEY = "kino-xii.hold";
export function validHoldReference(value) {
  return value && isHoldId(value.holdId) && Number.isSafeInteger(value.sessionId) && value.sessionId > 0;
}

// Storage is optional. Never fall back to another persistence mechanism.
export function createHoldStorage(storage = () => globalThis.sessionStorage) {
  return {
    read() {
      try {
        const raw = storage().getItem(HOLD_STORAGE_KEY);
        if (raw === null) return null;
        const value = JSON.parse(raw);
        if (!validHoldReference(value)) { this.clear(); return null; }
        return { holdId: value.holdId, sessionId: value.sessionId };
      } catch { this.clear(); return null; }
    },
    write(value) {
      if (!validHoldReference(value)) return;
      try { storage().setItem(HOLD_STORAGE_KEY, JSON.stringify({ holdId: value.holdId, sessionId: value.sessionId })); } catch { /* Current-tab authority still works. */ }
    },
    clear() {
      try { storage().removeItem(HOLD_STORAGE_KEY); } catch { /* No fallback. */ }
    },
  };
}
