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
