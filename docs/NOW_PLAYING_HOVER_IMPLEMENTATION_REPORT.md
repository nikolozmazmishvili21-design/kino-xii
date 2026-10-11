# Now Playing hover — 10 October 2026

**NOW PLAYING HOVER READY FOR REVIEW**

## 1. Git baseline

Started with a clean working tree at `b2373b9 feat: implement animated home hero carousel`. `git status --short`, `git log -1 --oneline` and `git diff --check` verified that Hero was committed before this task. No staging, commit, push, sync or deployment was performed.

Inspected the Assignment Home requirements, formal Movie/MovieDetail schemas and public movie endpoints, existing Home rendering/API modules, canonical Figma nodes, architecture and decisions before implementation. Existing independent catalogue reads, fallback states, actual server metadata/prices and navigation remain in use.

## 2. Changed files and purpose

| File | Purpose |
| --- | --- |
| `src/components/home/NowPlayingSection.jsx` | Own the active pointer/focus preview and keep expanding cards visible through local horizontal scrolling. |
| `src/components/home/MovieCard.jsx` | Stable content/Buy Ticket links, synopsis states, accessible Retry and focus recovery. |
| `src/components/home/useNowPlayingPreviews.js` | Section-owned React cache lifecycle; dispose and recreate safely through StrictMode cleanup. |
| `src/home/nowPlayingPreviews.js` | Deduplicate reads by slug, validate returned identity, cache results and fence obsolete settlements. |
| `src/styles/components/home-catalogue.css` | Now Playing width/image/synopsis transitions and verified component typography, pressed and reduced-motion states. Preserve shared metadata styling for the other cards. |
| `tests/nowPlayingPreviews.test.js` | Sixteen cache, error, race, cancellation and StrictMode tests. |
| `tests/nowPlayingIntegration.test.js` | Twenty-five intercepted real-app browser cases. |
| `tests/notificationsIntegration.test.js` | Allow only the six fixture movies' documented preview GETs while Tab traverses Now Playing before Coming Soon. Existing notification assertions and mutation interception remain intact. |
| `docs/03_FIGMA_REFERENCE.md` | Record verified Card_big geometry, prototype reactions and recording evidence. |
| `docs/05_ARCHITECTURE.md` | Record local preview/cache ownership and lifetime. |
| `docs/06_DECISIONS.md` | Add D-034 for the explicitly authorized preview interaction and data handling. |
| `docs/NOW_PLAYING_HOVER_IMPLEMENTATION_REPORT.md` | This review evidence and validation record. |

Baseline SHA-256 comparison confirms that all other existing files under `src`, `tests` and `docs` retain their original bytes. Hero source/styles/tests/report, Recently Viewed implementation, Coming Soon implementation, API modules, Booking, Checkout and Refund were not edited. No dependency or asset was added.

## 3. Figma measurements and provenance

Read design context and screenshots for Default `108:2445`, Hover `108:2792` and Variant3 `108:3026` in validated editable copy `Zeb7RQ8mjGp04YIPde2ud2`, component set `108:2446`. Independently inspected guest/authenticated Home instances `139:2899` / `272:3698` and read-only prototype reactions.

| Property | Default | Hover / expanded |
| --- | --- | --- |
| Root | 260×452 px | 447×452 px |
| Padding / radius | 14 / 20 px | 14 / 20 px |
| Background | #1e2031 | #1e2031 |
| Border | None | 1 px #2a2c3d |
| Poster | 232×300 px | 417×224.432617 px |
| Poster radius | 14 px | 14 px |
| Title | Archivo 20 px / 800 | Same |
| Metadata | Archivo 14 px / 400 | Same |
| Age | Archivo 12 px / 600; 4×8 px padding | Same |
| Price | Archivo 14 px / 800 | Same |
| Body / content height | 379.432617 / 426.432617 px | Same |
| Footer | Content y=391.432617, height 35 px | Same |
| Synopsis | Hidden | Content y=325.432617; height 54 px; 20 px trailing padding |
| Row gap | 17 px | Same |

Variant3 preserves the expanded geometry and removes the synopsis's 20 px trailing padding while pressed. The implementation applies that difference through the native active state. The task explicitly chooses standalone Card_big values; Home instances have smaller overrides (12 px padding, 18 px title and 12 px metadata/price), which are not the requested target.

