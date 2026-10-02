# Kino XII — Architecture Decision Log

> This file records project-level decisions that are not simply copied from the Assignment, OpenAPI contract, or Figma.
>
> It is intentionally concise. Do not duplicate the full specification here.
>
> Status values:
>
> - `Accepted` — decision is active and should be followed
> - `Pending` — must be resolved before the relevant implementation
> - `Superseded` — replaced by a later decision
>
> When a decision changes, do not silently edit history. Add a new decision and mark the old one as superseded.

---

# Foundational decisions

## D-001 — Source-of-truth priority

**Status:** Accepted
**Date:** 2026-10-02

### Decision

When sources conflict:

1. OpenAPI governs backend/API behavior.
2. Assignment specification governs required functionality/business expectations.
3. Figma governs visual design, states, spacing, and layout.
4. Explicit project decisions apply only where they do not conflict with the above.

### Reason

This keeps implementation behavior deterministic and prevents AI agents from inventing or reconciling conflicts silently.

---

## D-002 — Frontend technology boundary

**Status:** Superseded
**Date:** 2026-10-02

### Decision

Use only:

- HTML5
- CSS3
- Vanilla JavaScript
- ES Modules
- native browser APIs
- Fetch API

Do not introduce frontend frameworks/libraries that violate the assignment.

### Reason

This is an assignment constraint and also the architectural baseline for the repository.

Superseded by D-015 after the Assignment requirement was corrected to confirm that frontend frameworks and libraries are allowed.

---

## D-003 — Implementation/review agent roles

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Default workflow:

- Codex — primary implementation agent
- Claude — independent reviewer / second opinion
- ChatGPT Project — architecture, source reconciliation, task scoping, handoff coordination

Only one agent owns implementation of the same feature at one time.

### Reason

This avoids conflicting simultaneous edits and gives each substantial feature an independent review pass.

---

## D-004 — Incremental repository growth

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Do not generate the full target folder tree as empty placeholder files.

Create modules incrementally when a real feature needs them.

### Reason

Keeps the repository small, understandable, and easier to review.

---

## D-005 — Server-controlled business values

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Do not hardcode values that the API exposes through `/filter-options` or response fields.

Examples include:

- venues
- formats
- languages
- time bands
- sort options
- ticket types
- price ratios
- age ratings
- maximum seats per order
- hold duration

### Reason

The OpenAPI contract explicitly makes the API authoritative for these values.

---

# Environment and platform decisions

## D-006 — Auth token persistence

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Persist the Bearer authentication token in `localStorage`.

Access to the stored token must be isolated behind a small token-storage abstraction, for example:

- `getToken()`
- `setToken(token)`
- `clearToken()`

Application code should not read or write the token directly throughout unrelated components.

At application startup:

1. read the stored token
2. if a token exists, call `GET /me`
3. on `200`, restore the authenticated user
4. on `401`, clear the stale token and continue as guest

### Security boundaries

Never:

- put the token in a URL
- log the token
- expose the token in UI
- persist payment-card information alongside it
- assume a stored token is valid without `GET /me`

### Reason

The application requires authentication restoration after browser refresh.

`localStorage` provides the required persistence and remains simple to isolate behind a storage abstraction.

The API remains authoritative for whether the stored token is still valid.

### Affected configuration

- authentication bootstrap
- token-storage utility
- API client authorization header
- logout/session-expiry handling
- `05_ARCHITECTURE.md`

---

## D-007 — Local development server

**Status:** Superseded
**Date:** 2026-10-02

### Decision

Use the VS Code ****Live Server**** extension by ****Ritwick Dey**** for local development.

### Reason

- serves the project over HTTP
- supports native ES Modules
- provides a simple VS Code workflow
- adds no runtime frontend framework or library
- fits the assignment's HTML/CSS/Vanilla JavaScript technology boundary

Superseded by D-016 after React was selected as the frontend technology and Vite was chosen as the React development/build tooling.

### Affected configuration

Development is started through VS Code Live Server.

---

## D-008 — Deployment platform

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use Netlify as the public deployment platform for the Kino XII React SPA.

The production deployment will use the Vite production build:

- build command: `npm run build`
- publish directory: `dist`

The repository may be connected to Netlify through GitHub for production deployments.

Deployment must preserve React Router client-side routing and support direct navigation and refresh on application routes.

