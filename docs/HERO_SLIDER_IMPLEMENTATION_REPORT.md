# Home Hero Slider — 10 October 2026

**HERO SLIDER BLOCKER FIX READY FOR REVIEW**

The initial implementation evidence below is historical. The blocker-fix follow-up at the end records the current correction and validation.

## Baseline and audit

Baseline: clean working tree at `a7e09bd feat: implement recently viewed movie history`. Recently Viewed, including the Movie Detail auth/date regression fix, was committed before this task. `git status --short` and `git log -1 --oneline` verified the baseline.

Existing working behavior was retained: `GET /movies/featured`, independent catalogue reads, API-provided titles/backdrops/metadata, manual previous/next with wrapping, semantic labeled buttons, disabled single-slide arrows, visible shared keyboard focus, Buy tickets → the selected movie's detail route, All sessions → `/sessions`, and loading/empty/error/Retry states. Missing behavior was autoplay, smooth crossfades, synchronized progress and prototype arrow hover presentation. Existing Hero gaps differed from the inspected Banner values.

## Recording inspected before implementation

Local source: `C:\Users\KENNY\Documents\Bandicam\bandicam 2026-10-10 16-47-12-363.mp4`.

The complete recording was available and inspected before production edits. Its MP4 sample timing table identifies 653 variable-duration video frames over 28.966633 seconds at 2560×1440; there are no composition-time offsets. A disposable Chrome video decoder sought every frame's timestamp. Every decoded frame was extracted into 11 annotated contact sheets and visually inspected, including the startup/recording overlay, manual navigation, uninterrupted autoplay, scrolling and final recording overlay. No unrelated recording was opened.

The recording shows overlapping backdrops and film copy, without horizontal slide movement. Representative transition spans are approximately 2.50–2.80, 7.63–7.93 and 14.00–14.30 seconds. An uninterrupted sequence starts near 14.1, 17.4, 20.7 and 24.0 seconds, consistent with about 3.3 seconds between transition starts. Earlier rapid manual actions interrupt transitions; the requested implementation guards overlapping inputs. Recording-only measurements are approximate because of frame quantization, variable frame durations and manual interaction.

Ignored evidence: `.qa.local/hero-video/sheet-00.png` through `sheet-10.png`, `frames.json`, `hero-video-analysis.txt`, and the frame-extraction helper `.qa.local/inspect-hero-video.mjs`. These are QA evidence, not application assets or dependencies.

## Figma evidence and timings

Read design context/screenshots from validated canonical file `Zeb7RQ8mjGp04YIPde2ud2`: Banner variants `131:4476`, `137:1793`, `137:1840`, `137:1887`, and controls `148:3212`. Read-only Plugin API inspection of the Banner reactions supplies the exact interaction settings. The motion endpoint returned `nodes: []`; this is a component-variant prototype, not a returned keyframe timeline.

| Setting | Verified evidence | Implementation |
| --- | --- | --- |
| Autoplay wait | Each Banner: `AFTER_TIMEOUT`, 3 seconds | 3000 ms dwell after initial image readiness / preceding fade completion |
| Automatic transition | `DISSOLVE`, `EASE_OUT`, approximately float-encoded 0.3 seconds | 300 ms CSS ease-out crossfade |
| Previous/Next | Generally 0.3 seconds, dissolve or smart animate | 300 ms crossfade, with wrapping |
| Last variant → Previous | Explicit 0.7-second dissolve | 700 ms when moving backward from the last featured slot |
| Arrow hover | 0.7-second ease-out to Hover variant | 700 ms background/shadow transition |
| Continuous progress fill | No keyframe track returned; user explicitly requests advancing/resetting progress | Linear fill from the same dwell clock; visible 3 px active cap at zero, full active segment while paused/single |

These exact settings were read from the canonical editable copy. The separate original prototype file `rBonynbM7wSNOmPs4cryxT` was not programmatically inspected. Its user-provided recording independently agrees with the approximately 3.3-second automatic cadence and visible dissolve. No exact recording-only easing or interval claim is made.

Native browser full-cycle measurements: 1920×1080 consecutive transition starts were 3332.9, 3332.4 and 3334.1 ms apart; 1728×900 measured 3332.0, 3333.0 and 3333.9 ms. Animation-frame scheduling quantizes the configured 3000+300 ms cycle. D-033 narrowly supersedes D-021's earlier manual-only motion deferral; its missing API-copy and unverified functional-state visual boundaries remain intact.

