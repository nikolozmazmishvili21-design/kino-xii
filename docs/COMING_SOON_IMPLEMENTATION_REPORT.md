# Coming Soon implementation review — 10 October 2026

**COMING SOON BLOCKER FIX READY FOR REVIEW**

## Git baseline and scope

The initial working tree was clean. Branch `main` pointed to `a708c15` (`fix: align booking confirmation with Figma`) and tracked `origin/main` at the same commit. The previously reviewed Confirmation changes were committed. No staging, commits, pushes, synchronization or deployment occurred during this implementation.

Changes are limited to Coming Soon and its integration with the existing authentication infrastructure. Checkout, Refund and booking business logic are unchanged.

## Existing implementation

Home already fetched four Coming Soon films with the Movies API module, rendered semantic articles, formatted API release dates, and reused MovieImage, AgeBadge, CatalogueRow and SectionState. Loading, empty, retry and section-level error presentation already existed.

Notify Me was permanently disabled, described as unavailable, and its unused callback expected a movie ID. It had no endpoint, pending state, confirmed success, errors or auth continuation. The pending-action normalizer accepted only OPEN_BOOKING. AppShell consequently treated every retained action as booking and enforced profile completion.

The existing Coming Soon See all link went to `/sessions`. The user explicitly requested preservation of that original navigation in the minimal follow-up. The exact committed React Router Link, destination, accessible label, header placement and shared styling have been restored. Now Playing keeps its independent existing link. No new route or Coming Soon page was introduced.

## Exact changed files

| File | Change and reason |
| --- | --- |
| `src/api/moviesApi.js` | Bodyless, slug-based Notify POST; validates HTTP 201, subscribed=true and matching movieId. Catalogue reads accept explicit session credentials. |
| `src/auth/pendingAction.js` | Adds immutable NOTIFY_MOVIE descriptors containing only a bounded exact movieSlug; compares action types and their identifiers. |
| `src/auth/AuthProvider.jsx` | Adds synchronous, identity-checked Notify consumption without a profile gate; explicitly restricts booking readiness to OPEN_BOOKING. |
| `src/app/AppShell.jsx` | Owns the notification runtime/context, observes auth lifecycle, dispatches one consumed continuation, and cancels retained notification intent when Login is dismissed. |
| `src/notifications/NotificationContext.js` | Makes the app-shell runtime available to Home without credentials in context snapshots. |
| `src/notifications/notificationRuntime.js` | Separates subscription behavior from rendering: per-movie locks/state, auth identity guards, catalogue hydration, cancellation and error recovery. |
| `src/pages/HomePage.jsx` | Loads Coming Soon through the guarded runtime and refreshes account-specific reads after authentication changes. |
| `src/components/home/ComingSoonSection.jsx` | Connects individual cards to notification state, removes unavailable copy and preserves the original See all link to `/sessions`. |
| `src/components/home/ComingSoonCard.jsx` | Real slug-based button, pending/success states, associated errors, per-card live announcements and semantic movie labels. |
| `src/styles/components/home-catalogue.css` | Figma hover/success treatments and shadow, top-aligned poster cropping, long-date accommodation, and unclipped errors in normal flow below fixed-size cards. |
| `src/assets/icons/home-notified.svg` | Exact downloaded Figma success check icon. |
| `tests/notifications.test.js` | 26 focused API/domain tests, all with intercepted or injected transport. |
| `tests/notificationsIntegration.test.js` | 36 real-app browser checks using isolated Chrome, StrictMode and interception of every API request, including keyboard focus and both See all links. |
| `tests/fixtures/notifyProbe.jsx` | Test-server-only auth transition/cancellation probe; never included in the production entry. |
| `docs/COMING_SOON_IMPLEMENTATION_REPORT.md` | This implementation record, evidence and review limitations. |
| `docs/06_DECISIONS.md` | D-031 records the user-approved Home Notify scope and both preserved catalogue links, qualifying D-023's historical deferral. |

## Figma comparison

