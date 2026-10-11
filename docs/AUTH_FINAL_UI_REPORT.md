**AUTH FINAL UI READY FOR REVIEW**

Reviewed 2026-10-11. No staging, commits, pushes, or deployment.

1. **Verified mismatch and root cause**

   Chrome's real Autofill engine reproduced the pale Email background in both Login and Signup. This was not a field-format or authentication state. `Autofill.trigger` populated the actual inputs and `input.matches(':autofill')` returned true; no forced pseudo-state or manually assigned value was used for these checks.

   Before the fix, computed styles were `background-color: rgb(232, 240, 254)`, black text fill, and no inset shadow. `CSS.getMatchedStylesForNode` identified Chrome's `user-agent` rule for `:-internal-autofill-selected`, which forces background and `color: fieldtext` with `!important`. Ordinary typed inputs remained dark. Existing focus/success rules and form-specific author styles did not cause the pale fill.

   The corrected input paints `#1E2031` with an opaque inset shadow and explicitly sets white text/caret, or red text/caret for a field error. Background clipping prevents the browser fill showing through the transparent border. Chrome still reports its underlying UA background/color; the painted inset and text-fill override produce the verified dark, readable result.

   Computed evidence: [Login before](../artifacts/auth-final/before/login-autofill-styles.json), [Login after](../artifacts/auth-final/after/login-autofill-styles.json), [Signup before](../artifacts/auth-final/before/signup-autofill-styles.json), [Signup after](../artifacts/auth-final/after/signup-autofill-styles.json).

2. **Changes made in this pass**

   - `src/styles/components/auth-modal.css`: added auth-scoped `:autofill` / `:-webkit-autofill` styling, including the existing error state's text color. No validation, request, timing, or layout logic changed.
   - `tests/loginIntegration.test.js`: extended the existing untracked browser suite with actual Autofill, computed-style evidence, captures, registered-fixture/unregistered-format equivalence, autofilled 422/401 behavior, alert fit checks, real keyboard typing and Tab focus navigation.
   - `src/assets/icons/login-input-success.svg`: removed only this verified orphaned duplicate.
   - `docs/AUTH_FINAL_UI_REPORT.md` and `artifacts/auth-final/`: review report, browser/Figma screenshots, style evidence, and test logs.

   Preserved the pre-existing edits to `input-success.svg`, `FormField.jsx`, `AuthFormActions.jsx`, `LoginForm.jsx`, `useAuthForm.js`, `auth-modal.css`, and `home-catalogue.css`. Preserved and ran the pre-existing untracked `login.test.js` and `formFieldRendering.test.js` tests.

3. **Authentication and validation audit**

   OpenAPI `POST /login` and the Assignment require email syntax and a three-character password minimum. Syntax does not establish account registration. Both `person@example.test` (the mocked registered fixture) and `unregistered@example.test` pass the same local email checks, receive a green local-validation check alongside a locally invalid short password, and make no existence-check request. Authentication is decided by the mocked server response.

   The existing 401 handling already met the contract and was preserved:

   - Modal remains open; email and password remain entered.
   - Exact server message appears in one visible `role="alert"` inside the modal.
   - Both credential fields remain neutral, without green checks, red field errors, `aria-invalid`, or guessed credential-specific descriptions.
   - No password clearing, automatic authentication retry, or protected-action replay occurs on rejected Login.
   - The existing form-level red alert icon remains decorative. Short and longer generic rejection messages fit without control overlap or modal clipping.

   Field-level 422 errors still map to the named fields, associate through `aria-describedby`, focus the affected field, and use the red error icon. Autofilled error text remains red. Message-only 422 remains form-level feedback. No email-existence endpoint, authentication behavior, or validation timing was introduced.

4. **Before/after screenshots**

   All captures use disposable Chrome 155.0.8059.39 at 1280 x 900 with API interception. The before captures were regenerated with only the new autofill CSS block removed, using the same intercepted font fixtures as the final captures; the CSS was restored in `finally` before final validation.

   | State | Before | After |
   | --- | --- | --- |
   | Login real autofill | [Pale field](../artifacts/auth-final/before/login-autofill.png) | [Dark field](../artifacts/auth-final/after/login-autofill.png) |
   | Signup real autofill | [Pale fields](../artifacts/auth-final/before/signup-autofill.png) | [Dark fields](../artifacts/auth-final/after/signup-autofill.png) |

   Further evidence: [Login autofill with local success/error](../artifacts/auth-final/after/login-autofill-success.png), [Signup autofill success](../artifacts/auth-final/after/signup-autofill-success.png), [autofilled 422](../artifacts/auth-final/after/login-autofill-422.png), [autofilled 401](../artifacts/auth-final/after/login-autofill-401.png), [normal keyboard typing/focus](../artifacts/auth-final/after/login-keyboard-typing.png).

