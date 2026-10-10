# Kino XII — Architecture

> Repository and frontend architecture for the Kino XII cinema-ticketing SPA.
>
> This document turns `04_MASTER_SPEC.md` into an implementation structure.
> It does not override the Assignment, OpenAPI contract, Figma, or accepted decisions in `06_DECISIONS.md`.
>
> **Technology boundary:** React + JavaScript + HTML5 + CSS3 + Fetch API + native browser APIs where appropriate.
>
> Development/build tooling: Vite.
> Client-side routing: React Router.
> Default state management: React local state, `useReducer`, and Context where genuinely shared.
> Forms: React-controlled inputs with project-owned validation helpers.
> Do not introduce TypeScript unless explicitly chosen in a later decision.

---

## 1. Architecture goals

The implementation must be:

- modular without becoming over-engineered
- easy to inspect during code review
- safe around async/race conditions
- faithful to URL state requirements
- explicit about server-owned business rules
- easy for Codex to implement incrementally
- easy for Claude to review independently
- deployable as a static SPA
- based on the accepted React architecture without unnecessary dependencies

Primary design principle:

> Keep domain behavior separate from rendering.

Examples:

- API modules know endpoints, payloads, and response handling.
- React providers/reducers own genuinely shared application state.
- page components compose feature components and coordinate page-level reads.
- reusable components render UI from props/state and emit user intent through callbacks.
- validation helpers validate confirmed client-side rules.
- React Router owns navigation, route parameters, and URL interpretation.
- CSS is split into tokens, global primitives, reusable components, and page composition.

Do not duplicate sources of truth. In particular:

- OpenAPI/server state is authoritative for backend-owned data and business rules.
- Sessions URL query parameters are authoritative for Sessions view state.
- `expiresAt` is authoritative for hold countdown timing.
- `profileComplete`, `age`, and `isRefundable` are authoritative when returned by the API.

---

## 2. Proposed repository structure

```text
kino-xii/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
├── netlify.toml
├── README.md
├── AGENTS.md
├── CLAUDE.md
├── .gitignore
│
├── docs/
│   ├── 01_ASSIGNMENT_SPEC.md
│   ├── 02_OPENAPI.json
│   ├── 03_FIGMA_REFERENCE.md
│   ├── 04_MASTER_SPEC.md
│   ├── 05_ARCHITECTURE.md
│   └── 06_DECISIONS.md
│
└── src/
    ├── main.jsx
    ├── config.js
    │
    ├── app/
    │   ├── App.jsx
    │   ├── AppBootstrapProvider.jsx
    │   └── bootstrap.js
    │
    ├── routing/
    │   ├── AppRouter.jsx
    │   └── routes.js
    │
    ├── api/
    │   ├── client.js
    │   ├── authApi.js
    │   ├── catalogueApi.js
    │   ├── sessionsApi.js
    │   ├── bookingApi.js
    │   ├── profileApi.js
    │   └── ticketsApi.js
    │
    ├── auth/
    │   ├── AuthProvider.jsx
    │   ├── tokenStorage.js
    │   └── pendingAction.js
    │
    ├── booking/
    │   ├── BookingProvider.jsx
    │   ├── bookingReducer.js
    │   └── holdStorage.js
    │
    ├── pages/
    │   ├── HomePage.jsx
    │   ├── SessionsPage.jsx
    │   ├── MovieDetailPage.jsx
    │   ├── ProfilePage.jsx
    │   └── NotFoundPage.jsx
    │
    ├── components/
    │   └── reusable React UI components created incrementally
    │
    ├── forms/
    │   └── React form components created as required
    │
    ├── hooks/
    │   └── reusable hooks only where justified
    │
    ├── validation/
    │   └── project-owned validation helpers
    │
    ├── utils/
    │   ├── debounce.js
    │   ├── formatCurrency.js
    │   ├── formatDate.js
    │   └── recentlyViewedStorage.js
    │
    ├── assets/
    │   ├── icons/
    │   └── images/
    │
    └── styles/
        ├── main.css
        ├── tokens.css
        ├── reset.css
        ├── base.css
        ├── layout.css
        ├── components/
        └── pages/
```

This is the target architectural structure, not a requirement to create every file or directory immediately.

Create files incrementally when a real feature requires them.

Use `.jsx` for modules that render JSX and `.js` for non-JSX application logic.

Do not introduce placeholder files merely to make the repository match this tree.

Additional feature-specific modules may be added when justified by implementation needs.

---

## 3. `index.html`

`index.html` should remain intentionally small and serve as the Vite HTML entry document.

Responsibilities:

- document metadata
- responsive viewport metadata
- React root container
- remote font loading defined by D-011
- Vite module entry

Conceptual structure:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&family=Poppins:wght@500&display=swap"
      rel="stylesheet"
    />

    <title>Kino XII</title>
  </head>

  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

React owns application rendering inside `#root`.

Modal and overlay UI should normally remain inside the React application tree. A dedicated portal root may be added later only if an actual component requirement justifies it.

Do not put page templates, application state, feature logic, or large inline scripts in `index.html`.

---

## 4. React application entry flow

### `main.jsx`

`main.jsx` is the minimal React/Vite entry module.

Responsibilities:

1. import the global stylesheet entry
2. locate the `#root` element
3. create the React root
4. render `<App />`

Conceptual structure:

```jsx
import { createRoot } from "react-dom/client";
import App from "./app/App.jsx";
import "./styles/main.css";

createRoot(document.getElementById("root")).render(<App />);
```