Default `ON_HOVER → CHANGE_TO Hover` is `SMART_ANIMATE`, `LINEAR`, duration `0.30000001192092896` seconds. These independently readable reactions supply the exact 300 ms setting. `get_motion_context` returned no timeline nodes. The original separate prototype file was not claimed as programmatically inspected; the validated copy and the user's actual recording provide the evidence.

## 4. Recording and timing evidence

Actual source: `C:\Users\KENNY\Documents\Bandicam\bandicam 2026-10-10 16-47-12-363.mp4`, 2560×1440, duration 28.966633 seconds. Before production edits, decoded and inspected the 19–26 second interval, including fresh full-resolution samples at 19, 20, 21.9333, 22.0333, 22.1333, 22.2333, 22.3333, 23, 23.1, 23.2, 23.3, 23.4, 23.5, 24.3, 25 and 26 seconds.

At 20 seconds Avengers is expanded. Around 22–22.333 seconds Dune expands while Avengers contracts: the image changes crop, synopsis fades in while details move, neighboring cards shift and footers remain fixed. By 23.2 seconds Spider-Man is expanded. Intermediate recording frames were compared with browser captures, including the synopsis fading at its expanded position while the metadata moves upward.

The recording supports approximately 300 ms, but sampling and pointer actions do not prove exact duration or easing. Exact 300 ms linear comes from the independently inspected reaction. Reverse animation reuses this CSS transition; native browser reversal shortening during rapid direction changes is an implementation behavior, not a separately measured video timing claim.

Ignored source evidence: `.qa.local/now-playing-video/frame-*.png`, `.qa.local/now-playing-video.txt` and `.qa.local/inspect-now-playing-video.mjs`. These are QA artifacts, not application images.

## 5. Browser geometry

Both requested viewports, 1920×1080 and 1728×900, produced the same local geometry:

| Measurement | Default | 150 ms expansion | Expanded |
| --- | --- | --- | --- |
| Actual card width | 260 | 353.5 | 447 |
| Card height | 452 | 452 | 452 |
| Poster width | 232 | 323.5 | 417 |
| Poster height | 300 | 262.203125 | 224.421875 |
| Synopsis opacity | 0 | 0.5 | 1 |
| Next card displacement | 0 | 93.5 | 187 |
| Footer y relative to card | 404.21875 | 404.21875 | 404.21875 |

Reverse midpoint measurements also match 353.5 px card width and approximately 262.2 px poster height. Figma's fractional heights round to browser layout units; the approximately 0.01 px difference is layout quantization. Widths and the fixed height are exact. The title box fills the available poster width; long actual titles/genres ellipsize without changing card height.

## 6. Transition behavior

CSS changes actual width/flex-basis, poster height/flex-basis and synopsis opacity over 300 ms linear. No scale transform is used. The original poster element survives every hover and reversal, so there is no image-source swap or new decode race during expansion. The same image hash in all three Figma variants establishes the poster choice; API backdrop absence does not affect this interaction.

Missing/failed posters use the existing MovieImage fallback. Slow loading keeps stable geometry. Missing synopsis uses neutral unavailable copy; errors expose explicit Retry. There are no fabricated plot descriptions or alternate URLs.

## 7. Adjacent cards and clipping

The flex row preserves order and the 17 px gap. Expansion moves later cards by the actual extra 187 px; reversal returns them. Browser tests check intermediate displacement and repeated rapid reversals without neighboring-card overlap. The existing clipped catalogue viewport and horizontal scrolling remain in place.

A local ResizeObserver follows the active card's changing width and scrolls only the row when necessary. Middle, fifth and sixth cards remain usable at the right edge at 1728×900. No horizontal page overflow was observed at either target desktop size or 1280, 768 and 390 px widths. Small rows retain scrolling and cap the expanded basis to the available row width, with the existing 260 px minimum card size. Reduced motion removes transitions immediately.

## 8. Synopsis API and async safety

The formal Movie list schema has no synopsis. Previews call the existing `getMovie(slug, { signal })` helper for documented `GET /movies/{movie}` on pointer entry or keyboard focus. No endpoint, payload, API field or business rule was invented.

