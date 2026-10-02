# Kino XII — Assignment Specification

> Canonical transcription/normalization of the assignment requirements shown in the supplied assignment screenshots.
>
> **Scope rule:** this file is assignment-only. It intentionally does **not** add API behavior or Figma details unless the assignment screenshots themselves state them. API specifics belong in `02_OPENAPI.json`; design specifics belong in `03_FIGMA_REFERENCE.md`.

---

## 1. Project goal

Build a cinema-ticketing single-page application for Kino XII.

The application must support both unauthenticated and authenticated users, including movie discovery, session browsing, authentication, booking, checkout, profile completion, tickets, and refunds.

---

## 2. Technology and delivery constraints

- The design target is a **1920×1080** screen reference.
- The application may be implemented using Vanilla JavaScript or any preferred frontend framework/library.
- Allowed technology choices include, but are not limited to:
  - React
  - Vue
  - Svelte
  - Angular
  - `react-datepicker`
  - `react-hook-form`
  - Formik
  - vee-validate
  - Bootstrap
  - Tailwind
  - Sass
  - other suitable frontend frameworks and libraries
- The choice of technology is not part of the evaluation; neither frameworks nor libraries receive additional or reduced credit.
- Code must be split into files/components rather than kept in one giant file.
- Commit history should be meaningful and incremental rather than one large final commit.
- Deployment must be publicly accessible, e.g. Netlify, GitHub Pages, Heroku, or another public hosting option.
- GitHub/GitLab/Bitbucket repository must be public and code should be kept current there.
- Submission deadline shown in the assignment: **11 October, 23:59:59**.
- A video of **up to 6 minutes** may be provided explaining/showing the implementation and conceptual decisions; the assignment notes that this is not mandatory if the project already demonstrates the work adequately.

---

## 3. Global navigation

### Unauthenticated navigation

Must include:

- Logo
- Sessions
- Log in
- Sign up

### Authenticated navigation

Must include:

- Logo
- Sessions
- User/avatar entry
- A menu containing:
  - `My Profile`
  - `Logout`

---

## 4. Authentication modal — Login

### Entry points

Login modal can be opened from:

- Navbar `Log In`
- `Select Seats` when a protected booking action is attempted by an unauthenticated user
- `My Tickets` when unauthenticated
- `Notify Me` on Coming Soon content when unauthenticated
- other protected actions described by the assignment
- after an API `401` caused by an expired/invalid auth session

### Fields

- Email
  - required
  - valid email format
- Password
  - required
  - minimum 3 characters

### Actions

- `Log In`
  - submits the form
- `Don't have an account? Sign Up`
  - closes Login and opens Registration
- Close / `X`
  - closes the modal

### Successful login

On successful authentication:

- Close the modal.
- Update UI to authenticated state.
- Preserve the action the user originally attempted.
- If login was triggered by `Select Seats`, the user must continue the booking flow after authentication instead of needing to click again.

### Error behavior

- Backend validation/auth errors must be shown to the user.
- API `401` during a protected action must trigger authentication and allow the interrupted action to continue afterward.

---

## 5. Registration modal

### Entry points

Registration can be opened from:

- Navbar `Sign Up`
- Login modal `Sign Up`

### Fields

| Field | Required | Assignment rule |
|---|---:|---|
| Username | Yes | unique, minimum 3 characters |
| Email | Yes | unique, valid email format |
| Password | Yes | minimum 3 characters |
| Confirm Password | Yes | must match Password |
| Avatar | No | image; allowed formats shown as jpg, png, WebP |

### Important behavior

- Username and email uniqueness are checked against the backend/API.
- If the backend returns a meaningful error, display it on the relevant field.
- Avatar preview should appear inside the modal after selection.
- Unsupported image formats must produce a clear user-facing error.

### Actions

- `Sign Up`
  - submits registration
- `Already have an account? Log In`
  - closes Registration and opens Login
- Close / `X`
  - closes the modal

### Successful registration

- Close the modal.
- User becomes authenticated.
- **Important:** profile is not yet complete immediately after registration.
- If registration happened during booking, the user must be sent to complete the profile before continuing the protected booking flow.

---

## 6. Home page

The landing page behavior differs for authenticated and unauthenticated users.

### Hero section

- Shows a film preview / animated hero experience.

### Now Playing

