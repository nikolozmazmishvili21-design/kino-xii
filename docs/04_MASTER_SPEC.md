# Kino XII — Master Specification

> Cross-source implementation map for the Kino XII cinema-ticketing SPA.
>
> Sources:
> - `01_ASSIGNMENT_SPEC.md` — functional requirements
> - `02_OPENAPI.json` — authoritative backend/API contract
> - `03_FIGMA_REFERENCE.md` — design structure and visual-state inventory
>
> **Priority when sources conflict**
> 1. OpenAPI for backend/API behavior
> 2. Assignment for required functionality/business expectations
> 3. Figma for visual design and interaction states
> 4. Explicit project decisions recorded later in `06_DECISIONS.md`
>
> Never guess. If a conflict is discovered, record it before implementation.

---

## 1. Product definition

Build a cinema-ticketing SPA using an assignment-allowed frontend technology stack.

The assignment permits Vanilla JavaScript as well as frontend frameworks and libraries such as React, Vue, Svelte, Angular, and supporting UI/form libraries.

### Chosen implementation stack

This project will use:

- React
- JavaScript
- HTML5
- CSS3
- Fetch API / browser APIs where appropriate

The technology choice itself is not part of the assignment evaluation. Implementation quality, required functionality, API correctness, Figma fidelity, maintainability, and interaction behavior remain the project priorities.

The app must support:

- public movie discovery
- search
- Sessions browsing/filtering/sorting/pagination
- authentication
- movie details
- seat selection
- ticket-type pricing
- seat holds
- checkout/order creation
- profile completion
- age restrictions
- My Tickets
- refunds
- loading/empty/error states

---

## 2. Global application boot

### Required startup sequence

1. Initialize application shell/router.
2. Fetch `GET /filter-options`.
3. Cache the result in application state for the session.
4. If a stored auth token exists:
   - call `GET /me`
   - on `200`, restore authenticated user state
   - on `401`, discard the stale token and continue as guest
5. Render the current route from URL state.

### Why `/filter-options` is foundational

Do not hardcode:

- venues
- venue-supported formats
- formats
- languages
- time bands
- sort options
- ticket types
- ticket ratios
- age ratings
- maximum seats per order
- hold duration

These values come from the API.

### Implementation modules

Recommended ownership:

- `apiClient`
- `filterOptionsStore`
- `authStore`
- `router`
- app bootstrap

---

## 3. Global navigation

### Guest

Assignment requires:

- Logo
- Sessions
- Log in
- Sign up

Figma reference:

- Navbar unauthorized state — `137:1978`

### Authenticated

Assignment requires:

- Logo
- Sessions
- user/avatar control
- My Profile
- Logout

Figma reference:

- Navbar authorized — `240:1398`
- additional navbar state — `272:3210`
- profile controls — `276:9712`, `276:9752`
- profile incomplete/complete menu — `355:11311`

### Profile-completeness UI

Use API `user.profileComplete`.

Do not derive completeness independently when deciding application state.

Figma explicitly distinguishes:

- incomplete-profile authenticated state
- complete-profile authenticated state

---

## 4. Authentication

### Registration

API:

`POST /register`

Request:

- `multipart/form-data`
- required:
  - `username`
  - `email`
  - `password`
  - `password_confirmation`
- optional:
  - `avatar`

Important API facts:

- registration returns both user and token
- user is immediately authenticated
- newly registered account has `profileComplete: false`
- avatar supports jpg/jpeg/png/webp, max 2 MB
- use exact field name `password_confirmation`

Assignment UI fields:

- Username
- Email
- Password
- Confirm Password
- Avatar

Figma:

- Sign up — `269:4543`
- Signup filled — `269:4724`
- input states — component set `263:3550`

### Login

API:

`POST /login`

Request:

- email
- password

Behavior:

- store returned token
- use `Authorization: Bearer <token>` for protected requests
- wrong credentials `401` keeps login modal open
- preserve entered email