Inspected exact design context and screenshots through the requested GTU connection `link_6ac0b67d4a348191a63166ae0ce0eb57`, file `Zeb7RQ8mjGp04YIPde2ud2`:

- Guest Home: `139:2899`.
- Authenticated Home: `272:3698`.
- Authenticated complete Home: `369:6407`.
- Card_medium: `108:2346`.
- Notify default/hover/success: `108:1841`, `108:2127`, `108:2134`.

The standalone Card_medium has 14px padding, an 18px gap and 18px/800 title type. The actual Home instances override these with 12px padding, a 15px gap and 12px/600 titles/12px metadata. The implementation preserves the inspected Home instance values. The complete-profile frame's screenshot clips lower sections; its design context still contains the Coming Soon instances. The guest and full authenticated screens provide the visible section comparison.

Default: outlined pill, #a9a9a9 border, 12px/600 label, 4px icon gap and 6px/12px padding. Hover: white 10% tint with the same border. Focus adds the existing visible outline. Success: 28px pill, white 10% tint, transparent border and exact check icon. The existing bell is byte-for-byte identical to the downloaded Figma bell (both 1,344 bytes). Both icons retain their native approximately 16×16 geometry; browser checks verify loading and effective dimensions.

## API contract and isNotified discrepancy

`GET /movies/coming-soon?limit=4` supplies the catalogue. `POST /movies/{movie}/notify` requires Bearer authentication and no request body. The path uses the exact returned Movie.slug, URI-encoded once. A success requires HTTP 201 and data.subscribed strictly equal to true, with a positive integer movieId matching the known catalogue movie. HTTP errors, a different movieId, malformed data, false/string subscriptions and other success statuses never produce the success state. The documented repeated-subscription behavior is idempotent HTTP 201.

The formal Movie schema omits isNotified, although catalogue examples contain it. A credential-free production GET on 10 October 2026 returned HTTP 200 and four movies, all containing boolean isNotified=false. This confirms the live optional response shape, not a new required schema field. The canonical OpenAPI file was left unchanged.

Resolution: accept isNotified as an **optional, strictly typed server extension**. Only boolean true returned by a GET belonging to the current authenticated account/session restores success. Missing, false or nonboolean values do not invent a subscription. Guest reads never restore account subscriptions. No subscription flag is written to localStorage or sessionStorage. A confirmed POST result remains in app-shell memory for the current session, including Home remounts; an earlier read cannot erase it. Auth changes clear that memory and trigger a new read.

Live authenticated true/restoration semantics were not independently exercised against production: no real subscriptions or credentials were used. Restoration with true, missing, false, nonboolean and stale-account responses is covered by fixtures. Refresh persistence therefore depends on the server returning a meaningful authenticated indicator; when absent, Notify remains actionable and the documented idempotent endpoint is safe to invoke again.

## Authentication and protected continuation

Guests retain one bounded `{type: "NOTIFY_MOVIE", payload: {movieSlug}}` action in the existing AuthProvider and see the existing Login modal. Login or Signup success consumes that descriptor synchronously and automatically dispatches at most one replay. Notification subscriptions do not require booking profile completion.

A current POST 401 invalidates the session and retains the same slug for Login. Its replay uses the newly captured Bearer credential. A second 401 terminates the action and shows an error without reopening Login automatically. Cancelling Login/Signup clears retained intent, including cancellation while a login request is in flight. Late authentication success after cancellation cannot subscribe.

POST locks are acquired before notifying subscribers. Duplicate clicks, stale handlers, StrictMode replay and success-state clicks cannot dispatch a duplicate for the same movie/session. Separate movies remain independent. Each POST and catalogue read checks account ID and auth generation before adopting results. Logout/account changes abort obsolete POSTs and clear presentation; even a transport that ignores abort cannot adopt late success or expire the newer account with an old 401.

Unavailable Notify controls remain focusable with aria-disabled during pending, confirmed success, auth waiting and auth transitions. The activation handler explicitly rejects unavailable actions; the unchanged runtime separately checks the synchronous request lock and live account/session identity. The existing modal opener restoration now works without added autofocus or focus-trap changes.