## Playback, controls and progress

The standalone controller owns one animation-frame request at a time. The React hook owns its lifetime, media-query listener, visibility listener and intersection observer. Progress updates a Hero-local CSS variable rather than re-rendering Home on every frame. Native and controlled-clock browser tests assert a maximum of one pending playback frame, including StrictMode replay and unmount/remount.

Autoplay traverses the returned featured array and wraps last → first. Empty/single lists create no clock. Manual previous/next resets dwell/progress and wraps both directions. An immediate controller guard ignores overlapping input during a fade or pending image decode. No queued burst or duplicate transition is created.

API backdrops preload in the existing MovieImage components. An incoming image must decode or fail before it replaces the current frame; late callbacks from a destroyed controller are ignored. A delayed image retains the current slide instead of exposing a blank frame. Broken/missing images retain the existing unavailable-image fallback and usable API content/navigation.

During a crossfade, the outgoing image and its own copy remain an opaque base while the incoming image and its own copy fade in as one layer. This gives a complementary visible old/new contribution without the dark midpoint caused by independently fading two partially transparent layers. The base is removed from presentation after completion. The old/inactive slides are immediately inert and `aria-hidden`; only the current slide's actions are interactive. Navigation controls remain stationary. The Hero stays 760 px high and does not move the other Home sections.

Independent pause reasons cover pointer hover, keyboard focus, a natively hidden document and an offscreen Hero. Clearing one reason cannot override another. Elapsed dwell is retained; hidden/offscreen time does not accumulate or trigger catch-up transitions. An explicit fade can finish during pointer/focus pause, then playback stops. Reduced motion disables autoplay and uses immediate explicit navigation; live preference changes are supported.

## Visual and accessibility validation

Browser captures at both requested sizes were visually inspected against the design screenshots and recording: initial frame, mid-crossfade and settled second frame. QA featured responses used original Figma backdrop assets for these captures; production uses only API-provided imagery. Other tests use small deterministic synthetic image fixtures. No screenshot was substituted as an application asset.

Verified geometry: Hero 760 px high; 67 px horizontal copy/navigation inset; 179 px copy bottom inset; 42 px navigation bottom inset; 3 px bars; 8 px bar gap; 24 px navigation gap; 12 px arrow gap; 54×54 px arrow buttons; 34×34 px icons. The backdrop retains -88.56 px / 1062.72 px placement with `object-fit: cover`. Scoped copy/action spacing now follows the inspected Banner values. No horizontal page overflow occurs at 1920×1080 or 1728×900.

The existing local arrow, ticket and timer SVGs exactly match the current Figma asset bytes after newline normalization. Their files are nonempty, their existing callsites/slots are retained, and rendered geometry was verified. The ticket's intrinsic 15.9991×16.0011 px SVG renders at 15.984375×15.984375 CSS px through browser intrinsic/layout quantization; the root dimensions were preserved. Timer and arrow geometry is exactly 14×14 and 34×34 px. No static asset file changed.

Previous/Next remain real buttons with existing accessible labels, pointer cursors, real Enter/Space activation and visible focus. Keyboard focus remains on the activated arrow and pauses autoplay. Slide groups expose current position/title; decorative backdrops have empty alt text. Automatic rotation uses `aria-live="off"`; explicit paused navigation uses polite status updates. Reduced motion removes fades and arrow transitions. There are no duplicate active slide links in the tab order.

The featured Movie schema has no synopsis/premiere-copy field. Existing API-backed heading/metadata/actions transition together; no film description or premiere text was fabricated and no additional detail request was introduced. This remains the accepted D-021 content limitation rather than a new motion blocker. The requested linear progress fill is a documented frontend behavior; the reference prototype itself supplies static active segments, not a fill keyframe.

Ignored screenshots/geometry: `node_modules/.cache/kino-hero-ui/hero-{1920,1728}-{initial,midfade,second}.png` and `geometry-{1920,1728}.json`.

## Exact changed files

