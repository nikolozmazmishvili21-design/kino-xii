# Initial startup loader review

## Baseline and scope

- HEAD: `b7009e2 style: align coming soon cursor with Figma`, matching the locally recorded `origin/main`.
- The preceding auth release commit `054b526` is included. The latest local commit affecting `netlify.toml`, `2cf7658`, is an ancestor of HEAD; its Vite build/publish settings and SPA rewrite are present. This verifies repository deployment configuration, not the status of a live hosting deployment.
- Initial working tree: only `src/styles/components/home-catalogue.css` was modified. Its original bytes were saved locally and its SHA-256 remains unchanged.
- No staging, commits, pushes, synchronization or deployment were performed.

The original `Loading application...` string was in the loading branch of `src/app/AppBootstrapProvider.jsx`. It appeared only after React mounted. `index.html` originally had an empty root, so there was no pre-JavaScript loading screen.

## Design decision and implementation

Inspected the Assignment loading requirements, OpenAPI bootstrap schema, Figma reference, accepted decisions and bootstrap architecture. In the current Figma file `Zeb7RQ8mjGp04YIPde2ud2`, the navbar component set `240:1418` uses the white/red KINO XII text brand with Archivo ExtraBold. No dedicated startup/splash/loading frame was found on the inspected Components and Design screens pages.

This is a small intentional addition using that visual language, rather than an exact Figma startup-screen reproduction: a centered 32px brand, 24px ring, 24px vertical gaps, 14px status text, `#070C1C` background, `#EC3013` accent and `#A9A9A9` secondary text. Existing Archivo fonts are reused with an immediately readable Arial fallback.

Changed files:

| File | Purpose |
| --- | --- |
| `index.html` | Static loading markup, critical inline styling, reduced-motion rule, no-JavaScript message and early startup-failure alert. Existing Google Fonts stylesheet loads without blocking first paint. |
| `src/main.jsx` | Tiny dynamic import boundary, retaining the existing entry URL used by application and browser fixtures. |
| `src/mountApp.jsx` | Existing root mounting code moved intact, including the App and application CSS imports. This keeps bundled application CSS from blocking the static shell's first paint. |
| `src/app/StartupLoader.jsx` | Matching presentation while React waits for the existing bootstrap operation. |
| `src/app/AppBootstrapProvider.jsx` | Replaces only the original loading markup; bootstrap logic and error/Retry rendering stay intact. |
| `tests/helpers/startupBrowser.js` | Disposable-browser fixture intercepting every API/external request, with controllable script, style and bootstrap delivery. |
| `tests/startupIntegration.test.js` | Development and production-preview startup, navigation, motion, accessibility and failure coverage at both requested viewports. |
| `docs/STARTUP_LOADER_REPORT.md` | Design decision, evidence, validation and scope record. |

`src/styles/components/home-catalogue.css` remains an unrelated pre-existing working-tree change. No page-level loader, API, authentication, routing, booking, checkout or refund implementation was edited. No dependency was added.

## First paint, accessibility and failures

The static shell and all of its layout styles are in the HTML response. Tests hold JavaScript and stylesheets, disable cache and apply 150ms latency with 128,000 bytes/second throughput. They verify an actual `first-contentful-paint`, the centered brand/status, exact requested colors, full viewport size and zero API calls before releasing JavaScript. The production HTML has no render-blocking application stylesheet link; Vite loads it with the dynamic application module.

React replaces the static root children automatically. During bootstrap there is exactly one matching loader; after bootstrap there are none. No minimum display duration, artificial delay, progress percentage or automatic retry was added. The loader contains no focusable controls and does not move focus.

Both representations use `role="status"`, polite/atomic announcements and clear status text. The decorative brand and ring are hidden from screen readers. The ring rotates using a CSS transform; under `prefers-reduced-motion: reduce`, its animation is disabled and the same loading message remains visible.