### Reason

The Assignment requires a publicly accessible deployment.

Netlify supports static Vite deployments and provides explicit rewrite configuration for single-page applications using History API routing.

This allows the selected React + Vite + React Router architecture to be deployed without changing application routing behavior.

### Affected configuration

- production deployment workflow
- Netlify project configuration
- Vite production build
- SPA fallback configuration
- `README.md`
- `05_ARCHITECTURE.md`

---

## D-009 — SPA fallback strategy

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Configure Netlify SPA fallback through a root-level `netlify.toml` file.

The deployment configuration will include:

```toml
[build]

  command = "npm run build"

  publish = "dist"

[[redirects]]

  from = "/*"

  to = "/index.html"

  status = 200

```

The catch-all rule is a rewrite, not a browser redirect.

This allows direct navigation and browser refresh on React Router routes such as:

- `/sessions`
- `/movies/:slug`
- `/profile`

without Netlify returning a platform-level 404.

Existing static build assets should remain normally servable; the SPA rule must not be configured as a forced rewrite.

Application-level unknown routes remain the responsibility of the React Router Not Found route.

### Reason

React Router uses browser History API routes that do not correspond to physical HTML files on the static host.

Netlify officially supports SPA History API routing by rewriting unmatched paths to `/index.html` with HTTP status `200`.

Keeping the rule in `netlify.toml` makes the deployment behavior explicit and version-controlled.

### Affected configuration

- `netlify.toml`
- Netlify deployment
- React Router direct navigation
- browser refresh behavior
- application Not Found handling
- `README.md`
- `05_ARCHITECTURE.md`

---

## D-010 — Active hold persistence

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Persist only the minimal active-booking hold reference in `sessionStorage`.

Stored shape:

```js
{

  holdId,

  sessionId

}

```

Do not persist:

- the full seat map
- selected seat objects as authoritative state
- checkout form data
- card number
- expiry
- CVV
- the full Hold response

Access should be isolated behind a small booking/hold-storage abstraction rather than scattered direct `sessionStorage` calls.

### Restoration flow

When an active booking is restored after refresh:

1. read the stored `holdId` and `sessionId`
2. require a valid authenticated session
3. call `GET /holds/{hold}`
4. verify the server-provided hold is still live
5. use server `expiresAt` as the countdown source of truth
6. refetch the authenticated seat map
7. reconcile restored seats from server state, including `isMine`
8. clear the stored reference if the hold is expired, invalid, unavailable, released or no longer belongs to the active flow

### Cleanup

Clear the persisted hold reference after:

- successful order creation
- confirmed hold release
- hold expiry
- invalid/restoration failure
- full booking abandonment when the hold is released

Do not clear it merely because the user moves from Checkout back to Seat Selection while the same booking flow remains active.

### Reason

The requirement is to support restoration after refresh without treating browser storage as the source of truth.

`sessionStorage` survives refresh while keeping the short-lived booking reference scoped to the current browser tab/session.

The API remains authoritative for hold validity, seat ownership and expiry.

### Affected configuration

- booking state
- hold-storage utility
- booking restoration flow
- hold expiry/release cleanup
- `05_ARCHITECTURE.md`

---

## D-011 — Font loading strategy

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Load the project typography from Google Fonts as a remote web-font source.

Use:

- Archivo Regular — 400
- Archivo SemiBold — 600
- Archivo ExtraBold — 800
- Poppins Medium — 500 only where the inspected Figma node requires it

Font loading should be configured centrally in the application, preferably through the document `<head>`.

CSS should expose reusable font-family tokens, for example:

```css
--font-primary: "Archivo", sans-serif;

--font-numeric: "Poppins", sans-serif;

```

Archivo is the default application typeface.

Do not use Poppins globally. Apply it only to components whose inspected Figma typography requires it.

Include sensible `sans-serif` fallbacks.

Do not commit arbitrary font binaries to the repository.

If official project-provided font assets are discovered later, this decision may be revisited.

### Reason

The Figma Style Guide explicitly defines Archivo Regular, SemiBold and ExtraBold as the primary typography.

The verified Figma reference also identifies limited Poppins Medium usage in numeric UI.

No separate project-provided font package has been identified in the supplied resources inspected so far.

Remote loading avoids introducing unverified font binaries while preserving the required typography.

