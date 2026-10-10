# Recently Viewed implementation — 10 October 2026

**RECENTLY VIEWED BLOCKER FIX READY FOR REVIEW**

## Git baseline and scope

The working tree was clean at `f554383 feat: implement coming soon notifications`. Branch `main` tracked `origin/main` at that same commit. Coming Soon, its focus fix and both See all links were committed before this task. Baseline checks: `git status --short`, `git log -1 --oneline`, `git branch -vv`, and `git diff --check`.

The existing Movie Detail page recorded route slugs for authenticated users only. Its storage helper lacked a reader, guest partition and capacity bound. Home did not render Recently Viewed. This implementation extends those existing React/API/storage patterns without adding dependencies, routes or a backend endpoint.

## Exact changed files

| File | Change and reason |
| --- | --- |
| `src/utils/recentlyViewedStorage.js` | Separate guest/account keys, safe slug-only reads/writes, normalization, deduplication, 20-entry capacity and fresh-read pruning. |
| `src/recently-viewed/loadRecentlyViewed.js` | Current Movie API reads, two usable results, definite-404 pruning, retryable failures and stale/abort guards. |
| `src/components/home/RecentlyViewedSection.jsx` | Local Home loading/error/retry state, partition-specific reads, auth lifecycle invalidation/restart and storage-event refresh. |
| `src/components/home/RecentlyViewedCard.jsx` | Accessible Card_Small links using existing movieDetailPath, MovieImage, metadata presentation and AgeBadge. |
| `src/pages/HomePage.jsx` | Insert current partition's section above Now Playing; mask it during authentication transitions. |
| `src/pages/MovieDetailPage.jsx` | Record successful active API-returned slugs for guest/account scope; reject blank-title/invalid-slug placeholders and auth mutations. |
| `src/movie-detail/useMovieRead.js` | Expose the existing slug/date/revision/retry identity for separate visit ownership; auth changes do not invalidate public movie data. |
| `src/styles/components/recently-viewed.css` | Inspected Card_Small/section values, shared focus support, hover/pressed shadow and compensated scroll gutters. |
| `src/styles/main.css` | Import the scoped stylesheet. |
| `tests/recentlyViewed.test.js` | 18 isolated storage/read-domain tests. |
| `tests/recentlyViewedIntegration.test.js` | 23 real-app StrictMode browser cases, intercepted traffic, Movie Detail auth/date/navigation regressions, exact-generation restoration synchronization and geometry/capture evidence. |
| `tests/fixtures/recentlyViewedProbe.jsx` | Test-server-only Login/logout/session-restoration controls, with synthetic credentials. |
| `docs/06_DECISIONS.md` | Append D-032 for guest support and isolated histories. |
| `docs/05_ARCHITECTURE.md` | Reconcile only Recently Viewed's storage and rendering/read contract. |
| `docs/RECENTLY_VIEWED_IMPLEMENTATION_REPORT.md` | This review and validation record. |

Notify Me/API/auth implementation, Search, Navbar, Now Playing, Coming Soon, routing and Booking/Checkout/Refund source files are unchanged. Movie Detail retains the existing booking entry callback and session component. Its visit writer uses the read hook's identity independently of the public request dependencies; no endpoint or seat/booking behavior is changed.

## Decision reconciliation and storage

D-014 and D-023 §N are retained as historical context. D-032 explicitly supersedes both decisions' authenticated-only Recently Viewed scope because the user requires guests. Their slug-only browser storage, current API data and no-server-synchronization boundaries continue to apply. Other Movie Detail/booking policies remain unchanged. Architecture sections 33 and Recently Viewed describe the implemented contract.

- Guest key: `kino-xii:recently-viewed:guest`.
- Account key: `kino-xii:recently-viewed:{userId}`; existing numeric account keys remain compatible.
- Keys contain only ordered unique slug strings, never Movie objects, credentials, profile or booking data. At most 20 slugs are retained; this is a frontend capacity bound, not an API/business limit.
- Login selects that account's history. Logout selects the browser's guest history. Switching A → B selects B's partition. Nothing merges guest/account histories or copies between accounts.
- Malformed JSON, nonarrays, invalid/duplicate entries and excess entries are safely normalized. Repair occurs during Home's read effect, not during rendering. Storage read/write restrictions cannot crash Home or Movie Detail.

## Recording, ordering and current data

A successful active detail result records its actual returned slug. Direct URLs and canonical slugs returned for aliases work. Failed reads, missing/invalid slugs, blank titles and unrelated pages do not record visits. Re-viewing moves a slug to the front without duplication. Tests verify A → B → A → C yields `[C, A, B]` in storage and `[C, A]` on Home.

The existing detail hook aborts/ignores old navigation requests and rejects cached results from older request revisions. Public detail reads depend on the actual slug; session reads depend on slug/date. A separate visit owner captures session account/generation for each read/retry, resolves initial session restoration and revokes recording on subsequent auth lifecycle events. Recording requires an active successful result, unchanged owner, settled auth and current authenticated user where applicable. It happens once per visit. Login does not copy an already loaded guest visit into the account. Tests resolve abort-ignoring obsolete reads after navigation or account switching (including while Movie Detail stays open) and confirm no incorrect history entry.