- Shows currently available films.
- Cards include:
  - poster image
  - title
  - age rating badge (`G`, `PG`, `12+`, `16+`, `18+`)
  - genre
  - price label in the form `from ₾XX`
- `Buy Ticket`
  - navigates to the selected film's detail page
- `See All`
  - navigates to the Sessions page

### Coming Soon

- Section title: `Coming Soon`
- Shows unreleased films.
- Each card contains:
  - poster
  - title
  - age rating
  - genre
  - release date
- Clicking a Coming Soon film must **not** navigate into seat selection.
- Coming Soon films use a notification-oriented action such as `Notify Me`.

---

## 7. Sessions page

The page is composed of:

- filter panel on the left
- session list/content on the right

### Filter panel

The filter panel is sticky while scrolling.

#### Venue

- Checkbox list of venues.
- Multiple venues can be selected.

#### Date

- Horizontal date selection.
- Shows the next **7 days**.
- Only one date can be selected.
- The selected date must be visually clear.
- Default date is the current day.

#### Format

Available formats listed in the assignment:

- Standard
- MAX
- ATMOS
- PANORAMA
- MOTION

Multiple selections are allowed.

**Dynamic rule:** format availability must react to selected venue(s). If a selected venue does not support a format, that format must not remain offered/selected in an invalid way.

#### Language

Assignment examples include:

- Georgian Dub
- Georgian Subtitles
- Original with Subtitles
- Russian Dub

Multiple selections are allowed.

#### Time of Day

Three choices:

- Morning — before 12:00
- Afternoon — 12:00–18:00
- Evening — after 18:00

Multiple selections are allowed.

### Filter footer

- `Clear All Filters`
  - clears all active filters except the date
- Active filter counter:
  - e.g. `X filters active`

---

## 8. Sessions list

### Sorting

Dropdown choices shown in the assignment:

- Showtime: Earliest First
- Showtime: Latest First
- Price: Low to High
- Price: High to Low
- Title: A–Z

### Result count

Show:

- `Showing X sessions`

If none are available:

- `No sessions found`

### Grouping

Sessions are grouped under films.

Each film group displays the film's:

- poster
- title
- age rating
- genre
- starting price

Each individual session displays:

- showtime
- venue / hall
- format
- language
- price (`from ₾XX`)
- remaining seat count or `Sold out`

### Sold-out session

- Must remain visible.
- Must be visually disabled.
- User must not be able to select it.

### Clicking a session

Clicking an available session opens the seat-selection/booking flow.

---

## 9. Sessions URL state

Sessions page state must be reflected in the URL.

The assignment gives an example similar to:

```text
/sessions?venue=galleria,batumi&date=2026-11-14&format=max&sort=price_asc&page=2
```

Required behavior:

- Filters must be represented in the URL.
- Sorting must be represented in the URL.
- Pagination must be represented in the URL.
- Refresh must restore the same view from the URL.
- Browser Back must restore previous filter state.
- Browser Forward must restore state appropriately.
- Changing filters or sorting resets pagination to page `1`.
- If the user is on a page that becomes invalid after filtering (example: page 4 but only 3 pages remain), move to the last valid page.

---

## 10. Movie detail page

The page displays complete film information.

### Film information

Includes:

- title
- backdrop and poster imagery
- synopsis
- age rating and its explanation
- genre
- director and main cast
- release date
- available formats

### Session selection

- Shows available dates for upcoming sessions, at least covering the next 7 days where applicable.
- Dates with no sessions should not behave as valid session dates.
- Sessions are grouped by venue.
- Each session shows:
  - time
  - venue
  - format
  - language
  - price
  - availability

Clicking an available session opens Seat Selection.

### Age restriction

For authenticated users:

- If the film is `16+` or `18+` and the authenticated user's age is below the required age, session booking buttons must be visibly disabled.
- The assignment specifies the message:
  - `This film is rated 18+. You cannot buy tickets for it with this account.`
  - wording/number changes according to the relevant age rating.
- Unauthorized users can still browse the film/session information; authentication is required when they attempt the protected booking action.

---

## 11. Booking modal — general

Booking is a two-step process:

1. Seat Selection
2. Checkout

The modal header contains session information such as:

- venue
- hall
- cinema/location information
- date
- time
- format
- language

It also shows a step indicator:

```text
1. Seats → 2. Checkout
```

After moving to Checkout, the modal shows a countdown timer for the hold.

---

## 12. Step 1 — Seat Selection

### Hall map