Do not place API calls, routing rules, authentication logic, booking logic, or feature state directly in `main.jsx`.

### `App.jsx`

`App.jsx` composes application-level React structure.

Recommended provider composition:

```jsx
<AuthProvider>
  <AppBootstrapProvider>
    <BookingProvider>
      <AppRouter />
    </BookingProvider>
  </AppBootstrapProvider>
</AuthProvider>
```

This ordering lets `AppBootstrapProvider` call the authentication context's explicit `restoreSession()` action while it also loads `/filter-options`.

Other shared providers may be added only when justified.

`App.jsx` should not become a giant page or feature implementation component.

### `AppBootstrapProvider.jsx`

Own app-wide boot status and `/filter-options` data.

Expose at minimum:

- `status`: `loading | ready | error`
- `filterOptions`
- `error`
- retry behavior for boot-critical failure

It starts the idempotent boot initializer from `bootstrap.js` and invokes the authentication context's `restoreSession()` action as part of the boot sequence.

Application readiness should wait until both boot-critical filter options and auth restoration have settled.

The provider must not become a generic store for unrelated feature state.

### `bootstrap.js`

`bootstrap.js` owns boot-time initialization that must happen in a controlled and reusable way.

Startup must ensure:

1. `GET /filter-options` is requested once for a boot attempt
2. the result is stored in shared application state
3. stored auth token restoration is coordinated through the auth layer
4. when a stored token exists, `GET /me` is called
5. on `200`, the authenticated user is restored from the server response
6. on `401`, the stale token is cleared and the application continues as guest
7. boot-critical loading/error state is exposed to React instead of rendered manually

Boot logic must guard against duplicate initialization requests, including development remounts.

Do not manipulate UI directly from `bootstrap.js`.

---

## 5. API layer

### `api/client.js`

This is the only low-level Fetch wrapper.

Responsibilities:

- prepend API base URL
- attach `Accept: application/json`
- attach Bearer token when available
- support JSON request bodies
- support `FormData` without manually setting the multipart boundary
- parse successful JSON safely
- handle `204 No Content`
- preserve HTTP status
- normalize error information without inventing fields
- support `AbortSignal`
- distinguish aborts from real failures
- never silently swallow an error
- never log authentication tokens or payment-card data

Suggested normalized error concept:

```js
{
  status,
  data,
  message,
  errors,
  contested
}
```

Only expose fields that exist in the actual response.

### Error handling rule

`client.js` classifies transport/HTTP failures; domain-specific behavior stays outside the client.

Examples:

- client identifies `401`
- auth/protected-action layer decides whether to clear stale auth, open login, and replay
- booking flow interprets `409 contested`
- React form logic maps `422 errors` to relevant fields
- message-only business-rule failures are displayed as server messages
- `500` and network failures expose retryable UI where appropriate

Avoid a giant `switch(status)` that controls the application from the API client.

---

## 6. Endpoint modules

Each API file contains requests for one domain only.

### `authApi.js`

- `register`
- `login`
- `logout`
- `me`

Registration must use `FormData` because the contract is `multipart/form-data`.

### `catalogueApi.js`

- `searchMovies`
- `getNowPlaying`
- `getComingSoon`
- `getFeatured`
- `getMovie`
- `getMovieSessions`
- `notifyMovie`

Movie detail routes use the API movie slug.

### `sessionsApi.js`

- `getFilterOptions`
- `getSessions`
- `getSession`
- `getSeatMap`

### `bookingApi.js`

- `createHold`
- `getHold`
- `releaseHold`
- `createOrder`

### `profileApi.js`

- `updateProfile`

### `ticketsApi.js`

- `getTickets`
- `refundOrder`

No page/component should manually construct an API URL when a domain wrapper exists.

---

## 7. Configuration

### `config.js`

`config.js` contains non-secret, application-owned frontend configuration only.

It may contain:

- production API base URL
- stable application-owned storage key names/namespaces
- other non-secret configuration that is not backend-owned

It must not contain:

- authentication tokens
- payment-card data
- secrets
- server-controlled business values available through `/filter-options`
- duplicated route definitions owned by `routing/routes.js`

Production API base:

```text
https://api.kinoxii.redberryinternship.ge/api
```

Do not introduce `.env` configuration unless a concrete deployment requirement justifies it.

If environment-specific configuration is added later, remember that frontend environment values are not secret; record the change as an explicit project decision.

---

## 8. Authentication architecture

### `tokenStorage.js`

Bearer-token persistence is an accepted project decision: use `localStorage`.

Abstract access behind:

- `getToken()`
- `setToken(token)`
- `clearToken()`

Other application modules must not read/write the token directly.

Never:

- put the token in a URL
- render the token
- log the token
- store token data inside unrelated feature records

### `AuthProvider.jsx`

Own authentication state:

```text
status:
  restoring | guest | authenticated

user:
  null | API User

mutation:
  login/register/logout pending state as needed
```

The API's `profileComplete` and derived `age` remain on the server-returned user object.

Responsibilities:

- register
- login
- logout
- restore through `GET /me`
- token storage coordination
- current user replacement after successful profile update
- auth-expiry transition back to guest

On boot:

1. read token through `tokenStorage.js`
2. if absent, settle as guest
3. if present, call `GET /me`
4. on `200`, restore user
5. on `401`, clear stale token and settle as guest