Figma:

- Login — `269:4439`
- Login filled — `269:4441`

### Session restoration

API:

`GET /me`

Call only when stored token exists.

- `200`: restore user
- `401`: clear stored token, continue as guest

### Logout

API:

`POST /logout`

Always clear the locally stored token after logout attempt, including when server response is not successful.

### Protected-action replay

If a guest or expired session attempts a protected action:

1. capture an explicit pending action descriptor
2. open Login
3. authenticate
4. if profile completeness is required and profile is incomplete, route/show profile completion first
5. replay/continue the original action exactly once

Examples:

- Select Seats
- Notify Me
- My Tickets
- refund/protected mutations

Do not make the user click the original action twice.

---

## 5. Home page

### Figma screens

- Guest — `139:2899`
- Authenticated — `272:3698`
- Authenticated incomplete — `272:4139`
- Authenticated complete — `369:6407`

### Hero

API:

`GET /movies/featured`

Facts:

- returns featured movies
- featured movies are a subset of now-playing
- therefore featured titles are bookable

Figma:

- Banner component set — `131:4477`
- variants include `131:4476`, `137:1793`, `137:1840`, `137:1887`
- banner geometry 1728×760

### Now Playing

API:

`GET /movies/now-playing`

Use `limit` for the home grid if required by the design.

Display from API data:

- poster
- title
- age rating
- genre
- from price

Assignment action:

- Buy Ticket → movie detail
- See All → Sessions

Figma:

- Card_big — `108:2446`

### Coming Soon

API:

`GET /movies/coming-soon`

Important:

- these movies do not have bookable sessions
- clicking one must not open seat selection

Use:

`POST /movies/{movie}/notify`

for `Notify Me`.

Notify endpoint is protected.

Repeated subscription is idempotent from the user's perspective.

Figma:

- Card_medium — `108:2346`
- Notify button states in Button set

### Authenticated-only home details

Figma includes `Recently viewed`.

Do not invent its persistence/API behavior unless confirmed during implementation; if no API endpoint exists for it, record the discrepancy before choosing a client-side strategy.

---

## 6. Search

### API

`GET /search?q=...`

API behavior:

- title typeahead search
- max 6 results
- blank query returns empty array
- debounce before calling

### Figma

Search input:

- component set `332:10366`
- Default / Hover / Focused / Type / Filled

Result panel:

- Results — `326:6261`
- No results — `326:6260`
- Empty — `332:10737`

Overlay screens:

- Prompt — `361:6212`
- Results — `361:6267`
- No results — `361:6328`

### Implementation requirements

- debounce requests
- prevent stale response overwrite
- use `AbortController` or request-sequence protection
- render loading/empty/results correctly
- keyboard usability required

---

## 7. Sessions page

### Figma

- default — `272:7289`
- filtered — `276:9167`

### API

`GET /sessions`

Query parameters include:

- `date`
- `venues[]`
- `formats[]`
- `languages[]`
- `bands[]`
- `search`
- `sort`
- `page`

Array filters use **slugs**, not IDs.

Filter semantics:

- OR within one filter category
- AND across categories

Example meaning:

`venues[]=galleria&venues[]=vake&formats[]=max`

= (Galleria OR Vake) AND MAX

### URL synchronization

All filtering/sorting/pagination state must be mirrored in the browser URL.

Requirements:

- refresh restores state
- Back restores previous state
- Forward restores next state
- filter/sort change resets page to 1
- invalid current page after filtering moves to the highest valid page

### Pagination

Critical API behavior:

- sessions response is grouped by movie
- pagination counts **movies**, not individual sessions
- `perPage` is films per page
- `meta.totalSessions` drives `Showing X sessions`
- `meta.totalMovies`/`lastPage` drive pager state

Do not assume 10 sessions per page.

### Filter options

Use `GET /filter-options`.

Dynamic venue/format behavior:

- each venue exposes supported `formats`
- when venues are selected, narrow valid format options from that data

### Sorting

Do not hardcode values; render from `/filter-options`.

Known API sort IDs include:

- `time_asc`
- `time_desc`
- `price_asc`
- `price_desc`
- `title_asc`

### Figma components

- Days — `119:3614`
- Sessions — `119:3760`
- Sessions time — `276:10275`
- Pagination — `429:7088`

### Sold-out sessions

Keep visible but disabled.

Use API-provided `isSoldOut` / availability-related fields rather than client guesses.

---

## 8. Movie detail page

### API

`GET /movies/{movie}`

Use movie slug in the path.

The response provides the data required for the detail page, including movie metadata and `availableDates`.

Important:

- use `availableDates` to determine valid session dates
- do not enable dates known to have no upcoming sessions

Sessions for one movie/date:

`GET /movies/{movie}/sessions?date=...`

Response is already grouped by venue.

Each session includes live availability data such as:

- `seatsLeft`
- `isSoldOut`

### Age gate

Use:

- authenticated user's API-derived `age`
- movie `ageRating.minAge`

Do not independently calculate age if API already supplies it.

When user is under required age:

- disable booking action
- use assignment/Figma messaging

### Figma

Buy-ticket section:

- section `284:15451`
- eight movie-detail/booking-related frames

Exact state mapping must be checked per node during implementation.

---

## 9. Seat map

### API

`GET /sessions/{session}/seats`

This is the only source for hall geometry.

Never hardcode seat grids.

### Response hierarchy

Preserve:

`sections[] → rows[] → seats[]`

Do not flatten all sections into one grid.

Reasons:

- halls have different shapes
- sections can have different row widths
- real row labels may skip letters

### Seat fields

Use:

- `id`
  - send this to booking APIs
- `code`
  - human-readable seat reference, e.g. E7
- `label`
  - number shown in seat button
- `state`
  - visual/selectability state
- `aisleAfter`
  - render a visual gap to the right
- `isMine`
  - identifies user's own active hold

### Seat states

API defines:

- `available`
- `sold`
- `held`
- `unavailable`

Rules:

- available → selectable
- sold → disabled permanently
- held by someone else → disabled but visually distinct from sold
- unavailable → render grid gap, not a seat button

Figma:

- seat states component set `119:3146`
- visual states:
  - Default
  - Selected
  - Held
  - Disabled

### Auth note

Seat map is public.

When token is sent, `isMine` can restore seats belonging to the user's live hold.

---

## 10. Seat selection and ticket types

### Maximum seats

Do not hardcode 3.

Use:

`filterOptions.maxSeatsPerOrder`

The current API example is 3, but source of truth remains `/filter-options`.

### Ticket types

Read from:

`filterOptions.ticketTypes`

Do not hardcode ratios.

Current documented concepts:

- adult
- student
- child

Default newly selected seat to adult.

Child ticket availability:

- must respect API-controlled rule
- currently blocked when movie minimum age is 16 or above

### Price summary

For each selected seat:

- seat code
- ticket type
- calculated price

Show total/subtotal as required by Figma.

Money is GEL as a normal numeric value, not minor units.

### Figma

Seat Selection component set — `265:3958`

- Empty — `265:3956`
- Seat selected — `265:3954`
- Checkout — `265:3955`
- Checkout filled — `265:3953`
- Confirmation — `265:3957`

---

## 11. Creating a seat hold

### API

`POST /sessions/{session}/holds`

Protected.

Request:

- send selected seat `id` values
- include ticket type for each selected seat

Do not send human-readable `code` as the seat identifier.

### Hold behavior

- one user has at most one hold per session
- creating a new hold for the same session replaces the previous hold
- no need to DELETE the old hold before replacing selection

### Countdown

Do not run an arbitrary local 8-minute timer as source of truth.

Use API hold response expiry, especially `expiresAt`.