- Hall layout is supplied by the API.
- Do **not** hardcode a fake seat layout.
- The UI must render the structure returned by the backend.

### Seat states

The assignment names these states:

- `available`
- `sold`
- `held`
- `unavailable`

### Seat rules

- User can select at most **3 seats** for one order.
- Attempting to select more must be blocked with a clear message.
- Sold, held-by-another-user, and unavailable seats cannot be selected.
- A legend must explain all seat states.

---

## 13. Ticket types

Every selected seat must have a ticket type.

Assignment lists:

| Ticket type | Price |
|---|---|
| Adult | 100% of seat/session price |
| Child | 60% |
| Student | 75% |

Additional rule:

- `Child` tickets are unavailable for `16+` and `18+` films.

When the seat is first selected, its ticket type defaults to **Adult**.

If a seat is deselected, its related selection/ticket information must be removed.

---

## 14. Price summary

A live summary panel updates immediately.

For each selected seat show:

- seat code
- selected ticket type
- calculated price

Also show:

- subtotal / total summary

---

## 15. Moving from Seat Selection to Checkout

`Next: Checkout` is enabled only when:

- user is authenticated
- profile is complete
- at least one seat is selected
- every selected seat has a valid ticket type

On click:

- send the selected seats to the API for a temporary hold.
- only proceed to Checkout after the hold succeeds.

### Hold duration

The assignment states an **8-minute** hold/countdown.

### `409 Conflict`

If a seat is taken before the hold succeeds:

1. Show the user which selected seat(s) are no longer available.
2. Update those seats as unavailable/sold according to the returned state.
3. Remove them from the current selection.
4. Keep the remaining valid seat selections where possible.
5. Refresh/refetch the hall map.

---

## 16. Step 2 — Checkout

Shows:

- hold countdown timer
- booking summary:
  - selected seats and ticket types
  - selected session
  - total
- buyer/payment form

### Buyer/payment fields

| Field | Required | Assignment rule |
|---|---:|---|
| Full Name | Yes | prefilled from profile; minimum 3 characters |
| Email | Yes | prefilled from profile; valid email |
| Mobile Number | Yes | prefilled from profile; Georgian mobile format |
| Card Number | Yes | 16 digits |
| Expiry | Yes | `MM/YY`, must be in the future |
| CVV | Yes | 3 digits |

### Actions

- `Back`
  - returns to the prior booking step
- `Pay & Complete Order`
  - submits the purchase

### Submit behavior

- Button shows loading state while request is in progress.
- It must be disabled during submission.
- Double submission must be prevented.

### Error behavior

- Backend validation errors (`422`) must be mapped to the relevant form fields.
- On booking conflict (`409`), return/reconcile the seat-selection state and refresh seat availability.
- If the hold expires, return the user to Step 1 and make them re-select seats.

---

## 17. Hold expiry

The assignment states:

- Hold expires after **8 minutes**.
- When time runs out while the user is in the booking flow:
  - clear the held/selected seats
  - reset booking to Step 1
  - refresh the hall map
  - show:
    - `Your hold time expired. Please re-select your seats.`

---

## 18. Confirmation view

After a successful order:

- Show successful purchase confirmation.
- Show order reference/code.
- Show seat/ticket details.
- Show film/session details.
- Show payment/card information where the design requires it.
- `My Tickets`
  - navigates to the user's tickets/profile area
- `Close`
  - closes the booking modal

---

## 19. Profile page

Available only to authenticated users.

Contains:

- Personal Information form
- My Tickets section

---

## 20. Personal Information

### Fields

| Field | Required | Assignment rule |
|---|---:|---|
| Full Name | Yes | minimum 3, maximum 50 characters |
| Email | Yes | registered email; read-only/disabled |
| Mobile Number | Yes | Georgian mobile number |
| Date of Birth | Yes | user must be at least 12 years old |
| Preferred Venue | No | selection from available venues |

### Full Name validation

Messages shown in the assignment:

- empty:
  - `Name is required`
- less than 3 characters:
  - `Name must be at least 3 characters`
- over 50 characters:
  - `Name must not exceed 50 characters`

### Mobile Number validation

Rules:

- starts with `5`
- exactly 9 digits
- digits only

Messages shown:

- empty:
  - `Mobile number is required`
- does not start with 5:
  - `Georgian mobile numbers must start with 5`
- wrong length:
  - `Mobile number must be exactly 9 digits`
