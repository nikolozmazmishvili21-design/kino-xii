# Kino XII — Agent Instructions

## Source of truth

Before substantial edits, inspect the relevant canonical sources in `docs/`.

Priority:

1. `docs/02_OPENAPI.json` — backend/API behavior
2. `docs/01_ASSIGNMENT_SPEC.md` — required functionality and business rules
3. `docs/03_FIGMA_REFERENCE.md` and exact Figma nodes — visual design, states, spacing and layout
4. `docs/06_DECISIONS.md` — accepted project decisions where compatible with the above
5. `docs/05_ARCHITECTURE.md` — implementation architecture

Do not invent endpoints, payloads, response fields, validation rules, business rules, Figma values or unsupported behavior.

## Technology

Use the accepted stack:

- React
- JavaScript
- Vite
- React Router
- HTML5
- CSS3
- Fetch API
- native browser APIs where appropriate

Do not introduce TypeScript unless a later accepted decision explicitly chooses it.

Use React built-in state management by default:

- local state for local UI
- `useReducer` for feature state with related transitions
- Context only for genuinely shared state

Do not add Redux, Zustand, form libraries, or other dependencies merely by preference.

## Implementation rules

Work incrementally.

Before substantial edits:

- inspect the existing implementation
- inspect the relevant Assignment requirements
- inspect the relevant OpenAPI endpoint/schema
- inspect the relevant Figma node/state when visuals matter

Preserve unrelated working code.

Keep domain behavior separate from rendering.

Use API modules for endpoint/payload/response handling.

Keep Sessions filters, sorting and pagination synchronized with URL query parameters.

Treat server-owned state as authoritative.

Do not hardcode values exposed through `/filter-options`.

Never hardcode seat layouts.

Preserve seat-map nesting:

sections -> rows -> seats

Use seat IDs in booking requests.

Use server `expiresAt` as the hold countdown source of truth.

Never simulate checkout success or construct fake Orders.

Do not persist payment-card data.

Do not log or expose authentication tokens.

Avoid `dangerouslySetInnerHTML` for ordinary API or user content.

## Async and error safety

Prevent stale reads from overwriting newer state.

Use AbortController or explicit request guards where appropriate.

Prevent duplicate mutations.

Handle relevant:

- 401
- 403
- 404
- 409
- 422
- 500
- network failures

For 422:

- `errors` -> map to relevant form fields
- message-only response -> show the server business-rule message

## Quality

Support required loading, empty, validation, unauthenticated, expired-auth, conflict and error states.

Maintain semantic HTML and keyboard usability.

Use visible focus, labels, field-error associations and accessible modal behavior.

After implementation:

- state changed files
- explain why
- run relevant checks
- mention unresolved issues

Only one agent owns implementation of the same feature at a time.