| File | Purpose |
| --- | --- |
| `src/components/home/HeroCarousel.jsx` | Render coherent layered slides, current accessibility state, guarded controls and pause events. Preserve API navigation/actions. |
| `src/components/home/useHeroPlayback.js` | Local controller/observer lifecycle, image decode readiness, reduced-motion and visibility integration. |
| `src/home/heroPlayback.js` | Isolated single-clock dwell/progress/fade state machine and rapid-input/lifetime guards. |
| `src/styles/components/home-hero.css` | Scoped crossfade, verified Hero spacing/arrow hover, synchronized progress and reduced-motion styling. |
| `tests/heroPlayback.test.js` | Nine focused controller/lifecycle/timing tests with an explicit clock. |
| `tests/heroIntegration.test.js` | Nineteen real-app StrictMode browser cases, native autoplay cycles, intercepted API/images, keyboard/visibility/navigation and geometry/capture checks. |
| `docs/03_FIGMA_REFERENCE.md` | Record inspected Hero motion/geometry and recording provenance. |
| `docs/05_ARCHITECTURE.md` | Document Hero-local playback ownership and lifecycle. |
| `docs/06_DECISIONS.md` | D-033 and narrow D-021 motion-deferral reconciliation. |
| `docs/HERO_SLIDER_IMPLEMENTATION_REPORT.md` | This implementation/evidence/validation record. |

No dependency, route, API module, HomePage, Now Playing, Coming Soon, Recently Viewed, auth, Search, Sessions, Movie Detail, Booking, Checkout or Refund source file changed. Now Playing animations remain outside this scope.

## Validation results

| Check | Result |
| --- | --- |
| Focused Hero controller Node suite | 9 passed, 0 failed/skipped |
| Complete Hero browser suite | 19 passed, 0 failed/skipped |
| Strengthened static-asset/geometry browser recheck | 2 passed, 0 failed/skipped |
| Recently Viewed browser regressions | 23 passed, 0 failed/skipped |
| Existing Coming Soon browser regressions | 36 passed, 0 failed/skipped |
| Existing protected entry/profile/Search/navigation browser regressions | 39 passed, 0 failed/skipped |
| Full safe Node (`node --test tests/*.test.js`) | 776 total: 508 passed, 268 optional browser skips, 0 failed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed; nonblocking bundle-size advisory below |
| `git diff --check` | Passed |

The 117 distinct browser cases above explicitly enabled the disposable Chrome gate; the safe Node skips do not imply those cases were omitted from browser validation. All API/external traffic was intercepted, with unexpected requests blocked and asserted. No production booking, hold, payment, refund or notification mutation occurred. Existing Coming Soon tests include both See all destinations and Notify Me guest/expired-auth continuation and keyboard/focus regressions. Existing Recently Viewed tests include Movie Detail date preservation, account safety and Back/Forward.

Hero browser tests use a Vite-only clock wrapper for deterministic lifecycle/progress cases. The two full native autoplay cases use real requestAnimationFrame/performance time and actual CSS animations, without advancing a fake clock. The midpoint test inspects the real CSS animation. The production module contains no QA clock, probe or fabricated film content.

Commands: `node --test tests/heroPlayback.test.js`; with `KINO_PROFILE_QA_CDP_URL` set to a disposable intercepted Chrome, `node --test --test-concurrency=1 tests/heroIntegration.test.js`. Optional `KINO_NOTIFY_QA_ASSETS` supplies cached fonts; optional `KINO_HERO_REFERENCE_ASSETS` supplies the downloaded raw Banner PNGs for reference captures. Without the latter, geometry/capture cases use the same synthetic API-image fixture and remain runnable. Ignored `.qa.local/run-focus-qa.ps1` owns/disposes the Chrome processes used here.

Final ignored logs: `hero-browser-final.txt`, `hero-final-assets-geometry.txt`, `hero-recent-regressions.txt`, `hero-existing-regressions.txt` and `hero-node-final.txt`. Prototype evidence: `hero-prototype-reactions.json`, `hero-motion-endpoint.json`.

## Remaining issues and change control

No blocking issue remains in the validated scope. API-owned film content can differ from the static Figma samples; missing list-level synopsis/premiere copy remains intentionally unfilled. Runtime cadence has animation-frame quantization and pauses for accessibility/readiness. The production JS chunk is about 501.00 kB minified / 151.86 kB gzip, producing Vite's nonblocking 500 kB advisory; unrelated code splitting was not added to this scoped task.

All changes remain unstaged and uncommitted. No stage, commit, push, sync, deployment or Now Playing animation implementation occurred.

**Initial verdict (superseded by independent review): HERO SLIDER READY FOR INDEPENDENT REVIEW**