## Success and error behavior

Confirmed success stays on the individual card as **You will be notified**, with a polite live announcement. Pending shows Setting notification… and guards duplicate clicks. No transient toast is the only success indication.

404 explains that the movie is unavailable; 403 explains account access; 409/422 preserve the server business message; 500/unexpected HTTP and network errors have understandable recovery copy. A failed attempt leaves Notify Me available for an explicit retry. Errors are associated with their button and announced through role=alert. Long business messages wrap below the fixed-size card and expand the row naturally instead of being clipped.

Catalogue loading, empty, error and explicit retry remain local to the section. Posters, titles, release dates, genres, runtime and age ratings come from API values. Existing missing/broken-poster fallbacks and title/metadata ellipsis are reused. Cards contain no detail/booking links and card-surface clicks cannot open seat selection.

## Desktop measurements and visual limits

Measured at **1920×1080** and **1728×1080 CSS viewports**, without proportional scaling:

| Measurement | Rendered result |
| --- | --- |
| Default section height | 229.656px (Figma 229.664px, browser subpixel rounding) |
| Section horizontal inset | 70px |
| Card | 470×160px, 20px radius |
| Card padding / internal gap | 12px / 15px |
| Poster slot | 229×136px, 14px radius |
| Content height / trailing space | 132px / 60px |
| Row gap | 20px |
| Card x positions | 70, 560, 1050, 1540px |
| Title / metadata | 12px/600; 12px/400 with 1.3 line height |
| Default button | approximately 98×30px |
| Success height | 28px |

Coming Soon is below the initial 1080px fold, as expected from the preceding hero and Now Playing content. Screenshots were captured after scrolling the section into view. The fourth card uses the existing horizontal overflow and right-edge fade. Native visible scrollbars may reserve 15px of content width; fixed card geometry/insets remain unchanged. Reference captures hide scrollbars and preserve the full requested CSS width.

Intentional differences and limitations:

- User-requested You will be notified replaces Figma's Reminder set; the pill grows to fit the copy while preserving its treatment and height.
- The Assignment's Coming Soon heading is retained without Figma's trailing ellipsis.
- See all retains its original `/sessions` destination by explicit user instruction; it does not introduce a dedicated upcoming-films page.
- Figma supplies per-image custom vertical offsets. The API has no focal-point/crop metadata. Dynamic posters use top-aligned object-fit:cover without stretching, arbitrary per-film overrides or hardcoded artwork. Individual image crops therefore are not pixel-identical to all three art-directed references.
- Pending and error states are accessible implementation states; Figma provides only default/hover/success. Long dates may use the instance's spare trailing space; long titles retain accessible full text and a tooltip.
- Authenticated Home's pre-existing Recently viewed omission and unrelated hero/Now Playing differences are outside this scope. Test screenshots use controlled movie fixtures and cached fonts/posters, not a claim that the entire Home matches the reference content.

## Validation

| Check | Result |
| --- | --- |
| New API/domain Notify tests | 26 passed |
| Focused keyboard/pointer/error/auth-transition browser tests, independently run | 7 passed, 0 failed |
| Complete Coming Soon browser tests, including both See all links | Two runs: 36/36 and 36/36 passed, 0 failed |
| Existing Auth/Profile, booking-entry and Navbar/Search browser regressions | 39 passed, 0 failed |
| Full safe Node command: `node --test tests/*.test.js` | 481 passed, 0 failed; 226 browser-gated cases skipped by this command |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

Browser commands used `--test-concurrency=1`. The complete Coming Soon suite passed twice in separate disposable Chrome profiles. All 39 existing checks in `tests/holdEntryIntegration.test.js`, `tests/profileRendering.test.js` and `tests/searchIntegration.test.js` passed independently. The safe Node command's skips include these browser cases and other optional browser suites; the focused browser commands explicitly enabled the relevant cases.