Failed entry downloads, application-module downloads and application evaluation replace the early animation with an assertive alert: “Kino XII couldn't start. Please refresh to try again.” Native errors are still reported. The early listeners disconnect once React owns the root. A bootstrap API failure retains the existing server-message alert and working Retry button.

## Screenshots

Evidence is retained under ignored `node_modules/.cache/kino-startup-ui/`; screenshots and logs are not production imports or commit candidates. These links are relative to this report.

| Viewport | Original bootstrap text | Development before JS/CSS | Production before JS/CSS | Production React bootstrap |
| --- | --- | --- | --- | --- |
| 1920x1080 | [Before](../node_modules/.cache/kino-startup-ui/before/1920x1080-bootstrap.png) | [After](../node_modules/.cache/kino-startup-ui/after/dev-1920x1080-animated-before-js.png) | [After](../node_modules/.cache/kino-startup-ui/after/preview-1920x1080-animated-before-js.png) | [After](../node_modules/.cache/kino-startup-ui/after/preview-1920x1080-animated-bootstrap.png) |
| 1728x900 | [Before](../node_modules/.cache/kino-startup-ui/before/1728x900-bootstrap.png) | [After](../node_modules/.cache/kino-startup-ui/after/dev-1728x900-animated-before-js.png) | [After](../node_modules/.cache/kino-startup-ui/after/preview-1728x900-animated-before-js.png) | [After](../node_modules/.cache/kino-startup-ui/after/preview-1728x900-animated-bootstrap.png) |

The original pre-JavaScript screen was blank: [1920x1080](../node_modules/.cache/kino-startup-ui/before/1920x1080-before-js.png), [1728x900](../node_modules/.cache/kino-startup-ui/before/1728x900-before-js.png).

Reduced-motion evidence: [1920x1080](../node_modules/.cache/kino-startup-ui/after/preview-1920x1080-reduced-before-js.png), [1728x900](../node_modules/.cache/kino-startup-ui/after/preview-1728x900-reduced-before-js.png). Download/evaluation failure screenshots and ready-Home screenshots are in the same `after` directory.

## Initial implementation validation

These original runs passed, with no skips, but independent review subsequently identified a reload synchronization race. The stabilization section below supersedes the original test-readiness conclusion.

| Command | Result |
| --- | --- |
| `node --test tests/startupIntegration.test.js` | 20/20 passed, 261.0s. Development and production preview, both viewports: animated/reduced first paint, throttled handoff/removal, normal startup, Sessions/Tickets refresh and Home return, download/evaluation failure alerts and bootstrap Retry. |
| `node --test --test-name-pattern='delayed CSS alone' tests/startupIntegration.test.js` | 4/4 newly added CSS-isolation cases passed, 12.7s. JavaScript can load while CSS remains pending, with first-contentful-paint still verified. Together these runs cover all 24 distinct startup cases in the final file. |
| `node --test tests/loginIntegration.test.js` | 27/27 passed, 34.4s, serial run. Includes Signup, actual Chrome autofill, keyboard focus and authentication error regressions. |
| `node --test tests/profileBrowserHelper.test.js tests/login.test.js tests/formFieldRendering.test.js tests/profile.test.js tests/search.test.js` | 70/70 passed, 0.38s. |
| `npm.cmd run lint` | Passed, exit 0. |
| `npm.cmd run build` | Passed, exit 0; 172 modules. Startup entry 2.25kB, application chunk 504.64kB, application CSS 68.53kB. Final asset hashes match the tested production preview build. |
| `git diff --check` | Passed. |

Browser commands supplied `KINO_PROFILE_QA_CDP_URL` for an owned disposable Chrome and `KINO_NOTIFY_QA_ASSETS` for local font fixtures. All API requests were intercepted; the startup fixture rejected unexpected external requests and verified no unexpected runtime exceptions. Expected synthetic failure cases deliberately retain browser/Vite error reporting. No application startup exception was observed on successful paths.

