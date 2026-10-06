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