The section-owned cache deduplicates pending reads and retains successful/missing synopsis results until section unmount. Failures remain cached until explicit Retry, preventing repeated hover storms. Each settlement remains keyed to its requested slug; mismatched returned identities are rejected. A late A response may safely populate A's cache but cannot display in active B or C. Cleanup aborts reads and invalidates all late callbacks, including transports that ignore abort. StrictMode disposal before dispatch avoids abandoned duplicate reads.

## 9. Recently Viewed safety

The preview controller calls only the API reader. It does not mount Movie Detail, invoke its visit writer or write storage. A browser test snapshots storage, switches A→B→C with out-of-order responses and confirms no history or Recently Viewed section appears. Actual Link/Enter navigation to a successful Movie Detail still records the visit through the existing writer. Existing guest/account history regressions pass.

## 10. Keyboard and pointer behavior

Poster/title/metadata/synopsis content links and the sibling Buy Ticket link navigate to the correct movie. See all remains `/sessions`. Interactive links and Retry use pointer cursors; controls are never nested. Keyboard Tab reveals an equivalent expanded state, keeps focus on stable links during layout movement and provides a visible outline. Enter activates links; Space activates the Retry button. Pointer focus alone does not keep a card expanded after leaving.

Retry remains mounted/focusable while pending, uses `aria-disabled` plus a dispatch guard, and cannot duplicate reads. After successful replacement removes Retry, a layout effect restores its keyboard focus to the stable card link only when focus has otherwise fallen to the document. It does not move focus away from another control. Collapsed previews are hidden from assistive technology and their Retry is removed from tab order.

## 11. Screenshots and measurement artifacts

Visually inspected browser default, expansion midpoint, expanded and reverse midpoint captures against the actual recording and Figma states. Browser captures use deterministic synthetic API posters and real Archivo fonts; they validate crop/layout/motion rather than pretend to reproduce the recording's film artwork or plot copy.

Artifacts: `node_modules/.cache/kino-now-playing-ui/{default,intermediate,expanded,reverse}-{1920,1728}.png`. Geometry diagnostics are in `.qa.local/now-playing-complete.txt`. Screenshots and disposable browser profiles are ignored QA output. No application asset was created from a screenshot.

## 12. Exact validation results

All browser traffic was intercepted in disposable Chrome sessions; no production booking, notification or other mutation was sent. Suites ran serially to avoid cold Vite/CDP startup contention.

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Focused preview Node suite | 16 | 0 | 0 |
| Now Playing browser suite | 25 | 0 | 0 |
| Hero browser suite | 32 | 0 | 0 |
| Recently Viewed browser suite | 23 | 0 | 0 |
| Coming Soon/notification browser suite | 36 | 0 | 0 |
| Auth/navigation browser regressions: Hold entry, Profile, Search | 39 | 0 | 0 |
| Full safe `node --test` suite | 528 | 0 | 306 |

The five browser groups comprise 155 executed cases. The full safe Node run discovers 834 tests; browser cases require an explicit CDP endpoint and are skipped in that separate run. The focused 16 Node cases are included in its 528 passes, so these rows should not be summed as unique tests.

`npm.cmd run lint`, `npm.cmd run build` and `git diff --check` pass. Final build: 168 modules, CSS 67.03 kB / 12.29 kB gzip, JS 504.08 kB / 152.95 kB gzip. Vite emits its non-blocking >500 kB chunk advisory; code splitting is outside this interaction task.

Earlier validation caught and resolved: an overly broad metadata selector affecting the small cards; a CDP test attempting to serialize a DOM element; Retry focus restoration running before React's commit; and the notification fixture rejecting legitimate preview GETs during Tab traversal. Final results above contain no failures; existing regression assertions were preserved.

Ignored logs: `.qa.local/now-playing-complete.txt`, `now-playing-hero-regression.txt`, `now-playing-recent-final.txt`, `now-playing-coming-soon-verified.txt`, `now-playing-auth-navigation-final.txt`, `now-playing-full-node-complete.txt`.

## 13. Remaining limitations

No blocking issue remains. Recording-only timing is approximate; canonical-copy reactions provide the exact expansion timing. Fractional CSS geometry is subject to browser rounding, and rapid reversals use native CSS shortening. Loading/error copy is functional project UI, not an unverified Figma error-state design. The existing minimum card width can require horizontal scrolling on very narrow screens. Build chunk-size and Git CRLF/global-ignore permission advisories do not prevent validation or review.

The work remains uncommitted for review. Hero animation and unrelated product behavior remain outside this change.