## Blocker-fix follow-up — 10 October 2026

### Baseline and scope

HEAD remained `a7e09bd feat: implement recently viewed movie history`. `git status --short` showed existing modified Hero JSX/CSS and Figma/architecture/decision documentation, plus the untracked playback hook/controller, Hero tests and this report. `git diff --check` passed. All of that uncommitted work was retained. The initial evidence above is historical: independent review subsequently confirmed B1 and N1, reproduced below.

This follow-up changes exactly these six files relative to its saved SHA-256 baseline:

| File | Purpose |
| --- | --- |
| `src/components/home/HeroCarousel.jsx` | Distinguish keyboard focus from pointer focus using native focus-visible semantics and local input events. |
| `src/home/heroPlayback.js` | Allow explicit manual navigation to replace a pending image target while preserving the fade guard. |
| `tests/heroIntegration.test.js` | Real pointer/keyboard regressions in normal mode and StrictMode, both required viewport sizes, controlled image responses and decode completion. |
| `tests/heroPlayback.test.js` | Four focused pending-target, stale-readiness and pause/recovery cases. |
| `docs/06_DECISIONS.md` | Narrowly clarify D-033's focus semantics and supersede only its unconditional pending-decode navigation guard. |
| `docs/HERO_SLIDER_IMPLEMENTATION_REPORT.md` | Preserve historical evidence and record this correction and validation. |

The existing playback hook, all CSS, Figma-reference and architecture files are byte-identical to this follow-up's baseline. Hash comparison also verifies preservation of every unrelated source/test/documentation file. No dependencies or API behavior changed. The reference video remains outside tracked repository files.

### B1 reproduction and correction

Fresh disposable Chrome targets used the actual Home application, intercepted API/images, native pointer events and native elapsed time. In both normal mode and StrictMode at 1920×1080, autoplay advanced first; a real mouse Next click selected the next slide. Moving the pointer outside the entire Hero without another click produced **zero automatic transitions over the next 8.3 seconds**. Both regressions failed before the correction.

The root cause was unconditional `onFocusCapture` setting the independent `focus` pause reason. Chrome focuses a mouse-clicked button, and pointer leave clears only the hover reason, leaving focus paused indefinitely.

Focus capture now uses `event.target.matches(":focus-visible")`. Local pointer-down capture clears the keyboard pause, and local keyboard capture reinstates it for keyboard input. The latter two handlers cover modality changes on an already focused arrow, when no new focus event occurs. Blur still clears focus pause when focus exits the Hero. There are no added global listeners or production timers, and focus-ring CSS is unchanged.

Keyboard Tab pauses playback; native Enter and Space select slides and retain arrow focus and its visible outline. Tab out resumes playback when the remaining pause reasons permit. Tests also switch keyboard → pointer → keyboard on the same arrow. Hover, hidden-document, offscreen and reduced-motion conditions remain independent.

### N1 pending image recovery

The original `advance` guard rejected all navigation while `pending` existed. A delayed automatic backdrop therefore blocked both arrows, including Previous toward a decoded slide. Both browser recovery cases and all four added controller cases failed before the correction.

The guard now rejects pending work only for automatic navigation; explicit navigation replaces the pending target or immediately starts toward an already ready adjacent slide. Active fades still reject overlapping requests. No image is bypassed: an unloaded/undecoded target retains the current slide until readiness. Only readiness matching the latest pending target can start a transition. Superseded readiness caches the image for future use and cannot replace the user's selected slide. The existing destroyed-controller guard remains intact.

Browser tests hold actual `HTMLImageElement.decode()` promises, override pending autoplay with Previous, promote pending Next to explicit intent during hover, and replace a manual pending target. One test holds responses 1 and 3, releases responses **3 then 1**, then decode promises **1 then 3**. DOM slide assertions verify that unresolved/stale targets never become active and autoplay subsequently recovers. One animation-frame clock remains the maximum scheduled work throughout.

### Validation and measurements

All eight combinations of Next/Previous, normal mode/StrictMode and 1920×1080/1728×900 passed in each complete run: **24 native mouse scenarios**. Each observed two automatic transitions during the 8.3-second window, checked the actual active DOM slide/title, and retained focus on the clicked arrow without further clicks. The following transition-start offsets are milliseconds from the manual click, rounded to the nearest millisecond, across three runs. Offsets include pointer-exit and animation-frame scheduling time.