`filterOptions.holdMinutes` may be used for display/rule context, but actual live countdown should be derived from the hold's server expiry.

### 409 conflict

On `409`:

- no new hold was created
- read `contested`
- tell user which seat codes were lost
- remove only contested seats
- preserve still-valid selections
- mark/reconcile lost seats
- refetch `GET /sessions/{session}/seats`

### 422 business-rule block

If `422` has no `errors` object and only a message:

- treat it as a booking-rule failure
- show server `message` directly

---

## 12. Hold restoration / release / expiry

### Read existing hold

API:

`GET /holds/{hold}`

Use for restoration after refresh/navigation when a hold identifier is persisted for the active booking flow.

Do not assume a returned hold is live; inspect server-provided live/expiry state.

### Release

API:

`DELETE /holds/{hold}`

Use when the user abandons the entire booking flow and the contract requires releasing the hold.

Do not release simply because the user moves from Checkout back to Seat Selection if the booking flow remains active.

### Expiry

When server expiry is reached:

- clear checkout state
- clear invalid held selection
- return to Seat Selection
- refetch seat map
- show the documented expiry message

---

## 13. Checkout / order creation

### API

`POST /orders`

Protected.

Required body:

- `holdId`
- `fullName`
- `email`
- `mobileNumber`
- `cardNumber`
- `expiry`
- `cvv`

Key validation:

- fullName 3–50
- valid email
- Georgian mobile format
- card number 16 digits
- expiry MM/YY and not past
- CVV 3 digits

### Submission safety

- one in-flight order request at a time
- disable submit while pending
- prevent rapid/double submission

### Success

API returns an `Order`.

Confirmation must render from that returned Order.

Never fake success.

### Errors

- `401` → auth flow/replay where appropriate
- `403` → authorization/data ownership problem; do not pretend it is user-fixable
- `409` → contested seat reconciliation
- `422 + errors` → field errors
- `422 message-only` → booking/business rule
- `500` → visible retry/error path

---

## 14. Confirmation

Figma:

- Confirmation state `265:3957`

Assignment requires:

- successful booking state
- order reference
- ticket/seat details
- movie/session details
- My Tickets action
- Close action

Use server Order data only.

---

## 15. Profile

### API

`PUT /profile`

Protected.

Fields:

- `fullName`
- `mobileNumber`
- `dateOfBirth`
- `preferredVenueId`
- optional avatar

Email:

- registration email is not editable through profile
- render read-only/disabled

### Profile completeness

Use returned `profileComplete`.

Required for booking:

- fullName
- mobileNumber
- dateOfBirth

### Age

Use API-derived `age`.

Do not replace server age/business rules with custom date math for eligibility.

### Validation errors

Backend error strings are intended to be shown directly.

Map exact `errors[field]` entries to their fields.

### Figma

- Information screen — `284:13298`
- incomplete profile menu — `355:11310`
- complete profile menu — `355:11309`

---

## 16. My Tickets

### API

`GET /tickets`

Protected.

Filter supports ticket grouping/state such as:

- upcoming
- past

API contract meaning:

- upcoming = paid orders for sessions not yet started
- past = completed-session orders plus refunded orders
- without a filter both may be returned

Each Order already contains enough session/ticket information to render the card without extra requests.

### Figma

- tickets screens — `284:17650`, `291:19541`
- Tickets tab — `291:19183`
- My tickets card — `291:18200`

---

## 17. Refund

### API

`POST /orders/{order}/refund`

Protected.

Important:

- drive button state from API-provided `isRefundable`
- do not calculate the 2-hour cutoff yourself
- ask for confirmation before mutation
- action cannot be undone

On success:

- API returns updated Order
- re-render using returned object
- do not optimistically delete the card and guess state

On `422`:

- server message explains refusal
- show it directly

---

## 18. Error handling contract

Central API client should normalize failures while preserving response body.