Home reconstructs cards with the existing `GET /movies/{movie}` and its AbortSignal. It reads in stored order until it has two usable movies or exhausts the bounded history. Home reads never reorder/record visits. Current titles/posters/genres/runtime/rating come from those API responses, not stored Movie snapshots.

Definite 404s remove the missing slug and can backfill an older usable film. Pruning re-reads the current partition so newer stored visits are preserved. If all entries are missing, both section and its divider disappear. Network/401/403/422/500 or unusable response failures retain history and show an accessible explicit Retry. Missing poster uses the existing MovieImage fallback; missing genre/runtime/rating is omitted rather than fabricated. Long titles/metadata remain visually bounded with full accessible/title text.

## Figma and navigation

Inspected design context and screenshots through validated GTU connection `link_6ac0b67d4a348191a63166ae0ce0eb57`, file `Zeb7RQ8mjGp04YIPde2ud2`:

- Authenticated Home `272:3698` and guest Home `139:2899`.
- Recently Viewed pair `302:24335`, including cards `302:24336` and `302:24337`.
- Card_Small Default/Hover/Pressed component set `108:1799`.

Guest Home's reference has no history section; an empty guest retains that layout. After a guest visit, the user-requested guest section uses the inspected authenticated layout above Now Playing. It includes the divider shown in the authenticated frame.

| Value | Figma | Browser at 1920×1080 CSS pixels |
| --- | --- | --- |
| Visible pair | 2 cards | 2 cards |
| Card width | 329.121px | 329.109375px (CSS subpixel rounding) |
| Card height | 87px | 87px |
| Card gap | 20px | 20px |
| Card background | #1e2031 | rgb(30, 32, 49) |
| Radius / padding | 16px / 10px | 16px / 10px |
| Poster width / height / radius | remaining 87.121px / 67px / 8px | 87.109375px / 67px / 8px |
| Content width / internal gap | 210px / 4px | 210px / 4px |
| Title | Archivo 14px / 800 | Archivo 14px / 800 |
| Metadata | Archivo 12px / 400, 1.3 line height | Archivo 12px / 400, 1.3 line height |
| Section inset / top padding | 70px / 9px | 70px / 9px |
| Heading → cards | 20px | 20px |
| Hover / pressed | drop shadow 0 4px 12px, black 20% | Same computed filter in both states |

The first browser pass exposed a 24px shared-section gap overriding the required 20px; the scoped selector corrects it. Negative compensated scroll gutters preserve measured positions while reserving room for focus/shadows. Screenshots for default/hover/pressed and geometry JSON are in ignored `node_modules/.cache/kino-recent-ui/`; those screenshots were inspected. Posters/titles are deliberately dynamic API fixture content, not static substitutions for Figma artwork. Pre-existing hero/other catalogue content differences were not changed.

Cards are real React Router links through the unchanged movieDetailPath helper. Pointer and real Tab/Enter tests open the exact returned slug's Movie Detail route, with visible native keyboard focus, meaningful poster alt text and hover/pressed states. They never open Seat Selection directly. Existing section See all links remain independently unchanged at `/sessions`.

## Account and async safety

Home masks the section during restoration/auth mutations and keys its local component by guest/account partition. Each read captures session identity, observes the existing auth lifecycle, uses AbortController and rechecks identity before displaying data or pruning storage. Old successes and old 404s cannot affect the displayed account or its history. No new shared/global production state is introduced.

Auth lifecycle changes also restart local reads if Home remains mounted, covering a same-session `/me` restoration without leaving a permanently aborted loading state. A dedicated browser regression verifies this case. Storage events refresh only the matching partition (or a clear event).

Browser cases verify guest/account refresh, Login/logout/account switching without merges, late A success/404 after switching to B, obsolete navigation results, and old detail responses that cannot record into B's history. Fixtures exercise transports that intentionally ignore abort, so correctness does not rely solely on physical cancellation.

## Validation

| Check | Actual result |
| --- | --- |
| Focused Recently Viewed Node tests | 18 passed, 0 failed/skipped |
| Final Recently Viewed browser suite | 23 passed per run, three consecutive complete runs; 0 failures/skips |
| Focused Movie Detail auth browser regressions | 2 passed after the fix; committed comparison also 2 passed |
| Previously flaky restoration case | 10 consecutive independent test-process runs passed; stop immediately on any failure |
| Existing Coming Soon browser suite | 36 passed, 0 failed/skipped |
| Existing auth/profile + protected-entry + Search/navigation browser suites | 39 passed, 0 failed/skipped |
| Full safe Node suite (`node --test tests/*.test.js`) | 748 total: 499 passed, 249 optional browser skips, 0 failures |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed |
| `git diff --check` | Passed |