| Viewport | Mode | Arrow | First automatic transition | Second automatic transition |
| --- | --- | --- | --- | --- |
| 1920×1080 | Normal | Next | 3346–3348 | 6680–6682 |
| 1920×1080 | Normal | Previous | 3347–3348 | 6664–6681 |
| 1920×1080 | StrictMode | Next | 3347–3348 | 6664–6680 |
| 1920×1080 | StrictMode | Previous | 3331–3348 | 6665–6681 |
| 1728×900 | Normal | Next | 3347–3349 | 6681–6682 |
| 1728×900 | Normal | Previous | 3347–3348 | 6680–6682 |
| 1728×900 | StrictMode | Next | 3331–3348 | 6664–6683 |
| 1728×900 | StrictMode | Previous | 3347–3349 | 6681–6681 |

| Check | Final result |
| --- | --- |
| Focused pointer/focus/hover/progress/decode browser regressions | 13 passed, 0 failed/skipped; subsequent complete runs include strengthened decode cases |
| Hero controller Node suite | 13 passed, 0 failed/skipped |
| Complete Hero browser suite, run 1 | 32 passed, 0 failed/skipped |
| Complete Hero browser suite, run 2 | 32 passed, 0 failed/skipped |
| Complete Hero browser suite, run 3 | 32 passed, 0 failed/skipped |
| Recently Viewed browser suite | 23 passed, 0 failed/skipped |
| Coming Soon browser suite | 36 passed, 0 failed/skipped |
| Auth/profile, protected entry and Search/navigation browser suites | 39 passed, 0 failed/skipped |
| Full safe Node suite | 793 total: 512 passed, 281 optional browser skips, 0 failed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed; 501.16 kB minified / 151.93 kB gzip chunk advisory |
| `git diff --check` | Passed |

The final serial browser validation covers **130 distinct cases**, with **194 successful executions** including three complete Hero runs (96 + 23 + 36 + 39). Together with the earlier 13-case focused pass, this follow-up records **207 successful browser executions**. Final serial runs have zero failures/skips; the preliminary transport-timeout attempts below are reported separately. Safe Node skips are gated browser cases; the requested browser suites were explicitly enabled and run independently.

Ignored evidence: `.qa.local/hero-blocker-before.txt`, `hero-blocker-node-before.txt`, `hero-blocker-focused.txt`, `hero-blocker-final-suite-1.txt` through `-3.txt`, `hero-blocker-recent-final.txt`, `hero-blocker-existing-final.txt`, `hero-blocker-node-final.txt`, and `hero-blocker-measurements.json`. The runner `.qa.local/run-hero-blocker-qa.ps1` owns and disposes its fresh Chrome profile/process; no user browser is controlled. Synthetic-image midpoint captures at both requested viewport sizes were visually inspected in addition to the geometry/animation assertions.

Before the serial rerun, focused pointer/focus/hover/progress/decode checks passed **13/13**. Preliminary concurrently launched suites encountered only five-second `CDP Page.navigate` startup timeouts: Hero **31/32**, Recently Viewed **22/23**, and combined Coming Soon/auth/navigation **73/75**. These were transport failures in first-case setup, not behavior assertion failures. The Hero fixture now permits a 15-second command budget for cold Vite transforms; the shared helper and unrelated fixtures remain unchanged. Complete final runs are serial.

### Preserved behavior and remaining findings

The 3-second dwell, 300 ms ease-out crossfade, existing last-variant Previous 700 ms exception, API movie order, progress appearance, layout, dimensions and arrow hover treatment remain unchanged. Existing browser assertions cover actual CSS animation opacity/easing, coherent image/copy layers, one interactive slide, keyboard outlines, visibility pauses, reduced motion, navigation destinations and exact geometry at 1920×1080 and 1728×900. Real mouse rapid-click checks preserve slide order and one outgoing layer; manual input resets progress and starts a fresh dwell without extra clocks.

N2/N3/N4 remain separate nonblocking visual findings, unchanged and outside this correction. The build's existing approximately 501 kB chunk-size advisory remains nonblocking. No staging, commit, push, sync, deployment or Now Playing animation work occurred. All browser API/external requests are intercepted; unexpected requests fail tests, with no production mutations.

B1 and N1 are corrected; no blocker remains in the validated scope.

**HERO SLIDER BLOCKER FIX READY FOR REVIEW**
