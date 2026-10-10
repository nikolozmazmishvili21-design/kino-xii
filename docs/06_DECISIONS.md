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

## D-020 — Accessible keyboard/input focus visibility

**Status:** Accepted
**Date:** 2026-10-03

### Decision

Keep the Figma-defined focused input border (#505261), but also keep the additional visible focus outline currently implemented for focused auth inputs.

This is an intentional accessibility deviation from the exact Figma focused-state rendering.

### Reason

The Figma focused input state uses a low-contrast border that is not sufficiently prominent as the sole focus indicator. The project accessibility requirements prioritize a clearly visible focus state.

### Important

- Do not alter the normal Figma geometry, colors, spacing, or field state styling.
- Do not add this outline to unrelated elements beyond their existing focus-visible behavior.
- This decision applies to preserving an accessible focus indicator where the exact Figma state is too subtle.

### Affected

- auth/form input focus styling
- visual QA expectations
- docs/06_DECISIONS.md

---

## D-021 — Home unresolved visual/motion source gaps

**Status:** Accepted
**Date:** 2026-10-04

### Decision

1. The Assignment requires an “animated hero experience”.

2. The canonical Figma Home/Banner nodes were inspected, including:
   - `131:4477`
   - `131:4476`
   - `137:1793`
   - `137:1840`
   - `137:1887`

   Exact prototype motion timing, autoplay interval, easing or transition behavior could not be verified from the currently available canonical Figma data.

3. Therefore:
   - do not invent hero autoplay
   - do not invent transition duration
   - do not invent easing
   - do not invent animation behavior
   - current Home implementation uses deterministic manual previous/next navigation only

4. If exact canonical Figma prototype/motion behavior becomes verifiable later:
   - update this decision
   - implement only the verified behavior

5. Home loading, empty and error states are required functionally, but exact Figma-specific visual designs for those states are not currently verified.

6. Therefore:
   - provide clear accessible loading/empty/error/retry states using the existing design system
   - do not invent exact Figma geometry/styling for states that are not present/verified
   - if exact canonical states become available later, update them accordingly

7. Movie-list responses do not provide a synopsis/premiere-copy source for the decorative/textual hero content seen in some Figma examples.
   Therefore:
   - do not hardcode Figma example movie copy
   - do not invent synopsis/premiere text
   - render only API-supported movie information

### Reason

Preserve source-of-truth discipline and avoid invented behavior or content where Assignment/Figma/OpenAPI do not provide a verifiable exact implementation.

### Affected

- Home Hero
- Home loading/empty/error states
- Home visual QA
- `docs/03_FIGMA_REFERENCE.md` only if future verified motion/state references are added
- `docs/05_ARCHITECTURE.md` only if architecture behavior later changes

---

## D-022 — Sessions UI conflict and fallback policy

**Status:** Accepted
**Date:** 2026-10-05

### Decision

The Sessions live Figma audit, independent review, and source-conflict reconciliation are complete. Apply the following accepted policies during Sessions UI implementation while preserving the completed data/URL foundation.

Source priority remains OpenAPI, Assignment, Figma, accepted decisions, then compatible explicit instructions. The fallback behaviors below are requirement-resolution decisions, not claims of additional Figma-defined behavior.

### A. Source-priority resolutions

Where Assignment and Figma disagree:

1. Use **Clear All Filters**, rather than Figma's **Clear filters**, because the Assignment explicitly names the action.
2. Render session price as `from ₾{session.price}` using the API `Session.price` value. Do not derive a separate minimum session price in the client.
3. Select the current local calendar day by default and always make the selected date visually clear. Figma's default frame without a visibly selected day does not override the Assignment.
4. Each movie group must show poster, title, age rating, genre, and starting price. Use `movie.genres` and `movie.fromPrice`. Runtime may remain visible through `runtimeMinutes`, but does not replace genre or starting price.
5. Available-session activation opens the booking / Seat Selection flow. Do not follow the newer Figma prototype destination that navigates to movie detail.
6. Source venues, formats, languages, time bands, and sorts from API/filter-options values. Do not copy placeholder labels such as `Standart` or `Englis Dub`. Use `meta.totalSessions` for **Showing X sessions**, rather than Figma's illustrative count.

### B. Movie-group metadata placement

Figma does not define placement for the Assignment-required genre and starting price.

Preserve the verified movie-group composition: 56×80 poster, title, age badge, runtime, and existing session-row geometry. Add genre and starting price inside the movie-information block.

Implementation must:

- keep the verified group/session geometry as intact as practical
- keep required movie metadata out of the session buttons
- use `movie.fromPrice` directly, without calculating another "from" value from current-page/current-date sessions
- use existing design typography/tokens for any Sessions-specific internal spacing needed by the added metadata
- visually verify the resulting composition

This placement is an accepted requirement-resolution decision, not a placement defined by Figma.

### C. Active filter counter

The inconsistent Figma example does not establish a counting algorithm.

Count active values in normalized URL state:

- each selected `venues[]`, `formats[]`, `languages[]`, and `bands[]` value contributes 1
- non-empty `search` contributes 1
- `date`, `sort`, and `page` contribute nothing

When venue reconciliation removes an invalid format from the URL, that format no longer contributes. Derive the counter from normalized URL state, not separate component state.

Examples:

| Normalized URL filters | Counter |
|---|---|
| `venues=[galleria,vake]`, `formats=[max]`, `bands=[morning]` | 4 filters active |
| `venues=[galleria]`, `search=odyssey` | 2 filters active |
| Date only | 0 filters active |

### D. Filter clearing

**Clear All Filters** clears `venues[]`, `formats[]`, `languages[]`, `bands[]`, and `search`, while preserving `date`.

Sort remains a sorting preference, is not counted as an active filter, and is preserved by clearing filters. Follow the existing URL rules: a filter change resets `page` to 1.

### E. Date-row access and overflow

The Assignment requires all next 7 days to be selectable. Verified Figma uses 37×54 Days_Small tiles, a 6px gap, and a 272px sidebar inner width. Seven tiles need 295px; Figma clips the final tile with `overflowDirection=NONE` and defines no navigation interaction.

Preserve tile size, gap, and initial visual composition. Make the date row horizontally scrollable so every required day is reachable.

- Do not resize tiles merely to fit all seven within 272px.
- A hidden scrollbar is acceptable when it preserves the composition.
- Support mouse/touch/trackpad scrolling as appropriate and keyboard access to every day.
- Scroll focused/selected off-screen items into view as needed.
- Do not invent arrows unless a later verified design requires them.

### F. Deep-linked date outside the next 7 days

Preserve the URL foundation's support for any valid explicit API date.

The date control continues to represent today through today+6 days. When a valid URL-selected date falls outside that range:

- preserve the URL/request date
- append one additional selected date item to the row
- use the same selected Days_Small visual treatment
- scroll that selected item into view

Do not silently rewrite the URL to today. The additional item makes durable URL state visible without removing the required next-seven-day set.

### G. Session-row overflow

Verified Figma uses 252×104 session-time cards with a 12px gap. Five cards exceed the movie-group width; Figma clips the fifth card and defines no horizontal-scroll interaction.

Preserve card size, gap, and verified movie-group width/composition. Make each session-time row horizontally scrollable when its sessions exceed the visible width.

- Do not shrink session controls or wrap them unless a later authoritative design requires wrapping.
- Preserve Figma appearance at the initial scroll position.
- Keep every available/sold-out session keyboard reachable; sold-out sessions remain non-selectable.
- Scroll the target control into view when it receives focus.

### H. Low-seat color

Figma demonstrates green/red availability text without an authoritative numeric low-seat threshold.

Use one normal available treatment for available sessions. Use server `isSoldOut` for the verified disabled/**Sold out** state. Do not invent a low-seat threshold.

Revisit this visual state only when a backend field or accepted rule defines low-seat behavior.

### I. Pagination window policy

Figma demonstrates previous, 1, 2, active 3, ..., 10, next, but does not define a full algorithm. Use server `meta.currentPage` and `meta.lastPage`; pagination counts films as defined by OpenAPI.

| Condition | Page-number window |
|---|---|
| `lastPage <= 1` | Do not render pagination |
| `2 <= lastPage <= 5` | Render all page numbers |
| `lastPage > 5` and `currentPage <= 3` | `1, 2, 3, ..., lastPage` |
| `lastPage > 5`, `currentPage > 3`, and `currentPage < lastPage - 2` | `1, ..., currentPage, ..., lastPage` |
| `lastPage > 5` and `currentPage >= lastPage - 2` | `1, ..., lastPage-2, lastPage-1, lastPage` |

When pagination exists, always render previous/next controls. Disable previous on page 1 and next on `lastPage`. Ellipses are display-only and non-interactive.

Automatic server-clamped page correction remains owned by the completed URL foundation.

### J. Sticky sidebar

The Assignment requires stickiness; Figma establishes initial geometry without defining sticky scrolling behavior.

On desktop, use CSS sticky positioning with a **24px top offset**. Preserve the verified 320px width and desktop geometry.

When the viewport cannot show the full sidebar, constrain it to available viewport height and allow vertical scrolling inside it. Keep every filter and the footer reachable.

Do not invent mobile/tablet breakpoints. Preserve verified Figma dimensions at the 1728px reference and the Assignment's 1920×1080 target environment instead of proportionally scaling them.

### K. Search presentation

Sessions URL/API `search` support remains part of the completed data foundation. Neither the Assignment nor the inspected Sessions Figma places a standalone search input in the Sessions body/sidebar; Navbar already contains the application's search entry point.

Do not render the temporary Sessions-body search input in the final UI. Preserve `search` support in `sessionsQuery.js` and the API contract for deep links and later global search integration.

Non-empty search contributes 1 to the active-filter counter and is cleared by **Clear All Filters**.

### L. Sort control

Use the verified collapsed Figma appearance, with values/labels from `filterOptions.sorts`.

A semantic native select is acceptable unless an exact later design requires a custom accessible menu. Do not invent an open-menu visual state, hardcode sort IDs, or introduce a frontend default sort ID. Omitted sort continues to use backend default behavior.

When `query.sort === ""`, the collapsed control displays the backend-default sort label: resolve the OpenAPI-defined default `time_asc` in `filterOptions.sorts` and render that option's API-provided `label` without hardcoding the label. If that option is unexpectedly absent, render a neutral accessible sort placeholder rather than inventing an option.

This is display-only fallback behavior that preserves the already-reviewed URL-state foundation: leave sort omitted from the URL/request and keep the canonical request string unchanged. Do not normalize omitted sort to `time_asc`, insert `sort=time_asc` into the URL or outgoing request, or duplicate the sort option list in frontend constants. The backend continues to apply its OpenAPI-defined default.

### M. Loading / empty / error states

No Sessions-specific Figma skeleton, no-results, or request-error/retry states were found. The Assignment still requires skeleton loading, **No sessions found**, and recoverable error/retry behavior.

Apply the same source-gap principle as D-021 for Home:

- build these states from the existing Kino XII design system
- make skeleton geometry mirror the verified Sessions layout
- use existing typography/colors/buttons for empty/error UI
- preserve accessibility and retry behavior
- do not claim these fallback states are Figma-defined

The existing app-level bootstrap gate prevents a Sessions-local skeleton during the earliest cold boot. This is a known separate limitation. Do not change bootstrap behavior during the first Sessions visual pass unless separately scoped.

### N. Selected session state

The legacy Sessions card has a Selected variant, but the live Sessions list uses the newer Sessions-time component. No authoritative source requires persistent selected-session state on this page.

Do not add persistent selected-session UI state. Available-session activation starts booking; sold-out sessions are disabled.

### O. Footer

Sessions and Home Figma footers match in 1728×98 geometry, separator structure, and logo/copyright composition.

A shared Footer component may be extracted when the refactor is small and preserves Home exactly. Prefer shared rendering with page-level inclusion where required. Visually check Home for regressions if extraction occurs.

Do not automatically move Footer into AppShell unless every route is verified to require it.

### P. Navbar

Verified live Sessions Navbar instance `302:23538` has `State=Unathorized`, main component `137:1978`, and component set `240:1418`.

Reuse existing Navbar/AppShell. Do not create a Sessions-specific Navbar or redesign Navbar during Sessions work. Existing auth/Navbar code retains ownership of authenticated/guest behavior.

### Q. Figma asset policy

Reuse the verified existing `chevron-down.svg` for sort.

Use CSS-native geometry for checkbox boxes/backgrounds, date tiles, pills, separators, and pagination circles.

Export/create exact project assets only where necessary for the checkbox check vector, availability ticket icon, and pagination arrow. Do not reuse `home-arrow-left.svg` for pagination or introduce arbitrary substitute icons.

### R. Responsive policy

No mobile/tablet Sessions design is verified. Follow D-013:

- use exact 1728px desktop geometry as the reference
- treat 1920×1080 as a target display environment, not a scale factor
- preserve fixed Figma component dimensions and let outer space grow sensibly
- do not invent mobile/tablet breakpoints
- prevent horizontal page overflow where practical
- use local scrolling for intentionally overflowing date/session rows

### S. Documented Figma source

For Sessions and future implementation inspection, use the editable Education duplicate:

`https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/`

Current implementation-inspection file key: `Zeb7RQ8mjGp04YIPde2ud2`.

The earlier public/view-only copy `5AncExEN8mTN1Wy02MMD6r` may remain recorded for provenance, but must not be described as the current implementation-inspection source.

### Reason

Resolve the reviewed Sessions source conflicts and undefined UI policies before implementation, while keeping API behavior, URL state, verified visuals, accessibility, and fallback decisions distinct.

### Affected

- Sessions UI implementation and visual/accessibility QA
- Sessions filter/date/sort/pagination presentation and overflow behavior
- required movie metadata and loading/empty/error rendering
- possible small shared Footer extraction with Home visual regression checks
- `docs/03_FIGMA_REFERENCE.md` source clarification

The completed Sessions data/URL foundation remains unchanged. No architecture-document update is required in this pass; update `docs/05_ARCHITECTURE.md` later only if implementation reveals a structural change needing documentation.

---

## D-023 — Movie Detail presentation and pre-booking behavior

**Status:** Accepted
**Date:** 2026-10-05

### Decision

### A. Date source and calendar range

`movie.availableDates` is the authoritative set of selectable Movie Detail dates. Do not manufacture a selectable date absent from `availableDates`.

The visual date row is calendar-based:

- start at the user's current local calendar date
- render at least today through today + 6 days
- if the latest chronological date present in `movie.availableDates` is later than today + 6, extend the horizontal calendar range through that date
- determine that date chronologically; do not rely on array position or assume `availableDates` is pre-sorted
- dates inside the rendered calendar range that are absent from `availableDates` are visible but disabled
- enabled dates are only dates present in `availableDates`

This preserves the Figma seven-date initial composition, calendar continuity, disabled empty dates, and access to valid later API dates.

The row may scroll horizontally when the calendar range exceeds the visible Figma width. Do not invent carousel arrows unless a later verified source requires them.

If API dates unexpectedly precede today, do not make past dates selectable merely because they are present. Report the backend/source inconsistency instead of silently redefining “upcoming”.

### B. Initial selected date

Initial Movie Detail selected date is:

1. today, if today exists in `movie.availableDates`
2. otherwise the first upcoming available date returned by the API
3. otherwise `null`

Do not default to an unavailable date.

Selected date is page-local state. Do not add a Movie Detail date query parameter. Refresh may recompute the initial selection from current API data.

### C. Fewer than seven / no available dates

If fewer than seven dates have sessions:

- still render the initial seven-calendar-day composition
- non-available calendar dates are disabled
- do not invent sessions for them

If `availableDates` is empty:

- no date is selected
- all displayed calendar chips are non-bookable/disabled
- show a clear design-system empty state for the Sessions area
- do not request movie-date sessions without a selected valid date merely to fabricate content

Exact empty-state styling is not Figma-defined. Use a conservative design-system fallback and do not claim it is an exact Figma state.

### D. Sessions subtitle / count

Figma example text such as `22 sessions over the next seven days` must not cause seven/multiple aggregate API reads merely to recreate the mock count. There is no aggregate Movie Detail endpoint for that value.

Use data already returned for the selected date. After a selected-date sessions response succeeds:

- sum the actual sessions in the venue groups
- display a selected-date count in the subtitle
- use grammatically correct singular/plural wording

The conceptual meaning is `N sessions on <selected date>`. The formatted date may use the project's normal locale-safe date presentation.

If no date is selected, use the no-upcoming-sessions empty state instead of an invented aggregate count.

The response-derived count is presentation only and does not become durable state.

### E. Genre placement

The Assignment requires genre on Movie Detail, but the audited base Figma frame does not show a dedicated genre field.

Add `GENRES` to the Movie Detail Details sidebar. Render API `movie.genres[].name` values using the existing Details label/value typography. Join names for presentation only; do not hardcode genre names.

Do not move/remove verified Figma hero metadata merely to make room.

This is an intentional Assignment-over-Figma addition and must be reported as such in visual QA.

### F. Sold-out Movie Detail session control

The base Movie Detail Figma ticket component has no verified disabled variant. The Assignment still requires sold-out sessions to remain visible and disabled.

Therefore:

- preserve the verified 207×81 Movie Detail ticket geometry
- use a real disabled button
- replace availability text with `Sold out`
- use a conservative existing design-system disabled treatment such as reduced opacity while preserving legibility
- do not copy Sessions-page geometry
- do not claim the fallback disabled appearance is Figma-defined

`session.isSoldOut` remains authoritative. Do not derive sold-out status from `seatsLeft`.

### G. Age restriction presentation

For authenticated users, use API-provided `user.age` and compare it against `movie.ageRating.minAge`. Never calculate replacement age from date of birth.

If the authenticated user is below the minimum age:

- Movie Detail session booking controls are disabled
- show the Assignment-required age-denial message near the Sessions/action area
- wording follows the movie's actual rating code, for example: `This film is rated 18+. You cannot buy tickets for it with this account.`
- the message must remain perceivable independently of disabled controls
- session controls should be accessibly associated with the restriction message where practical

Do not treat a nullable age on an incomplete profile as age zero. Profile completeness is handled by the protected-action rule below.

### H. Profile completion before booking replay

A booking action is a protected action. The bounded pending descriptor is conceptually:

```js
{
  type: "OPEN_BOOKING",
  payload: {
    sessionId
  }
}
```

Do not persist full Movie or Session objects as the pending action.

For a guest:

1. store the bounded session action
2. authenticate
3. if the returned user has `profileComplete === false`, require profile completion
4. only after a complete profile is confirmed from the API, replay the booking action once
5. clear pending state appropriately

For an already-authenticated user with incomplete profile:

- preserve the same booking action
- require profile completion before opening Seat Selection
- replay once after the API confirms `profileComplete`

The user must not have to click the original session twice. Do not open Seat Selection first and postpone profile completion until hold creation.

This project chooses profile completion **before booking-flow entry** for protected booking actions. This is stricter in UX than the backend's hold-time enforcement but remains compatible with the Assignment and API.

Use server-returned `profileComplete`; do not force it locally.

### I. Compact language / format labels

Movie Detail ticket controls must use API-provided `format.name` and `language.name`.

Do not invent abbreviations from IDs, slugs, or language codes. Do not use undocumented `language.code` as the primary UI value.

Preserve full authoritative values in the accessible name.

Within the fixed 207×81 Figma geometry:

- first try the verified typography/layout
- if an unusually long authoritative value cannot fit safely, visual truncation/ellipsis is allowed as a presentation fallback
- the full value must remain available to assistive technology
- do not silently substitute another label

Do not reduce core typography arbitrarily merely to force text to fit.

### J. Movie Detail → booking integration boundary

Movie Detail session activation ultimately opens the shared Seat Selection overlay. Booking is not a route. Do not invent `/booking` or `/sessions/:id/book`.

The durable integration identifier is `sessionId`. The later shared booking entry should conceptually consume `openBooking(sessionId)`.

The Movie Detail implementation pass may create a clean callback/integration seam for this action. Seat Selection itself remains the next implementation phase.

Until a real booking consumer exists:

- do not create fake modal content
- do not navigate to Movie Detail again
- do not simulate booking success
- do not claim booking integration is complete

Any temporarily unconnected session activation must be explicitly reported as a known deferred integration in the Movie Detail checkpoint, exactly as the existing Sessions-page booking boundary was reported.

The next Seat Selection/Booking checkpoint must replace that deferred boundary with real behavior.

### K. Coming Soon direct detail

A direct `/movies/:slug` navigation to a Coming Soon movie may render its Movie Detail metadata.

If `isComingSoon === true` and/or `availableDates` is empty:

- no booking date/session action is enabled
- do not enter Seat Selection
- render the Sessions area as a no-upcoming-sessions / unavailable-for-booking state

Do not invent Movie Detail notification behavior in this scope. `Notify Me` remains a separate feature unless a later scoped implementation verifies and wires the relevant API/Figma behavior. Do not invent notification persistence.

### L. Movie Detail session grouping

`GET /movies/{movie}/sessions?date=...` returns venue groups.

Inside each venue:

- group sessions by `session.hall.id` for presentation
- preserve server session order unless a confirmed source says otherwise
- use `hall.name`
- do not invent a nested halls API shape
- do not flatten all venue/hall meaning away

Use `session.time` for displayed showtime, `session.price` directly, `session.format.name`, `session.language.name`, `session.seatsLeft`, and `session.isSoldOut`.

Do not add format uplift again.

### M. Local state / async policy

Movie Detail owns selected date locally. Do not copy Sessions URL-query architecture into Movie Detail.

Reads for `GET /movies/{slug}` and `GET /movies/{slug}/sessions?date=...` must use:

- AbortController where practical
- explicit current-request protection where needed
- silent abort handling
- retry against current slug/date
- no stale response overwrite

Changing date must not erase the already loaded movie metadata.

### N. Recently Viewed writer boundary

Preserve accepted D-014. After Movie Detail loads successfully:

- for an authenticated user, record only the movie slug in the user-scoped Recently Viewed storage
- failed/404 loads are not recorded
- repeated view moves the slug to the most-recent position
- no Movie object is persisted

The Home Recently Viewed consumer remains a separate missing integration unless deliberately scoped later. Do not expand the Movie Detail implementation into a Home redesign.

### Reason

Resolve the audited Movie Detail policy gaps before implementation while preserving API authority, Assignment requirements, verified Figma presentation, and explicit fallback/deferred integration boundaries.

### Affected

- Movie Detail presentation, local date selection, session reads, and visual/accessibility QA
- later shared protected booking entry and profile-completion replay
- Movie Detail Recently Viewed writer
- Buy-ticket navigation references in `docs/03_FIGMA_REFERENCE.md`

This decision does not implement Movie Detail or the later booking flow, and does not expand scope into Profile UI, Home Recently Viewed rendering, or Notify Me.

---

## D-024 — Seat Selection presentation, pre-hold behavior, and staged booking entry

**Status:** Accepted
**Date:** 2026-10-05

### Decision

The following policies resolve the Seat Selection audit gaps and approve separate implementation checkpoints. They preserve D-010 hold persistence, D-012 Checkout Back/live-hold behavior, D-013 desktop behavior, D-023 protected booking/profile entry, and the accepted booking state architecture.

### A. API seat map is the only hall geometry source

Render `sections[] → rows[] → seats[]` from `GET /sessions/{session}/seats`. Do not flatten sections or hardcode rows, seat counts, letters, aisle positions, section widths, or hall shapes.

Use:

- `seat.id` for selection/request identity
- `seat.code` for summaries
- `seat.label` for the visible seat number
- `seat.state` for server availability
- `seat.aisleAfter` for a visual gap to the right
- `seat.isMine` for own-hold recognition

Unavailable seats preserve their spatial slot but render no interactive seat button.

### B. Seat state → visual / interaction mapping

| Condition | Visual | Interaction |
| --- | --- | --- |
| Available and not locally selected | Figma Default | Selectable below the configured selection cap |
| Locally selected | Figma Selected | Deselectable |
| Sold | Figma Disabled | Disabled |
| Held by another user | Figma Held | Disabled |
| Unavailable | No seat control | Spatial gap only |
| `isMine` | Own-held/Selected presentation | Requires verified restoration context for active selection; see §C |

Interpret `isMine` separately from `state`. Do not assume an own-held seat always has a particular state enum value.

### C. Own-hold without verified restoration context

`isMine` alone does not provide a hold ID, ticket type, or authoritative held-seat price.

Visually distinguish the seat as owned/Selected, but do not guess Adult, automatically add it to the local selected-seat summary/subtotal, or treat it as a fresh available seat.

Only hydrate own-held seats into active booking selection after the complete accepted D-010 restoration flow succeeds. All of the following are required, not independent alternatives:

1. find the persisted `{ holdId, sessionId }`
2. require valid/restored authentication
3. successfully call `GET /holds/{hold}`
4. verify the returned hold is live
5. obtain ticket assignments and prices from the returned hold
6. refetch the authenticated seat map
7. reconcile `isMine` seats against that verified hold

Only after this full flow may own-held seats enter active booking selection. `isMine` alone is not enough.

If an own-held seat appears without recoverable hold context, keep it non-editable in the current local selection flow rather than inventing missing booking data. Do not invent a hold-discovery endpoint.

If a later hold mutation for the same session replaces an older user hold, the subsequent server response/refetch is authoritative. The UI must not visually promise that an unrecoverable old own-held seat remains reserved.

### D. Seat typography

Use the Seat component-set canonical seat-number typography, Archivo 18 / 800, for normal seat controls.

Some Figma map instances override numbers to 14px. Treat those overrides as mock inconsistency, not a state/business rule. Do not vary number typography by seat state unless a verified component variant requires it.

### E. Map slot / aisle geometry

Preserve the verified geometry:

- seat slot/control: 52×52
- seat radius: 10
- ordinary horizontal gap: 8
- row vertical gap: 10
- aisle spacer: 16px, inserted after the seat whose `aisleAfter` is true

Do not shrink seats or normal gaps to force a real hall into the 720px sample width. Row labels remain separate from seat slots.

### F. Dynamic map overflow

Figma samples do not represent all production hall shapes. The verified desktop Seat Selection map column remains 720px wide, even when real API rows are wider.

Preserve real seat geometry and center a row within the map canvas when it fits. Row content may use a wider internal canvas, but its viewport remains 720px. Wide canvases scroll horizontally inside that map column so right-side seats remain reachable.

Do not expand the 1146px primary desktop dialog merely to fit a wider hall row. Do not shrink seats or proportionally scale them down.

Use a deliberate vertical scroll region for seat-map content when multiple API sections exceed the sample allocation, so every section heading, row, seat, and legend remains reachable.

Keep progress and the summary/sidebar outside the seat-map content scroll where the desktop viewport permits. For a shorter desktop viewport, the booking dialog itself may become vertically scrollable so no control becomes unreachable.

Do not invent mobile/tablet breakpoints.

### G. Screen / section / legend dynamic behavior

Preserve the verified screen-bar design. Render API section names in API order; headings must be API-derived.

Do not reuse mock text such as `STALLS · ROWS A-E` when it does not match actual data. If a useful row-range label is shown, derive it from the actual first/last API row labels without implying missing intermediate letters.

Keep the legend available after/alongside map content according to the approved scroll layout.

### H. Pre-hold timer

Local seat selection does not reserve seats. A real hold is created only after the hold endpoint succeeds.

While no real live SeatHold exists:

- do not show `SEATS HELD`
- do not show a countdown
- do not start a local timer
- do not show placeholder hold time
- omit the hold timer card from the pre-hold Seat Selection header

After a successful real hold exists in the later hold/Checkout checkpoint, render the hold card and derive its countdown from server `expiresAt`. Never treat a fixed 8-minute local decrement as authoritative.

Figma's pre-hold `SEATS HELD / 7:48` example is intentionally not implemented literally because it contradicts the real hold lifecycle. This resolves the conflict in favor of OpenAPI/Assignment over Figma.

### I. Maximum seat interaction

The cap comes only from `filterOptions.maxSeatsPerOrder`; do not hardcode 3.

Selected seats remain deselectable at the cap. Other server-available seats remain visually in their normal available state.

When the user attempts to add another seat after reaching the cap, leave selection unchanged and show accessible inline/status feedback with dynamic copy:

`You can select up to {maxSeatsPerOrder} seats.`

Clear or update stale max-seat feedback when selection changes. Do not disable already-selected seats or turn server-available seats into fake sold/held states.

### J. Ticket types

Ticket types come only from `filterOptions.ticketTypes`. Do not hardcode Adult, Child, Student, their ratios, or restrictions.

Identify the default Adult type by the API-defined `adult` slug. A newly selected seat defaults to that returned Adult record.

Changing ticket type is local-only until hold creation. Deselecting a seat removes its ticket-type assignment.

For each ticket type:

- if `ticketType.blockedFromRatingAge` is null, the type is not blocked by this rule
- if it is non-null, block/omit the type when `movie.ageRating.minAge >= ticketType.blockedFromRatingAge`

Use server values only. Do not hardcode 16 or special-case Child by name when the API rule already provides the restriction.

Do not invent additional Student validation fields. The API-provided note may be presented where the design supports it.

### K. Client price preview / rounding

Before a real hold exists, prices are client-side previews only.

For each selected seat:

`rawPreview = session.price × ticketType.priceRatio`

Convert each per-seat preview to normal GEL currency precision:

- round the per-seat preview to 2 decimal places
- do not use integer-only rounding
- calculate subtotal as the sum of those rounded per-seat preview values
- present trailing decimals only when needed by the existing currency presentation style

Do not add format uplift again.

After successful hold creation in the later checkpoint, `SeatHold.seats[].price` and `SeatHold.subtotal` become authoritative. If returned values differ from the pre-hold preview, render server values rather than preserving the client preview.

Client preview must never override server hold/order totals.

### L. Figma selected-seat sample values are not business rules

The inspected selected Figma state shows exactly three selected seats, Adult on each card, ₾16 per card, and subtotal ₾32. The subtotal is inconsistent with the visible cards.

Do not reproduce the mock subtotal, infer a fixed three-seat requirement, or infer Adult-only selection. Derive selection, ticket types, and preview subtotal from API/configuration/local state. `maxSeatsPerOrder` controls the cap.

### M. Summary sidebar

Use selected-seat cards. Each selected seat shows its code, calculated preview price, remove action, and ticket-type selector.

Ticket-type labels and ratios are API-driven. The verified selected-state order may be preserved visually where compatible, but do not hardcode type count or names. Omit blocked types.

Interpolate the actual configured maximum in the summary heading and helper copy. The verified Seat Selection summary uses `SUBTOTAL`; do not invent a separate fee/total row in this step.

### N. Booking close control

No close control was verified inside the inspected Seat Selection Figma component. The project modal architecture requires a reliable explicit close path where the composed booking dialog provides one, alongside Escape/backdrop behavior as permitted.

Kino XII chooses a top-right booking close control in the dialog header using the existing project modal/close-control visual language. This is an accepted project UI decision, not a claimed Figma fact or a general Assignment mandate for a visible close control on Seat Selection itself.

Before a real hold exists, closing through the close control, Escape, or allowed backdrop click may abort active reads, clear local Seat Selection state, and close the overlay. No release request is required because no hold exists.

After a real hold exists, use accepted hold-release/abandonment rules. Do not reuse pre-hold close behavior after a live hold is created. Preserve D-012: Checkout Back stays in the active flow and does not release its live hold.

### O. Loading / error fallbacks

No exact Seat Selection loading/error Figma variant is verified. Use conservative design-system fallback states; do not draw a fake seat grid while the real map is unknown.

Required states include session-context loading, seat-map loading, terminal 404, network/server error, Retry, and runtime auth-expiry handoff.

Keep loading/error UI within the dialog with accessible status/error announcements. Retry uses the current session ID. Aborts from close/session replacement are silent.

### P. Booking entry contract

Both existing entry surfaces converge on `openBooking(sessionId)`. Current Movie Detail and Sessions callbacks may adapt to that contract.

Do not duplicate authentication/profile logic per page or create a booking route. Booking remains an overlay/state flow.

The bounded protected-action descriptor remains:

```js
{
  type: "OPEN_BOOKING",
  payload: {
    sessionId
  }
}
```

Do not persist full Movie or Session objects in the pending action.

### Q. Protected-action / profile sequencing

D-023 remains authoritative. For a guest booking action:

1. preserve bounded `OPEN_BOOKING(sessionId)`
2. authenticate
3. inspect server-returned `profileComplete`
4. if incomplete, require real Profile completion
5. after API-confirmed complete profile, replay booking once
6. clear pending action safely

For an already authenticated incomplete-profile user, preserve the same action, require Profile completion, and replay once after API confirmation.

Do not open Seat Selection before profile completion. The current placeholder Profile page cannot satisfy this flow.

### R. Implementation checkpoint sequence

Approve the following separate checkpoints:

**CHECKPOINT A — Protected-action/shared booking-entry infrastructure**

Scope:

- shared `openBooking(sessionId)` entry
- bounded pending action
- auth handoff
- replay-once guards
- cancellation/cleanup
- current-user replacement support needed for future profile completion

Do not claim incomplete-profile booking is complete in A.

**CHECKPOINT PROFILE — Real Profile completion UI/API integration**

Save the confirmed profile fields, use the returned server User, update AuthProvider's user, expose API-confirmed `profileComplete`, and allow the pending `OPEN_BOOKING` action to replay once.

**CHECKPOINT B — Seat Selection foundation**

Scope:

- booking overlay/dialog
- GET session context
- GET seat map
- BookingProvider/reducer
- dynamic seat map
- local selection
- API-driven ticket types
- client preview summary
- accessibility
- loading/error states
- both booking-entry consumers

No hold mutation yet.

**CHECKPOINT HOLD — Real hold creation and conflict/restoration behavior**

Scope:

- POST hold
- pending guard
- 409 reconciliation
- 422 business/validation handling
- minimal hold storage
- `expiresAt` timer
- restoration
- release/abandonment rules
- transition into Checkout

**CHECKOUT remains its own subsequent feature checkpoint.** Do not merge these into one giant commit.

### S. Intermediate Checkpoint B — Next button

Assignment requires `Next: Checkout` to create a real hold and proceed only after successful hold creation.

Checkpoint B must not expose an enabled control that appears to perform this transition while hold creation is unimplemented.

During Checkpoint B only:

- render the verified `Next: Checkout` control
- keep it natively disabled even when local selection is otherwise valid
- document this as an intermediate implementation limitation
- do not add a fake click handler
- do not navigate to Checkout
- do not simulate a hold
- do not start a timer

The HOLD checkpoint replaces this temporary disabled boundary with real enabled behavior when all normal prerequisites are satisfied.

This is not the final feature behavior. List it as deferred in Checkpoint B review/QA.

### T. Booking state ownership

Introduce BookingProvider/reducer when shared active booking state begins. BookingProvider owns current booking session ID/context, seat map/read state, selected seats, ticket assignments, booking step, and later hold/order state.

Pending protected-action state remains separate from selected-seat booking state.

Do not store authoritative seat selection in localStorage/sessionStorage. Only the later accepted minimal hold reference may be persisted, preserving D-010.

### U. Async safety

Booking/session/map reads must guard open session A → close → open session B, repeated same-session opens, stale responses arriving after close, and auth handoff/replay.

Use AbortController where practical plus explicit request/version identity where needed. Closing the pre-hold modal aborts/obsoletes reads. No stale response may reopen or overwrite current booking state.

### V. Accessibility

Seat Selection must support:

- accessible dialog title/description association
- focus containment
- Escape behavior
- focus restoration to the original session trigger
- native seat buttons
- `aria-pressed` or equivalent selected semantics
- meaningful seat accessible names including code/state/context
- native disabled behavior for sold/held seats
- non-color distinction between Held and Sold
- unavailable gaps excluded from tab order
- labeled ticket-type groups per seat
- labeled remove controls
- accessible max-seat feedback
- accessible subtotal updates
- loading/error announcements
- disabled Next semantics during Checkpoint B

Do not make seat state understandable by color alone.

### Reason

Resolve the correctness-affecting Seat Selection policies before coding, preserve API authority over hall geometry and live booking state, and make the temporary implementation boundary explicit without simulating reservations or Checkout.

### Affected

- later shared protected booking entry and Profile-completion replay
- later Seat Selection rendering, selection, preview pricing, and accessibility/visual QA
- later hold/Checkout lifecycle integration
- Seat Selection references in `docs/03_FIGMA_REFERENCE.md`

This decision documents policy only; it does not implement booking entry, Profile, Seat Selection, holds, or Checkout, and does not modify architecture.

---

## D-025 — Profile completion, validation, and protected reauthentication

**Status:** Accepted
**Date:** 2026-10-05

### Decision

Approve the following CHECKPOINT PROFILE policies. Preserve D-019 form/validation architecture, D-023 protected booking/profile sequencing, D-024 staged checkpoints, and Checkpoint A's single pending/READY action semantics. Server-returned User remains authoritative.

### A. Profile Personal Information field set

Implement only the five fields verified in the Personal Information design:

| Field | Editing / completion policy |
|---|---|
| Full Name | Editable; required by `PUT /profile` and for profile completion |
| Email | Visible, read-only and programmatically immutable; omitted from the payload |
| Mobile Number | Editable; required by `PUT /profile` and for profile completion |
| Date of Birth | Editable; required by `PUT /profile` and for profile completion |
| Preferred Venue (Optional) | Editable within §H–I; optional; not a completion requirement |

Email helper: `Set at registration and cannot be changed`.

Do not add Username to the form: `PUT /profile` does not support updating it. Do not add fields merely because they exist on User.

### B. Avatar is deferred from Profile UI

`PUT /profile` supports optional avatar upload, but the inspected Personal Information frame contains no upload control, the Assignment Profile form does not establish avatar-edit UI, and removal semantics are undefined.

CHECKPOINT PROFILE exposes no avatar upload, replacement, or removal and appends no avatar field to FormData. The returned avatar remains authoritative and continues rendering through existing authenticated identity/Navbar UI. Do not invent delete/remove semantics. A future avatar-edit feature requires its own verified presentation/behavior scope.

### C. Profile completeness

Use only returned `user.profileComplete`; do not derive completeness from the local draft. Booking requires server-confirmed complete profile.

API completion requires `fullName`, `mobileNumber`, and `dateOfBirth`. Preferred venue and avatar do not control completeness. A locally valid form is not a complete profile until `PUT /profile` succeeds and returned User confirms it.

### D. API-derived age

Use only returned `user.age` as account age for booking eligibility. Do not calculate replacement age from `dateOfBirth`.

Client DOB calculations are allowed only for the confirmed Profile validation boundary requiring DOB to be at least 12 years ago. After save, render returned age and `profileComplete`; independently override neither.

### E. Date of Birth control

Use native semantic `<input type="date">`. Style its visible shell to match verified Profile input geometry and use the verified calendar visual where compatible. Do not build a custom calendar/date-picker.

Client validation may mirror required, valid date, not in the future, and at least 12 years old. Use local calendar-date arithmetic for the 12-year boundary. This is Profile-form UX validation only, never authoritative account age.

### F. Mobile Number input / normalization

Use no masking library or country-code UI. Ordinary spaces are allowed, for example `599 123 456`; preserve the visible draft as typed during editing.

For client validation and submission, remove ordinary spaces from a normalized copy, validate that copy, and submit the normalized 9-digit value. Do not invent hyphen or prefix normalization. After success, reset the draft/baseline from returned User and display server-returned `mobileNumber`.

Client validation precedence:

1. Empty after normalization: `Mobile number is required`.
2. Non-digit characters after allowed spaces are removed: `Please enter a valid Georgian mobile number (9 digits starting with 5)`.
3. Does not start with 5: `Georgian mobile numbers must start with 5`.
4. Length is not exactly 9: `Mobile number must be exactly 9 digits`.

Server 422 field messages remain authoritative after submission.

### G. Confirmed Profile validation

Mirror only confirmed Assignment/OpenAPI rules:

| Field / failure | Exact client message |
|---|---|
| Full Name empty | `Name is required` |
| Full Name fewer than 3 characters | `Name must be at least 3 characters` |
| Full Name more than 50 characters | `Name must not exceed 50 characters` |
| Mobile Number | Apply §F precedence and messages |
| DOB empty | `Date of birth is required` |
| DOB invalid/future | `Please enter a valid date of birth` |
| DOB under 12 | `You must be at least 12 years old to create an account` |

Show confirmed field validation feedback on blur. While editing, current client validation controls Save enablement under §N. Run full validation again on submit as a safety net; if it fails despite the button previously being eligible, block the request, expose field errors, and focus the first invalid field. Clear stale server field errors when their associated values change. Invent no additional business validation.

Map server 422 `errors[field]` arrays directly to the relevant fields, including `preferredVenueId` errors on the Preferred Venue control. Focus the first field with a returned error when practical; keep server strings authoritative. Message-only failures render the returned server message.

### H. Preferred Venue source

Options come only from `filterOptions.venues`; never hardcode venues. Initialize from `user.preferredVenue?.id`. Submit a selected venue's API integer ID as `preferredVenueId`, not its slug, Venue object, or display name.

### I. Preferred Venue null / clearing boundary

OpenAPI makes `preferredVenueId` optional and nullable, but does not define multipart encoding to explicitly clear an existing non-null preference. Do not invent literal `"null"` or blank-string backend semantics.

Accepted behavior:

- Server preference null: show an empty/placeholder choice; it may remain empty, with `preferredVenueId` omitted from FormData. The user may select a venue and return the unsaved draft to empty while the authoritative baseline remains null.
- Server preference non-null: preselect it; allow keeping it or replacing it with another API venue. Expose no action to clear that existing preference in this checkpoint.

Document this limitation in implementation QA. A future clear-preference action requires verified backend null encoding.

### J. Profile status banner — source resolution

OpenAPI explicitly requires `profileComplete` to drive a Profile-page banner; the inspected Personal Information frame visibly omits one. Resolve behavior as OpenAPI over Figma omission.

Place the banner in Personal Information between the tabs/divider and form, aligned to the verified 880px form column. Shift the form downward; do not overlay controls. This page placement is accepted project UI policy, not a Figma fact.

Reuse verified Profile-menu status visual language:

- Incomplete: orange/warning treatment; `#E27E04` at 10% background treatment; radius 10; title `Profile incomplete`; Profile-page supporting copy `Please complete your profile to enable booking.`
- Complete: green/success treatment; `#4ADE80` at 10% background treatment; radius 10; title `Profile Complete`; verified check-icon treatment where reusable.

For complete status, the visible title remains `Profile Complete`, available as accessible text. The verified check icon may provide the visual ✓ treatment, but accessibility must not depend on the icon alone. Hide decorative check icons from assistive technology unless they add a distinct accessible label.

The final period is required for the Profile-page incomplete supporting copy. The verified account-menu wording may remain unchanged. Do not change the existing account-menu status component merely to implement the page banner.

### K. Eligibility / age copy

Use server-returned age only. Use `filterOptions.ageRatings` only to determine whether that age meets every configured rating minimum.

For `profileComplete === true`, a valid returned numeric age, and age at least the maximum `ageRatings[].minAge`, render:

`You are {age}, you can buy tickets for all age ratings.`

This generalizes the OpenAPI example. Make the all-ratings claim only when API-provided thresholds support it.

Otherwise, for a complete profile with returned numeric age, render conservative project copy:

`Age on your account: {age}. Film age restrictions are applied when booking.`

For null age, invent no value and omit age-specific eligibility copy.

### L. Profile form payload

`PUT /profile` uses multipart/form-data. Let browser/fetch set the multipart Content-Type and boundary automatically; set neither manually.

Required FormData entries: `fullName`, `mobileNumber`, `dateOfBirth`. Append `preferredVenueId` only for a concrete selected ID under §I.

Do not append `email`, `username`, `avatar`, `profileComplete`, or `age` in this checkpoint.

### M. Form initialization / source of truth

Initialize from current AuthProvider User, mapping nullable fields to safe empty form values. Track a local draft and saved baseline; create no second authoritative Profile store.

After success:

1. Use returned User and call `replaceUser(returnedUser)`.
2. Require replacement to be accepted before reporting success.
3. Reset local baseline/draft from returned User.
4. Render returned `profileComplete` and age.

Never optimistically mutate current User.

### N. Save button / success behavior

Save Changes must be disabled when any of these is true: the form has no unsaved changes, current client-side form validation fails, or a Profile save mutation is pending. Enable Save only when the draft is dirty AND valid AND no save request is pending. This is an Assignment requirement.

Run full submit-time validation as a safety net before building or sending FormData. If validation fails because state changed between enablement and submit, block the request, expose field errors, and focus the first invalid field.

Prevent redundant saves and permit only one active PUT at a time. While PUT is pending, disable Save, expose loading/pending state, and prevent duplicate submission. On accepted successful save, announce `Profile saved successfully.` through accessible status feedback.

Remain on `/profile` after a normal save; do not navigate Home on success.

### O. Booking-driven Profile completion

D-023 and Checkpoint A remain authoritative. On successful PUT with pending `OPEN_BOOKING`, use returned User, call `replaceUser(returnedUser)`, and inspect returned `profileComplete`.

- True: Checkpoint A moves the same pending action to READY exactly once, without a second session click. Profile must neither call `openBooking` again nor consume READY itself.
- False: remain on Profile, preserve pending `OPEN_BOOKING`, and produce no READY.

CHECKPOINT PROFILE has no Seat Selection consumer. After reaching READY, remain on Profile; show no fake Seat Selection or booking route, claim no hold, and show no timer. Document this intermediate limitation. CHECKPOINT B later consumes READY automatically.

### P. Normal Profile editing

Already-complete users use the same form and PUT endpoint. Every successful save uses authoritative returned User: `profileComplete` may be true or false, age and preferred venue may change, and Navbar/account-menu state updates accordingly. Do not assume completeness only moves false → true.

Editing with no pending booking updates User without creating booking intent or navigating into booking flow.

### Q. Direct /profile access

`/profile` is authenticated-only. A guest direct visit must not render editable Profile data and must open the existing Login flow. Preserve `/profile` as the protected destination in transient in-memory coordination across Login ↔ Sign Up switching.

This Profile-access continuation is separate from bounded `OPEN_BOOKING`. Create no fake booking action, place no token/action in the URL, and do not persist the continuation.

After successful Login or Sign Up, remain/navigate to `/profile` and initialize from returned authenticated User. A newly registered incomplete user can then complete Profile.

On cancellation of the entire auth flow, clear the transient continuation and navigate Home `/`.

Returning Home on cancellation is an accepted Kino XII project navigation policy, not an OpenAPI, Assignment, or Figma-defined destination.

### R. PUT /profile 401 reauthentication

A Profile-save 401 means expired/revoked auth. Do not automatically retry PUT, fabricate a booking session ID, call logout POST for expiry, or add a speculative global 401 interceptor.

For a current save receiving 401:

1. Invalidate only stale auth using expected-auth/request guards.
2. Preserve the Profile draft in memory.
3. Open the existing Login flow.

If `OPEN_BOOKING` is already pending, preserve its descriptor and use existing booking-aware reauthentication coordination where appropriate. Without pending booking, use the transient Profile reauthentication continuation.

After successful reauthentication:

- Same user ID: retain the unsaved draft, remain on `/profile`, do not replay PUT, and announce `Session restored. Review your changes and save again.`
- Different user ID: immediately discard the previous user's draft and initialize from newly authenticated User. Never expose the prior user's full-name/mobile/DOB draft to the new account.

On reauthentication cancellation, discard the stale protected draft, clear transient Profile reauth continuation, and navigate Home. Existing Checkpoint A booking cancellation/cleanup remains in force.

Returning Home here follows the accepted Kino XII project navigation policy in §Q; it is not an OpenAPI, Assignment, or Figma-defined cancellation destination.

A late/stale 401 from an obsolete save must never clear newer authentication.

### S. Draft / mutation race safety

Require one active PUT, explicit pending state, request identity/generation, auth/user snapshot guard, and unmount protection.

Ignore stale success/error/401 after logout, replacement by another authenticated user, navigation/unmount, or a newer valid Profile interaction invalidating the request. A late response must never resurrect old User. Use existing `replaceUser` safeguards; no automatic mutation retry.

### T. My Tickets checkpoint boundary

Render the Profile navigation shell with Personal Information visibly active and My Tickets visibly present but unavailable/disabled. Include no hardcoded ticket-count badge; Figma's `2` is example content, not application data.

Call no `GET /tickets`; render no fake tickets, fake empty ticket content, or refunds. Only one panel is functional: use appropriate accessible navigation/button semantics, not full ARIA tab semantics without a second interactive tab/panel. Tickets/refunds remain a later checkpoint.

### U. Figma Personal Information geometry

Editable implementation-inspection source: `Zeb7RQ8mjGp04YIPde2ud2`, second/GTU connection. Primary reference: `284:13298` — `My profile_Information`.

| Element | Verified base geometry / style |
|---|---|
| Frame / page background | 1728×959; `#070C1C` |
| Navbar | 1728×111 |
| Heading/tabs region | x=51, y=117.5, width=1626, height=88; 1px bottom divider |
| Heading | `My Profile`; Archivo ExtraBold 800, 24px |
| Tabs | 271×33; gap 32; Archivo SemiBold 600, 14px |
| Active underline | 139×2; `#EC3013` |
| Form | x=51, raw y=247.5, width=880, height=495 |
| Field / Email blocks | 63px / 84px including helper |
| Input | 880×40; radius 12; horizontal padding 16; label-to-input gap 10 |
| Labels | Archivo SemiBold 600, 12px |
| Input fill / muted text | `#1E2031` / `#A9A9A9` |
| DOB / venue icons | Approximately 16×16 |
| Save button | 143×41; radius 999; padding 13px 22px; Archivo ExtraBold 800, 14px; `#EC3013` |
| Footer | y=861; 1728×98 |

The §J banner intentionally shifts the form below its raw Figma y-position. Do not label the shifted implementation position as a Figma measurement.

### V. Figma Profile status references

Incomplete Profile menu `355:11310`: orange 8px avatar dot; `#E27E04` surface at 10% opacity; radius 10; `Profile incomplete` and `Please complete your profile to enable booking`.

Complete Profile menu `355:11309`: green 8px avatar dot; `#4ADE80` surface at 10% opacity; radius 10; `Profile Complete` with check icon.

Existing Navbar/ProfileDropdown continues deriving states from returned User. No Profile-menu redesign is required.

### W. Figma input states

References: Default `263:3549`, Hover `263:3551`, Focused `263:3561`, Filled `263:3731`, Error `263:3595`, Success `263:3607`.

Reuse matching existing project form-field styling. Do not duplicate an unrelated input design system.

### X. Figma Navbar conflict

Inspected frame `284:13298` contains an Unauthorized Navbar instance. Assignment requires authenticated-only Profile, the API endpoint is protected, and accepted architecture already supplies authenticated Navbar/ProfileDropdown behavior.

Retain the authenticated application Navbar on `/profile`. Treat the frame's unauthorized Navbar as a source inconsistency/sample composition; do not regress runtime behavior to copy it literally.

### Y. Accessibility

Provide semantic `main`, `h1`, associated labels, helper/error associations, appropriate `aria-invalid`, visible focus, first-error focus after invalid submit, programmatically read-only Email, keyboard-usable native date and Preferred Venue controls, saving status, success/error announcements, and incomplete status understandable without color alone.

Provide disabled My Tickets semantics and no fake tab semantics.

### Z. CHECKPOINT PROFILE scope

Approve real authenticated Profile access, Personal Information visuals, five-field form, status banner, exact client validation, multipart PUT integration, server 422 mapping, accepted returned-User replacement, returned completeness/age rendering, API venues, normal editing, pending booking completion → READY once, direct Profile auth continuation, guarded save-401 reauthentication, async/stale mutation safety, accessible fallback/error/success states, and visible disabled My Tickets shell.

Explicitly defer Profile avatar editing/removal, clearing an existing non-null preferred venue until multipart-null encoding is verified, My Tickets API/content, refunds, Seat Selection, seat map, holds, timer, Checkout, and Confirmation.

### Reason

Resolve Profile correctness and presentation policies before implementation while preserving API authority, bounded booking replay, auth/draft safety, and the accepted staged sequence. Keep unsupported avatar/removal and venue-clearing semantics outside this checkpoint.

### Affected

- later Profile API/form, validation, status/eligibility rendering, and accessibility/QA
- minimal protected Profile access/reauthentication integration with AuthProvider and AppShell
- Profile references in `docs/03_FIGMA_REFERENCE.md`

This decision documents policy only. It implements no Profile, booking, or ticket functionality and modifies no architecture.

---

## D-026 — Seat Selection runtime read, focus, and configuration-failure policy

**Status:** Accepted
**Date:** 2026-10-06

### Decision

Resolve the four runtime policies left open by the Seat Selection audit: authenticated optional-read 401 handling, initial focus, missing/invalid Adult ticket configuration, and missing movie age-rating context. This decision supplements D-024 only. It does not rewrite D-024 or change D-023 protected booking replay, D-025 Profile completion, or the accepted architecture.

### A. Authenticated optional-read 401

Seat Selection is entered only after the existing protected booking gate produces READY. An active CHECKPOINT B booking instance therefore expects an authenticated user even though `GET /sessions/{session}/seats` is public/auth-optional.

The seat-map endpoint does not document 401. The following is a Kino XII defensive runtime policy for a stale/revoked authenticated session, not an added OpenAPI contract.

For a current authenticated booking session-context or seat-map read returning 401:

1. Verify the active booking instance identity, request-attempt identity, and that the expected authenticated user is still the current user.
2. If any guard is stale, ignore the 401 completely. It must not clear newer authentication or a newer booking instance.
3. If all guards are current, abort/obsolete the active session and seat-map reads and clear the active local Seat Selection instance, including selection, ticket assignments, and feedback.
4. Requeue the same bounded `OPEN_BOOKING` intent with the same `sessionId` through the existing Checkpoint A booking reauthentication mechanism.
5. Open the existing Login flow.
6. After successful authentication, run normal auth/profile gating again. READY is produced once and CHECKPOINT B consumes it to open a fresh booking instance once.

Do not reopen the old local instance directly or preserve pre-hold selection across this auth-expiry boundary. There is no hold yet, so no server reservation is lost.

Do not install a global 401 interceptor or call logout POST merely for expiry. A stale 401 must never clear a newer authenticated user or newer booking instance.

### B. No silent guest fallback

If an authenticated Seat Selection read receives 401, do not retry that read anonymously or silently fall back to guest seat-map data.

Protected entry has already established an authenticated identity, and `isMine` semantics can differ with authentication. Switching identity semantics inside the same booking instance would produce inconsistent state. Reauthenticate through the existing bounded protected-action flow instead.

The endpoint remains public/auth-optional. This policy governs the authenticated protected booking instance; it does not add an authentication requirement to the API endpoint.

### C. Initial focus

The Seat Selection Figma component does not establish a verified initial-focus target. D-024 already accepts a persistent top-right close control as a project UI decision.

Use that top-right Close button as the Seat Selection modal initial-focus target through the existing Modal initial-focus mechanism. It must be available immediately when the dialog opens.

Async session/seat-map loading completion, Retry, and loaded-seat rendering must not steal or automatically move focus. Closing restores focus to the original booking opener when that opener remains connected.

This is an accessibility/project decision, not a claimed Figma fact.

### D. Missing Adult ticket type

New locally selected seats require the returned ticket type with `slug === "adult"`. Do not use array position or substitute Child, Student, the first returned type, or another guessed fallback.

If `filterOptions.ticketTypes` contains no valid Adult record, treat this as a booking configuration error.

During CHECKPOINT B:

- the Seat Selection modal may remain open
- independently loaded hall/seat geometry may remain visible
- local seat selection is blocked
- no selected-seat card is created and no ticket assignment is guessed
- subtotal remains `₾ 0`
- `Next: Checkout` remains natively disabled
- available seats retain their factual available appearance rather than being restyled as sold or held

Use the configuration-level error copy:

`Booking configuration is unavailable. Reload the page and try again.`

Expose a real `Reload page` button. Reloading the application refetches bootstrap/filter-options through the normal app boot path. Do not offer Seat Map Retry as if it could repair cached filter options. Recovery does not mutate production state.

### E. Invalid / missing Adult record

Apply the same configuration-error and reload-page policy when an Adult entry exists but cannot safely provide the fields required for local preview assignment under the documented TicketType schema.

Do not invent missing values or substitute another type. Keep this policy narrowly scoped to configuration that prevents a valid default local ticket assignment.

### F. Missing movie age-rating context

Ticket-type restrictions require `movie.ageRating.minAge`. The authoritative CHECKPOINT B source is `GET /sessions/{session}`; the seat-map response alone does not supply this context.

Treat a successful current session-context response as incomplete when:

- `movie` is missing
- `ageRating` is missing
- `minAge` is missing
- `minAge` cannot be treated as the documented numeric value

Do not assume `minAge = 0`, assume unrestricted ticket types, hardcode 16/18, special-case Child, or continue ticket-type decisions from stale route data.

For incomplete context:

- keep the modal open
- independently loaded hall/seat-map geometry may remain visible
- block local seat selection and ticket assignment
- subtotal remains `₾ 0`
- `Next: Checkout` remains natively disabled
- show the context-level error and expose a real Retry button

Use the project copy:

`Booking details are incomplete. Try again.`

Retry reruns `GET /sessions/{currentSessionId}` inside the same current booking instance. Retain request/instance guards; do not create another `OPEN_BOOKING` intent merely for Retry. If the seat-map read also failed, its existing Retry state remains separate.

### G. Valid rating context

Evaluate D-024 ticket-type restrictions only after a valid session-context response supplies `movie.ageRating.minAge`.

- If `ticketType.blockedFromRatingAge == null`, this rule does not block the type.
- Otherwise, omit/block the type when `movie.ageRating.minAge >= ticketType.blockedFromRatingAge`.

Use returned values. Do not calculate film-rating rules independently.

### H. Configuration failure vs read failure

Keep the failure categories and recovery paths distinct.

Seat/session read failures include network failure, 404, 500, malformed required session context, and current guarded 401. Use in-modal Retry, terminal 404 treatment, or reauthentication according to the applicable D-024/D-026 rule.

Bootstrap configuration failure includes a required Adult ticket type that is missing/invalid. A seat/session Retry cannot repair cached filter options; use the configuration error and `Reload page` recovery defined above.

### I. Selection interaction while configuration is blocked

When Adult/default assignment or rating context is unavailable, do not allow a new local selection into booking state.

If configuration/context becomes invalid after a guarded retry/result transition in the same instance, clear existing local selection and ticket assignments before presenting the blocked state. Do not preserve assignments based on obsolete context.

Do not alter API seat-state values. Seats may retain their factual map appearance. Explain in text that booking selection is temporarily unavailable without representing the seats themselves as sold/held.

### J. CHECKPOINT B boundary remains unchanged

CHECKPOINT B still:

- consumes READY once
- opens one application-level Seat Selection modal
- reads real session context and the real nested seat map
- keeps local pre-hold selection only
- uses API filter options
- calculates local preview prices and renders dynamic subtotal
- leaves `Next: Checkout` natively disabled

CHECKPOINT B still does not:

- create or release holds through POST/DELETE
- restore holds or persist hold state
- start an `expiresAt` timer
- enter Checkout
- create an Order
- render Confirmation

### K. Existing D-024 facts remain authoritative

Do not reopen these already-resolved policies:

- unresolved `isMine` seats remain map-only, visually own-held/Selected, non-editable, and excluded from local cards and totals
- D-026 adopts `₾ 0` as CHECKPOINT B's empty subtotal display, established from the verified empty Seat Selection Figma state during the pre-implementation Seat Selection audit
- further selection attempts at the configured cap are blocked with `You can select up to {maxSeatsPerOrder} seats.` while available seats retain available appearance
- close uses the top-right project control plus existing permitted Escape/backdrop semantics
- seat geometry remains 52×52, radius 10, horizontal/vertical gaps 8/10, aisle spacer 16, and map viewport 720; seats do not shrink
- the timer card/countdown is omitted before a real hold

### L. Async / StrictMode safety

The new policies preserve request-attempt identity, booking instance identity, same-session reopen distinction, expected-user/auth identity guards, stale-response rejection, StrictMode duplicate-effect safety, and READY consume-once behavior.

A stale success, error, 401, or Retry result must never replace a newer booking instance or newer authenticated user.

### M. Accessibility

- Close is the initial-focus target.
- Loading completion does not steal focus.
- Configuration/context failures are announced.
- Reload/Retry controls are real buttons.
- Blocked selection is explained in text, not color alone.
- Available seat appearance must not falsely communicate sold/held state.
- `Next: Checkout` remains semantically disabled.

### Reason

Close the four correctness-affecting runtime policy gaps before CHECKPOINT B implementation while preserving protected entry, API ownership semantics, asynchronous safety, and the accepted pre-hold boundary. Give incomplete configuration and incomplete session context distinct, effective recovery paths.

### Affected

- later CHECKPOINT B booking coordinator/read guards and reauthentication handoff
- later Seat Selection initial focus, configuration/context fallbacks, selection reset, and accessibility/QA

This decision documents policy only. It implements no Seat Selection, hold, Checkout, Order, or Confirmation functionality and modifies no architecture or Figma facts. D-001 through D-025 remain unchanged.

---

## D-027 — Seat hold lifecycle, recovery, restoration, and Checkout handoff policy

**Status:** Accepted
**Date:** 2026-10-06

### Decision

Resolve the frontend HOLD lifecycle/recovery policies identified by the completed CHECKPOINT HOLD audit. This supplements D-010 hold persistence/restoration, D-012 Checkout Back behavior, D-023 protected booking replay, D-024 Seat Selection/hold authority, and D-026 read/runtime policy. Preserve D-025 Profile behavior and all prior decisions; do not rewrite them. The API remains authoritative, and this decision adds no backend transactional guarantees.

### A. Confirmed API baseline

Confirmed protected endpoints:

- create/replace: `POST /sessions/{session}/holds`
- retrieve/revalidate: `GET /holds/{hold}`
- release: `DELETE /holds/{hold}`

The session identifier is the integer path parameter. The create body contains only the selected seat assignments. Its schema shape is:

```text
{
  "seats": [
    {
      "seatId": integer,
      "ticketType": "adult" | "child" | "student"
    }
  ]
}
```

Send map seat IDs and API ticket-type slugs, one assignment per seat. Do not send `sessionId` in the body, price, subtotal, ratio, seat code, or buyer/payment fields. Required assignment fields are `seatId` and `ticketType`; the documented array has at least one item and at most three. UI quantity limits come from `filterOptions.maxSeatsPerOrder`, and ticket choices/restrictions come from API configuration rather than hardcoded options.

POST succeeds with `201` and GET with `200`, both enveloping `SeatHold` in `data`; DELETE succeeds with `204` and no body. Confirmed SeatHold fields include:

- `holdId`
- `sessionId`
- `expiresAt`
- `secondsRemaining`
- `isLive`
- `subtotal`
- `seats[].seatId`
- `seats[].code`
- `seats[].ticketType.slug`
- `seats[].ticketType.name`
- `seats[].price`

After successful validation, server Hold assignments/prices/subtotal replace local previews. A user has at most one hold per session; another POST replaces it without a preliminary DELETE. This replacement rule does not imply idempotency or transactional behavior after failed requests.

### B. Next → hold creation

In Seats, `Next: Checkout` is enabled only when:

- the current booking instance is authenticated and the server-confirmed profile is complete
- session, map, and configuration are usable
- at least one local seat is selected
- selected quantity does not exceed the configured maximum
- every selected seat has one currently allowed ticket-type slug
- no hold mutation is pending
- no uncertain hold-create state is active

Validate every selected assignment, not merely a filtered preview list. On activation, synchronously capture an immutable submitted assignment snapshot, acquire a provider-owned mutation lock, disable further mutation/edit controls, and send exactly one POST. Never submit from render or an effect.

The lock must prevent double-click, Enter repeat, rerender, StrictMode, and same-event duplication. Mutation identity includes request identity, booking instance identity, `sessionId`, expected authenticated user, selection revision, and immutable submitted seats. An unresolved POST retains its detached request identity when its UI instance is closed/replaced; UI abandonment is not proof of mutation cancellation.

### C. Hold success validation

Do not accept a `201` merely because its HTTP status is successful. Before adoption, validate the data needed for a usable live SeatHold:

- usable UUID `holdId`
- matching `sessionId`
- parseable, unexpired `expiresAt`
- `isLive === true`
- usable numeric `subtotal`
- usable returned seat assignments
- returned seat IDs corresponding to the submitted request
- usable returned ticket data and per-seat prices required by the UI

Do not fabricate missing fields. If fully valid, adopt SeatHold as authority, persist only `{ holdId, sessionId }`, replace preview prices with returned prices/subtotal, show a real `expiresAt` timer, advance to Checkout, and clear mutation pending state. Adoption must pass current request/booking/user guards.

### D. Malformed success

A malformed `201` may represent a completed server mutation with an incomplete response.

If a usable `holdId` is present but other required data is invalid/missing, do not send a second POST. GET `/holds/{holdId}` once through current request/user guards. Adopt a valid live matching result normally. If retrieval proves terminal invalidity, expiry, or not-found, return safely to Seats. If retrieval is transient/ambiguous, enter UNCERTAIN.

If no usable `holdId` is available, enter UNCERTAIN. Do not claim creation failed, fabricate an ID, or automatically retry POST.

### E. Uncertain hold-create state

Use an explicit phase such as `hold.phase = "uncertain"` when the frontend cannot prove whether the previous POST created/replaced a server hold. Network failure, unknown server failure including `500`, or unusable success data can require this state.

While uncertain:

- never advance to Checkout
- show no fake timer or client preview represented as server-held values
- never automatically retry POST or start another automatic creation
- preserve the submitted snapshot only for explanatory/recovery UI
- prevent stale results from reviving an abandoned instance

Use project fallback copy:

`We couldn't confirm whether your seats were held. Start over to try again.`

Provide a real `Start over` action. It abandons the uncertain UI instance, clears unverified authoritative hold state, refetches current session/seat map, and returns to fresh Seats. It does not automatically submit, claim the unknown hold was released, or infer that the earlier POST failed.

If an ambiguous replacement POST had a previously verified Hold, its old ID does not establish continued authority. Block Checkout and do not present its timer as proof that it survived. Keep the previous `{ holdId, sessionId }` reference only as recovery evidence while uncertain; it may be revalidated later, not assumed valid. Start over clears that reference and issues one best-effort DELETE for the previous known ID if it can still be targeted with current auth. An unknown replacement without a known ID cannot be targeted and is left to expiry. Do not claim all possible holds were released.

After Start over, refreshed `isMine` seats may belong to an unknown server Hold. Preserve D-024: map-only own-held appearance, non-editable, excluded from local cards/subtotal. Do not make them selectable to avoid a temporary dead end or invent a hold ID/ticket assignment. For this recovery state, use Kino XII project UX copy, not API/Figma text:

`Some seats may remain temporarily unavailable until the previous hold expires.`

A later explicit Next is a new user-driven replacement attempt under the API's same-user/session replacement rule. It must still satisfy the provider mutation lock. This is bounded explicit recovery, not an exactly-once or idempotency guarantee.

### F. Late success after UI abandonment

Closing/replacing an instance while creation is unresolved does not prove server cancellation. Keep a detached cleanup identity for that request.

If an abandoned request later returns a valid successful SeatHold, do not reopen UI, persist it as the active booking, or overwrite a newer hold/reference. Immediately attempt best-effort DELETE for its returned `holdId`, scoped only to that abandoned request/hold/user identity. Cleanup must not target or alter a newer active hold; do not assume replacement IDs are guaranteed to differ.

If the abandoned request ends ambiguously without a usable `holdId`, no release can be targeted. Rely on server expiry and leave newer booking state untouched. Do not substitute a newer user's authentication for the captured cleanup identity.

### G. Authenticated 401 during create

A received server `401` differs from ambiguous transport failure. OpenAPI explicitly requires Login and replay of the interrupted protected action. Use one bounded, transient `HOLD_CREATE` continuation containing only:

- `sessionId`
- immutable submitted `seatId`/`ticketType` assignments
- original expected account identity
- `replayCount`, bounded to one replay

Do not persist the continuation. Before handoff, verify current mutation/booking identity and that the expected user is still current; clear mutation pending state and do not retry anonymously. Use existing Login/Profile gating.

Same-account successful reauthentication may continue. Account change, Login cancellation, or replaced/new booking intent discards the continuation. Before replay, reopen/revalidate booking context, refetch session and authenticated seat map, and revalidate every captured assignment against current availability/configuration/rules.

When the interrupted POST was replacing a previously verified Hold, its seats may appear `isMine` in the refreshed authenticated map. Count them as valid for replay only when their IDs belong to that verified previous Hold, the current map still reports `isMine`, the replay snapshot still contains them, and their ticket assignments remain valid. Newly added snapshot seats must satisfy ordinary current selectable/available rules. Arbitrary extra `isMine` seats are not valid replay assignments.

If the exact submitted mutation remains valid, replay POST automatically once. If it is no longer valid, do not replay: reconcile to Seats, show the changed availability/rule state, and require a fresh explicit Next after review. Never replay more than once or loop on another `401`.

The same-account-only HOLD_CREATE continuation is a Kino XII replay-safety policy layered on OpenAPI's replay requirement, not an API-defined account-continuation guarantee. This create-specific continuation does not change D-026's read-specific reset/requeue policy or D-025's no-auto-replay Profile PUT policy. It follows the documented received-401 replay instruction without claiming POST idempotency.

### H. 409 conflict

The confirmed root response field is `contested: string[]`, containing seat codes. For a current mutation, map codes against the immutable submitted snapshot and its captured seat-code correspondence; immediately remove only matching draft assignments, preserve unaffected assignments/ticket choices, show the server message and contested codes accessibly, refetch the authenticated map, and remain in Seats. Never enter Checkout on `409`.

Until authenticated seat-map refetch succeeds, contested codes use a transient conflict/sold-unavailable presentation and remain non-selectable so they cannot trigger an immediate repeat conflict. Keep this in provider/UI reconciliation state; do not mutate the API seat-map response object. The successful refreshed factual map replaces the transient presentation. If refetch fails, keep contested seats non-selectable, expose existing seat-map Retry, and do not invent final factual seat state beyond the conflict evidence. This records OpenAPI's mark/drop behavior without overwriting API data.

If `contested` is missing/malformed, do not invent lost IDs. Show the server message, refetch, and reconcile the local draft against factual refreshed availability. Preserve only valid selections and do not claim the failed request held seats. Ignore a stale `409` completely.

When the request was replacing an existing hold, apply §J as well; preserving unaffected local draft assignments does not establish that the old hold survived.

### I. Replacement POST with an existing hold

Checkout Back retains the verified live hold. On returning to Seats, hydrate the editable draft from server Hold assignments; keep the Hold authoritative and its timer running. Draft edits are local only.

If the draft differs from the active Hold, show this Kino XII project UX copy, not API/Figma text:

`Changes are not held until you continue.`

Do not claim added/changed draft seats or ticket assignments are covered by the old Hold. An unchanged draft may return to Checkout through Next without another POST, provided the verified hold is still live. A changed draft requires POST replacement. Do not DELETE first.

### J. Replacement failure and previous hold

A failed replacement must not assume the old Hold survived. Capture its previously verified `holdId` separately. After a definite replacement failure such as `409`/`422`, GET that previous hold and reconcile against current authenticated map evidence under guards.

If it is confirmed live and consistent, retain it as the active server Hold, restore its authoritative assignments/prices/timer, return the editable draft to those verified assignments, and keep the replacement-failure message visible. Next may return to Checkout without another POST while that draft remains unchanged and the hold live.

If the old hold is no longer live/valid or ownership/map evidence contradicts it, clear active Hold authority and persistence. Remain in Seats with factual refreshed availability and valid local draft only.

If previous-hold revalidation is transient/ambiguous, block Checkout and offer Retry / Start over. Do not pretend the old hold still exists. An ambiguous replacement POST uses §E: the previous reference is recovery evidence only, not authoritative Hold/timer proof. Start over clears it and best-effort targets that known ID when current auth permits; an unknown replacement is left to expiry without claiming all possible holds were released.

### K. 422 policy

Preserve the global distinction: `422` with `errors` maps recognized fields where possible; message-only `422` is a business-rule failure and shows the exact server message. Confirmed request concepts are `seats`, `seatId`, and `ticketType`.

The POST description documents field validation, while its response schema references message-only `BookingBlocked`. Do not invent guaranteed field/index-key formats to bridge that contract gap. If indexed keys are actually returned, map through immutable submitted request order, never current object enumeration. Keep unmapped errors visible rather than silently discarding them.

For a current message-only `422`, show the exact server business-rule message. Do not parse arbitrary text or inspect substrings to infer incomplete profile, age restriction, session start, or another cause. Perform one guarded fresh `GET /me` only when profile-completion remediation may be relevant to the active protected booking. Use the fresh server User as structured evidence: `profileComplete === false` routes through existing Profile completion; `profileComplete === true` stays in Seats without invented Profile remediation. If the read cannot establish the relevant state, do not guess the cause or remediation. Refetch session/map when factual freshness is needed, and apply existing auth/Profile and request/user guards.

Do not automatically replay the rejected POST solely because `/me` reports an incomplete profile. After Profile completion, return through existing booking entry/gating, refetch/revalidate context, and require fresh explicit Next for a new hold mutation. The `422` was a definite rejection; OpenAPI defines no automatic HOLD replay for this business-rule response. Preserve draft only without crossing account/session identity boundaries; otherwise rebuild from factual current context. Replacement failures also follow §J.

### L. Release — user abandonment

A known live hold is intentionally abandoned by explicit Close, accepted Escape/backdrop Close, starting a different-session booking, or explicit logout. Checkout Back and page refresh are not abandonment. Timer expiry requires no DELETE.

For intentional abandonment:

- close/switch promptly
- immediately clear that booking's persisted restoration reference so it is not restored later
- capture exact hold/user cleanup identity
- issue one best-effort DELETE while current authentication is available
- do not block Close/navigation/new-session flow on cleanup success
- do not retry in a loop
- prevent old DELETE completion from changing a newer hold/reference

If DELETE fails, leave the UI action completed, do not restore the abandoned hold, rely on expiry, and do not invent release success. Immediate reference cleanup specifies intentional abandonment; it is not proof that DELETE succeeded. No browser/window unload or beacon mechanism is introduced.

### M. Logout release sequencing

For explicit logout with a known live hold, initiate the captured DELETE while the current token is still available to that request. Logout must proceed even if release fails; failure must not trap the user in the authenticated session. Clear protected booking UI/restoration reference on logout and rely on expiry if release did not complete. Add no global release interceptor.

### N. Session replacement

Opening a different session abandons the old flow. Capture/best-effort release its known live hold, clear its reference, and open the new bounded booking flow promptly. Old release completion cannot affect the new session. Do not create a queue. Unresolved old creation follows the detached cleanup/guard rules in §§B/F.

### O. Restoration — terminal vs transient

Keep D-010's exact `{ holdId, sessionId }` reference in `sessionStorage` through a storage abstraction. Do not persist Hold/map/assignment objects, payment data, or a new auth-token copy. Restoration starts only after validated authentication is available; do not issue protected GET using unknown/stale auth.

Terminal outcomes are `403`, `404`, `isLive === false`, expired `expiresAt`, malformed reference, or a definitively invalid Hold/session mismatch. Clear the reference and expose no stale protected booking data. Expired outcomes use the accepted expiry copy.

Network/unknown server failures and recoverable restoration read failures are transient. Keep the reference; do not fabricate state or expose unverified assignments. Use this Kino XII project UX copy, not API/Figma text:

`We couldn't restore your seat hold. Check your connection and try again.`

Provide Retry and Start over. Retry reruns guarded restoration. Start over clears the reference, best-effort releases a known validated live hold when available, otherwise relies on expiry, and opens fresh Seats only through explicit user action.

This distinguishes transient read failure from terminal invalidation for D-010 cleanup. It does not change the persisted shape or authorize restoring on a failed read. A `401` requires validated authentication before restoration can resume; it is not ownership proof or permission to use another account's protected data.

### P. Restored Hold / map mismatch

Activate restored Hold state only after verifying a live unexpired Hold, matching session, valid returned assignments/prices, and consistent authenticated map ownership evidence. Refetch session context/map as part of the complete restoration flow.

Extra `isMine` seats outside the verified Hold remain map-only and excluded from cards/subtotal. If Hold seats are missing, not `isMine`, sold/unavailable, or otherwise contradictory, do not partially hydrate, guess, or enter Checkout. Show this Kino XII project UX copy, not API/Figma text:

`We couldn't verify your saved seat hold. Retry or start over.`

Retry re-GETs Hold, refetches authenticated map/session context, and reruns full guarded reconciliation. Start over best-effort releases the known hold when possible, clears the reference and protected restored data, and returns to fresh Seats. `isMine` alone never proves restoration.

### Q. Fresh intent during restoration

Restoration creates no queue. If fresh explicit intent arrives for the same session, prefer completing/revalidating the stored Hold and avoid duplicate booking instances.

For a different session, cancel/obsolete restoration UI work, clear the old reference as abandonment, best-effort release its known `holdId` when authenticated, and continue with the fresh bounded intent. Stale restoration must not reopen/replace the newer session.

### R. Hold expiry

Use server `SeatHold.expiresAt` as the authoritative expiry. Derive:

```js
remainingMs = Math.max(0, Date.parse(expiresAt) - Date.now());
```

`secondsRemaining` is not a ticking source. `filterOptions.holdMinutes` supplies duration/rule context, not a client-created expiry or fallback for invalid live data.

On expiry of the current active hold, transition once: invalidate Checkout readiness, clear Hold authority/reference and held/local assignments, return to Seats, refetch authenticated map, and announce:

`Your hold time expired. Please re-select your seats.`

Apply this on current timer expiry or server-confirmed non-live/expired retrieval, including while on Seats after Back. Do not DELETE merely because time reached zero.

### S. Timer format

Accepted project display algorithm:

- derive from current remaining milliseconds
- use `Math.ceil(remainingMs / 1000)` for displayed seconds while positive
- show unpadded total minutes and two-digit seconds
- examples: `7:48`, `1:05`, `0:09`, `61:05`, and `0:00` at expiry

This matches the verified Figma M:SS sample without assuming duration stays below an hour. Use `role="timer"` without per-second live announcements; announce expiry separately.

Recalculate approximately once per second, on visibility return/window focus, and immediately when hold identity/`expiresAt` changes. Never store a decrementing counter as authority. Guard the expiry transition against duplication and stale callbacks.

### T. Hold success → Checkout boundary

Successful validated Hold advances `step = "checkout"` in CHECKPOINT HOLD. Activate Checkout progress, show real timer and authoritative held assignments/prices/subtotal, and keep Close and Back to Seats available. No order mutation occurs.

The intermediate handoff shell contains only:

- booking/session header
- Checkout progress state
- real hold timer
- authoritative held-seat summary/subtotal
- Back to Seats
- Close

Omit payment/card controls entirely. Do not render fake/disabled payment controls, buyer/payment placeholders, or a fabricated purchase CTA. HOLD implements no payment-card state, card inputs, order creation, confirmation, or refund. The subsequent CHECKOUT checkpoint adds real payment/order UI. This shell is accepted project checkpoint policy, not an additional Figma variant.

### U. Checkout Back → Seats

Back from the handoff shell keeps verified Hold, persistence, and timer. Return to Seats and hydrate editable draft from Hold assignments. Use local preview UI while editing.

An identical draft returns through Next without POST while the hold remains verified/live. A changed draft displays the project UX copy `Changes are not held until you continue.` (not API/Figma text) and Next performs replacement POST. Local edits are never represented as already reserved. Keep draft preview and authoritative held values distinct; apply §J after definite replacement failure.

### V. Server price authority

After successful hold creation/restoration, authoritative held values are `SeatHold.seats[].price`, returned ticket-type slug/name, and `SeatHold.subtotal`. Do not recompute held prices from filter ratios or add format surcharge. Local preview pricing applies only to the editable Seats draft before successful replacement; it cannot override held values.

### W. Pending UI

During POST, natively disable Next, seat add/remove controls, and ticket changes; action/state guards must also block edits. Keep Close governed by detached late-success cleanup. Expose one accessible status announcement using Kino XII project UX copy, not API/Figma text:

`Holding seats…`

Do not spam announcements or change button copy merely to simulate an unverified Figma pending variant.

### X. Release failure copy / UX

Do not add a global toast system solely for release failure. Intentional Close/session replacement/logout completes even if release fails.

If booking/recovery UI remains visibly open after an explicit release/recovery action and release fails, show this exact Kino XII project UX fallback copy, not API/Figma text:

`We couldn't release your seats immediately. They will expire automatically.`

If the user intentionally closed/switched/logged out and the UI is already gone, silent server-expiry fallback is acceptable. Never reopen closed booking UI just to show release failure, and never claim release success.

### Y. Storage failure

If `sessionStorage` is unavailable, do not crash. The current-tab active Hold may continue, but do not pretend refresh restoration is available. Do not duplicate Hold data into another storage mechanism or invent a persistence fallback.

### Z. Checkpoint B / HOLD / CHECKOUT boundary

Preserve the staged scope:

- CHECKPOINT B: local selection only
- CHECKPOINT HOLD: real Hold lifecycle, timer, restoration, release, and Checkout handoff shell
- CHECKPOINT CHECKOUT: payment/order/confirmation

No `POST /orders` in HOLD and no card persistence anywhere.

### Backend ambiguity boundary

D-027 does not claim that POST is idempotent, lost responses mean mutation failure, failed replacement preserves the prior Hold, DELETE is guaranteed during unload, `isMine` alone proves restoration, or `500` means no Hold was created.

Where backend guarantees are absent, use uncertain state, guarded revalidation, bounded explicit user recovery, and server expiry. Do not invent an idempotency key, hold-discovery endpoint, or transactional response guarantee. Received-401 replay is bounded to the explicit API instruction; ambiguous transport outcomes never inherit that replay path.

### Async safety

Guard create/retrieve/release/restore results with booking instance, request, session, and expected-user identity, plus selection revision and hold identity where applicable. Detached cleanup retains its originating identity rather than borrowing a newer instance/user. Apply synchronous provider mutation guards across rerenders and instance replacement.

Stale success, `401`, `409`, `422`, release completion, restoration result, and timer expiry must never modify a newer booking/user/hold. A stale successful creation can trigger only its guarded detached cleanup, never active-state adoption. Cleanup must not release a newer active hold or clear its persistence. Fetch abortion is not proof of server mutation cancellation.

### Reason

Resolve frontend correctness/recovery choices before CHECKPOINT HOLD implementation while preserving API ownership, server price/expiry authority, protected-action safety, and separate payment/order scope. Missing backend guarantees remain explicit rather than being replaced by client assumptions.

### Affected

- later BookingProvider/reducer lifecycle, mutation identity, and guarded recovery
- later hold API/storage modules, restoration, reconciliation, and timer
- later create-specific auth continuation and abandonment/logout sequencing
- later Seats draft/pending/recovery UI and Checkout handoff shell
- later focused lifecycle tests and intercepted browser QA

This decision documents policy only. It implements no source/CSS changes, endpoints, payment, Order, or Confirmation behavior, changes no Figma facts or architecture document, and leaves D-001 through D-026 unchanged.

---

## D-028 — Checkout, order submission, uncertainty, confirmation, and Tickets handoff policy

**Status:** Accepted
**Date:** 2026-10-07

### Decision

Accept the following CHECKPOINT CHECKOUT policies following the completed read-only Checkout audit. D-028 supplements, not replaces, D-010, D-012, D-023, D-024, D-025, D-026, and D-027. Earlier decisions remain unchanged. Extend the completed HOLD foundation; do not redesign its creation, restoration, timer, or Back behavior.

Source baseline: `02_OPENAPI.json` governs backend behavior; `01_ASSIGNMENT_SPEC.md` governs required functionality; the completed audit's exact GTU Figma findings govern verified visuals; accepted decisions and compatible `05_ARCHITECTURE.md` guide frontend behavior. Sections explicitly labeled FACT record source facts. Accepted frontend recovery, copy, normalization, and presentation choices below are Kino XII project policy, not additional backend guarantees.

### A. Confirmed Order API — FACT

`POST /orders` requires Bearer authentication and an `application/json` request body. Its seven documented fields are all required strings. Construct the frontend payload with exactly these fields:

```text
{
  holdId,
  fullName,
  email,
  mobileNumber,
  cardNumber,
  expiry,
  cvv
}
```

| Field | Confirmed constraint |
| --- | --- |
| `holdId` | UUID |
| `fullName` | 3–50 characters |
| `email` | Email format |
| `mobileNumber` | Nine digits starting with 5; OpenAPI pattern `^5\d{8}$` |
| `cardNumber` | 16 digits |
| `expiry` | `MM/YY`; valid month 01–12; OpenAPI says not in the past, Assignment says in the future |
| `cvv` | Three digits |

Do not send seats, `sessionId`, subtotal, total, price, `cardholderName`, `paymentMethod`, or billing address. Those fields are not documented in this request. This exact-payload rule does not claim that the OpenAPI schema explicitly rejects every additional property.

The API strips spaces from card/mobile numbers and accepts spaced input. No Luhn or card-brand validation rule exists in the sources. Payment is simulated: the endpoint validates the card, retains only its last four digits, and charges nothing. This API fact does not authorize real production booking mutations during development or QA.

Success is `201` with `{ data: Order }`. Documented endpoint failures are `401`, `403`, `409`, and `422`. `404` and `500` are not endpoint-specific documented response schemas; generic API error guidance does not establish rollback guarantees.

### B. Returned Order and recovery capabilities — FACT

Order defines `id`, `reference`, `status` (`paid` or `refunded`), `totalPrice`, `paidAt`, nullable `refundedAt`, `isUpcoming`, `isRefundable`, `cardLastFour`, `contact`, `session`, and `tickets`. Contact contains `fullName`, `email`, and `mobileNumber`. Tickets contain `id`, `seatCode`, `ticketType.slug`, `ticketType.name`, and `price`. Session carries movie, venue, hall, date/time, format, and language information.

The only documented returned card information is `cardLastFour`; full card number, expiry, and CVV are not echoed. There is no documented Order `holdId`, QR, download URL, or ticket `seatId`. Render confirmation from returned Order fields rather than Hold/local previews; do not construct missing fields or order references.

`GET /tickets` requires Bearer authentication and returns `200 { data: Order[] }`. Optional `filter` values are `upcoming` and `past`; without a filter it returns both, newest session first. Each Order already contains its session/ticket information. No direct Order GET, Order lookup by Hold, idempotency key, or client request identifier is documented. The refund endpoint exists but refund implementation is outside this checkpoint.

### C. Payment state and security

`cardNumber`, `expiry`, and `cvv` exist only in local Checkout form state and transient request construction. They must never enter BookingContext, reducer state, localStorage, sessionStorage, URL, logs, debug probes, or auth/pending-action continuations. A coordinator may track submission identity without retaining the payment payload as shared state.

Buyer edits remain Checkout-local and do not automatically update Profile. Initialize `fullName`, `email`, and `mobileNumber` from the authoritative current User when entering Checkout; payment fields start empty. Never derive `user.profileComplete` from local form validity.

Clear sensitive payment fields on successful Order creation, full abandonment/Close, account change/logout, explicit Start over, and terminal Checkout invalidation. Do not persist buyer/payment drafts or restore payment fields after refresh. Returned Order, including server `cardLastFour`, may be held as the authoritative purchase result under account guards.

### D. Checkout Back

Preserve D-012/D-027: Back returns to Seats, keeps the current verified live Hold and its reference, keeps its timer running, and hydrates the editable seat draft from Hold assignments. It sends neither DELETE nor Order POST.

Clear `cardNumber`, `expiry`, `cvv`, and payment-field validation errors on Back. Non-sensitive buyer edits may remain local only when the same Checkout component/runtime instance returns without account/session change. If Checkout unmounts on Back, reinitializing buyer fields from current User on return is acceptable. Never persist buyer edits or place them in shared authoritative Profile state merely to retain this draft.

This payment clearing is project security policy: sensitive values do not survive leaving Checkout. Back is disabled during submission and is not a recovery/resubmission action from uncertain Order state.

### E. Pre-submit readiness

Before Order POST, synchronously require:

- authenticated current same account and server `profileComplete === true`
- current booking instance/session
- active verified Hold with `isLive === true`, matching context, usable authoritative assignments/prices, and a parseable `expiresAt` strictly later than the current time
- no recovery, uncertain Order, unresolved conflicting mutation, or completed Order for the instance
- valid local form under confirmed rules

Do not automatically GET Hold before every submit. Such a read is not source-required and cannot eliminate the race after it completes. Check readiness again at dispatch; the server remains authoritative. Guarded GET revalidation remains required for the specific reauthentication/conflict recovery paths below.

### F. Client validation and normalization

Validate on blur and again on submit. Mirror only the confirmed request/Assignment constraints in §A. Trim surrounding whitespace from fullName/email for validation/request construction. Allow spaces while typing card/mobile; remove spaces from normalized validation/submission copies, without unexpectedly changing the displayed draft during typing.

Add no Luhn, card-brand validation, four-digit CVV support, country-code handling, undocumented character whitelist, or additional punctuation normalization. The Hold ID comes from verified booking state, not an editable input. Exact client error copy is Kino XII project UX unless it is source/server-provided; do not attribute invented strings to API or Figma. Server validation remains authoritative.

Accepted expiry interpretation: valid `MM/YY`, month 01–12; accept the current calendar month through its end; reject an earlier month/year. This is Kino XII frontend policy resolving OpenAPI's “not in the past” versus Assignment's “in the future” wording, not a claim about an undocumented server boundary. Do not manufacture a local day/time expiry field in the API payload.

### G. Duplicate-submit lock and request identity

Use one semantic form `onSubmit`. Acquire a synchronous submit lock before asynchronous work. Never POST from render or an effect. Disable submit immediately and guard the handler independently of queued React renders so double click, Enter repetition, rerender, StrictMode, and repeated handlers still produce exactly one POST.

Capture non-sensitive identity: booking instance, account ID, auth generation/token identity without logging the token, session ID, Hold ID, and submit request ID. Keep unresolved request identity in the runtime/coordinator even if active UI expires/closes. Once a valid Order is adopted for an instance, no second POST may be accepted for that booking/order instance.

These are frontend duplication controls, not server idempotency or exactly-once purchase guarantees.

### H. Pending controls, CTA, and timer

The purchase CTA is exactly `Pay & Complete Order`; Assignment copy takes priority over Figma's `Pay: Complete order`. Enable only when form is client-valid, Hold is usable, no mutation is pending, and Checkout authority/readiness is established. Figma's active sample button is not proof of valid payment data.

While Order POST is pending, disable Pay, every Checkout input, Back, and seat-edit navigation. Close, Escape, and backdrop Close remain available under §§O–Q. Continue the visible timer from server `expiresAt` until expiry; do not announce every tick.

Keep CTA dimensions/style and use disabled pending button copy `Completing order…`. Announce one accessible status `Completing your order…`. Both strings and this pending behavior are Kino XII project UX/policy, not API/Figma pending-state facts.

### I. Order 401 — explicit payment re-entry and continuation

OpenAPI instructs reauthentication/replay. Order has no documented idempotency guarantee, and sensitive payment values cannot enter shared/persisted continuation state. For a definite CURRENT `401` response from Order POST, treat that received response as rejection of the submitted mutation; do not infer this outcome from transport failure and do not automatically replay POST.

Retain only non-sensitive Checkout context, clear cardNumber/expiry/cvv before authentication, and invoke the existing Login flow. Preserve one bounded, transient `ORDER_REAUTH` continuation containing booking instance, `sessionId`, `holdId`, expected account ID, and replayCount metadata. It contains no payment data and is never persisted. Do not copy the HOLD_CREATE automatic-replay policy into Order submission.

After successful same-account authentication, guarded GET `/holds/{holdId}` must verify the same live, unexpired, consistent Hold; revalidate session context as needed and preserve existing authenticated-map reconciliation rules where applicable. Reapply server profile-completion gating. Return to Checkout only after authority is re-established, initialize buyer fields from current User if needed, and require payment re-entry plus a fresh explicit Pay action. Never automatically POST after Login.

Account change, authentication cancellation, new booking intent, or invalid Hold discards this continuation. A transient verification failure blocks Checkout pending guarded recovery, rather than permitting unverified Pay. No automatic authentication/POST loop is introduced.

This is an explicitly accepted Kino XII resolution of the sources' automatic-replay wording: it satisfies safe continuation intent through reauthentication, revalidation, payment re-entry, and explicit resubmission. It does not silently claim literal automatic POST replay or introduce a backend replay/idempotency guarantee.

### J. 422 field errors

For `422` with `errors`, recognize only flat keys `fullName`, `email`, `mobileNumber`, `cardNumber`, `expiry`, `cvv`, and `holdId`. Map the six form keys to their inputs; Hold ID is booking-level feedback. These are request-derived mapping keys, not an API guarantee that every error uses a fixed enumerated key set.

Keep unknown keys visibly surfaced. Focus the first recognized invalid input after render. Keep payment values/errors local, clear stale field errors when their field changes, and use server messages. Do not infer nested/indexed aliases or parse message text to guess field causes.

### K. Message-only Order 422 — expired Hold

The Order endpoint documents message-only `422` as Hold expiry, despite its formal response reference being ValidationError. Support both documented shapes. For message-only expiry, leave Checkout: clear active Hold authority, stored reference, local seat draft, and payment fields; stop the timer; return to Seats; refetch the authenticated seat map; show the exact accepted warning:

`Your hold time expired. Please re-select your seats.`

Do not DELETE solely because the Hold expired. Do not classify `422` with field `errors` as expiry by parsing its text.

### L. Order 409 and previous Hold recovery

FACT: Order `409` has root `message` and `contested: string[]`; the endpoint describes seats sold by another checkout in between. It does not document `409` as expired Hold or already-ordered Hold.

Show the exact server message and contested codes, adopt no confirmation, clear Order pending state/payment fields, and return to Seats. Match contested codes against the captured verified Hold/assignment correspondence. Remove only matching assignments and preserve unaffected ticket choices where still valid; refetch the authenticated map. Missing/malformed contested data must not produce invented seat IDs; use factual refreshed availability for reconciliation.

Do not assume the previous Hold survived. Before reusing any authority, guarded GET `/holds/{holdId}` must verify the requested Hold, same session, `isLive`, unexpired expiry, usable assignments/prices, and consistency with the refreshed authenticated map.

- Verified: restore the usable remaining server Hold, reset the editable draft to its verified assignments, and keep conflict feedback visible. Do not manufacture a reduced Hold by editing its response locally.
- Terminal: clear Hold/reference and remain in Seats with factual valid draft state only.
- Transient/ambiguous verification: block Checkout and use the existing guarded recovery pattern with Retry / Start over. A read failure does not establish live Hold authority or justify another Order POST.

This recovery policy adds no guarantee that a failed Order preserves any Hold.

### M. Definite 403 / defensive 404

FACT: documented Order `403` means the Hold belongs to another account. Show the exact server message, block Checkout, clear payment fields, and do not retry automatically. Revalidate Hold/auth context before allowing another Pay; never expose another account's protected data.

Order `404` is not endpoint-documented. If generic API behavior surfaces it, treat it as terminal context failure, clear sensitive state and invalid Hold/reference, and expose safe recovery rather than a supposedly safe POST retry. Do not invent missing-Order semantics.

### N. Uncertain Order and explicit Tickets recovery

Network failure after dispatch, response-body read failure, malformed/unusable `201`, or unknown `500`/server failure without guaranteed rollback requires `order.phase = "uncertain"`. A received definite rejection is distinct from an ambiguous mutation outcome.

OpenAPI's global error guidance and Assignment require a retry path for server failures such as `500`. However, `POST /orders` has no documented idempotency support or GET Order-by-ID/Hold recovery endpoint. An observed `500`, network failure, or body-read failure does not prove that an Order was not created; repeating POST could create a duplicate purchase. Kino XII explicitly resolves this source tension through project safety policy: the retry requirement is a user-driven flow recovery path, not automatic or direct resubmission of the uncertain mutation.

Show Kino XII project copy:

`We couldn't confirm whether your order was completed.`

Offer `Check my tickets` and `Return to home`. Block normal Pay retry and Back-to-Seats resubmission. Do not show fake failure/success, automatically repeat POST, automatically refund, or DELETE the Hold as if no Order existed. Clear sensitive inputs when the active Checkout is terminally invalidated.

Immediately on entering uncertain, clear the persisted `{ holdId, sessionId }` Hold restoration reference from sessionStorage through the existing storage abstraction. Guarded restoration must never restore that submitted Hold into Checkout and expose fresh Pay while its prior Order outcome remains unresolved. Keep submitted holdId/sessionId only as non-persisted runtime recovery evidence where needed for stale-result/account guards. Persist no uncertain marker, Order request data, or payment data; do not automatically DELETE the Hold or treat its existence as proof that the Order failed.

Once Order has settled into uncertain, the previous Hold is no longer active Checkout authority in the UI. Hide the normal Checkout form, keep Pay unavailable, and stop presenting the Hold countdown as actionable Checkout time. Do not allow restoration of that Hold to re-enter Checkout. If the server-side Hold later expires, remain in Order uncertainty recovery until the user chooses `Check my tickets` or `Return to home`; do not transition back to Seats merely because its timer would have reached zero, and do not interpret expiry as proof of Order failure. This rule applies only after `order.phase` has settled to uncertain. It does not change §P's visible expiry transition for an Order POST that is still pending.

On explicit `Check my tickets`, fetch the current user's factual Orders through `GET /tickets`. Adopt a specific Order as the uncertain submission's result only if a trustworthy Order identifier from the partial response/request context matches exactly. Hold/session/request IDs are not Order identifiers; no request-to-Order association may be invented.

Never match merely by session, seats, contact, or cardLastFour. Without a trustworthy Order ID/reference, show factual account tickets without claiming a specific entry corresponds to the uncertain POST. Absence from `/tickets` does not prove resubmission is safe. No automatic resubmission is permitted from uncertain state. Future backend recovery/idempotency support requires a new verified capability, not a guessed endpoint.

`Return to home` exits uncertainty recovery and navigates Home without claiming Order failure, issuing Order POST, refunding anything, or automatically releasing the submitted Hold. After leaving uncertainty recovery, the user may later start a new booking through the normal Sessions flow. This is a fresh user-initiated booking/hold/order lifecycle, not replay or resubmission of the uncertain POST: retain no prior payment values, restore no previous Hold from storage, replay no prior mutation, and make no claim that the uncertain Order failed. Never automatically recreate/resubmit it or add a special `Retry Order` button that sends the prior payload. These factual recovery/navigation actions and a later explicit new booking are the accepted Checkout retry path for ambiguous outcomes; they provide no exactly-once or safe-retry guarantee for the earlier mutation.

### O. Close without unresolved Order versus pending Close

Without a pending/uncertain Order, Checkout Close is abandonment under D-027: clear sensitive form state and the restoration reference, close promptly, and initiate best-effort captured Hold release when applicable. Preserve existing release-failure/expiry fallback and never release a newer Hold.

While Order POST is pending, Close/Escape/backdrop Close must close UI promptly, clear sensitive payment fields and normal Checkout presentation, and clear its normal active restoration reference so closed Checkout is not restored. Preserve detached non-sensitive request identity in runtime memory until settlement. Do not assume fetch abortion cancels the server mutation and do not automatically DELETE the Hold while Order outcome is unresolved; release could conflict with successful in-flight purchase.

After detached settlement, subject to request/account/auth/Hold guards:

- Definite rejection: best-effort release the still-known live Hold when appropriate; do not reopen closed UI solely for the rejection or claim release succeeded.
- Valid late `201`: retain only guarded detached purchase evidence for the same account/request; never reopen or mutate a newer booking. Surface one non-sensitive notification `Your order was completed.` with `View my tickets`.
- Uncertain outcome: do not reopen the closed modal; retain detached uncertainty only for the current tab/account and surface `We couldn't confirm whether your order was completed.` with `Check my tickets`.

The notification/action policy is Kino XII UX, not a verified Figma toast design or a requirement for a new notification dependency. No automatic refund is authorized. Closing an already uncertain outcome likewise does not authorize Hold DELETE or POST retry.

### P. Expiry while Order is unresolved

Run the normal current-Hold visible expiry transition once: invalidate Checkout, clear active Hold authority/reference and seat draft, clear payment fields, stop its timer, return to Seats, refetch the authenticated map, and show `Your hold time expired. Please re-select your seats.` Do not DELETE for expiry.

Preserve detached unresolved Order identity independently of Hold/active operation cleanup; expiry is not proof of rejection. A late valid `201` becomes same-account detached purchase evidence and produces `Your order was completed.` with `View my tickets`; it must not overwrite a newer booking. A late definite rejection cannot resurrect expired Checkout. A late ambiguous result uses the detached uncertainty notification and `Check my tickets`.

### Q. Logout / account change while pending

Logout/account switch clears sensitive local values and removes protected Checkout UI immediately. Preserve only non-sensitive detached request identity sufficient to reject stale writes. Apply the unresolved-Order no-release rule rather than blindly applying Hold-only logout cleanup to its submitted Hold. Logout must not be blocked by settlement.

Never show previous-account Order details or notifications to a different account. Late results cannot populate current-account state or borrow its auth to release an older Hold. Do not persist detached Order results across accounts. Detached notification delivery requires the applicable current-account/auth guards; retaining origin identity is not permission to display protected results after logout.

### R. Successful response validation

Do not accept arbitrary HTTP `201` as confirmation. Validate usable response data sufficient for actual confirmation: reference, paid status, numeric totalPrice, session/movie/venue/hall/format/language context, and a usable tickets array with seatCode, ticketType slug/name, and numeric price. Require usable contact information for displayed contact fields; paidAt and cardLastFour are required only if displayed.

Check request/session/account correspondence under current or detached guards as applicable. Do not fabricate missing values or replace server tickets/prices with local estimates. These are frontend usability checks; they do not claim that the OpenAPI response formally marks every property required. Malformed/unusable `201` goes uncertain, with no automatic POST retry and no fake confirmation.

### S. Current success transition

For a valid CURRENT `201`, adopt returned Order as authority, set `order.phase = "success"`, end active Hold checkout authority, clear the stored Hold reference, stop its timer, clear payment fields, and permanently block duplicate Pay for that instance. Enter Confirmation in the same booking dialog. Detached success follows §§O–Q rather than reopening Confirmation.

Do not DELETE Hold after successful Order. The API describes conversion of a live Hold to a paid Order; its success flow does not require DELETE. Do not depend on, or claim, physical Hold deletion or an undocumented post-purchase Hold representation.

### T. Confirmation visuals and source conflicts

Use GTU connection `link_6ac0b67d4a348191a63166ae0ce0eb57`, editable file `Zeb7RQ8mjGp04YIPde2ud2`, Confirmation `265:3957`, full-page `291:22766`. Keep Confirmation in the same dialog with title `Booking confirmed!` and returned Order reference, movie/session, venue/hall, format/language, tickets/seat codes/types/prices, and totalPrice. No local preview can override them.

Primary action is `View my tickets`; secondary action is `Back to home`. Preserve the top-right Close under existing project modal policy, satisfying Assignment's Close requirement alongside the Figma actions. Do not show timer, booking progress, QR, fake download, full card number, expiry, or CVV.

The verified Figma sentence `Your tickets are ready. We've sent the confirmation to your email.` includes an unsupported delivery claim. Omit the email-delivery sentence/claim; the API supplies no delivery guarantee/status. This is an explicit source conflict resolution, not evidence that delivery happened or failed. Any remaining supporting copy must make no unsupported email claim.

### U. Confirmation actions and minimal My Tickets destination

`Back to home` closes booking, navigates Home, clears transient confirmation, and sends no Hold DELETE. Close clears transient confirmation and closes the dialog without Hold DELETE. `View my tickets` closes the completed flow and navigates to Profile's real My Tickets area; confirmation remains transient and no Hold DELETE is sent.

CHECKPOINT CHECKOUT must enable the minimum real Profile My Tickets navigation/tab/route state required for this action. Fetch `GET /tickets` when that destination is opened and render enough actual Order/ticket information to establish a functional destination according to existing Assignment/Figma facts. Include loading, error, and factual empty states; never substitute fake tickets or a disabled action. Full visual implementation, if materially larger than this handoff, follows in a separate Tickets checkpoint; a minimal accepted destination is permitted here.

Do not implement refunds in CHECKOUT. Do not automatically fetch tickets immediately after purchase solely to populate a speculative cache. The explicit `Check my tickets` recovery action opens the same factual destination and fetches there under current-account guards. Recovery/navigation actions do not resubmit Orders.

### V. Confirmation refresh and storage boundaries

Do not add Checkout/Order persistence. Existing Hold storage remains the exact minimal sessionStorage `{ holdId, sessionId }` through its abstraction. Success clears that reference. No buyer/payment/Order draft, confirmation result, detached result, or uncertain request marker is persisted.

Refreshing after success may leave the user outside transient Confirmation; factual purchases remain recoverable through My Tickets / `GET /tickets`. Payment data never survives refresh. Existing guarded Hold restoration remains unchanged where applicable, but a restored Hold cannot prove whether an earlier lost Order response represented success. Refresh loses in-memory detached request/uncertainty tracking; this policy does not promise cross-refresh exactly-once protection or authorize automatic Order replay after restoration.

### W. Checkout geometry and progress resolution

Use the completed audit's composed full-page filled Checkout `291:22284` as the primary desktop reference; supporting Checkout nodes are `265:3953`, `265:3955`, and empty full-page `291:21718`. This is project presentation policy resolving conflicting variants, not a claim that their geometry is identical.

| Element | Accepted desktop reference |
| --- | --- |
| Dialog / body | 1146×599 / 1082×452 |
| Form / summary columns | 720 / 321 |
| Divider / surrounding gaps | 1px / 20px each side |
| Progress | 720×33; Checkout active |
| Input | 40px high; radius 12 |
| Field vertical gap | 24px |
| Paired fields | 354 + 12px gap + 354 |
| Summary purchase CTA | 321×41 |
| Timer | 102×46 |

Use consistent empty/filled layout geometry where practical, rather than shifting modal height as values change. Do not use the empty mock's larger 44px controls when they cause layout shift. Preserve necessary accessible error/control reachability rather than clipping content to force sample height. Existing desktop/overflow policy remains applicable.

The standalone Checkout components highlight Seats while both composed full-page references use Checkout progress. Preserve D-027's Checkout-active requirement and composed reference; do not reproduce the standalone incorrect step state.

### X. Back placement and purchase presentation

Figma establishes no Checkout Back control. Add the project-required Back as a secondary control in the left/form-column footer, aligned consistently. Keep it outside the payment-summary CTA area and preserve the 321px summary CTA. This placement is Kino XII policy, not a guessed Figma measurement.

Use §H's Assignment-required CTA, readiness gating, and pending copy; do not infer enablement from the filled sample. New pending/recovery treatments compose existing project visuals and must be identified as policy fallbacks when no exact Figma state exists.

### Y. Accessibility and focus

Use a semantic form, associated labels, visible focus, field-error associations and `aria-invalid`, first invalid input focus after failed submit, pending `aria-busy`, and status/error feedback with no sensitive values. Confirmation title receives focus when success replaces the form. Expiry focuses the Seats recovery context; uncertain state focuses its recovery heading/action. Do not let asynchronous callbacks steal focus from a newer booking/account.

Close remains keyboard-accessible; Escape/backdrop follow current modal behavior and the pending detached policy. Timer retains `role="timer"` and `aria-live="off"`; announce expiry separately without per-second announcements.

Recommended autocomplete values may be used: `name`, `email`, `tel-national`, `cc-number`, `cc-exp`, and `cc-csc`. Use text inputs where leading zeros/formatted values matter and appropriate inputMode hints without introducing extra validation rules. These attribute choices are accessibility implementation guidance, not API/Figma facts.

### Z. Minimal shared Order state

Accept shared lifecycle state:

```js
order: {
  phase: "idle", // idle | submitting | success | error | uncertain
  data: null,
  feedback: null
}
```

`order.data` contains the returned Order only. Do not duplicate authoritative total, tickets, reference, session, or contact outside it. Definite rejection uses error; uncertain outcome uses uncertain, not a guessed rejection. Form values/payment-field errors remain local. Detached pending request identity belongs to runtime/coordinator memory, not reducer persistence, and remains distinct from a newer active booking's Order state.

### Backend ambiguity disclaimer

The frontend does not claim Order idempotency, exactly-once purchase semantics, network failure means no Order was created, `500` means rollback, fetch abort cancels the server mutation, failed Order preserves the Hold, successful Order physically deletes the Hold, `/tickets` absence proves safe retry, or automatic refund is authorized. These guarantees are unconfirmed.

No frontend decision can supply absent backend transactional guarantees. Use explicit uncertainty, factual Tickets recovery, guarded detached handling, and no automatic ambiguous POST retry. Accepted definite-401 continuation is scoped to the received rejection, not ambiguous transport outcomes.

### Async safety

Guard every Order result/callback with applicable submit request identity, booking instance, account ID, auth/token generation, session ID, and submitted Hold ID. Separate active-state adoption from detached handling. Settlement cannot clear another request's lock, reopen old Checkout, overwrite newer booking, leak purchases across accounts, repeat a mutation, or release/delete a newer Hold.

Detached late results may only produce the accepted non-sensitive notification/action for the eligible current account, with protected purchase evidence isolated from another account's active state. Do not borrow newer account authentication for cleanup. Hold expiry/Close cleanup must not erase unresolved Order identity.

### Source attribution

`Completing your order…`, `Completing order…`, `We couldn't confirm whether your order was completed.`, and `Your order was completed.` are Kino XII project UX strings. Uncertain recovery actions, detached-result notification, current-month expiry interpretation, Back placement, input geometry reconciliation, pending controls, and explicit payment re-entry after Order 401 are project policies. Do not present them as OpenAPI guarantees or exact Figma states.

### Reason

Order creation is an irreversible/high-value booking mutation even though this API simulates payment. There is no documented idempotency or direct Order recovery by Hold. Payment values require stricter local-state boundaries, Checkout Figma variants conflict, and pending/uncertain/success navigation needs deterministic frontend behavior. The purchase and recovery actions also require a functional My Tickets destination. Resolve these choices before implementation while preserving source authority and the completed HOLD lifecycle.

### Affected

- booking API module
- booking runtime/provider/reducer and guarded detached request handling
- Order operations/lifecycle helpers
- local Checkout form and validation
- confirmation rendering/actions
- minimal Profile My Tickets handoff and factual GET `/tickets` reads
- booking CSS and accessible focus/status behavior
- focused lifecycle/rendering tests and deterministic intercepted browser QA

No dependency requirement is implied. This decision documents policy only: it implements no src/CSS/assets/dependency changes, modifies no architecture document, sends no production mutation, and leaves D-001 through D-027 unchanged. Full Tickets visuals/refunds remain a separate checkpoint beyond the accepted minimal handoff.

---

## D-029 — Refund lifecycle, bounded authentication continuation, and authoritative Tickets reconciliation

**Status:** Accepted
**Proposed:** 2026-10-08

### Scope and source attribution

Propose the frontend Refund lifecycle for Full My Tickets. This decision requires independent review and explicit acceptance before implementation. It leaves D-001 through D-028 unchanged, including D-026 read recovery, D-027 Hold recovery, and D-028 Checkout/Order recovery. Refund must not inherit their mutation-specific replay rules merely by reusing helpers.

Sources: OpenAPI paths /tickets.get and /orders/{order}/refund.post, components.schemas.Order, and components.responses.Unauthenticated / Forbidden / BookingBlocked; Assignment §§21–26; Master Spec §§16–19; Architecture §§9, 20, 23, 34, and 36. OpenAPI governs the contract, Assignment governs functionality, and exact Figma inspection governs visuals. Lifecycle names, continuation limits, runtime ownership, recovery copy, and dismissal behavior below are proposed Kino XII policies, not new backend guarantees or verified Figma states.

### A. Contract baseline and Order ownership

Both operations require Bearer authentication. Refund is POST /orders/{order}/refund with no documented request body; success is HTTP 200 with { data: Order }. GET /tickets returns HTTP 200 with { data: Order[] }; omit filter for exact-reference recovery across Upcoming and Past. The optional filter supports only upcoming and past. Preserve the documented newest-session-first ordering.

Use the exact server-returned Order.reference as the refund path value, encoded as one URL path segment without trimming, case conversion, or numeric-ID fallback. The path parameter is a string with example KX-7QF2LD, matching Order.reference; Order.id is an integer. Choosing reference is the explicit scope of this proposal and the requested checkpoint, not a claim that numeric-ID routing is supported or that OpenAPI explicitly describes backend binding. Do not manufacture a reference or substitute a Hold, session, seat, or request ID.

Order.isRefundable is the sole refund-eligibility authority. Never compute the two-hour cutoff, derive eligibility from startsAt, or run a local cutoff timer. Upcoming/Past membership comes from Order.isUpcoming or the documented server filter, never local date arithmetic. Validate status/flags for usable, coherent server state; this does not add an independent eligibility calculation. A malformed or inconsistent Order cannot authorize POST.

Render a disabled Refund control and accessible explanation/tooltip when the server marks an Upcoming Order non-refundable. No refundReason property is documented. General explanatory copy can state the documented cutoff rule but must not invent a returned reason. Refunded Orders belong in Past regardless of session date, with no upcoming purchase/refund actions. Refund requires no locally invented booking-profile-completion gate.

### B. State ownership and lifetime

Keep the dialog, selected tab, Orders read state, and visible feedback in the Profile/Tickets feature. Keep refund domain operations separate from rendering and endpoint handling in ticketsApi. Existing Profile drafts, URL navigation, factual Order recovery, and BookingProvider ownership remain intact.

A small Refund-specific runtime ledger must survive dialog, Tickets-panel, and Profile-route unmount/remount within the running application. Own it at a stable app-shell lifetime rather than inside a disposable dialog/hook. It stores mutation/continuation identity and unresolved-reference guards, not a general UI store or global Orders cache. React built-in state/refs and a narrowly scoped shared interface are sufficient; no dependency or Booking reducer rewrite is implied.

Use one active confirmed continuation, and at most one actively pending client-owned Refund POST in the application runtime, including across account changes. An uncertain result invalidates the old consent and prevents automatic replay; it is not a permanent ban on a separately verified, newly confirmed attempt under Section F. Keep a minimal prior-uncertainty marker separate from the current attempt phase, even when a new attempt becomes available or starts. Retain only the records needed for settlement, uncertainty disclosure, and guarded re-entry. Dialog/panel effects may subscribe or GET; they must never create or replay POST from mount, rerender, subgroup selection, or restoration.

Represent attempt phases as idle, confirming, submitting, reauth, verifying, verification_retry, retry_available, succeeded, rejected, uncertain, and blocked. UI attachment, prior uncertainty, and card display status (ready, refreshing, or error) are separate from attempt phase. Verification records its purpose: definite-401 continuation, uncertainty recovery/new-attempt eligibility, rejected/blocked-context refresh for a new intent, or display restoration. A paid snapshot never authorizes an automatic POST in the uncertainty flow.

Consent rules are explicit: confirming holds fresh unsubmitted consent; submitting consumes that dispatch consent; reauth/verifying/verification_retry retain the original consent only for an unused definite-401 continuation. Other verification holds no POST consent. retry_available permits opening NEW confirmation, never dispatching by itself, and retains prior uncertainty. succeeded/rejected/uncertain/blocked hold no reusable POST consent. blocked is terminal for the old continuation: erase its descriptor and automatic replay permission. verification_retry retains only the purpose-specific read recovery and, for the unused 401 path only, its bounded consent. No mount or read retry can revive terminally discarded consent.

| Event / boundary | Transition / permitted work |
| --- | --- |
| Explicit Refund on usable eligible Order, with no unresolved history | idle → confirming; no POST |
| Cancel/X/Close/Escape/backdrop before dispatch | confirming → idle for an ordinary attempt, or retry_available/uncertain for a renewed attempt according to still-current verification; erase consent, retain prior uncertainty; no POST |
| Explicit confirmation with current account/reference/consent guards and no active client POST | confirming → submitting; acquire synchronous lock before dispatch |
| Matching HTTP 200 with status refunded | submitting → succeeded; record reported outcome; adopt card only if fully usable, otherwise refresh display through GET |
| Current first definite HTTP 401 with original consent still active | submitting → reauth; preserve bounded intent |
| Same-account authentication for definite-401 intent | reauth → verifying (401 purpose); fresh unfiltered GET only |
| Exact fresh eligible target in 401 verification, unused budget and active intent | verifying → submitting once; consume replay budget before automatic continuation POST |
| Refunded target in any verification | verifying/verification_retry/retry_available → succeeded; retain factual reported refund outcome; restore complete display if needed; no POST |
| Ineligible/missing/duplicate/malformed/contradictory target in 401 verification | verifying → blocked; erase old continuation; later action requires fresh authority and new confirmation |
| Transient GET failure in 401 verification | verifying → verification_retry; retain unused bounded consent; explicit GET retry only |
| Explicit verification retry | verification_retry → verifying with the same purpose and budget; no consent creation |
| HTTP 401 during definite-401 verification, or on its one continuation POST | verifying/submitting → blocked; discard old consent/budget, guard auth expiry; no automatic second Login/replay cycle |
| Definite 403 / defensive 404 / message-only 422 | submitting → rejected; show server feedback and refresh factual Tickets; no automatic POST |
| Factual refresh after rejection (initial or explicit GET retry) | rejected → verifying (read-only purpose); preserve refusal message and prior evidence; no old consent |
| Definite refusal acknowledged / feedback dismissed | rejected → idle with old consent erased; cached target cannot authorize another attempt before fresh verification; retain any earlier uncertainty |
| Network/body-read failure, unrecognized identity/status, or unknown server outcome | submitting → uncertain after local settlement; erase old consent; no automatic POST |
| Explicit Check refund status after the client request has settled | uncertain → verifying (uncertainty purpose); fresh unfiltered GET only |
| Fresh exact usable paid/Upcoming/refundable target in uncertainty verification and no actively pending client POST | verifying → retry_available; retain earlier uncertainty; no POST |
| Paid but non-refundable/Past, missing/invalid/duplicate target in uncertainty verification | verifying → uncertain; no new POST; GET recovery remains available |
| Failed uncertainty/rejected/blocked-context verification | verifying → verification_retry; hold no POST consent; preserve prior evidence; explicit GET retry only |
| Read-only recovery GET 401 outside definite-401 continuation | verifying → verification_retry; bounded same-account Login/read recovery only; no POST on auth success; exhausted read-auth recovery → blocked with prior uncertainty retained |
| Explicit renewed Refund after eligible verification | retry_available → confirming with NEW consent and Section F warning; no POST until new explicit confirmation |
| Eligibility snapshot superseded or account/auth changes before renewed dispatch | retry_available/confirming → uncertain if prior outcome unresolved, otherwise blocked; erase new consent and require fresh GET |
| Completion acknowledged / completed dialog closed | succeeded → idle; retain reported refunded authority and display-refresh/error state; no Refund enablement from stale paid data |
| Display-restoration GET fails or returns 401 after reported success | Keep succeeded/acknowledged-idle outcome authority; display status becomes error/auth-required; explicit bounded GET recovery, never POST |
| Explicit Retry display details after reported success | Keep outcome authority; display status refreshing; fresh GET only |
| Ineligible/missing/duplicate/malformed target in rejected/blocked-context verification | verifying → blocked for that proposed new intent, or uncertain when prior ambiguity remains; no POST; later recovery requires fresh GET |
| Explicit read recovery from blocked | blocked → verifying (new-intent authority purpose, never old 401-continuation purpose) with no old consent/budget; fresh eligible data can support a new confirmation, or retry_available with warning if prior uncertainty remains |
| Blocked feedback dismissed | blocked → idle presentation; old continuation remains terminated; cached target stays unauthorized until fresh GET, and prior uncertainty still requires Section F |
| Pending Close or leaving My Tickets context | submitting stays submitting, detached; revoke further automatic continuation; lock survives until local settlement |
| Leaving My Tickets, or explicitly canceling retained auth/read continuation before further dispatch | confirming/reauth/verifying/verification_retry/retry_available → idle presentation; erase continuation/new consent; preserve prior outcome markers and any separately active request |
| Upcoming/Past, URL subgroup, or Back/Forward changes within My Tickets | Preserve runtime phase, consent generation, lock, and applicable bounded continuation; no mount-triggered POST |
| Expected auth-expiry UI unmount for a permitted continuation | Preserve runtime intent and applicable phase; mask protected data; no inferred cancellation |
| Explicit logout or different account | Detach pending request; terminate continuation/consent and hide protected UI; retain only origin guards/evidence; old responses cannot populate the new account |
| Same account returns after auth invalidation | Fresh guarded GET before adopting protected data or opening new confirmation; no old POST replay |

Stable idle means no reusable confirmation/continuation, not erased server outcome or proof that an uncertain request failed. Fresh rejected-context/blocked verification transitions to idle with authoritative eligible data when there is no prior uncertainty; with prior uncertainty, it must satisfy Section F and transition to retry_available. Terminal or exhausted automatic continuation never resumes from verification_retry/blocked merely because the component mounts again.

### C. Confirmation, synchronous lock, and request identity

Open confirmation only from an actual usable Order. Explain irreversibility and identify the exact Order with its returned movie/session/tickets. The explicit confirmation authorizes that account/reference only. Immediately before dispatch, recheck current account/auth, selected-reference ownership, authoritative isRefundable, coherent paid/Upcoming state, consent generation, and absence of any actively pending client-owned POST. If prior uncertainty exists, require the fresh Section F verification and NEW warned confirmation; the uncertainty marker is retained, not treated as reusable consent.

Acquire the runtime lock synchronously before notifying React subscribers or constructing dispatch work. Then set explicit submitting state, disable the confirm action and competing refund starts, and announce pending once. Recheck guards after synchronous notifications before dispatch. Double-click, repeated Enter/form submission, stale event handlers, StrictMode effect replay, and panel/dialog remount must not send another POST.

Capture a unique request ID, consent/operation generation, account ID, auth/token generation, exact reference, and available original Order/session identity for correspondence checks. The private dispatch/guard closure may capture the request credential; never expose it through reducer/UI state, continuations, logs, URLs, probes, or storage. A continuation contains plain bounded identity data, not a callback, Promise, token, full Order, contact, or payment payload.

Every settlement, verification read, auth effect, notice, and delayed focus callback must check the applicable request, account/auth, consent, and current presentation identity. Only the owning request can release its lock. An obsolete response cannot clear a newer lock, invalidate newer auth, overwrite another Order, or reopen/focus a newer dialog.

### D. Authoritative outcome versus complete card adoption

HTTP 200 with an object envelope containing data.reference exactly matching the requested Order.reference and data.status === "refunded" establishes the server-reported refund outcome under current request/account/auth guards. Record succeeded and retain that minimal factual outcome. Missing poster, total, flags, ticket/session details, or other unrelated display fields do not by themselves make that reported outcome ambiguous. Additional inconsistent display/correspondence fields require reconciliation, not erasure of the matching reference/status evidence.

Complete-card adoption is a separate check: require coherent returned boolean isUpcoming/isRefundable flags (false for a refunded Order), finite server totalPrice, usable session/movie/venue/hall/date/time/format/language context, and non-empty usable tickets with seatCode, ticketType slug/name, and finite prices. Check captured Order/session IDs where supplied; do not coerce identifiers. Optional contact/card/timestamp fields are required only if displayed. These are frontend usability checks, not a claim that OpenAPI formally marks every field required. Reuse compatible pure readability helpers; do not use the paid-only Confirmation validator or tighten Checkout validation merely for Refund.

When the outcome is reported refunded but the card is incomplete/inconsistent, set display status refreshing and issue fresh unfiltered GET /tickets to locate the exact reference and restore complete server-provided display data. Show factual refund-completion feedback plus loading/error for its details; do not adopt the partial object as a full card, merge guessed fields/flags into the previous paid Order, or fabricate a Past card. GET failure, target absence, or contradictory paid data does not erase the reported success or enable another Refund. Keep its factual outcome separate while allowing read-only display recovery. Missing/mismatched reference, unrecognized/non-refunded status, or a genuinely unusable identity/status envelope remains in Section F uncertainty; an unexpected successful HTTP status is not a documented refund confirmation.

For a complete guarded success, replace the matching record with returned Order authority, render returned ticket/session/price facts, and group by returned isUpcoming. Do not optimistically delete or locally mark a paid Order refunded. Keep the selected tab; announce completion and offer explicit View past tickets. Fresh server lists reconcile ordering; do not calculate cross-tab positions or grouping from client dates.

Advance the Tickets read/mutation generation and abort/obsolete competing reads at dispatch and again at outcome settlement/reconciliation. A GET started before the reported mutation result must not overwrite it, including one begun during POST. Remounted readers share the same authority barrier. A failed refresh cannot undo reported success. A later contradictory paid record for a reported refunded reference is an inconsistent verification result: surface safe feedback, preserve known outcome, and never re-enable Refund from that contradiction. Closing/acknowledging success returns presentation to idle while retaining this outcome and any display-recovery state.

### E. Definite HTTP 401 — one bounded automatic continuation

A reliably received current HTTP 401 is the documented authentication rejection. It is distinct from an ambiguous transport/body-read failure, which cannot be classified as 401 from message text or presumed token expiry. The proposed continuation follows OpenAPI's login-and-replay instruction only for that definite rejection; it does not infer rollback for lost responses.

For the first definite 401 while the original confirmed intent is still active:

1. Verify current request and expected-auth ownership; invalidate only the stale authentication through existing guarded auth coordination, without logout POST or a global interceptor. End the dispatched request's pending marker and retain the operation's continuation guard.
2. Preserve one transient REFUND_REAUTH descriptor: accountId, exact reference, captured Order/session identity where available, consent generation, replayCount initially zero, and verification purpose. Keep confirmation consent in memory; retain no full Order, credential, or payment data in the descriptor.
3. Open the existing Login flow, preserving intent across Login ↔ Sign Up switching. Coordinate the bounded Refund continuation separately from OPEN_BOOKING and Profile drafts; never invent a booking session ID, silently overwrite a booking continuation, or overwrite the existing booking-logout cleanup handler.
4. On successful authentication, require the original account ID and current new auth generation. A different account, explicit logout, auth cancellation, dismissed refund intent, leaving My Tickets context as defined in Section G, superseding intent, or exhausted budget discards automatic continuation. No POST is sent for that old consent.
5. Fetch fresh unfiltered GET /tickets under the new auth with read/request guards. Find exactly one Order whose reference equals the captured reference; validate captured IDs when present and current server status/flags. Never match by movie, session, seats, contact, or list index alone.
6. If the unique exact-reference Order reports refunded, retain factual refunded outcome without POST or a claim that the rejected request caused it; restore incomplete display through Section D. If it is paid, Upcoming, and isRefundable === true, with all consent/account/request guards still current, consume the descriptor and increment replayCount to one synchronously before acquiring dispatch ownership and sending one automatic continuation POST. No second confirmation click is required for this still-valid previously confirmed intent.
7. Paid but non-refundable/Past, missing/duplicate reference, or inconsistent identity/flags ends automatic continuation with safe explanation and no POST. A transient verification failure retains the unused continuation in verification_retry, distinct from terminal blocked; offer explicit Retry verification (GET only). A valid retry can continue once only while the same undismissed intent remains active.

A 401 from the continuation POST, or a 401 during its verification, may expire only the guarded current auth but ends the descriptor/budget and must not automatically open another Login/replay cycle. Show sign-in/recovery feedback; subsequent explicit authentication and a newly confirmed action are distinct user intent, not a reset of the old replay budget. Mounting, retrying a read, or switching tabs cannot reset the budget.

If the original dialog was closed or My Tickets context was left while POST was pending, a late 401 is detached settlement: no automatic Login, verification-to-POST, or consent revival. Cancellation revoked permission for further dispatch even though it could not cancel the request already sent.

Implementation note (N5): src/auth/pendingAction.js currently normalizes only OPEN_BOOKING. AppShell/Profile expiry currently stores only a Profile access/reauth descriptor with userId; it does not store Order reference, Refund consent, or replay budget. The future Refund feature needs a separate bounded coordination path connected to existing auth success/cancellation, account guards, and semantic My Tickets context. Reusing Profile expiry alone does not implement Refund continuation. Do not extend that path, fake a booking action, or change application code in this documentation checkpoint.

### F. Ambiguous outcome, factual verification, and a newly confirmed attempt

Network failure after dispatch, response-body read failure, an unusable identity/status success response under Section D, HTTP 500 with unknown outcome, and an unclassified status/outcome enter uncertain after local request settlement. Do not announce failure, assume rollback, or automatically repeat POST. An aborted submitted request supplies no server-cancellation proof. Preserve minimal account/reference prior-uncertainty evidence across dismissal/remount; uncertainty invalidates the old dispatch consent but is not a session-long prohibition on a new explicit attempt.

Use proposed project copy: We couldn't confirm whether your refund was completed. Offer Check refund status (fresh unfiltered GET /tickets), and Close/Return to my tickets to leave presentation. Repeated checks are reads only. Neither GET completion, auth success, component mounting, nor an eligible flag may automatically POST after ambiguity.

Before verification can authorize a renewed attempt, the original client-owned POST must no longer be actively pending: its Promise has settled, it has been classified uncertain, and its own in-flight lock has been retired without clearing another request's lock. Obtain a new unfiltered GET /tickets initiated after that settlement, for the same authenticated account and current auth/read generation. Locate exactly one Order by exact reference, validate identity/status and ensure no other client-owned Refund POST is active. A paid target additionally needs complete usable server data and coherent eligibility flags before another attempt can be offered. A read begun while the original request was pending cannot serve as this new-attempt eligibility evidence.

| Fresh verification evidence | Interpretation / permitted UX |
| --- | --- |
| Exactly one matching Order reports status refunded | Treat it as currently refunded and use Section D to restore complete display if needed; no POST; do not attribute which request caused it |
| Exactly one usable matching Order has status paid, isUpcoming === true, and isRefundable === true, with the settled-request/account guards above | retry_available: offer an explicit new Refund confirmation with the warning below; no automatic POST and no claim the old attempt failed |
| Matching paid Order is Past or isRefundable is not true | Keep factual status and server-controlled disabled eligibility; uncertain/recovery presentation remains; no new POST |
| GET fails, reference is missing/duplicated, identity/status are unusable, or a paid target has unusable/contradictory flags/display data | verification_retry for transient read failure, uncertain for inconclusive target; GET retry only; no new POST |

Only an explicit user action from retry_available may open NEW confirmation. Before its confirm control, show this proposed warning: We couldn't confirm the earlier refund. Your tickets currently show this order as paid and refundable, but the earlier request may still complete. Confirming sends a new refund request. Keep that warning in the confirmation interaction; no default-confirm, automatic acceptance, or assertion that the new request is guaranteed safe.

NEW explicit confirmation creates a new consent generation, request identity, synchronous lock, and current account/auth ownership. Recheck exact reference, fresh eligibility evidence, active-request absence, and read/consent generations immediately before dispatch. A changed account/auth/context, revoked consent, superseded verification, or reported refunded/ineligible target prevents dispatch and requires appropriate fresh verification. Cancellation erases the new consent without erasing the earlier uncertainty. This is a new user-initiated operation, not a replay of the uncertain mutation. Its own definite-401 handling remains bounded by Section E; retained prior uncertainty stays disclosed rather than being reset by the new intent.

A paid snapshot does not prove that the earlier server request has stopped or cannot still settle. Local Promise settlement ends client-owned pending work only. OpenAPI documents 422 refusal when already refunded, but no idempotency key, transactional atomicity, concurrent-request serialization, or exactly-once delivery guarantee. This proposed recovery permits a newly warned attempt under fresh server eligibility and consent, with residual backend uncertainty; it does not claim duplicate refunds are mathematically impossible. Never infer a rollback, create an idempotency key, or silently clear prior uncertainty just because verification is paid or a new attempt starts. A later refunded report establishes current refunded state without proving that the earlier request failed or identifying which attempt caused it.

On the new attempt's 422, display the actual server message, finish that confirmed attempt, and refresh unfiltered authoritative Tickets state. Do not parse the message to infer refunded/cutoff state. Derive current status/flags from structured server data, retain accurate prior-outcome disclosure, and require another fresh warned confirmation before any subsequent separately permitted attempt. Another ambiguous outcome returns to verification recovery, never an automatic retry loop.

A GET 401 during uncertainty/new-attempt eligibility recovery uses one bounded same-account Login/read continuation only. Transition to verification_retry with no POST consent; after auth, a fresh GET may restore factual state or retry_available, but POST still requires a NEW warned confirmation. A second 401 in that read-recovery cycle terminates it in blocked, masks protected data, and requires explicit sign-in/read recovery without automatic looping. Different-account auth or explicit cancellation discards that read continuation; origin outcome evidence remains private. Cancellation/navigation never turns uncertainty into failure.

### G. Pending dismissal, My Tickets context, and late settlement

Before dispatch, Cancel, X, Close, Escape, and backdrop dismiss confirmation and erase consent; no request is sent. While POST is pending, keep X/Close/Escape/backdrop available and close UI promptly. Disable the mutation confirmation, not dismissal. Replace any Cancel label during submission with Close, explain that closing does not cancel a submitted refund, and retain pending status in the account's Tickets context when visible.

A pending dismissal revokes permission for any future automatic continuation POST, detaches presentation, and leaves the dispatched request and ledger lock intact until local settlement. Do not abort POST merely to implement dismissal, assume abortion canceled server work, release seats locally, DELETE a Hold, or attempt a compensating mutation. This resolves Assignment §22 dismissal versus §§22/26 duplicate prevention: close remains usable while mutation ownership survives independently. A later separately verified and newly confirmed attempt under Section F is distinct consent, not revival of a canceled continuation.

Define My Tickets context semantically using the existing route helpers: pathname === ROUTES.profile and profileTab(search) === "tickets" (currently /profile?tab=tickets). Leaving that context for another page OR Personal Information/another Profile panel revokes unsubmitted confirmation, automatic 401 continuation, read-only auth continuation, and any unconsumed new-attempt verification permission; it detaches dispatched work without erasing origin outcome evidence. A pathname-only check is insufficient. Check current context/consent generation again before continuation dispatch, so navigating away and back cannot revive old consent.

Changing Upcoming/Past within My Tickets does NOT leave this context. URL-only subgroup/query changes, unrelated search parameters, and browser Back/Forward while the semantic predicate remains true preserve runtime consent generation, lock, and applicable continuation. Back/Forward to another Profile panel or another page does leave it and cancels continuation. Track true-to-false context membership and explicit cancellations, not location-object identity, the entire search string, or every component unmount.

Ordinary dialog/panel unmount, StrictMode cleanup, subgroup changes, and expected auth-expiry/Login UI replacement detach presentation without clearing runtime ownership. The Profile auth gate unmounts MyTickets during reauthentication; that expected unmount while the route remains in My Tickets must not be mistaken for user cancellation. Unsubmitted local confirmation is discarded on explicit dismissal/context exit; UI cleanup or subgroup remount alone must not be interpreted as cancellation. A previously confirmed 401 intent remains runtime-owned until explicit cancellation or another Section E terminal condition. Remount can GET/subscribe and display existing phases, never reset locks/create consent/dispatch POST. Only the domain coordinator completing Section E may perform its bounded automatic continuation; Section F always requires a new explicit confirmation. Late callbacks cannot continue after consent/context generation was revoked.

For detached settlement with unchanged originating account/auth, matching HTTP 200/refunded identity establishes the reported outcome even if display is incomplete. Update the active matching Tickets feature only under shared guards, or retain minimal outcome/invalidation and restore display through GET on next entry. Queue at most one non-sensitive completion notice; do not reopen/navigate/focus UI automatically. A definite refusal queues account-scoped feedback; a detached 401 does not force Login for canceled consent. Uncertainty preserves origin evidence and offers Section F recovery. Notification styling is project fallback, not a verified Figma toast/dependency.

Expected auth expiry for permitted Section E continuation hides protected UI but preserves its bounded consent through the guest/Login interval. Read-only auth recovery under Section F preserves only its read descriptor and outcome evidence, not POST consent. Explicit logout/account switching immediately hides protected Orders/dialog/feedback, discards continuation/new consent/eligibility snapshots and protected response data, and invalidates display/auth generations without awaiting POST. Any still-active client POST retains the runtime dispatch lock across that account change; new-account UI must expose no origin Order details. Retain only private minimal origin/request/reference evidence and guards; never expose them to another account or borrow its credentials. Old-auth settlement may retire only its own pending marker, never replace User/Orders, open Login, display an old notice, or clear a newer lock. Same-account later login requires fresh GET; neither login nor returning to My Tickets restores old confirmation.

Refund adds no browser-storage or URL persistence for intent, ledger, Orders, credentials, or outcome markers. Existing tokenStorage/persistence remains unchanged under D-006. Reload/browser close loses in-memory tracking; no cross-refresh duplicate-prevention or exactly-once guarantee follows. Never restore/replay POST, present refresh as a way to bypass recovery, or claim a later paid list proves the prior request failed. Normal factual rendering after refresh supplies current eligibility only; known uncertainty requires the Section F warning/new confirmation, and lost runtime history cannot be reconstructed or given unsupported guarantees.

### H. Received errors and safe retry boundaries

| Evidence | Proposed treatment |
| --- | --- |
| Definite current 401 | Section E only; stale/detached 401 cannot expire newer auth or replay canceled consent |
| Definite 403 | Ownership failure; show safe server feedback, block the offending context, no automatic Login/POST; fresh current-account GET must establish usable target ownership before any new confirmation |
| Received 404 | Defensive missing-context rejection; safe not-found feedback and fresh GET, no cached-context retry; not an endpoint-specific documented response |
| Message-only 422 | Definite business refusal; show server message directly, end confirmed attempt, refresh exact factual Order/eligibility, no automatic POST |
| Unexpected 422 errors container | Preserve surfaced messages; there are no documented Refund request-body fields to map onto invented inputs; no automatic POST |
| Network/body-read/unusable identity-status/500/unclassified outcome | Section F uncertainty, no rollback or repeat-POST assumption |

Do not parse messages to decide already refunded, cutoff reached, account ownership, or missing Order. Derive state only from structured status and fresh usable Order fields. If a 422 refresh proves refunded, report factual state; if it proves paid/non-refundable, render its flag and preserve refusal feedback. A new user-confirmed attempt after a definite rejection requires fresh coherent server authority and current eligibility; it is not automatic replay. Inconclusive verification blocks that attempt. Prior uncertainty is not erased by eligible data; any renewed attempt must satisfy Section F fresh verification, client-settlement, warning, and NEW confirmation rules.

Server message/body retention must not expose credentials or unrelated-account details. Unknown/missing message uses neutral project error copy, not an invented backend cause. Do not reuse Checkout 409 seat-reconciliation or Hold-expiry behavior for Refund; neither is documented here. Retry controls must make clear whether they GET for verification or start a separately permitted newly confirmed action.

### I. Figma, accessibility, and unresolved source boundaries

Use connection link_6ac0b67d4a348191a63166ae0ce0eb57 and file Zeb7RQ8mjGp04YIPde2ud2. The preceding inspection verified metadata for Upcoming/Past variants and a ticket-card instance containing Refund and explanatory-text layers; it did not verify full styles or a dedicated Refund confirmation modal. Do not switch to Primary or the older provenance file.

Reuse established Modal patterns for semantic dialog labeling, dimmed backdrop, focus containment/restore, initial focus, Escape/backdrop behavior, and visible keyboard focus. Use a clearly labeled confirmation/cancel interaction, pending aria-busy/status, and associated explanation available to keyboard users even when Refund is disabled. Delayed settlement must not steal focus from another route/account/dialog; after a card moves out of Upcoming, restore focus to a surviving logical control rather than a removed button.

Exact Refund confirmation geometry, typography, colors, spacing, and responsive states require the separate Figma audit. Existing modal-pattern reuse and the pending/uncertain copy above are proposed UX fallbacks; do not present them as exact Figma values or claim full visual verification.

The proposed received-401 policy follows OpenAPI continuation wording and deliberately differs from D-028's Order-specific payment re-entry policy. It does not supersede that policy. The general 500/network retry requirement is addressed by factual verification and, when Section F conditions hold, a new warned user-confirmed attempt. Automatic replay after ambiguity remains prohibited. The paid snapshot is eligibility evidence, not proof of rollback or server settlement; independent review must assess this explicit residual-risk recovery policy. Backend transaction, idempotency, ordering-after-write, and cross-refresh completion guarantees remain unverified; this policy supplies none. No conflict requires rewriting D-026, D-027, or D-028. If later backend/design evidence conflicts with these proposals, report and reconcile it before implementation.

### J. Acceptance and testing requirements

Independent review must verify the lifecycle table against the detailed rules and explicitly accept or revise this Pending proposal. Full visual implementation additionally requires the dedicated Figma audit. Acceptance must not be inferred from adding this text or from prior Checkout approval.

Implementation acceptance requires deterministic tests for:

- Exact encoded returned-reference POST, no invented payload/endpoint, exclusively server-driven eligibility/grouping, and no refund action for Past.
- Pre-dispatch cancellation sends no POST; double-click/repeated Enter/StrictMode/remount dispatch once; synchronous subscribers changing auth/consent before dispatch stop work.
- Matching HTTP 200/reference/refunded status establishes reported outcome despite missing display data; incomplete/contradictory card fields trigger fresh GET without partial-card adoption, false ambiguity, or outcome loss on refresh failure. Unusable identity/status remains uncertain; stable keys, cross-tab migration, stale GET suppression, and acknowledged-success authority remain guarded.
- Definite 401 followed by same-account auth and exact fresh eligible Order continues once; already-refunded/non-refundable/Past/missing/duplicate/mismatched targets never replay. verification_retry retains bounded consent only for unused 401 continuation; blocked discards it. Cover explicit read recovery, purpose-specific GET 401 handling, exhausted budgets, and no implicit replay from any idle/blocked/remounted presentation.
- Login/Sign Up switching and expected auth-gate unmount preserve intent; ordinary remount/StrictMode cleanup do not create POST. Leaving My Tickets for another page or Personal Information revokes continuation; Upcoming/Past, URL-only subgroup changes, and Back/Forward within My Tickets preserve it. Explicit cancellation, newer intent, account change, and stale auth results cannot revive consent.
- Ambiguous POST plus refunded/eligible-paid/ineligible/inconclusive verification. A still-pending original client POST or absent/invalid/failed verification prevents another POST; fresh exact eligible data after local settlement permits only NEW warned confirmation and identity/lock/guards. Paid snapshots, auth success, and repeated GET checks never automatically replay POST; old uncertainty survives a new intent, its refusal, and cancellation. Show actual 422 messages and refresh structured state without text parsing.
- Pending X/Close/Escape/backdrop, navigation, unmount/remount, logout/account switch, same-account return, late success/refusal/uncertainty, and stale callbacks never release a newer lock, expose private data, or reopen/focus obsolete UI.
- Accessible keyboard confirmation, disabled explanation, pending announcements, dismissal, focus after card removal, and account-scoped recovery feedback.
- Complete lifecycle-table transitions, including succeeded/rejected → idle without evidence loss, blocked recovery without old consent, renewed confirmation, cancellation/account boundaries, and prior-uncertainty preservation. Verify the separate future Refund/auth coordination path without assuming OPEN_BOOKING or Profile expiry already stores it; regress Profile drafts/navigation, minimal Tickets, Order recovery hints, booking logout cleanup, and D-026/D-027/D-028.

Browser QA must use a disposable isolated browser with interception installed before navigation. Fulfill known Refund/GET responses synthetically, block unknown external API traffic, assert no production mutation forwarding, and fail rather than claim coverage when required browser cases skip. Pure/API tests mock transport. Tests must not claim backend idempotency, cancellation, rollback, or cross-refresh protection.

### Rationale and affected modules

Refund is irreversible and changes both server seats and Order grouping. The current minimal Tickets hook safely owns reads but has no Refund mutation/continuation ledger or read-versus-mutation barrier. Separating short-lived presentation from guarded runtime ownership permits Assignment-compliant dismissal, bounded protected-action continuation, and factual uncertainty recovery without guessing backend outcomes.

Affected future implementation areas: ticketsApi; Tickets domain operations/read hook and stable runtime ownership; MyTickets cards/tabs and Refund confirmation; existing AppShell/Profile-access/auth cancellation and logout integration; compatible pure Order usability checks; existing Modal accessibility; verified Tickets/dialog CSS; focused pure/rendering/intercepted-browser tests. New feature-specific helpers are permitted only as needed; no generic store, dependency, fake booking action, or unrelated architectural refactor is implied.

This checkpoint changes docs/06_DECISIONS.md only. It implements no Refund, changes no source/CSS/tests/architecture document, performs no production mutation, and authorizes no commit or synchronization. D-029 remains Pending until independent review and explicit acceptance.

---

## D-030 — Refund request deadline and application-owned attempt retirement

**Status:** Accepted
**Proposed:** 2026-10-08

### Scope, sources, and relationship to D-029

Propose a Refund-specific client deadline and a narrowly scoped exception to Accepted D-029's actual Promise-settlement prerequisite. Independent review and explicit acceptance are required before implementation. D-001 through D-029 remain unchanged; appending this Pending proposal does not make the exception operative.

Repository sources inspected: Assignment §§21–26; OpenAPI /tickets.get, /orders/{order}/refund.post, Order and applicable error responses; Master Spec §§16–20; Architecture §§5, 12–13, 20, 34, and 36; Accepted D-029. Existing client.js awaits Fetch and response-body consumption and forwards AbortSignal, but has no deadline. ticketsApi/useTickets currently own reads only. AuthProvider/AppShell and bookingRuntime/orderOperations provide relevant account, continuation, and synchronous ownership patterns; they do not already implement this Refund policy. Refund coordination remains separate from OPEN_BOOKING, Profile access descriptors, and booking mutation rules.

If accepted, D-030 §C's completed deadline retirement substitutes for actual transport/body Promise settlement ONLY for a deadline-retired attempt. Expiry alone, requesting abort, dismissal, navigation, logout, or an ordinary still-pending request does not qualify. The precise D-029 cross-references are:

| D-029 location | Deadline-only qualification |
| --- | --- |
| §B paragraph beginning "Use one active confirmed continuation", specifically "at most one actively pending client-owned Refund POST in the application runtime, including across account changes" | At most one active application-owned POST remains the limit. Only a deadline-expired attempt fully retired under D-030 §C releases application ownership even if its underlying transport Promise remains unresolved. Ordinary pending attempts still own the slot; synchronous acquisition and owner-only release remain required. |
| §B lifecycle-table rows "Network/body-read failure, unrecognized identity/status, or unknown server outcome", "Explicit Check refund status after the client request has settled", and "Pending Close or leaving My Tickets context" | Completed deadline retirement permits uncertain/read-recovery state and ends that attempt's application lock without actual transport settlement; no automatic POST or consent revival. |
| §B lifecycle-table row "Fresh exact usable paid/Upcoming/refundable target in uncertainty verification and no actively pending client POST" | Only a fully retired deadline-expired attempt is excluded from application-owned pending work despite an unresolved transport Promise. retry_available still requires no other active application-owned POST and all existing fresh factual verification guards; this adds no recovery permission or automatic POST. |
| §C paragraph beginning "Open confirmation only from an actual usable Order", specifically "absence of any actively pending client-owned POST" | The absence check concerns application ownership: only completed D-030 §C retirement of a deadline-expired attempt ends that ownership despite an unresolved transport Promise. Every new dispatch must still acquire the synchronous lock and satisfy the unchanged current identity, consent, eligibility, and existing warned-reconfirmation guards. |
| §F opening paragraph ("enter uncertain after local request settlement"), prerequisite paragraph beginning "Before verification can authorize a renewed attempt", and eligible-paid verification-table row ("settled-request/account guards above") | Completed deadline retirement satisfies only the local-settlement prerequisite. The authorizing GET must start after retirement, with the same account/current auth, exact identity, fresh eligibility, empty application slot, and NEW warned confirmation still required. |
| §G paragraph beginning "A pending dismissal" and account-change paragraph beginning "Expected auth expiry", specifically "Any still-active client POST retains the runtime dispatch lock across that account change" | A detached/account-changed attempt keeps ownership until normal settlement OR completed deadline retirement. Dismissal/account change never triggers retirement itself. |
| §H paragraph beginning "Do not parse messages", specifically the requirement for "Section F fresh verification, client-settlement, warning, and NEW confirmation rules" | The inherited Section F client-settlement prerequisite alone may be satisfied by completed deadline retirement when prior uncertainty concerns that retired attempt. Refusal treatment and every other renewed-attempt guard remain unchanged. |
| §J test bullet beginning "Ambiguous POST plus refunded/eligible-paid/ineligible/inconclusive verification" | An ordinary still-pending client POST continues to block another POST. A deadline-retired attempt is no longer application-owned pending work; fresh post-retirement verification and NEW warned confirmation replace actual settlement for that case only. |

D-029 §D's outcome rules and §G's paragraph beginning "For detached settlement" continue to govern normally settled, unretired attempts. D-030 §D instead fences ALL results arriving after deadline retirement, including a late 200; it does not erase a success already accepted before expiry. D-029 §E's definite-401 budget, all normal 200/422/other settlement behavior, account ownership, and no-automatic-uncertain-replay rules remain unchanged. This exception does not qualify GET settlement or any unrelated mutation policy. No earlier decision is rewritten or generally superseded.

### A. Proposed 30-second client wait budget

Use a 30,000 ms frontend wait budget for each actually dispatched Refund POST, from dispatch through complete response-body consumption and delivery of the resulting response/error to the coordinator. Receiving headers or a status alone does not complete this budget. Do not start it while confirmation, Login, or GET verification is waiting; do not reset it on headers, modal changes, remounts, or account changes. A separately permitted new POST, including D-029's bounded definite-401 continuation, gets its own budget and unique identity.

Thirty seconds is a proposed Kino XII frontend policy, not an OpenAPI value, backend SLA, refund cutoff, or assertion that most requests complete within that time. Its rationale is a finite client wait with time for a slow response; no repository latency evidence establishes it as optimal. It can time out a legitimate slow success and increase uncertainty/recovery work. Review may change this value without inventing server behavior.

Use an injectable monotonic elapsed-time clock, preferably performance.now(), with an injectable timer for deterministic tests. Capture dispatch time and deadline in the same clock/time-origin domain; elapsed time is current monotonic time minus dispatch time, and the deadline is dispatch time plus 30,000 ms. Do not use Date.now(), calendar timestamps, manual/system/NTP wall-clock adjustments, or a mix of clock domains to decide elapsed time or expiry. No remount resets the clock origin or deadline. [High Resolution Time clock specification](https://www.w3.org/TR/hr-time-3/#dfn-monotonic-clock)

Timers are wake-up mechanisms; the stored monotonic deadline determines expiry. Browser execution, background throttling, freezing, and sleep can delay callbacks. Browser/platform sleep-ticking differences can also extend real elapsed wait when the monotonic clock pauses during sleep; this policy promises no exact 30-second wall-time bound. On resumed execution, timer, transport-outcome, and new-dispatch paths check the same clock/deadline before admitting work. If a timer fires before that clock reaches the deadline, reschedule only the remaining monotonic budget without resetting dispatch time or entering a busy loop; do not manufacture elapsed sleep time from wall-clock changes. An outcome already accepted before expiry remains normally settled; otherwise elapsed time at or beyond the deadline takes the expiry path even if the timer callback has not run. Define the observable boundary at coordinator admission; do not guess when a response became available while JavaScript was unable to observe it. [HTML timer specification](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers), [High Resolution Time sleep-behavior issue](https://github.com/w3c/hr-time/issues/115)

### B. Three distinct settlement facts

| Fact | Meaning and limits |
| --- | --- |
| Actual transport Promise settlement | Fetch plus the API wrapper's body-consumption operation resolves or rejects. Fetch's initial Promise may already be fulfilled at headers while body consumption is still pending. Local settlement supplies no proof of backend rollback or completion. |
| Deadline-triggered application-owned retirement | The coordinator permanently ends this attempt's application authority and settles its bounded application result as uncertain, without waiting for the underlying transport Promise. This is an explicit policy transition, not a claim that the transport settled. |
| Backend mutation settlement | Whether the server refused, completed, or is still executing the refund. Deadline expiry, abort, application retirement, and a paid GET do not establish this fact. |

AbortController requests client-side cancellation. Native Fetch abort rejects a pending Fetch Promise and errors a readable response body; rejecting an already fulfilled Fetch Promise does not reverse its fulfillment. An adapter/mock or surrounding Promise may remain pending despite an aborted signal. Retirement must therefore not depend on abort-induced rejection. A timeout race alone neither cancels nor settles the losing transport operation. [Fetch Standard](https://fetch.spec.whatwg.org/#abort-fetch)

A complete current outcome admitted before expiry retains D-029 behavior unchanged: matching HTTP 200/refunded evidence and separate card adoption, definite-401 bounded continuation, 422 refusal, other received rejections, and ordinary ambiguity classification. Normal settlement finalizes only the owning request and cancels its timer. D-030 does not reinterpret a normal 401 as uncertainty or change normal success/refusal rules.

### C. Exact deadline-retirement rule

The stable app-shell Refund runtime owns one active application attempt across all accounts. Acquire its POST slot synchronously before notifying subscribers; recheck D-029 account/auth/context/consent/eligibility guards before immediate transport dispatch. Dispatch must use the captured attempt identity and AbortSignal. No deferred factory, effect, adapter retry, or retired callback may initiate an HTTP POST later.

Each dispatched attempt records its unique request identity, operation/consent generation, originating account, private auth guard, exact returned reference, captured Order/session IDs, dispatch deadline, controller, and terminal disposition. Credentials remain private to dispatch/guards, never in UI state, continuation descriptors, logs, probes, storage, or URLs. Keep no global Orders cache.

At deadline, perform this once-only transition synchronously, with no await and no subscriber notification between its ownership steps:

1. Check that this request is still unfinalized and owns the active POST slot. A normally settled or previously retired request's timer is a no-op; it must not inspect or change a newer attempt.
2. Claim the terminal deadline disposition before invoking abort or other reentrant callbacks. Permanently fence transport settlement, auth effects, consent, and presentation effects for this request.
3. Revoke its original consent and any automatic 401 continuation permission. Record uncertain with minimal private originating account/reference/ID evidence; preserve any earlier uncertainty. Invalidate the affected account's Tickets read/eligibility generations and obsolete its competing reads as in D-029; apply §G's account-isolation and safe-restart requirements if an existing shared barrier also affects the current account's read.
4. Request abort through this attempt's controller. Keep the slot owned during the abort call so synchronous abort listeners cannot start competing work. Abort failure or absent rejection does not undo the fence or prevent guarded finalization.
5. Clear its timer and retire only the slot whose request identity still matches. Settle the bounded application result once as deadline uncertainty without awaiting the underlying transport. Only after the fence, uncertainty, and owner-only release are established may subscribers observe the transition.

Acquiring a later slot cannot erase prior uncertainty. Timer, fulfillment, rejection, and cleanup callbacks must use request identity rather than unconditionally setting a shared pending flag to false. An old callback cannot release a newer slot, reclaim ownership, or dispatch a POST. The deadline transition is coordinator-owned; a dialog unmount is not its trigger.

### D. Late results and rejection handling

Attach fulfillment and rejection observers to the full transport/body Promise immediately when dispatch creates it; also handle synchronous transport throws and rejection of any derived observer Promise. Keep observers capable of consuming a rejection after retirement. Do not leave the losing branch of a deadline race unobserved or create an unhandled rejection through detached finally/then chains.

After deadline retirement, late HTTP 200, 401, 422, 500, malformed responses, body failures, abort rejection, and other rejections are consumed as obsolete transport outcomes. They cannot adopt an Order, erase uncertainty, change a newer phase, expire auth, open Login, restore consent, notify/focus obsolete UI, release another lock, or POST. Discard protected late response data; factual recovery uses a fresh guarded GET instead. A late 200 alone does not become this retired attempt's displayed success. This differs from D-029's normal detached settlement, which remains applicable before deadline retirement.

Exactly one terminal application disposition wins. Abort rejection following a claimed deadline cannot run normal refusal/auth/error logic; normal settlement accepted first makes its queued timeout harmless. Clearing the timer is cleanup, while identity and terminal guards remain necessary for callbacks already queued.

### E. Recovery after deadline retirement

A deadline-retired attempt qualifies for D-029 §F factual verification and reconfirmation even if the underlying transport/body Promise has not settled. This is the narrowly scoped exception proposed here, not a relabeling of transport state.

Offer explicit Check refund status: fresh unfiltered GET /tickets, initiated after completed application retirement, under the same authenticated originating account and current auth/read generation. A GET begun before retirement, including during the POST, cannot authorize a renewed attempt. Repeated checks and authentication are read recovery only. D-029's bounded read-only GET-401 continuation applies, without POST consent; exhausted recovery cannot reopen an automatic Login loop through the generic Profile gate.

| Fresh verification | Permitted result |
| --- | --- |
| Exactly one matching exact Order.reference reports refunded, with applicable identity guards | Preserve factual refunded authority; restore incomplete display under D-029 §D. No POST and no attribution to a particular attempt. |
| Exactly one matching exact reference has usable corresponding Order/session identity and complete coherent display data, status paid, isUpcoming === true, and isRefundable === true | retry_available only if no application-owned POST is active and all current guards hold. Preserve uncertainty; offer NEW warned confirmation. |
| Paid but Past/non-refundable, missing/duplicate reference, identity mismatch, malformed/contradictory data, or failed GET | No new POST. Preserve uncertainty and the applicable read-only retry/blocked state from D-029. |

Use D-029 §F's warning in the renewed confirmation: "We couldn't confirm the earlier refund. Your tickets currently show this order as paid and refundable, but the earlier request may still complete. Confirming sends a new refund request." It must be visible before the confirm control; no default acceptance or guaranteed-safe claim.

A NEW explicit confirmation creates new consent and request identities. Immediately before dispatch, recheck same current account/auth, semantic My Tickets context, exact reference/captured IDs, fresh unsuperseded verification, coherent server eligibility, consent, and an empty application slot. Changed authority requires fresh verification. Canceling the new confirmation preserves prior uncertainty. Never automatically repeat the uncertain POST from timeout, abort, GET completion, login, mounting, or eligible flags.

A new confirmed attempt has its own normal D-029 rules, including its own bounded definite-401 handling. A new 422 shows the actual server message and refreshes structured Tickets facts; do not parse the message to infer status. Prior uncertainty survives that refusal or a paid snapshot. Another ambiguous/deadline outcome returns to factual recovery, never a retry loop.

### F. Concurrency risk and proposed tradeoff

The guarantee is at most one active application-owned Refund attempt in this runtime. A retired transport may remain unresolved and earlier server work may overlap a later explicitly confirmed POST, including across account changes. Abort/fencing prevents further application authority; it cannot prove physical transport shutdown or server non-overlap.

OpenAPI documents an already-refunded 422 refusal, but no idempotency key, transactional atomicity, server serialization, exactly-once execution, or authoritative ordering-after-write guarantee. That refusal supports documented sequential rejection; it does not prove that concurrently arriving requests cannot both act or that financial effects cannot duplicate. A fresh paid GET is current eligibility evidence, not proof the earlier request failed or stopped. Do not invent a body, idempotency header/key, cancellation endpoint, backend timeout, or compensating mutation.

Recommendation: accept bounded retirement as an availability and informed-consent policy consistent with D-029 §F's residual-risk recovery. It bounds client ownership and requires fresh evidence plus new warned consent; it does not bound backend execution or prove financial safety. Independent review must explicitly assess this residual risk. Repeated separately confirmed attempts can leave multiple unknown backend operations; the application lock does not cap that count once earlier attempts are retired.

If that residual risk is unacceptable, reject the retirement exception and keep renewed POST blocked until actual full transport/body Promise settlement under D-029. Read-only status checks may provide factual feedback but cannot bypass that lock. A never-settling Promise can then block indefinitely. Even actual transport settlement supplies no backend-stop guarantee. Guaranteed backend non-overlap/exactly-once effects would require additional verified backend guarantees; neither policy option invents them. Pending review, D-029's existing settlement prerequisite remains authoritative.

### G. Logout, dismissal, navigation, and lifetime

- Modal dismissal remains available. It revokes continuation and detaches UI under D-029; it does not itself abort, retire, or reset the timer of a submitted POST.
- Leaving semantic My Tickets context, including Personal Information at the same pathname, revokes unsubmitted/continuation/verification permission. The dispatched attempt retains its slot and deadline until normal settlement or the defined deadline retirement. Upcoming/Past changes within My Tickets do not reset them.
- Ordinary remount/StrictMode cleanup cannot create consent, reset elapsed time, clear the lock, or replay POST. Stable runtime ownership and the shared Tickets read barrier survive.
- Logout/account change immediately masks protected presentation and revokes consent, read-auth continuation, and eligibility snapshots. Keep only private minimal origin evidence. Do not await POST or borrow another account's credentials.
- The originating request's deadline remains live across logout/account changes. It can retire its own slot without current-origin authentication, but cannot display origin details, expire the new account's auth, invalidate that account's consent, or release a newer slot.
- Scope timeout read/eligibility invalidation to the affected originating account where possible. Account A's retirement must not silently cancel or permanently invalidate account B's active Tickets read. Check captured account ownership, current auth ownership, read request identity, and the applicable generation before adopting data OR applying read-error/auth effects; stale A responses cannot populate B, expire B's auth, or change B's read state.
- If an existing shared generation/barrier also obsoletes the currently authenticated account's active Tickets read, its attached reader must safely restart under that account's current auth with a new request identity and the updated generation. An obsolete loading state cannot remain indefinitely: a current read must run and expose the existing success/empty/error/auth-required states; restart failure must surface the appropriate existing recovery state. Never reuse A's credentials/data or auto-POST. Deduplicate restart for the affected account/invalidation generation; the replacement read captures the new generation, and obsolete read cleanup/error must not advance it again or repeatedly restart work. A retirement is finalized once, so repeated old callbacks cannot create a restart loop. Account-scoped generations or a small restart guard around an existing shared barrier are both acceptable; no global Orders cache or unrelated architecture rewrite is required.
- Same-account return requires fresh guarded GET and, for renewed POST, NEW warned confirmation. Authentication, navigation back, or remount never restores old consent. Detached retirement does not automatically reopen a dialog, navigate, or focus.
- No new browser-storage/URL persistence, reload replay, cross-tab/reload protection, Hold deletion, or local seat release is authorized. Timer/ledger loss on app teardown gives no settlement or rollback proof.

### H. Required tests and implementation boundary

Use injected clocks/timers and synthetic/mock transport only. Browser interception must be installed before navigation; fulfill known traffic and block unknown external API requests. Never forward production mutations or count skipped required cases as passes.

Required deterministic coverage:

- Timeout before headers; headers arrive but body consumption hangs; no normal classification from headers alone.
- Never-settling Fetch/adapter Promise that ignores AbortSignal: application retirement completes, abort is requested, uncertainty remains, and no automatic POST occurs.
- Abort-induced rejection and synchronous abort listener reentrancy: fencing precedes abort and owner-only release; no unhandled rejection or double finalization.
- Normal complete 200, definite 401, 422 and other D-029 outcomes before expiry remain unchanged and clear their timer.
- Delayed timer execution and deadline boundary races: overdue outcome/new-dispatch paths enforce expiry; an already accepted normal result wins. Forward/backward wall-clock adjustments with unchanged monotonic time do not change eligibility for deadline retirement. Mock paused-during-sleep monotonic time and an early timer wake-up: only remaining-budget scheduling occurs, without a reset, wall-clock fallback, or busy loop.
- Late 200/401/422/500, malformed/body failure and rejection after retirement: no state adoption, stale auth expiry, Login, consent revival, focus, POST, or newer-lock release.
- Double click/Enter, synchronous subscribers changing auth/context before dispatch, StrictMode and remount: at most one active application-owned dispatch.
- Logout/account switch, same-account return, modal dismissal, route departure to another Profile panel, and subgroup navigation: deadlines persist and private origin data stays masked.
- Account-isolation regression: A has a pending Refund; switch to B; B starts GET /tickets; A's deadline retires its attempt; B's Tickets still load correctly. Exercise account-scoped invalidation (B's read continues) and shared-barrier invalidation (one deduplicated restart using B's auth/new generation). Resolve obsolete A/B callbacks and repeated A timeout callbacks: no cross-account data/auth effects, permanent loading, newer-lock release, or repeated restart loop. Verify a restarted read's failure surfaces the existing error/auth recovery state.
- Old queued timeout/settlement after a later attempt owns the slot: the later owner and its timer/consent are untouched.
- Fresh GET initiated after retirement versus stale pre-retirement GET; refunded, eligible paid, ineligible, missing/duplicate/mismatched/inconsistent targets; GET failures and bounded read-only 401 recovery.
- Eligible paid GET creates no POST; new explicit warned confirmation is required, guards are rechecked, earlier uncertainty survives cancellation/refusal/new timeout, and no automatic uncertain retry occurs.
- Synthetic backend-work overlap demonstrates the limit of application ownership; tests must not claim idempotency, server cancellation/serialization, rollback, or exactly-once financial effects.

Affected future implementation areas are Refund-specific runtime/lifecycle coordination, ticketsApi, guarded Tickets reads, AppShell/AuthProvider integration, confirmation/recovery presentation, and focused tests. This decision does not add a global API timeout, alter booking/payment policies, introduce a dependency, or prescribe unverified Figma styling.

This checkpoint modifies docs/06_DECISIONS.md only. It implements no Refund, changes no application code/tests/other documentation, performs no production mutation, and authorizes no staging, commit, push, or sync. D-030 remains Pending for independent review and explicit acceptance.

---

## D-031 — Home Coming Soon Notify Me and preserved catalogue navigation

Status: Accepted user-authorized scope; implementation remains subject to independent review.

Decision date: 2026-10-10

D-023 §K says: “`Notify Me` remains a separate feature unless a later scoped implementation verifies and wires the relevant API/Figma behavior.” This decision records that later user-approved Home Coming Soon scope and supersedes only its notification deferral for Home. D-023's Movie Detail and booking boundaries remain applicable; no historical decision is erased or expanded into Movie Detail notification behavior.

- Use the existing authenticated, bodyless `POST /movies/{movie}/notify`, with the exact server movie slug and captured Bearer authentication. Show **You will be notified** only after a server-confirmed HTTP 201 subscription for that movie.
- Retain a bounded `NOTIFY_MOVIE` protected action through the existing Login/Signup flow. Guest and expired-auth continuation use the existing identity-checked, once-consumed client replay; notification does not introduce booking profile requirements. Preserve cancellation and account/session isolation.
- Restore subscription state only from optional boolean `isNotified: true` supplied by a verified GET belonging to the current authenticated session. This optional extension is not a new required Movie field. Production authenticated-true semantics have not been independently established; fixture coverage does not imply backend persistence guarantees.
- Keep confirmed state in current-session application memory. Do not fabricate subscription persistence in localStorage/sessionStorage or infer a subscription from a guest, absent, false, nonboolean or stale response.
- Pending, auth-transition/auth-waiting and confirmed-success Notify controls remain focusable with `aria-disabled`, an explicit activation guard, and the existing runtime dispatch/session guards. Preserve live announcements, the modal focus trap and its existing opener restoration.
- Preserve both Home **Coming Soon See all → `/sessions`** and **Now Playing See all → `/sessions`**, using their existing React Router links. Do not add a route or a Coming Soon page.

Reason: the user explicitly approved the separately scoped Notify implementation and preservation of both original catalogue links. This reconciles that scope with D-023's historical deferral without adding API contracts, persistence promises or business rules.

Affected areas: Home Coming Soon rendering, the Movies API module, notification runtime/context, existing protected-action integration and focused regression tests. Checkout, Booking, Refund, Search and Navbar behavior are outside this decision's implementation scope.

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
