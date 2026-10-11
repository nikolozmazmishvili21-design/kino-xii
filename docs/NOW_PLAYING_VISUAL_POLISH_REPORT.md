# Now Playing visual fidelity audit — 10 October 2026

**NOW PLAYING VISUAL POLISH READY FOR REVIEW**

The audit preceded production edits. Four visual differences were corrected: synopsis color, metadata/synopsis line height, price text alignment, and an extra inset shadow. Existing card geometry, title placement, poster crop, text-block positions, footer position and animation were retained.

## Audit method and sources

Inspected the existing Now Playing components, preview cache and CSS; Assignment Home requirements; OpenAPI Movie/MovieDetail definitions; Figma reference, accepted decisions and architecture. This task started with the preceding hover implementation already present as uncommitted work at HEAD `b2373b9`. An additional SHA-256 baseline was saved before this audit's edits, so this report distinguishes the polish changes from that earlier work.

Fresh Figma design context and screenshots were obtained for Card_big Default `108:2445` and Hover `108:2792`. Read-only Plugin API inspection verified component set `108:2446`, both variants' nested bounds, typography, fills, border, effects, image fill and prototype reactions in the validated editable copy [Zeb7RQ8mjGp04YIPde2ud2](https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2?node-id=108-2446). No Figma content was edited. The requested standalone Card_big measurements remain the target; smaller Home-instance overrides were not substituted.

The actual recording `C:\Users\KENNY\Documents\Bandicam\bandicam 2026-10-10 16-47-12-363.mp4` was inspected through decoded frames, including the 22–22.333 second expansion sequence. It is 2560×1440, duration 28.966633 seconds. It confirms crop changes, fixed footers, moving neighbors and the synopsis fading at its final position while metadata moves. Its original browser zoom cannot be established retrospectively, so video pixels were not used as CSS measurements. Exact duration/easing came from Figma's `SMART_ANIMATE`, `LINEAR`, `0.30000001192092896` second reaction, not a timing estimate from video.

Before/after application captures used a disposable intercepted Chrome session with an actual **1920×1080 CSS viewport**, device pixel ratio **1**, `visualViewport.scale=1`, page scale **1** and computed root zoom **1**. Real Archivo Regular/ExtraBold fonts were confirmed through Chrome's platform-font inspection. Default, paused 150 ms intermediate and expanded states were captured. Figma's unmodified component PNG was placed at native 1× size beside the two application crops in a separate 1920×1080 browser canvas; the components were not resized to make them appear equal.

For comparison, API fixtures supplied the same title, genre, runtime, age and poster as the reference card. The synopsis is original QA text, not the Figma placeholder. The same poster asset was intercepted only in disposable QA. Production movie data, prices, assets and API modules were not changed. Price copy remains Assignment's `from ₾XX`; the Figma example's capitalization/spacing was not copied.

## Actual mismatches and exact corrections

All y positions below are relative to the card's top edge, in CSS pixels. Measurements are from the expanded state unless specified.

| Property | Before | Figma target | After |
| --- | --- | --- | --- |
| Synopsis color | `#ffffff` | `#a9a9a9` | `#a9a9a9` |
| Metadata line height | 18 | 130% of 14 = 18.2 | 18.2 |
| Synopsis line height | 18 | 130% of 14 = 18.2 | 18.2 |
| Metadata box height | 18 | 18 | 18, preserved explicitly |
| Expanded synopsis text box | 397×54 | 397×54 | 397×54, capped to its existing wrapper |
| Price line box height | 19 (`normal`) | 15 | 15 |
| Price line box y | 412.21875 | 414.216309 | 414.21875 |
| Price glyph top y | 415.21875 | 414.216309 | 414.21875 |
| Buy Ticket glyph top y | 414.21875 | 414.216309 | 414.21875, unchanged |
| Card shadow | Outer `0 1px 4px rgba(0,0,0,.2)` plus inset `0 0 4px rgba(0,0,0,.2)` | One drop shadow: offset 0,1; radius 4; opacity .2 | Existing outer shadow only |

The line-height change advances the second and third synopsis glyph rows from y=357.21875 / 375.21875 to 357.40625 / 375.59375. The first row stays at 339.21875. Keeping the metadata's 18 px box avoids shifting the age badge; capping the synopsis at 54 px avoids increasing the three-line clipping area to its natural 54.6 px height.

Figma's raw effect radius is 4. The generated context's CSS filter standard deviation of 2 does not justify replacing the existing 4 px box-shadow blur. Only the unsupported inset effect was removed.

Actual screenshot paint confirms maximum synopsis RGB channel **255 before → 169 after**. The regression independently found 3,038 visible gray text pixels with maximum channel 169, so it checks rendered PNG pixels as well as computed styles.

## Measurements already matching: retained

| Measurement | Figma | Browser before | Browser after |
| --- | --- | --- | --- |
| Default card | 260×452 | 260×452 | 260×452 |
| Expanded card | 447×452 | 447×452 | 447×452 |
| Default poster | 232×300 | 232×300 | 232×300 |
| Expanded poster | 417×224.432617 | 417×224.421875 | 417×224.421875 |
| Default title y | 324.783691 | 324.796875 | 324.796875 |
| Expanded title y / height | 249.216309 / 22 | 249.21875 / 22 | 249.21875 / 22 |
| Expanded metadata y / height | 279.216309 / 18 | 279.21875 / 18 | 279.21875 / 18 |
| Expanded age badge y / height | 305.216309 / 21 | 305.21875 / 21 | 305.21875 / 21 |
| Expanded synopsis y / width / clipping height | 338.216309 / 397 / 54 | 338.21875 / 397 / 54 | 338.21875 / 397 / 54 |
| Footer y / height | 404.216309 / 35 | 404.21875 / 35 | 404.21875 / 35 |
| Expanded content left / right edge | 15 / 432 | 15 / 432 | 15 / 432 |
| Neighbor displacement when expanded | 187 | 187 | 187 |
| Card gap | 17 | 17 | 17 |