### Affected configuration

- `index.html`
- typography CSS tokens
- base typography styles
- components using Poppins
- `05_ARCHITECTURE.md`

---

# Source-conflict decisions

## D-012 — Checkout Back action

**Status:** Accepted
**Date:** 2026-10-02

### Decision

The Checkout action label is:

`Back`

When activated from Checkout, it returns the user to Seat Selection, the previous booking step.

The active live hold must not be released merely because the user goes back to Seat Selection.

The booking flow remains:

1. Seat Selection
2. Checkout

`Back` must not close the booking modal or abandon the booking flow.

### Figma note

The inspected Checkout component states confirm the Seats → Checkout step sequence.

A separate visible Back control is not present in the inspected Checkout component states, so its exact visual placement/styling must be verified against the surrounding booking-modal design during implementation.

Do not invent unrelated Figma dimensions or styling for the control.

### Reason

The Assignment explicitly requires a `Back` action that returns to the prior booking step.

Since Checkout is step 2 and Seat Selection is step 1, the prior booking step is Seat Selection.

This also preserves the live hold while the user remains inside the same active booking flow.

### Affected configuration

- booking step navigation
- Checkout actions
- hold lifecycle behavior
- booking modal UI
- `05_ARCHITECTURE.md`

---

## D-013 — Desktop reference width and responsive behavior

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use the exact inspected Figma geometry as the source of truth for desktop component sizes, spacing, alignment and composition.

The primary Figma desktop reference width is 1728px.

The Assignment's 1920×1080 reference is treated as the target display environment, not as an instruction to proportionally scale every Figma measurement.

At wider desktop viewports:

- preserve Figma component dimensions where fixed values are specified
- allow outer page/container space to grow sensibly
- center or distribute content according to the inspected Figma composition
- do not multiply Figma dimensions by a 1920/1728 scale factor
- do not stretch components merely to fill the viewport

Responsive behavior outside the supplied desktop composition should remain conservative and preserve the design intent.

Exact breakpoints or mobile/tablet layouts must not be invented unless required by the Assignment or verified from Figma.

### Reason

The Assignment identifies 1920×1080 as the target display reference, while the canonical Figma desktop screens are primarily 1728px wide.

Figma remains authoritative for visual geometry.

Treating the two values this way preserves exact design measurements without forcing artificial scaling at wider browser sizes.

### Affected configuration

- page/container layout rules
- CSS layout tokens
- responsive behavior
- screen-level CSS
- visual QA
- `05_ARCHITECTURE.md`

---

## D-014 — Recently Viewed source

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Implement `Recently viewed` as client-only browser state.

Do not invent a Recently Viewed API endpoint or backend persistence.

The feature applies to the authenticated Home state shown in Figma.

Persist only an ordered list of movie slugs in `localStorage`, scoped by authenticated user ID so one user's history is not shown to another user in the same browser.

Do not persist full Movie objects as authoritative data.

A movie should be added to Recently Viewed only after its Movie Detail data has loaded successfully.

When a movie is viewed again, move its slug to the most-recent position rather than storing a duplicate.

When rendering Recently Viewed:

1. read the current user's stored movie slugs
2. retrieve current movie data through the existing API
3. ignore/prune entries that can no longer be resolved
4. render the section according to the exact inspected Figma layout

The exact number of visible cards must be taken from the relevant Figma Home state during implementation rather than invented here.

Recently Viewed is browser-local only. It must not be presented as cross-device or server-synchronized account history.

### Storage boundaries

Store only movie slugs needed to reconstruct the list.

Do not store:

- authentication tokens inside the Recently Viewed record
- full API responses as authoritative state
- booking state
- payment information
- user profile data

Access should be isolated behind a small recently-viewed storage utility rather than scattered direct `localStorage` calls.

### Reason

Figma includes a Recently Viewed section for authenticated Home states, but the supplied Assignment does not define its persistence behavior and the OpenAPI contract exposes no dedicated Recently Viewed API.

A user-scoped client-side list preserves the Figma feature without inventing unsupported backend behavior.

Current movie information remains sourced from the API.

### Affected configuration

- authenticated Home page
- Movie Detail visit handling
- recently-viewed storage utility
- movie data retrieval
- `05_ARCHITECTURE.md`

---

# React architecture decisions