Logs: [startup matrix](../node_modules/.cache/kino-startup-ui/startup-tests-final.txt), [CSS isolation](../node_modules/.cache/kino-startup-ui/startup-css-tests-final.txt), [auth regression](../node_modules/.cache/kino-startup-ui/login-regression-final.txt).

Test development findings: the initial matrix had 12 passes and eight harness failures: it measured the rotating ring's bounding box rather than its CSS width, encountered canceled intercepted requests during reload, and used too short a readiness budget for the throttled development graph. Those checks now measure computed width and recognize only the exact CDP canceled-interception error. Network traces confirmed React DOM was still downloading; the new fixture gives that specific handoff a bounded 60-second condition wait. This adds no application timeout, arbitrary sleep or retry. An overlapping auth regression run had 26 passes and one Runtime.evaluate timeout; its final serial run passed all 27.

The additional CSS-only exploration had three passes and one failed first-paint assertion. An isolated reproduction confirmed Chrome had not yet delivered the paint timing entry when the assertion ran. The test now waits for the actual entry before asserting it. Two exploratory processes were stopped after their failed assertion left preview teardown waiting on unfinished preload responses; teardown now closes only its owned preview server connections. The final four-case run exited normally with all assertions intact.

## Final test stabilization

Baseline for this follow-up: `b7009e2 style: align coming soon cursor with Figma`. `git diff --check` passed. All startup implementation changes were already uncommitted. Baseline SHA-256 hashes were saved for the five protected application files and the unrelated `home-catalogue.css` change; all six remain byte-for-byte unchanged.

Only these files are edited by this follow-up:

- `tests/helpers/startupBrowser.js`
- `tests/startupIntegration.test.js`
- `docs/STARTUP_LOADER_REPORT.md`

### Reproduced root cause

`Page.reload` acknowledges the command before the replacement document is ready. The previous wait checked only `.sessions-page` or `.my-tickets`, both already present in the old document. It could therefore return immediately and allow the next navigation to cancel the reload, skipping that document's bootstrap.

The unmodified four-case refresh run passed 4/4, confirming that an ordinary passing run does not eliminate this race. A controlled diagnostic held the replacement Sessions HTML and pipelined the selector read into the reload scheduling window. It observed `{rendered: true, marker: true}` from the old document, with bootstrap reads unchanged at 1. Navigating to Profile then left only 2 reads instead of the required 3. That diagnostic failed its preserved bootstrap-count assertion as expected. Two earlier diagnostic arrangements did not reach that assertion: one missed the canonical Sessions query string, and one queried Runtime after navigation had already blocked evaluation; those were probe setup failures, not additional application findings.

### Exact synchronization

Both refreshes now call the same fixture method, `reloadPage`:

1. Wait for the old page's expected API reads, then snapshot their counts.
2. Read the old main frame's loader identity and mark the old HTML element with `data-startup-reload-pending`; record `performance.timeOrigin` and the current path/query.
3. Register the main-frame navigation listener before issuing `Page.reload`.
4. Require a main-frame navigation with a different CDP `loaderId` within 10 seconds.
5. Require a different document time origin, removal of the marker, the preserved path/query and the expected page selector. The old document cannot satisfy these conditions.
6. Require exactly one additional `/filter-options`, `/me` and route-specific read (`/sessions` or `/tickets`) before proceeding.

The page-render and API-read waits are independently bounded at 10 seconds. Existing route, Home-return, duplicate-loader, overflow and total-four-bootstrap assertions remain. No arbitrary delay, automatic retry or assertion removal was introduced.

A controlled check of the corrected helper observed it still pending before replacement HTML delivery on both routes, with bootstrap counts still at 1 and 3 respectively. After delivery it completed with four total bootstraps, the marker removed and the required fresh reads.

### Timing budget