Logout should clear the stored token after the logout attempt according to the API contract, including stale/failed-token cases where local auth must not remain stuck.

Pages/components must not directly mutate authentication state.

---

## 9. Protected action replay

### `pendingAction.js`

Store at most one intentionally bounded action descriptor.

Examples:

```js
{
  type: "OPEN_BOOKING",
  payload: { sessionId: 809 }
}
```

```js
{
  type: "NOTIFY_MOVIE",
  payload: { movieSlug: "..." }
}
```

Rules:

- descriptors must be serializable/plain data
- do not store arbitrary callbacks
- do not store tokens/card data
- do not allow unbounded arbitrary payloads
- replay once
- clear after success, cancellation, or terminal failure
- guard against replay loops

Flow:

1. protected action requested
2. if unauthenticated, store descriptor and open Login
3. authentication succeeds
4. if the action requires booking eligibility, inspect server `profileComplete`
5. require profile completion if necessary
6. replay the original action once
7. clear pending state

The user should not need to click the original protected action a second time.

---

## 10. Routing architecture

Use React Router for client-side routing.

Core routes:

```text
/                 Home
/sessions         Sessions
/movies/:slug     Movie Detail
/profile          Profile
*                 Not Found
```

Route definitions belong in `routing/routes.js` and `routing/AppRouter.jsx`.

Use React Router primitives rather than custom History API infrastructure:

- `BrowserRouter`
- `Routes`
- `Route`
- `Link` / `NavLink`
- `useNavigate`
- `useParams`
- `useSearchParams` where appropriate

Modal/overlay flows stay stateful overlays unless the Assignment/Figma explicitly makes them a page:

- Login
- Registration
- Search
- Seat Selection / Checkout / Confirmation
- profile menu
- confirmation dialogs

Use real links for navigable URLs and real buttons for actions.

Browser Back/Forward and refresh must restore URL-driven page state.

---

## 11. Sessions URL contract

The URL is the durable source of truth for Sessions filters, sorting, and pagination.

Use the exact API query parameter names:

- `date`
- `venues[]`
- `formats[]`
- `languages[]`
- `bands[]`
- `search`
- `sort`
- `page`

React Router search-parameter logic should normalize URL state into a single Sessions query model.

Conceptual normalized state:

```js
{
  date,
  venues: [],
  formats: [],
  languages: [],
  bands: [],
  search,
  sort,
  page
}
```

Rules:

- render/request derives from URL
- UI changes write URL
- refresh reads the same URL
- Back/Forward restores the same state
- filter or sort change resets `page` to `1`
- pagination counts movies/groups as defined by the API, not individual session rows
- `meta.totalSessions` drives the showing-sessions counter
- if the selected venues make selected formats invalid, remove those incompatible format selections using `venue.formats`
- valid option values come from `/filter-options`
- do not maintain a second unrelated filter state that can drift from the URL

Rapid URL changes must not allow an older Sessions response to overwrite a newer one.

---

## 12. React state-management strategy

Use React built-in state management by default.

### Local component state

Use local state for local concerns:

- open/closed UI state
- field drafts
- focused/hover-adjacent React state where needed
- selected tab when not URL-controlled
- local request state that no other area needs

### Feature reducer state

Use `useReducer` when one feature has multiple related transitions, especially booking.

### Context

Use Context only for genuinely shared state/actions, such as:

- app bootstrap/filter options
- authenticated user/auth actions
- pending protected action
- active booking flow

Do not introduce Redux, Zustand, or another external state library at project setup.

An external state library may be reconsidered only if a concrete implementation problem justifies it and the decision is recorded.

Sessions filter/sort/page state must not be duplicated into unrelated Context; the URL remains authoritative.

Server-owned business state remains authoritative and must not be replaced by guessed client state.

---

## 13. Shared state ownership

### `AppBootstrapProvider`

Own:

- boot status
- `/filter-options` response
- boot error/retry

Loaded once per boot attempt.

### `AuthProvider`

Own:

- auth status
- current API user
- auth mutations
- bounded pending protected action integration

### `BookingProvider`

Own the active booking flow only.

Detailed state is defined below.

### Global UI state

Do not create a general-purpose `uiStore`.

Keep overlay/menu/search state local to the closest shared owner unless multiple distant parts genuinely need the same state.

Avoid turning Context into a dump for all component state.

---

## 14. Booking state model

Use `BookingProvider` + `bookingReducer.js`.

Conceptual state:

```js
{
  sessionId: null,
  session: null,

  seatMap: null,
  seatMapStatus: "idle",

  selectedSeats: {},
  // seatId -> { seat, ticketType }

  step: "seats",
  // seats | checkout | confirmation

  hold: null,
  order: null,

  isCreatingHold: false,
  isSubmittingOrder: false,

  error: null
}
```

Use seat IDs as selection keys and booking request identifiers.

Do not persist the full seat map or selected seat objects as authoritative browser state.

Server remains authoritative for:

- seat availability
- `isMine`
- hold validity
- hold expiry
- order result

The active-hold persistence decision is separate and intentionally minimal.

---

## 15. Booking lifecycle

### Open booking

1. set active session id
2. fetch `GET /sessions/{session}` when the modal/header needs session detail not already available
3. fetch `GET /sessions/{session}/seats`
4. inspect minimal persisted hold reference for the same active flow
5. if restoring:
   - require valid authenticated session
   - fetch `GET /holds/{hold}`
   - verify server `isLive`
   - refetch seat map with auth available so `isMine` is populated
   - reconcile selected seats from current server state