## D-015 — Frontend implementation technology

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use React with JavaScript as the frontend implementation technology.

The application stack will use:

- React
- JavaScript
- HTML5
- CSS3
- Fetch API
- native browser APIs where appropriate

Do not introduce TypeScript unless it is explicitly chosen in a later decision.

### Reason

The corrected Assignment specification explicitly allows Vanilla JavaScript as well as frontend frameworks and libraries.

React was selected for this project because the application contains substantial interactive state across authentication, routing, filtering, booking, holds, checkout, profile and modal flows.

### Affected documentation

- `01_ASSIGNMENT_SPEC.md`
- `04_MASTER_SPEC.md`
- `05_ARCHITECTURE.md`
- Project Instructions

---

## D-016 — React development and build tooling

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use Vite as the development and build tooling for the React application.

Vite will provide:

- the local development server
- React development tooling
- production build output

VS Code Live Server is no longer the project's development server.

### Reason

Vite provides a focused development/build environment for the selected React stack without requiring an additional application framework.

It keeps the tooling lightweight while supporting the SPA development workflow and production builds.

### Affected configuration

- React project scaffold
- development server workflow
- production build workflow
- `05_ARCHITECTURE.md`
- `README.md`

---

## D-017 — Client-side routing

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use React Router for client-side routing in the React SPA.

The application must support routes for at least:

- Home
- Sessions
- Movie Detail
- Profile
- Not Found

Sessions filtering, sorting and pagination state must remain synchronized with URL query parameters.

The URL is the durable source of truth for the Sessions view state.

### Reason

The application requires multiple SPA routes, route parameters, query-parameter synchronization, direct navigation, and correct browser Back/Forward behavior.

React Router provides these capabilities cleanly within the selected React architecture without requiring custom routing infrastructure.

### Affected configuration

- React project dependencies
- application router
- route definitions
- Sessions URL-state handling
- `05_ARCHITECTURE.md`

---

## D-018 — Application state management

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use React built-in state management as the default architecture:

- local component state for local UI concerns
- `useReducer` where feature state has multiple related transitions
- React Context for genuinely shared application state

Do not introduce Redux, Zustand or another external state-management library at project setup.

Shared state may include:

- authenticated user/auth status
- filter options
- pending protected action
- active booking flow

Sessions filtering, sorting and pagination must not be duplicated into unrelated global state. The URL remains the durable source of truth for the Sessions view.

Server-owned business state remains authoritative and must not be replaced by guessed client state.

### Reason

The current application requirements do not justify an additional global state-management dependency.

React built-in state, Context and feature-level reducers are sufficient while keeping the dependency surface and architecture smaller.

An external state-management library may be reconsidered later only if a concrete implementation problem justifies it.

### Affected configuration

- React application state architecture
- context/provider structure
- booking state ownership
- auth state ownership
- Sessions URL-state handling
- `05_ARCHITECTURE.md`

---

## D-019 — Form state and validation

**Status:** Accepted
**Date:** 2026-10-02

### Decision

Use React-controlled form state and project-owned validation helpers.

Do not introduce React Hook Form, Formik or another form-management library at project setup.

Forms should use:

- controlled React inputs
- local component/form state
- reusable validation functions
- validation on blur where required by the Assignment
- full validation on submit
- explicit pending/submission state
- direct mapping of backend `422 errors` to relevant fields
- server `message` handling for message-only `422` business-rule failures

Server validation remains authoritative.

### Reason

The current forms and validation requirements are manageable without an additional form-management dependency.

Keeping form state explicit makes Assignment validation timing, backend error mapping and submission behavior easier to inspect and review.

A form library may be reconsidered later only if a concrete implementation problem justifies it.

### Affected configuration

- Login form
- Registration form
- Profile form
- Checkout form
- validation utilities
- `05_ARCHITECTURE.md`

---

# Decision-log maintenance rules

When resolving a Pending decision:

1. change its status to `Accepted`
2. add the decision date
3. replace the open question with the exact chosen behavior
4. record the reason
5. mention any affected files/configuration
6. if replacing an earlier accepted decision, add a new numbered decision and mark the old one `Superseded`

Do not use this file for:

- feature requirements already present in `04_MASTER_SPEC.md`
- API schema copies
- Figma measurements
- temporary debugging notes
- TODO lists