The in-app browser runtime reported no available browser after documented discovery. Browser verification used the project's existing CDP helper against a newly created disposable headless Chrome profile. Every API request was intercepted; unexpected API/external requests were blocked and failed the fixture. No automated request created a real subscription. Production was accessed only for the credential-free read described above. Screenshots/geometry evidence are in ignored `node_modules/.cache/kino-notify-ui/`; local run logs are in ignored `.qa.local/notify-*`.

There are no known blocking functional failures. The remaining external question is the formal Movie schema omission/authenticated indicator semantics, handled explicitly as described above.

## Minimal See all follow-up

Original behavior was verified using `git show HEAD:src/components/home/ComingSoonSection.jsx` and the committed Home composition. At HEAD `a708c15`, the link was `<Link className="home-section__all" to={ROUTES.sessions} aria-label="See all sessions">See all</Link>`, with ROUTES.sessions equal to `/sessions`.

Only these three files changed during the follow-up: `src/components/home/ComingSoonSection.jsx`, `tests/notificationsIntegration.test.js` and this report. Existing shared link/header CSS is reused without modification. Four focused regressions cover actual pointer activation and native Enter activation for Coming Soon and Now Playing, link visibility, the exact original destination, styling/hover/focus and successful Notify independent of navigation. The existing card-content test now expects the restored section link while continuing to assert that movie cards have no navigation links.

Notify Me's API, protected-action continuation, expired-auth replay, success copy, subscription state, account-switch protection and card design are unchanged. File hashes are compared with the start of this follow-up to verify preservation, including AppShell, AuthProvider, the pending-action module, notification modules, card and shared styles. No staging, committing, pushing or synchronization occurred.

Follow-up verification: all four See all regressions and all 25 prior Coming Soon browser checks passed (29/29, zero failures). The full safe Node suite passed 481 checks with 219 browser-gated skips; lint, build and `git diff --check` passed. All ten captured implementation/style file hashes remained identical. Verdict: **COMING SOON SEE ALL RESTORED**.

## Keyboard blocker and deterministic-test follow-up

### Baseline and exact follow-up files

HEAD remained `a708c15 fix: align booking confirmation with Figma`. The baseline contained eight modified tracked source files and the existing untracked Coming Soon modules, icon, fixtures, tests and report listed above. `git diff --check` passed. All existing uncommitted work was retained.

Only five reviewable files changed during this follow-up:

- `src/components/home/ComingSoonCard.jsx`: replace native disabling with focus-preserving aria-disabled and an explicit unavailable-state handler guard.
- `src/styles/components/home-catalogue.css`: apply unavailable hover/cursor rules to aria-disabled; retain pending transparency, success treatment, visible focus outline and all geometry.
- `tests/notificationsIntegration.test.js`: add seven regressions and bounded interception-event synchronization.
- `docs/06_DECISIONS.md`: append D-031.
- `docs/COMING_SOON_IMPLEMENTATION_REPORT.md`: reconcile current behavior and record reproduction/validation evidence.

Ignored local QA artifacts include run logs and a disposable-browser runner under `.qa.local/`, with browser profiles/captures under `node_modules/.cache/`. They are not application changes.

### B1 reproduction and fix

The original `disabled={disabled || pending || success}` removed the focused button from keyboard interaction. In Chrome, focus fell to BODY after the disabled state rendered. The shared Modal also refuses a disabled opener on close; guest Login could therefore fail to restore Notify focus. For expiry, the already-disabled Notify could lose focus before the Login opener was captured.

The new regressions first ran against the unchanged component and failed all four focus cases. Tests used actual CDP Tab traversal and native Enter/Space activation, not programmatic button.focus() or click(). Observations were taken after animation-frame rendering while the intercepted POST remained paused, and again after a mocked HTTP 201 response:

| Flow | Before: pending / success activeElement | After: pending / success activeElement | Actual POST count after repeated Enter and Space |
| --- | --- | --- | --- |
| Authenticated, Enter | BODY / BODY | Notify BUTTON / Notify BUTTON | 1 |
| Authenticated, Space | BODY / BODY | Notify BUTTON / Notify BUTTON | 1 |
| Guest → keyboard Login | BODY / BODY after Login | Notify BUTTON / Notify BUTTON | 1 |
| Expired auth → keyboard Login | BODY initially, then BODY / BODY after Login | Notify BUTTON initially and after Login / Notify BUTTON | 2: original 401 plus one replay |

Login initially focuses Email, Tab reaches Password and submit within the existing dialog, and successful continuation returns focus to the original Notify button. Tab after subscription reaches the next card's Notify button. No modal implementation, focus trap or autofocus behavior changed.

Pending and success have native disabled=false and aria-disabled=true; aria-busy is true only during the POST. Auth-waiting and auth-transition controls also expose aria-disabled=true. Idle and recoverable-error states omit aria-disabled. The handler blocks unavailable pointer/keyboard actions, while unchanged runtime locks and live account/generation checks continue to protect duplicate dispatch and stale responses. Tests assert both the active element and intercepted POST counts. A separate real-pointer test confirms pending/success clicks cannot duplicate; the keyboard recovery test confirms an error permits one new explicit attempt. The auth-transition test confirms no POST or protected intent is created while Login is pending.

### Request-race correction

The loading/error/retry test previously invoked read() after the section rendered but before the asynchronous CDP interceptor recorded its paused GET. Reading calls.gets[index] could consequently dereference undefined. The retry path also polled animation frames and duplicated a loading assertion.

A request-event waiter now registers a listener, checks already-recorded requests, resolves when the requested interception count arrives, and rejects after a bounded 10 seconds. read() itself awaits the selected request. The loading test explicitly waits for GET 1 before its error response and GET 2 before its empty response, retaining every loading/error/retry/empty assertion. POST waits, refresh-read waits and delayed Login fulfillment use the same mechanism. There are no arbitrary request sleeps or test retries.

### Validation and reconciliation

- Baseline focus reproduction: 4/4 failed as expected; `.qa.local/focus-before.txt` records BODY in each settled pending/success state.
- Final independently run focus/pointer/error/auth-transition regressions: 7/7 passed (`focus-targeted-final.txt`).
- Complete Coming Soon runs: 36/36 passed twice, including the loading/error/retry case (`focus-suite-1.txt`, `focus-suite-2.txt`).
- Existing auth/profile, protected booking-entry and Home/Navbar/Search navigation regressions: 39/39 passed (`focus-auth-navigation.txt`). These files were not modified.
- Safe Node suite: 707 total, 481 passed, 226 optional browser cases skipped, zero failures (`focus-node.txt`).
- `npm.cmd run lint`, `npm.cmd run build`, `git diff --check`: passed. Final status retains all work uncommitted and unstaged.

Source-file SHA-256 comparison against this follow-up's baseline identified only ComingSoonCard.jsx and home-catalogue.css as changed. Notify API behavior, Bearer handling, once-consumed replay, account isolation, server-confirmed success, per-card state and optional authenticated restoration remain unchanged. Both See all links retain the original `/sessions` destination verified from Git; pointer and Enter navigation pass independently. Figma geometry remains 470×160px at both 1728px and 1920px viewport widths. Checkout, Booking, Refund, Search and Navbar source files are unchanged.

D-023 §K was a conditional historical deferral: Notify remained separate unless later scoped work verified and wired API/Figma behavior. D-031 records that user-authorized Home scope and narrowly supersedes the Home deferral without deleting historical decisions or extending Movie Detail behavior. It documents the existing endpoint/auth continuation, server-confirmed success, conditional authenticated isNotified restoration, no fabricated persistence and both preserved See all links.

No blocking issue remains in these checks. The pre-existing non-blocking limitation remains: optional authenticated isNotified=true semantics were verified with fixtures, not a real production subscription. Every browser API request was intercepted; no real subscription or other production mutation was created. No staging, commit, push, sync or deployment occurred.

Verdict: **COMING SOON BLOCKER FIX READY FOR REVIEW**.