6. render Seat Selection

### Seat map structure

Preserve exactly:

```text
sections
  → rows
    → seats
```

Never flatten the API nesting into one hardcoded grid.

Respect:

- seat `id`
- `code`
- `label`
- `state`
- `aisleAfter`
- `isMine`
- row labels from API
- different section widths
- `unavailable` gaps

### Select seat

Allow selection only when:

- seat state is `available`, or the restored flow explicitly recognizes the user's own live held seat through server state
- selection remains within API-provided `maxSeatsPerOrder`

Default a newly selected seat to the API-defined adult ticket type.

Ticket type slugs/identifiers, ratios, age restrictions, and maximum seat count come from `/filter-options`, not hardcoded constants.

### Deselect seat

Remove:

- selected seat
- its ticket-type assignment

### Create/update hold

On Next:

1. validate current selections
2. block duplicate submission
3. send seat IDs with server-defined ticket type values
4. on success:
   - store returned hold in booking state
   - persist only minimal hold reference
   - derive timer from server `expiresAt`
   - move to Checkout
5. on `409`:
   - read `contested` seat codes
   - identify/remove only lost seats
   - preserve valid remaining selection where possible
   - refetch seat map
   - show a clear conflict message
6. on `422` with `errors`:
   - treat as validation failure
7. on message-only booking-rule failure:
   - show server message
   - route profile-completion cases through the protected/profile flow when required

Calling hold creation again for the same session replaces the user's previous hold according to the API; do not release it first merely because the selection changed.

### Back from Checkout

The accepted Back behavior is:

- Checkout → Seat Selection
- keep the same live hold
- do not close/abandon the booking flow merely because the user went back one step

### Abandon booking

When the user exits the booking flow entirely:

- release the live hold when required/possible
- clear minimal persisted hold reference after confirmed release or terminal invalidation
- clear active booking state

### Order creation

On checkout submit:

1. validate controlled fields
2. block duplicate submission
3. never persist card number, expiry, or CVV
4. call `POST /orders`
5. on success:
   - use returned `Order`
   - clear hold persistence
   - move to confirmation
6. handle relevant auth, conflict, validation, business, server, and network failures
7. never simulate success locally

---

## 16. Active-hold persistence and timer

Persist only the minimal active-hold reference in `sessionStorage`:

```js
{
  holdId,
  sessionId
}
```

Access it through `holdStorage.js`.

Do not persist:

- full `SeatHold`
- full seat map
- selected seat objects as authoritative state
- checkout fields
- payment-card data

### Restoration

After refresh:

1. read `holdId` and `sessionId`
2. require/restore authentication
3. call `GET /holds/{hold}`
4. if it does not exist, is unauthorized, or is no longer live, clear the stored reference
5. if live, use server `expiresAt`
6. refetch authenticated seat map
7. reconcile server `isMine` seats
8. resume the active booking flow

An expired hold may still return `200` with `isLive: false`; treat server state as authoritative.

### Cleanup

Clear the hold reference after:

- successful order creation
- confirmed release
- expiry
- invalid restoration
- full booking abandonment

Do not clear it merely because Checkout went back to Seat Selection within the same active flow.

### Timer

The timer UI is derived from absolute server expiry:

```text
remaining = expiresAt - Date.now()
```

Never use a fixed locally decremented counter as the authoritative time source.

Update display at a reasonable interval and re-check on:

- tab visibility change
- resume from background
- restored flow

At/after expiry:

- invalidate checkout state
- return to Seat Selection
- clear persisted hold reference
- refetch seat map
- show the documented expiry message

---

## 17. React rendering strategy

Render application UI with React JSX/components.

Security/rendering rules:

- rely on React's normal escaping for API/user strings
- do not use `dangerouslySetInnerHTML` for ordinary API/user content
- do not build UI by imperatively injecting API strings into raw HTML
- use semantic HTML elements inside components
- use component props/state rather than manual DOM synchronization

Direct DOM/browser APIs are appropriate only for focused infrastructure needs, such as:

- focus management
- measuring when truly necessary
- `AbortController`
- `IntersectionObserver`/`ResizeObserver` when justified
- storage
- timers
- document visibility

Do not create a second imperative rendering system beside React.

---

## 18. Component contract

Reusable React components should have small, predictable props.

Conceptual pattern:

```jsx
<MovieCard
  movie={movie}
  onBuyTicket={handleBuyTicket}
/>
```

Prefer:

- data in through props/context
- intent out through callbacks/actions
- accessible semantic elements
- explicit loading/disabled/error props where relevant

Avoid:

- components directly calling unrelated domain APIs
- hidden global mutations
- giant components combining multiple independent features
- passing entire application state when a narrow prop is sufficient

Extract a reusable component when reuse/state complexity justifies it; do not split every few lines into a new component by ceremony.

---

## 19. Page and effect lifecycle

Page components are React route components.

Page-level responsibilities:

- read route params/search params
- start page-specific reads
- compose feature components
- own page-local state
- render loading/empty/error/success states

Effects that create external work must clean up when dependencies change or the component unmounts.

Cleanup may include:

- aborting in-flight reads
- clearing intervals/timeouts
- removing browser listeners
- disconnecting observers
- canceling feature-specific subscriptions

Do not depend on manual "destroy page" router hooks; React lifecycle/effect cleanup owns component cleanup.

---

## 20. Async request safety

### Read requests

Rapidly changing reads include:

- Search
- Sessions query changes
- movie-detail date switching
- seat-map refreshes

Use:

- `AbortController` where practical
- an explicit request/version guard when abort alone is insufficient

Default pattern:

1. cancel/obsolete previous read
2. start current request
3. ignore abort errors
4. render only the latest relevant response

Never allow an older response to overwrite newer state.

### Mutations

Use explicit pending state.

Disable or otherwise guard the initiating control while a mutation is pending.

Prevent duplicate:

- login
- register
- profile save
- notify action when required
- hold creation
- order creation
- refund
- other non-idempotent mutations

State updates after a mutation should use returned server objects or a deliberate refetch strategy.

---

## 21. Form architecture

Use React-controlled inputs and project-owned validation helpers.

Do not introduce React Hook Form, Formik, or another form-management library at project setup.

Forms own:

- field values
- touched/blur state where needed
- local validation errors
- backend field errors
- pending/submission state
- success/business-rule feedback

Validation timing:

- validate on blur where required by the Assignment
- validate the entire form on submit
- clear stale server field errors when the associated value changes
- map `422` `errors` keys to relevant fields
- treat message-only `422`/business failures separately

Do not mix every form's behavior into one generic modal component.

A form library may be reconsidered later only if a concrete implementation problem justifies it and the decision is recorded.

---

## 22. Validation source rules

Client validation may mirror confirmed requirements for immediate UX.

Server remains final authority.

Never invent a validation rule.

Never replace exact server business-rule messages with generic client guesses.

### Registration

Mirror only confirmed request/validation requirements from Assignment/OpenAPI.

Registration uses multipart form data and may include an avatar when the contract permits it.

### Profile

Use backend field messages.

After successful profile update, use returned user fields including:

- `profileComplete`
- derived `age`

Do not independently calculate a replacement for API-derived age.

### Checkout

Mirror confirmed rules for fields such as:

- full name
- email
- mobile number
- card number
- expiry
- CVV

Still display backend validation when a request fails.

Never persist card values.

---

## 23. Modal and overlay architecture

Use reusable React modal/overlay primitives.

Responsibilities:

- backdrop
- dialog container
- close semantics
- Escape handling
- backdrop-click behavior where design/requirements permit
- initial focus
- focus containment
- focus restore
- scroll locking
- accessible `role="dialog"` / `aria-modal="true"` when appropriate

Domain-specific content remains separate:

- Login
- Registration
- Search
- Booking
- refund/other confirmation dialogs

Do not build one giant modal component containing all domain logic.

Closing/abandoning a booking modal must coordinate with booking hold-release rules rather than simply hiding UI.

A React portal may be introduced if it solves a real stacking/focus/layout need; it is not mandatory by default.

---

## 24. Search overlay

Search state:

- closed
- prompt
- loading
- results
- no results
- error

Behavior:

- debounce before calling `GET /search`
- support abort/stale-response protection
- blank query behavior follows API response contract
- API returns at most the documented result limit; do not invent a different server limit
- render prompt/results/no-results/error states from Figma
- support keyboard interaction where applicable
- Escape closes through overlay behavior
- selecting a result navigates to the movie detail route

Search request state should stay local to the search feature unless a concrete need justifies broader state.

---

## 25. Seat map component architecture

A `SeatMap` component receives API seat-map data and selection state.

Responsibilities:

- preserve `sections → rows → seats`
- preserve row labels
- preserve different section widths
- render unavailable gaps
- render `aisleAfter`
- render `available`, `held`, `sold`, `unavailable`, and selected/own-hold visual states correctly
- use seat `label` for visible seat number where appropriate
- expose meaningful accessible labels including seat code/state
- emit select/deselect intent with seat ID/data

Individual seat buttons do not call booking APIs.

`BookingProvider` owns selection/hold/order state and mutations.

Never hardcode hall geometry.

---

## 26. CSS architecture

### `styles/main.css`

Imports/organizes the CSS layers used by the application.

### `tokens.css`

Contains verified, reusable design tokens only:

- colors
- typography families
- recurring font sizes/weights
- radii
- common shadows
- recurring spacing values where genuinely reusable

Do not convert every Figma pixel into a token.

### `reset.css`

Minimal reset:

- box sizing
- body margin
- button/input font inheritance
- image defaults
- sensible form normalization

### `base.css`

Global primitives:

- body
- typography defaults
- links
- focus visibility
- global utility behavior

### `layout.css`

Shared page/container layout primitives only.

### component CSS

Reusable component styles and their visual states.

### page CSS

Composition unique to a route/page.

Do not style reusable buttons/cards only inside a page stylesheet.

### Desktop reference behavior

Figma's primary desktop frames are 1728px wide.

The Assignment's 1920×1080 reference is the target display environment, not a scale factor.

At wider desktop viewports:

- preserve exact inspected Figma component dimensions where fixed
- allow outer container/page space to grow sensibly
- center/distribute according to the inspected composition
- do not multiply every Figma measurement by `1920 / 1728`
- do not stretch components merely to fill the viewport

Do not invent mobile/tablet breakpoints that are not required by the Assignment or verified in Figma.

---

## 27. CSS naming convention

Use readable component-oriented names.

BEM-like naming is acceptable without requiring strict academic BEM.

Examples:

```text
.navbar
.navbar__logo
.navbar__actions

.movie-card
.movie-card__poster
.movie-card__title
.movie-card--large

.form-field
.form-field__input
.form-field--error

.seat
.seat--selected
.seat--held
.seat--sold
```