The 98 distinct browser cases above explicitly enable their disposable-Chrome gate; safe Node skips do not imply they were omitted from browser validation. Existing Coming Soon checks include Notify Me, Enter/Space focus, duplicate protection, guest/expired continuation, both See all links and Home geometry at 1728px/1920px. Existing regression files were not edited.

Browser tests use a fresh disposable headless Chrome profile, isolated targets and a local Vite server with StrictMode/test-only probes. Every API/external request is intercepted; unrecognized traffic is blocked and fails the fixture. No production mutation or real subscription is made. The in-app Browser skill found no connected browser, so verification used the repository's existing disposable CDP test helper.

Run logs are ignored under `.qa.local/`; blocker follow-up logs are listed below. Production build output, browser profiles/captures and the local runner are ignored QA artifacts.

## Review blocker follow-up

At follow-up start, HEAD was still `f554383 feat: implement coming soon notifications`, with the full Recently Viewed implementation unstaged/uncommitted. `git status --short`, `git log -1 --oneline` and `git diff --check` verified that baseline. Before-edit hashes of source/tests/docs preserve the distinction between existing work and this fix.

The cause was the uncommitted auth-derived `scope` in `useMovieRead`'s request key. Status, mutation and account changes cleared the public detail result, unmounted MovieSessions and discarded its local selected date. OpenAPI `GET /movies/{movie}` is public and does not vary by account. The fix removes that dependency while keeping navigation abort/revision guards and separating visit ownership as described above. MovieSessions and Booking logic are unchanged.

Independent intercepted-browser measurements use the actual Movie Detail, Navbar/auth modal and protected booking continuation. Committed HEAD's MovieDetailPage, useMovieRead, storage helper and Home were loaded directly from `git show HEAD:<path>` in the test Vite server, without checking out or changing the working tree. The same scenarios ran before and after the fix:

| Version | Initial detail GETs | During Login | After Login | After logout | Selected date / Sessions / loading |
| --- | --- | --- | --- | --- | --- |
| Pre-fix working tree | 1 | 2 | 3 | 5 | Third → first; Sessions replaced; loading reappeared |
| Committed `f554383` | 1 | 1 | 1 | 1 | Third retained; same Sessions node; no loading flash |
| Fixed working tree | 1 | 1 | 1 | 1 | Third retained; same Sessions node; no loading flash |

Both Navbar Login and protected-action Login produced these results. Logout was tested independently after selecting the third date again. Booking opens the existing Seat Selection modal successfully after Login and through protected continuation; no seat hold, booking, payment, refund or notification was sent to production. Actual slug changes and Back/Forward navigation load the correct movie. Existing history tests cover guest persistence, ordered deduplication/capacity, two-card display, recoverable errors, isolated guest/A/B partitions and stale results. The geometry test rechecks the unchanged Small Card design.

The flaky restoration test previously counted intercepted reads before StrictMode's second initial request necessarily reached interception, then could resume the wrong request. The test-only fetch wrapper now tags each detail read with an increasing generation and tracks its original signal's abort state. Bounded UI/interception waits identify the live initial generation and its live replacement after restoration. Only that exact replacement is fulfilled; obsolete generations remain paused. The test requires the original signal to be aborted, the replacement's unique title to render, history to remain intact, and loading to disappear. No arbitrary sleep, weakened assertion or success-on-rerun behavior is used.

The exact follow-up files are `src/pages/MovieDetailPage.jsx`, `src/movie-detail/useMovieRead.js`, `tests/recentlyViewedIntegration.test.js`, `docs/05_ARCHITECTURE.md`, `docs/06_DECISIONS.md` and this report. All other existing Recently Viewed and unrelated files are preserved. D-032 now explicitly supersedes the authenticated-only portion of D-023 §N as well as D-014, leaving older entries intact.

Evidence: `.qa.local/recent-blocker-before.txt`, `recent-blocker-committed.txt`, `recent-blocker-after.txt`, `recent-blocker-suite-final-1.txt`, `recent-blocker-suite-final-2.txt`, `recent-blocker-suite-final-3.txt`, `recent-blocker-race-repeat-1.txt` through `recent-blocker-race-repeat-10.txt`, `recent-blocker-existing-regressions.txt` and `recent-blocker-node-final.txt`. The intentional pre-fix reproduction failed both new auth regressions; the committed comparison and corrected focused run passed both. An initial strengthened account-switch test incorrectly assumed one initial request under StrictMode with abort-ignoring transport; its assertion now compares actual fetch generations before/after the switch, preserving the requirement of zero additional reads.

## Remaining issues and change control

No blocking issue remains in the validated scope. History is browser-local and depends on available localStorage; restricted storage degrades safely without persisted history. It is not server-synchronized or cross-device account history. Dynamic API artwork/content can differ from the static Figma samples.

All implementation and documentation changes remain unstaged and uncommitted. No stage, commit, push, sync or deployment occurred.

**RECENTLY VIEWED BLOCKER FIX READY FOR REVIEW**
