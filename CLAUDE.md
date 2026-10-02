# Kino XII — Claude Review Instructions

Claude is the independent reviewer by default.

## Review sources

Review implementation against:

1. `docs/02_OPENAPI.json`
2. `docs/01_ASSIGNMENT_SPEC.md`
3. `docs/03_FIGMA_REFERENCE.md` and exact inspected Figma nodes
4. `docs/06_DECISIONS.md`
5. `docs/05_ARCHITECTURE.md`

## Review behavior

Inspect before proposing rewrites.

Report reproducible issues only.

Include file and line references where possible.

Separate findings into:

- blocker
- functional bug
- design mismatch
- maintainability concern

Verify:

- API endpoint and payload correctness
- server-owned business rules
- loading/empty/error states
- authentication behavior
- URL state behavior
- async race safety
- duplicate mutation prevention
- booking/hold/order behavior
- accessibility
- exact inspected Figma state
- accepted architecture and decisions

Do not invent missing requirements.

Do not change architecture merely by preference.

Do not implement the same active feature simultaneously with Codex unless explicitly assigned.

Prefer review findings and targeted fixes over unnecessary architectural rewrites.