State classes may use:

```text
.is-open
.is-loading
.is-disabled
.is-active
```

Avoid:

- deeply nested selectors
- styling by generated React structure
- IDs for styling
- selectors that depend on fragile DOM position

---

## 28. Design tokens

Populate tokens from exact Figma inspection.

Known typography family tokens:

```css
:root {
  --font-primary: "Archivo", sans-serif;
  --font-numeric: "Poppins", sans-serif;
}
```

Additional token categories may include:

```css
:root {
  /* colors */
  --color-bg: ...;
  --color-surface: ...;
  --color-text: ...;
  --color-text-muted: ...;
  --color-primary: ...;
  --color-success: ...;
  --color-warning: ...;

  /* layout */
  --page-max-width: ...;

  /* radius */
  --radius-sm: ...;
  --radius-md: ...;
}
```

Do not finalize a token value from this architecture document alone.

Open the exact Figma node and verify:

- dimensions
- spacing
- padding
- typography
- line-height
- letter-spacing
- colors
- radius
- borders
- shadows
- interaction states

---

## 29. Accessibility baseline

Required where applicable:

- semantic landmarks
- real buttons for actions
- real links for navigation
- visible keyboard focus
- form labels
- field error association
- `aria-live` for important async/error feedback where useful
- accessible modal semantics
- Escape handling
- focus restore after modal close
- meaningful seat labels
- real disabled semantics when appropriate
- image `alt` text
- keyboard-usable search/results
- keyboard-usable navigation/profile controls

Meet the Assignment/Figma visuals and accessibility requirements together.

---

## 30. Image/assets policy

Prefer Figma-provided/exportable assets when the design uses specific icons/graphics.

Movie posters/backdrops come from API URLs.

Do not:

- hotlink arbitrary replacement artwork
- invent missing icons
- use emoji as production substitutes for designed icons
- commit unverified binary assets

If a required Figma asset cannot be exported/read, record the gap before substituting.

---

## 31. Font policy

Accepted font-loading strategy:

- load fonts remotely from Google Fonts
- Archivo Regular — 400
- Archivo SemiBold — 600
- Archivo ExtraBold — 800
- Poppins Medium — 500 only where inspected Figma typography requires it

Archivo is the default application typeface.

Do not use Poppins globally.

Configure font loading centrally in `index.html`.

Keep sensible `sans-serif` fallbacks.

Do not commit arbitrary font binaries from unverified sources.

If official project-provided font assets are discovered later, revisit the decision explicitly rather than silently changing font strategy.

---

## 32. Security and untrusted content

Rules:

- no `eval`
- no dynamic `Function` constructor
- keep React escaping intact
- avoid `dangerouslySetInnerHTML` for normal API/user content
- never log auth tokens
- never put tokens in URLs
- never persist card number, expiry, or CVV
- never expose server secrets/config as if the browser could keep them private
- validate avatar/file type/size client-side only for UX while server remains authority
- clear sensitive checkout input state after successful completion or full abandonment where appropriate

Checkout success exists only when the API returns a successful Order.

Do not create fake success state.

---

## 33. Browser storage boundaries

### `localStorage`

Allowed:

- Bearer auth token through `tokenStorage.js`
- client-only Recently Viewed movie slugs in separate guest and authenticated-user-ID partitions (D-032)
- other non-sensitive application-owned UX state only if a real requirement justifies it

### `sessionStorage`

Allowed:

- minimal active booking hold reference through `holdStorage.js`

```js
{
  holdId,
  sessionId
}
```

Never persist:

- card number
- expiry
- CVV
- full seat map
- full hold response as authoritative state
- full API user/profile object merely for convenience
- backend error objects unnecessarily

### Recently Viewed

Recently Viewed is client-only browser state; do not invent a backend endpoint.

Rules:

- applies to guests and authenticated users; hide the section when current history is empty
- store an ordered list of movie slugs only
- preserve `kino-xii:recently-viewed:{userId}` account records and use a separate `kino-xii:recently-viewed:guest` record; never automatically merge them
- retain at most 20 unique slugs as a browser-local capacity bound; safely normalize malformed records and tolerate unavailable storage
- add a movie only after Movie Detail loads successfully
- viewing the same movie again moves its slug to the most-recent position instead of duplicating it
- record the actual API-returned slug; capture visit ownership per detail read/retry, resolve initial session restoration and revoke recording on later auth lifecycle changes so stale account results cannot record visits; public detail reads depend on slug independently of auth, preserving MovieSessions and its selected date on Login/logout; retain abort/revision guards for actual navigation
- retrieve current movie data with `GET /movies/{movie}` when rendering; Home reads never count as visits
- prune definite 404s and invalid stored values; retain transient read failures for explicit retry
- display at most two usable movies, most recent first, using inspected Card_Small/Home geometry
- keep rendering/read state local to the Home section; key it by partition, hide it during authentication transitions, and abort/ignore reads on auth lifecycle changes
- do not present it as cross-device/server-synchronized history

---

## 34. Page-specific ownership

### Home

Own page-local:

- featured read state
- now-playing read state
- coming-soon read state
- hero UI state
- Recently Viewed rendering request state

Shared auth/filter-options data comes from providers.

### Sessions

Own:

- URL-derived query state
- current sessions request/result/meta
- filter UI state that is purely presentational

Do not duplicate durable filters outside URL search params.

### Movie Detail