### 401

Meaning:

- missing/expired/revoked token
- except login's own 401 = invalid credentials

Behavior:

- protected action → login + replay
- boot `/me` → clear token and become guest
- login → keep modal open and show message

### 403

Record/account ownership mismatch.

Treat as unexpected/bug-like state, not something the user can normally fix.

### 404

Missing entity.

Render safe not-found/error UI.

### 409

Seat contention.

Use `contested` response.

### 422 with `errors`

Field validation.

Map server field keys to inputs.

### 422 without `errors`

Business-rule/booking failure.

Show `message` directly.

### 500/network

Show user-friendly retry path.

---

## 19. Async/race-safety requirements

Use explicit pending state for all mutations.

Prevent:

- duplicate login/register submission
- duplicate profile update
- duplicate holds from rapid click
- duplicate orders
- duplicate refund

For read requests that can become stale:

- Sessions filtering
- Search
- movie date/session switching
- seat-map refreshes

use:

- `AbortController`, or
- monotonically increasing request IDs

Old responses must not overwrite newer UI state.

---

## 20. Modal interaction standard

Assignment requirements:

- dimmed/blurred background
- X/Close
- Escape closes
- backdrop click closes
- validation on blur
- success/error field state
- loading state during mutations

Figma input component explicitly includes:

- Default
- Hover
- Focused
- Filled
- Error
- Success

Keyboard focus must remain usable.

Implementation should restore focus to the invoking control when practical.

---

## 21. Loading and empty states

### Sessions

Assignment specifically requires skeleton loading states.

Do not use only a generic spinner.

### Other async views

Provide clear loading for:

- Home data
- search
- movie details/sessions
- seat map
- profile
- tickets
- form/mutation actions

### Empty states

Handle at least:

- no Sessions results
- search no results
- no upcoming tickets
- no past tickets

Use Figma where a specific empty state exists.

---

## 22. Design system implementation map

### Typography

Primary:

- Archivo

Verified styles include:

- ExtraBold: 40, 24, 20, 18, 14
- SemiBold: 14, 12
- Regular: 16, 14, 12

Some numeric UI uses Poppins Medium 14.

Do not globally replace Poppins occurrences without checking target node.

### Main observed colors

- `#070C1C`
- `#FFFFFF`
- `#A9A9A9`
- `#EC3013`
- `#1E2031`
- `#2A2C3D`
- `#505261`
- `#4ADE80`
- `#E27E04`
- `#8A38F5`
- `#444444`
- `#E3E3E3`

Final semantic CSS token names must be established from actual component usage, not frequency alone.

### Exact styling rule

Before implementing a screen/component:

- open the exact Figma node
- inspect design context
- take exact values for:
  - size
  - padding
  - gap
  - alignment
  - type
  - colors
  - radius
  - borders
  - shadows
  - hover/focus/selected/disabled/error states

---

## 23. Route/state plan

Final route names should be confirmed against implementation needs, but the SPA must support at minimum:

- Home
- Sessions
- Movie details
- Profile

Modal flows are stateful overlays rather than full page replacements unless Figma/assignment explicitly indicates otherwise:

- Login
- Registration
- Seat Selection / Checkout / Confirmation
- Search overlay
- profile menu

Sessions URL query state is mandatory.

Movie/session identifiers must use the API's expected slug/id types.

---

## 24. State ownership boundaries

### Global app state

Own:

- filter options
- auth token
- current user
- pending protected action
- global modal/search shell state

### Sessions page state

Own:

- URL-derived date
- venues
- formats
- languages
- bands
- search
- sort
- page
- current request state/results/meta

URL is the durable source for Sessions view state.

### Booking state

Own:

- session id
- seat map
- selected seats
- ticket type per selected seat
- active hold id
- hold expiry
- checkout step
- pending mutations
- order/confirmation result

Server remains source of truth for seat availability and hold validity.

---

## 25. Implementation order

