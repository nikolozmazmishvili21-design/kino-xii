**KINO XII — Auth release cleanup**

**AUTH RELEASE CLEANUP READY TO COMMIT**

Baseline HEAD: `0cd5a2c style: polish Hero All sessions hover state`.
The initial `git diff --check` passed. Existing application edits and untracked auth tests/documentation were preserved. No files were staged, committed, pushed, synced, or deployed.

1. **Confirmed navigation failure and targeted stabilization**

   Before editing tests, the complete Notifications browser file produced **35 passed, 1 failed, 0 skipped**. The first test, `Enter keyboard focus retention during pending and success prevents repeated Notify POSTs`, failed with `CDP Page.navigate (id 8) timed out after 5000ms.` The failure occurred in fixture setup before the keyboard assertions.

   The isolated test also exceeded the original five-second navigation budget on this host (**0 passed, 1 failed**). Thus the reported timeout was reproduced, although the isolation-versus-full-file distinction did not reproduce here. No more specific machine/browser startup bottleneck is claimed.

   The Notifications fixture used `connectProfileBrowser(endpoint)` with its default five-second budget for every CDP command. Added an optional `navigationTimeoutMs` to the test helper, defaulting to the existing `commandTimeoutMs`. Only the Notifications fixture supplies **15,000 ms**, and only `Page.navigate` uses it. Other CDP commands, target/socket connection, cleanup, UI waits, request waits, and all other fixtures retain their existing budgets. `Page.reload` is unchanged.

   No application code, assertions, navigation behavior, or request interception changed. No sleeps or automatic retries were added. Helper regression tests cover the separate navigation budget, unchanged ordinary/reload budgets, default inheritance, invalid timer values, one dispatch on timeout, and late-reply cleanup.

2. **QA evidence safety**

   Inspected all 30 original files in `artifacts/auth-final/`: 24 PNG screenshots, four computed-style JSON files, and two test logs. Verified PNG signatures, JSON evidence structure, and test-log contents. Production source, `index.html`, Vite configuration, and `package.json` do not reference this directory. References are confined to review documentation and the browser capture output location.

   Added the root-anchored `.gitignore` entry `/artifacts/auth-final/`. `git check-ignore` confirms all 30 original files are ignored; no files in the directory are already tracked. They no longer appear in the normal untracked-file inventory and will not be included by an ordinary `git add`. Evidence remains on disk. Explicit force-add can bypass any Git ignore rule and is outside the intended commit scope.

   Release validation logs are also kept locally beneath this ignored directory. Documentation links to that evidence are local review links; screenshots/logs and reference exports are excluded from the commit scope.

3. **Complete modified/untracked scope audit**

   `M` means modified tracked file; `??` means untracked source/documentation. No tracked files are deleted. The orphaned duplicate `login-input-success.svg` was already absent at this cleanup baseline, so this pass deletes nothing.

   | Status | File | Release category / disposition |
   | --- | --- | --- |
   | M | `.gitignore` | Release hygiene: narrowly exclude generated auth QA evidence. Changed this pass. |
   | M | `src/assets/icons/input-success.svg` | Shared validation icon correction: canonical green check. Existing change preserved. |
   | M | `src/components/forms/FormField.jsx` | Shared validation presentation, icon selection and description associations. Existing change preserved. |
   | M | `src/forms/AuthFormActions.jsx` | HTTP 401 form-level alert/icon presentation. Existing change preserved. |
   | M | `src/forms/LoginForm.jsx` | Login validation feedback and HTTP 401 presentation wiring. Existing change preserved. |
   | M | `src/forms/useAuthForm.js` | Login validation timing, neutral credential states and general rejection state. Existing change preserved. |
   | M | `src/styles/components/auth-modal.css` | Login/Signup autofill fix and HTTP 401 alert/icon styling. Existing change preserved. |
   | M | `src/styles/components/home-catalogue.css` | **Unrelated:** Coming Soon card/Notify pointer-cursor styling. Preserve, exclude from auth release commit. |
   | M | `tests/helpers/profileBrowser.js` | Test timeout stabilization: opt-in navigation budget. Changed this pass. |
   | M | `tests/notificationsIntegration.test.js` | Test timeout stabilization: Notifications navigation gets 15 seconds. Changed this pass. |
   | M | `tests/profileBrowserHelper.test.js` | Corresponding timeout isolation/default/validation regression tests. Changed this pass. |
   | ?? | `tests/formFieldRendering.test.js` | Shared validation icon/accessibility rendering tests. Existing file preserved. |
   | ?? | `tests/login.test.js` | Login/Signup validation, API payload and 401/422 error semantics tests. Existing file preserved. |
   | ?? | `tests/loginIntegration.test.js` | Login/Signup UI, real autofill, 401/422 and keyboard regression tests. Existing file preserved. |
   | ?? | `docs/AUTH_FINAL_UI_REPORT.md` | Corresponding auth UI audit and Figma comparison documentation. Existing file preserved. |
   | ?? | `docs/AUTH_RELEASE_CLEANUP_REPORT.md` | This release hygiene, validation and commit-scope audit. Added this pass. |

   Exclude `artifacts/auth-final/`, `node_modules/.cache/`, `dist/`, generated screenshots/logs, reference images/videos, and credentials/secrets. The changed tests use explicit synthetic credentials/tokens; no real credentials or secret files are part of the listed scope. The Git index remains empty.

   Compared SHA-256 hashes for all **178 files under `src/`** against this cleanup's initial snapshot: **zero changed**. Application behavior is untouched by this pass, including the unrelated cursor edit.