The small positional differences above are browser layout quantization, all below 0.014 px. Title remains Archivo 20 px/800 with its existing 22 px line box. Metadata remains 14 px/400. Existing 14 px padding, 20 px card radius, 14 px image radius, `#1e2031` surface, expanded 1 px `#2a2c3d` border, 12 px poster/details and body/footer gaps, 8 px title/metadata/badge gaps and 20 px synopsis trailing padding were retained.

The exact same Figma poster image fill is used in both reference variants. Centered `object-fit: cover` reproduces its crop. No separate hover image or crop offset was introduced.

At the paused **150 ms** frame, before and after both measure card **353.5×452**, poster **323.5×262.203125**, synopsis opacity **0.5**, next-card displacement **93.5** and footer y **404.21875**. The verified **300 ms linear** transition and its reversal are unchanged. The temporary interaction between fading synopsis and moving details seen in the recording was retained. Neighboring cards remain separated by the existing gap.

## Changes in this task

| File | Purpose |
| --- | --- |
| `src/styles/components/home-catalogue.css` | Correct the four visual differences; retain existing layout boxes and scope metadata changes to Now Playing. |
| `tests/nowPlayingIntegration.test.js` | Add one 1920×1080 visual regression with default/intermediate/expanded screenshots, geometry, clipping, aligned glyphs and actual PNG color checks. Fixture supports original API synopsis and an optional local reference poster; screenshot capture returns its encoded image. Explicitly control page scale. |
| `docs/NOW_PLAYING_VISUAL_POLISH_REPORT.md` | Record source evidence, measurements, validation and limits. |

SHA-256 comparison against this task's baseline confirms every other existing file under `src`, `tests` and `docs` retains its original bytes. API/cache/Retry/navigation/Recently Viewed isolation logic was not edited. No dependency or production asset was added. Existing work from the preceding hover task is preserved. No staging, commit, push, sync or deployment was performed.

## Validation

| Check | Result |
| --- | --- |
| Now Playing browser suite, including new visual regression | 26 passed; 0 failed; 0 skipped |
| Recently Viewed browser suite | 23 passed; 0 failed; 0 skipped |
| Coming Soon/Notify browser suite | 36 passed; 0 failed; 0 skipped |
| Safe `node --test --test-concurrency=1` | 835 discovered; 528 passed; 307 browser cases skipped; 0 failed |
| Read-only visual audit before / after | Passed in both captures; comparison generation also passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed; CSS 67.06 kB, JavaScript 504.08 kB |
| `git diff --check` | Passed |

The three dedicated browser suites executed **85 cases** without skips. The safe Node run is separate and skips browser cases without its explicit Chrome endpoint; its counts should not be added to the browser suite counts as unique tests. The existing Vite warning about the JavaScript chunk exceeding 500 kB remains; JavaScript size did not change.

Browser coverage preserves pointer/focus expansion, API races and cache reuse, Retry, navigation, history isolation, default/intermediate/reverse geometry, reduced motion, image failures, long content and viewport containment. The new regression also verifies long API synopsis clipping inside the 54 px wrapper. Recently Viewed and Coming Soon retain their shared metadata presentation.

Reproduce the new regression with the existing disposable intercepted Chrome endpoint and font fixture variables (`KINO_PROFILE_QA_CDP_URL`, `KINO_NOTIFY_QA_ASSETS`), then `node --test --test-concurrency=1 tests/nowPlayingIntegration.test.js`. `KINO_NOW_PLAYING_QA_POSTER` optionally points to a local copy of the reference poster; otherwise the test uses its existing synthetic image fixture. Tests make no live production API mutations.

## Review artifacts and remaining limits

Artifacts are local ignored QA files; no screenshot or reference poster was added to application assets.

- [1920×1080 native-scale Figma / before / after comparison](../.qa.local/now-playing-polish/comparison-expanded-1920.png)
- [Before expanded application](../.qa.local/now-playing-polish/before-expanded-1920.png), [after expanded application](../.qa.local/now-playing-polish/after-expanded-1920.png)
- [After default](../.qa.local/now-playing-polish/after-default-1920.png), [after 150 ms intermediate](../.qa.local/now-playing-polish/after-intermediate-1920.png)
- [Raw Figma metrics](../.qa.local/now-playing-polish/figma-metrics.json), [before metrics](../.qa.local/now-playing-polish/before-metrics.json), [after metrics](../.qa.local/now-playing-polish/after-metrics.json)
- [Automated screenshot/geometry regression metrics](../node_modules/.cache/kino-now-playing-ui/visual-polish-metrics.json)

The original video browser zoom and an end-to-end pixel comparison against the original live prototype viewer remain unverified. The controlled reference comparison uses the verified copy's canonical component export at native size. It is not presented as a screenshot of the original live viewer. Different API plot text and price copy are intentionally excluded from pixel equivalence.

Small font-derived horizontal bounds remain observable: Figma's HUG Buy Ticket width is 119 px versus Chrome's 118.125 px, and its 16+ badge is 38 px versus 37.46875 px. Actual font family/weight, padding, height and right-edge alignment match; no fixed widths or typography substitutions were added to compensate for renderer metrics. Cross-browser font rasterization was not audited. These limits do not block review of the measured corrections.