Recommended feature sequence:

1. project scaffold / app shell
2. design tokens/base CSS
3. API client + error normalization
4. router
5. filter-options boot state
6. auth/session restoration
7. Navbar + modal foundation
8. Login / Registration
9. Home
10. Search
11. Sessions + URL state
12. Movie details
13. Seat map / seat selection
14. holds / restoration / expiry
15. checkout / orders
16. Profile
17. My Tickets / refunds
18. full loading/empty/error audit
19. Figma visual QA
20. deployment/final QA

---

## 26. Feature acceptance matrix

A feature is complete only when applicable states have been verified:

| Area | Default | Loading | Empty | Validation | 401 | 409 | 422 | 500 | Figma |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Auth | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Home | ✓ | ✓ | ✓ | — | — | — | — | ✓ | ✓ |
| Search | ✓ | ✓ | ✓ | — | — | — | — | ✓ | ✓ |
| Sessions | ✓ | ✓ | ✓ | — | — | — | — | ✓ | ✓ |
| Movie detail | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | ✓ | ✓ |
| Seat selection | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Checkout | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Profile | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Tickets | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | ✓ | ✓ |

Also verify:

- keyboard behavior
- modal close behavior
- Back/Forward where applicable
- refresh restoration where applicable
- duplicate-click safety
- stale-response safety

---

## 27. Known source conflicts / ambiguities

### Figma frame width vs assignment display reference

- assignment references 1920×1080 target
- Figma desktop frames are mostly 1728px wide

Decision:

- use Figma exact geometry as design source
- make the browser layout behave sensibly around it
- do not mechanically scale all design values to 1920

### Checkout Back wording

Assignment screenshot wording appears inconsistent with the visible step numbering.

Do not guess.

Resolve against:

- Figma booking flow
- actual implemented modal step behavior
- user expectation that Back from Checkout returns to Seat Selection

Record final resolution in `06_DECISIONS.md`.

### Generic Figma variant names

Names such as `Variant2`, `Variant3`, `State3` have no guaranteed business meaning.

Open exact node before implementation.

### Recently viewed

Figma includes the section, while current canonical API inventory does not clearly expose a dedicated recently-viewed endpoint.

Do not invent backend persistence.

Record a design/API gap before deciding whether a client-only implementation is appropriate.

---

## 28. Non-negotiable implementation rules

- no fake seat map
- no fake successful checkout
- no hardcoded API-controlled filter/ticket/hold configuration
- no client-computed refund eligibility when `isRefundable` exists
- no independent age calculation replacing API-derived age
- no loss of interrupted protected action
- no stale async response overwriting newer state
- no duplicate mutations from rapid clicks
- no architectural rewrite merely because another AI prefers a different pattern
- no design approximation when Figma value can be inspected
- no endpoint/schema invention

---

## 29. AI implementation workflow

For each feature:

1. Read this master spec.
2. Read relevant section of `01_ASSIGNMENT_SPEC.md`.
3. Read exact relevant endpoint/schema in `02_OPENAPI.json`.
4. Inspect exact Figma node from `03_FIGMA_REFERENCE.md`.
5. Inspect existing implementation before editing.
6. Implement only the scoped feature.
7. Test normal + relevant edge states.
8. Report changed files and why.
9. Have independent reviewer check against all three sources.
10. Fix reproducible issues only.

Default roles:

- Codex — primary implementer
- Claude — independent reviewer / second opinion
- ChatGPT project chat — architecture/specification coordination

Only one agent should own implementation of the same feature at one time.

---

## 30. Next document

`05_ARCHITECTURE.md` will define:

- exact VS Code repository structure
- JS module boundaries
- CSS file organization
- router contract
- API client contract
- stores/state ownership
- booking-state lifecycle
- validation architecture
- naming conventions
- Git workflow
- Codex/Claude repository instructions

Do not create implementation files before that architecture document is agreed.