5. **Exact Figma comparison**

   Read the exact nodes in current canonical file `Zeb7RQ8mjGp04YIPde2ud2` through the working Figma connection and visually inspected exported references. The other connection denied file access; the working connection provided the exact nodes successfully.

   | Reference | Verified design and implementation |
   | --- | --- |
   | [Login 269:4439](https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/?node-id=269-4439) | Modal 403 x 399; input 339 x 40; radius 12; dark surface. Existing geometry preserved. |
   | [Login filled 269:4441](https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/?node-id=269-4441) | Filled/success input remains `#1E2031`, with white text and `#4ADE80` check. |
   | [Input Error 263:3595](https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/?node-id=263-3595) | Dark surface, red `#EC3013` text/border/icon; 12px error glyph inside the existing 16px slot. |
   | [Input Success 263:3607](https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/?node-id=263-3607) | Dark surface, white text, green success glyph approximately 16 x 16. |

   Reference exports: [Login](../artifacts/auth-final/figma-login.png), [Login filled](../artifacts/auth-final/figma-login-filled.png), [Error](../artifacts/auth-final/figma-input-error.png), [Success](../artifacts/auth-final/figma-input-success.png).

   The supplied nodes do not specify a separate generic 401 modal variant. Retained existing form-level error presentation and verified its fit; did not convert it to a field-level Figma Error state. Existing visible keyboard focus and validation timing remain deliberate interaction behavior.

6. **Cleanup verification**

   Before deletion, both SVGs had SHA-256 `BA0D2ECD4BD0CEBB5379C9D7F004DFB047AFA1D1C180B40ADD781E71E7F9BF40`. Repository search found no reference to `login-input-success.svg`; Git listed it as untracked. Removed only that file. The shared `input-success.svg` remains.

7. **Exact checks**

   | Check | Result |
   | --- | --- |
   | `node --test tests/login.test.js tests/formFieldRendering.test.js tests/loginIntegration.test.js` | 38 passed, 0 failed, 0 skipped: 6 validation/API/error-mapping tests, 5 shared-field rendering tests, 27 intercepted browser tests. |
   | Original CSS baseline, filtered to the two real-autofill tests | 0 passed, 2 failed as expected; both lacked the dark inset paint. Confirms the regression tests catch the original bug. |
   | `npm.cmd run lint` | Passed. |
   | `npm.cmd run build` | Passed; bundle-size warning described below. |
   | `git diff --check` | Passed. |

   [Full final test names/results](../artifacts/auth-final/final-tests.txt), [baseline failures](../artifacts/auth-final/baseline-tests.txt).

   The browser run supplied `KINO_PROFILE_QA_CDP_URL` for the explicitly disposable Chrome, `KINO_NOTIFY_QA_ASSETS=node_modules/.cache/kino-auth-final-chrome/font-assets.json`, and `KINO_AUTH_QA_CAPTURE_DIR=artifacts/auth-final/after`. Without a disposable endpoint the browser tests deliberately skip; the reported run skipped none. On this Windows host the `npm` PowerShell wrapper is disabled, so the successful checks used `npm.cmd`.

   Browser coverage includes neutral/filled appearance, valid and invalid typing, invalid email syntax, password under three characters, local green/red icons, registered-fixture and unregistered email formats, real Chrome autofill in Login and Signup, autofill success/error text, exact generic 401 messages, preserved credentials, 422 field/message-only responses, pending/read-only/duplicate safety, late responses after dismissal/switching, synthetic successful login, 429/500/network failure, closing/Escape/backdrop, real keyboard typing, visible focus, Tab order and focus wrapping.

   Browser requests were intercepted before navigation. Production API requests received synthetic fixtures or explicit failures; unexpected external traffic failed the tests. Unit API tests mocked `fetch`. Font requests were served from downloaded fixture bytes. No live backend requests or mutations were used.

8. **Remaining issues and limits**

   No unresolved auth UI issue was found in the requested Chrome scenarios. Vite reports the app's JavaScript bundle at approximately 506 kB, above its 500 kB warning threshold; this pass does not change bundle architecture. Firefox/Safari autofill were not exercised. The four original user screenshots were not attached to this request; the described mismatch was reproduced directly instead.