Independent review measured a throttled development readiness wait of 59.7 seconds, leaving only 0.3 seconds below the former 60-second ceiling. The same retained 150ms-latency / 128,000-bytes-per-second throttle downloads the entire unbundled Vite development graph; modest host/network variance can exhaust that margin.

Only the four throttled development cases now explicitly pass a 90-second readiness limit. Production-preview throttled cases and other bootstrap waits retain 60 seconds. CDP command/navigation timeouts and the new reload synchronization budgets are unchanged. The helper reports actual readiness duration; no application timeout or startup behavior changes.

### Follow-up runs

| Run | Result |
| --- | --- |
| Unmodified targeted refresh baseline | 4/4 passed, 19.2s; intermittent race still present. |
| Controlled original-race reproduction | Expected failure: 0/1 passed, bootstrap reads 2 versus required 3, 9.25s. |
| Corrected helper with controlled HTML delivery on both routes | 1/1 passed, 5.83s; four completed bootstraps. |
| Corrected targeted refresh run 1 | 4/4 passed, 18.69s. |
| Corrected targeted refresh run 2 | 4/4 passed, 8.13s. |
| Corrected targeted refresh run 3 | 4/4 passed, 8.99s. |
| Complete startup suite run 1 | 24/24 passed, 243.32s, no failures or skips. Throttled development readiness: 55.764-55.831s; production: 1.682-1.718s. |
| Complete startup suite run 2 | 24/24 passed, 257.48s, no failures or skips. Throttled development readiness: 55.870-56.482s; production: 1.736-1.812s. |
| `node --test tests/profileBrowserHelper.test.js` | 34/34 passed, 0.105s. |
| `npm.cmd run lint` | Passed, exit 0. |
| `npm.cmd run build` | Passed, exit 0; production asset hashes unchanged. Existing 504.64kB chunk warning remains. |
| `git diff --check` | Passed at baseline, after the correction and at final audit. |

Each targeted run uses `node --test --test-name-pattern='normal Home' tests/startupIntegration.test.js`; each full run uses `node --test tests/startupIntegration.test.js`. Browser tests run serially with intercepted API traffic and synthetic read-only responses. No production mutation is permitted by the fixture.

Evidence is local and ignored under `node_modules/.cache/kino-startup-stabilization/`: [original baseline](../node_modules/.cache/kino-startup-stabilization/baseline-refresh.txt), [race reproduction](../node_modules/.cache/kino-startup-stabilization/reproduced-race.txt), [controlled correction](../node_modules/.cache/kino-startup-stabilization/controlled-fix.txt), [refresh run 1](../node_modules/.cache/kino-startup-stabilization/refresh-run-1.txt), [refresh run 2](../node_modules/.cache/kino-startup-stabilization/refresh-run-2.txt), [refresh run 3](../node_modules/.cache/kino-startup-stabilization/refresh-run-3.txt), [full run 1](../node_modules/.cache/kino-startup-stabilization/full-run-1.txt), [full run 2](../node_modules/.cache/kino-startup-stabilization/full-run-2.txt). Full-run screenshots use separate `full-N/` paths.

### Commit scope

The startup change can include the eight files in the implementation table above: five original application files plus the two corrected test files and this report. This follow-up did not edit any application file. Exclude `src/styles/components/home-catalogue.css`, generated screenshots/logs, browser profiles and other ignored QA evidence. Nothing was staged, committed, pushed, synchronized or deployed.

## Remaining issues

No remaining test failure was observed in the corrected targeted runs or either complete suite. The controlled original-race failure is retained as reproduction evidence. Repeated passing runs provide coverage of the confirmed race and do not claim to prove the absence of every possible browser timing issue. The production build emits the existing greater-than-500kB application chunk warning; bundle splitting is outside this startup test change. Browser evidence covers Chrome on Windows; no cross-browser or live-hosting deployment claim is made.

**STARTUP LOADER TEST FIX READY FOR REVIEW**