Own:

- movie detail read state
- selected date
- grouped movie-session read state
- local display state

Age/profile eligibility uses server-returned data.

### Profile

Own:

- active tab when not URL-controlled
- controlled profile form draft
- tickets read/filter state
- refund dialog/local feedback state

Active booking stays in BookingProvider because booking can start from multiple pages.

---

## 35. Profile update strategy

On successful `PUT /profile`:

1. use the returned user payload
2. replace the current user through `AuthProvider`
3. render profile completeness from returned `profileComplete`
4. render eligibility information from returned API-derived `age`
5. update navbar/profile indicators from new user state
6. if a pending protected booking action was waiting for profile completion:
   - verify `profileComplete`
   - replay once
   - clear pending state appropriately

Do not manually force `profileComplete = true`.

Do not replace returned age with independent client date math.

---

## 36. Tickets/refund strategy

`ProfilePage` composes ticket tabs.

`ticketsApi` fetches server state.

Use server `isRefundable` to control refund availability.

Refund flow:

1. inspect `order.isRefundable`
2. show confirmation UI
3. guard duplicate refund mutation
4. call refund endpoint
5. use returned updated `Order` or refetch consistently
6. update the relevant ticket view
7. show server message when rejected

Do not compute the two-hour refund cutoff independently.

The server is authoritative for refund status.

---

## 37. Not Found and fatal states

React Router must include an application-level Not Found route.

For API/domain failures:

- prefer local recoverable error states
- avoid crashing the entire app because one section fails
- offer retry when useful

Example:

- Home featured request fails while Now Playing succeeds:
  - render available sections
  - show local failed-section feedback/retry where practical

Boot-critical `/filter-options` failure may justify application-level retry because many controls depend on it.

Unexpected render errors may justify a small React error boundary later if a concrete need appears; do not add one only for ceremony.

---

## 38. Logging during development

Temporary debug logs are allowed during implementation.

Before final submission:

- remove noisy/debug-only logs
- never log token/card data
- keep only useful error logging if genuinely appropriate
- ensure normal expected handled failures do not spam the console

No analytics dependency is required unless the Assignment explicitly asks for it.

---

## 39. Local development and build tooling

Vite is the accepted development/build tool.

Do not use VS Code Live Server for this React application.

Development commands are the Vite/npm workflow defined by `package.json`, typically:

```text
npm install
npm run dev
npm run build
npm run preview
```

The exact generated scripts should come from the actual Vite scaffold/package configuration.

Requirements:

- `npm run dev` starts the local Vite server
- `npm run build` produces the production build
- build output is suitable for Netlify deployment
- development should not rely on opening `index.html` through `file://`

Do not add tooling dependencies merely by preference.

---

## 40. Deployment architecture

Netlify is the accepted public deployment platform.

Production build:

```text
command: npm run build
publish: dist
```

Use root-level `netlify.toml` for SPA fallback:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

The catch-all is an SPA rewrite so direct navigation/refresh works on React Router routes such as:

- `/sessions`
- `/movies/:slug`
- `/profile`

React Router remains responsible for rendering the application Not Found page for unknown application routes.

Verify production deployment with direct URL entry and browser refresh on non-root routes.

---

## 41. Git strategy

Default branch:

```text
main
```

Work incrementally.

Commit one coherent change/feature at a time:

- not one commit per line
- not one giant final project commit

Example commits:

```text
chore: scaffold React Vite application
chore: add Netlify SPA deployment config
feat: add API client and filter-options bootstrap
feat: implement authentication modal flow
feat: add sessions URL-synced filters
feat: render API-driven seat map
feat: add hold restoration and expiry handling
feat: complete checkout order flow
fix: reconcile contested seats after 409
```

Before substantial edits:

- inspect existing code
- inspect relevant Assignment section
- inspect exact OpenAPI endpoint/schema
- inspect relevant Figma node/state

After:

- state changed files
- explain why
- run relevant checks
- mention unresolved issues

---

## 42. Branch strategy

For a solo assignment, avoid unnecessary branching complexity.

Recommended:

- keep `main` stable
- use a short-lived feature branch only when useful for risky/large work

Do not create branches merely for ceremony.

If multiple AI tools are involved:

- only one agent owns implementation of the same feature at a time
- reviewer should not simultaneously rewrite that feature
- reconcile review findings before handing ownership to another implementer

---

## 43. `AGENTS.md`

Purpose:

Give Codex/other implementation agents repository-local rules.

It should require:

- read canonical docs before editing
- OpenAPI authority for backend behavior
- Assignment authority for required functionality
- Figma node inspection for exact visuals
- follow accepted React + Vite + React Router architecture
- use React built-in state strategy unless a later decision changes it
- do not add dependencies merely by preference
- incremental edits
- preserve unrelated working code
- report changed files
- no invented endpoints/business behavior/Figma values
- no fake checkout
- no hardcoded seat map
- test relevant edge states
- do not log/persist sensitive data

Do not include obsolete "no frameworks" or Live Server rules.

---

## 44. `CLAUDE.md`

Purpose:

Make Claude the independent reviewer by default.

It should require:

- inspect rather than rewrite by preference
- compare implementation against:
  - Assignment
  - OpenAPI
  - Figma
  - accepted architecture/decisions
- report reproducible issues
- include file/line references where possible
- separate:
  - blocker
  - functional bug
  - design mismatch
  - maintainability concern