- invalid format:
  - `Please enter a valid Georgian mobile number (9 digits starting with 5)`

### Date of Birth validation

Messages shown:

- empty:
  - `Date of birth is required`
- future date:
  - `Please enter a valid date of birth`
- under 12:
  - `You must be at least 12 years old to create an account`

Date of birth is also used for age-restricted movie booking.

### Save behavior

`Save Changes`:

- disabled until form has changed and is valid
- shows a loading state while saving

### Profile status

Incomplete:

- one or more required profile fields missing
- show an indicator/banner
- message:
  - `Please complete your profile to enable booking.`

Complete:

- all required profile fields valid
- show `Profile Complete ✓`
- warning indicator disappears

---

## 21. My Tickets

Two tabs:

- Upcoming
- Past

### Upcoming

Each upcoming ticket/order card displays:

- film poster/title
- venue
- date
- time
- format
- language
- seat numbers with ticket type
- total amount paid

### Refund

- Refund is allowed only until **2 hours before** the session.
- After the cutoff:
  - Refund button is disabled.
  - Explain why.
- Clicking Refund:
  - opens/uses a confirmation interaction
  - performs the refund through the API
  - then updates the ticket list/state
  - refunded order moves out of Upcoming according to the resulting state

### Past

Past tickets display the relevant ticket/order information without purchase/refund actions intended for upcoming tickets.

---

## 22. Modal behavior — applies to all modals

- Background is dimmed/blurred.
- Modal can be closed with:
  - `X`
  - `Close` action where present
  - `Escape` key
  - clicking the overlay/backdrop
- Validation messages appear on field blur.
- Valid field state uses a green checkmark.
- Invalid field state uses red border/message treatment.
- During submission/mutation, show loading state and prevent repeated actions.

---

## 23. Loading states

Every asynchronous operation must show a clear loading state.

Examples explicitly covered by the assignment:

- page loading
- filtering
- submitting forms
- booking mutations

For Sessions:

- use skeleton placeholders rather than only a generic spinner.

---

## 24. Empty states

Every relevant list must have a clear empty state.

Examples:

- no sessions after filtering
- no upcoming tickets
- no past tickets
- no search results where applicable

The empty state should guide the user rather than leave blank space.

---

## 25. Error states

### General/network failure

- Show a user-friendly message.
- Offer retry where appropriate.

### `401`

- Session/token expired or invalid.
- Open Login.
- After successful login, repeat/continue the interrupted protected action.

### `409`

Used for resource contention such as seats becoming unavailable.

- Show what changed.
- Reconcile selected state.
- Refresh server state.

### `422`

- Validation errors must be shown near the corresponding fields.
- Booking/business-rule failures must be shown clearly to the user.

### `500`

- Show a clear server-error state.
- Provide a retry path.

---

## 26. Interaction safety

- Buttons performing mutations must be disabled while the request is pending.
- Rapid repeated clicking must not:
  - create duplicate orders
  - create conflicting duplicate holds
  - submit forms twice
- After a mutation:
  - update local state correctly, or
  - refetch the relevant server state where required.

---

## 27. Search

The supplied design contains search states, and the assignment materials include search behavior as part of the application experience.

Expected UX includes:

- search prompt/input
- results
- no-results state

Exact visual behavior belongs to the Figma source and exact backend contract belongs to `02_OPENAPI.json`.

---

## 28. Source-priority note for implementation

When implementing this assignment:

1. API behavior must follow the supplied API contract where backend semantics are concerned.
2. Functional requirements come from this assignment specification.
3. Visual implementation comes from Figma.
4. If these sources disagree, document the conflict before implementation rather than guessing.

---

## 29. Assignment ambiguities to preserve for later resolution

These points should **not** be silently guessed:

- The Checkout screenshot text for the `Back` action contains wording that appears inconsistent with the displayed step number; implementation should be resolved against the Figma flow/API behavior rather than assuming.
- The assignment references a 1920×1080 design target, while exact frame dimensions/desktop geometry must be taken from Figma.
- Any server-controlled values shown numerically in assignment examples must not automatically be hardcoded when the API contract exposes them dynamically.

---

## 30. Completion checklist

A feature is not considered complete until the relevant states are checked:

- default
- loading
- success
- validation
- empty
- protected/unauthenticated
- expired authentication
- conflict where applicable
- server failure
- keyboard/modal close behavior
- Figma visual state
- URL restoration where applicable