4. **Validation results**

   All browser tests used this task's disposable Chrome with interception enabled before navigation. Production API requests were fulfilled by test fixtures or explicitly failed; font requests used local fixture bytes. No live backend mutations were made. Runs were separate sequential Node processes, not retries of failed tests.

   | Check | Passed | Failed | Skipped | Duration / result |
   | --- | ---: | ---: | ---: | --- |
   | Notifications complete file — run 1 | 36 | 0 | 0 | 51.380 s |
   | Notifications complete file — run 2 | 36 | 0 | 0 | 39.920 s |
   | Notifications complete file — run 3 | 36 | 0 | 0 | 21.982 s |
   | Browser helper regression tests | 34 | 0 | 0 | 0.107 s |
   | Login/Signup, shared field rendering and auth browser tests | 38 | 0 | 0 | 27.357 s |
   | `npm.cmd run lint` | — | — | — | Passed, exit 0. |
   | `npm.cmd run build` | — | — | — | Passed, exit 0; existing 506.25 kB JavaScript bundle warning. |
   | `git diff --check` | — | — | — | Passed, exit 0. |

   Commands: `node --test tests/notificationsIntegration.test.js` (three complete runs), `node --test tests/profileBrowserHelper.test.js`, and `node --test tests/login.test.js tests/formFieldRendering.test.js tests/loginIntegration.test.js` for the auth checks. Browser runs explicitly supplied `KINO_PROFILE_QA_CDP_URL` and `KINO_NOTIFY_QA_ASSETS`; no browser tests were skipped. PowerShell's `npm` wrapper is disabled on this host, so checks used `npm.cmd` without changing execution policy.

   Local logs: [Notifications run 1](../artifacts/auth-final/release-cleanup/notifications-run-1.txt), [run 2](../artifacts/auth-final/release-cleanup/notifications-run-2.txt), [run 3](../artifacts/auth-final/release-cleanup/notifications-run-3.txt), [helper tests](../artifacts/auth-final/release-cleanup/browser-helper-tests.txt), [auth tests](../artifacts/auth-final/release-cleanup/auth-tests.txt), [lint](../artifacts/auth-final/release-cleanup/lint.txt), [build](../artifacts/auth-final/release-cleanup/build.txt). Original timeout evidence: [complete-file baseline](../artifacts/auth-final/release-cleanup/notifications-baseline.txt), [isolated baseline](../artifacts/auth-final/release-cleanup/notifications-isolated-baseline.txt).

   No release-cleanup blocker remains. The bundle-size warning predates this cleanup; generated asset names and sizes are unchanged. All 30 original QA evidence files retain their initial SHA-256 hashes. The unrelated `home-catalogue.css` change remains outside the intended auth commit scope. Nothing is staged.