- do not change architecture unless a concrete defect requires it
- do not implement the same active feature simultaneously with Codex

---

## 45. AI feature workflow

For each feature:

### Implementation phase — Codex

Prompt should include:

- exact feature scope
- relevant source docs
- relevant Figma node IDs/states
- files to inspect first
- expected loading/empty/error/validation states
- instruction not to touch unrelated areas

### Review phase — Claude

Ask Claude to:

- review the changed diff
- verify Assignment
- verify OpenAPI contract
- verify exact Figma state
- verify accepted architecture/decisions
- identify reproducible issues only
- avoid implementation unless specifically assigned

### Coordination — ChatGPT Project

Use for:

- source conflict resolution
- architecture decisions
- task scoping
- environment/deployment planning
- handoffs between chats
- final QA planning

Only one agent should own implementation of the same feature at one time.

---

## 46. Definition of Done per feature

A feature is done only when applicable items are verified:

1. happy path works
2. required loading state exists
3. relevant empty state exists
4. validation behavior matches confirmed rules
5. relevant `401`, `403`, `404`, `409`, `422`, `500`, and network states are handled
6. duplicate mutation is prevented
7. stale reads cannot overwrite newer state
8. keyboard interaction is acceptable
9. modal/focus behavior is correct where applicable
10. Back/Forward/refresh behavior is correct where applicable
11. visual state matches exact inspected Figma nodes
12. API payload/response handling matches OpenAPI
13. no server-controlled values were hardcoded
14. no unrelated code was rewritten
15. console has no new unexpected errors
16. changed files and checks are reported
17. reviewer findings are resolved or explicitly rejected with evidence

---

## 47. Files not to create prematurely

Do not create placeholder modules just to fill the target tree.

For example, do not create:

- every component file
- every CSS file
- every hook
- every validation helper
- empty test files
- unused abstractions

Create a file when a real feature needs it.

Exceptions are infrastructure files required by the chosen scaffold/deployment, such as package/Vite/Netlify entry configuration.

---

## 48. Architecture anti-patterns

Reject:

- one giant `App.jsx`
- one giant global CSS file containing all feature styling
- page/component code calling raw `fetch` everywhere
- components mutating unrelated shared state
- duplicated API error parsing
- multiple durable sources of truth for Sessions filters
- hardcoded seat layouts
- flattened seat-map nesting
- hardcoded `/filter-options` business values
- client-generated fake `Order`
- ad-hoc token reads scattered across modules
- `dangerouslySetInnerHTML` for normal API/user values
- hold timers based on local decrement as authoritative time
- storing payment-card data
- persisting full seat maps/hold objects as authoritative browser state
- Redux/Zustand/form libraries added without a concrete need and recorded decision
- custom router infrastructure alongside React Router
- implementation agents rewriting architecture merely by preference

---

## 49. Initial implementation/scaffold set

After creating the React/Vite project, keep the first real implementation foundation small.

Expected scaffold/infrastructure:

```text
index.html
package.json
package-lock.json
vite.config.js
netlify.toml
README.md
AGENTS.md
CLAUDE.md
.gitignore

docs/
  canonical source files

src/
  main.jsx
  config.js

src/app/
  App.jsx
  AppBootstrapProvider.jsx
  bootstrap.js

src/routing/
  AppRouter.jsx
  routes.js

src/api/
  client.js
  sessionsApi.js

src/pages/
  HomePage.jsx
  NotFoundPage.jsx

src/styles/
  main.css
  tokens.css
  reset.css
  base.css
  layout.css
```

Add auth, booking, forms, profile, tickets, search, and other feature modules only when their feature implementation begins.

The first boot path should prove:

- React renders successfully
- React Router resolves the current route
- global CSS loads
- API client can call `GET /filter-options`
- boot loading/error/ready state works
- production build succeeds

---

## 50. Architecture checkpoint

Before substantial feature implementation, confirm:

- repository folder/Git are ready
- canonical docs are current
- `06_DECISIONS.md` reflects accepted React/Vite/Router/state/form/deployment/storage/font decisions
- React/Vite scaffold runs with `npm run dev`
- `npm run build` succeeds
- React Router direct navigation works locally
- production API is reachable from the browser
- `/filter-options` boot handling is implemented without hardcoded fallback values
- Netlify SPA fallback configuration exists
- `AGENTS.md` reflects the React architecture
- `CLAUDE.md` reflects reviewer role
- first meaningful architecture/scaffold commit is made

Only then continue feature-by-feature implementation.

---

## 51. Decision-log relationship

`06_DECISIONS.md` records choices that are not merely copies of Assignment/OpenAPI/Figma.

This architecture must stay aligned with active decisions, including:

- D-005 — server-controlled business values
- D-006 — auth token persistence in `localStorage`
- D-008 — Netlify deployment
- D-009 — Netlify SPA fallback
- D-010 — minimal active-hold persistence in `sessionStorage`
- D-011 — remote Google Fonts strategy
- D-012 — Checkout Back returns to Seat Selection without abandoning the live hold
- D-013 — Figma 1728px geometry vs 1920×1080 target environment
- D-014 — client-only Recently Viewed
- D-015 — React
- D-016 — Vite
- D-017 — React Router
- D-018 — React built-in state management
- D-019 — React-controlled forms/project-owned validation

If a later decision changes architecture:

1. update `06_DECISIONS.md`
2. update this document
3. update affected implementation/configuration
4. do not leave contradictory active rules behind

Never record guesses as accepted architecture.
