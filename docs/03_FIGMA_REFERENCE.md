# Kino XII — Figma Reference

> Design inventory with the current editable implementation-inspection source identified below.
>
> Current implementation-inspection file (editable Education duplicate):
> https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/
>
> Current file key: `Zeb7RQ8mjGp04YIPde2ud2`
>
> Earlier/public/view-only inventory source: `5AncExEN8mTN1Wy02MMD6r` — https://www.figma.com/design/5AncExEN8mTN1Wy02MMD6r/Redberry-Bootcamp-XII--Copy-
> Retained for provenance only, not current implementation inspection. The copies are not guaranteed to remain identical; verify exact nodes in the current editable file.
>
> This file records verified Figma structure, screen/state inventory, major components, typography, and color usage. It is not a substitute for opening the relevant Figma node when exact spacing, geometry, assets, or visual behavior is required.

---

## 1. Design pages

The earlier inventory listed these top-level pages; both were also verified in the current editable copy:

- `Design screens` — page id `0:1`
- `Components` — page id `355:14337`

The editable copy additionally includes `Style Guide` — page id `381:6297`, verified during the Sessions audit on 2026-10-05. The earlier inventory did not list this page.

---

## 2. Main design sections and screen states

### Home — section `161:2656`

Direct screens:

- `Home_Not_authorized` — `139:2899` — 1728×1719
- `Home_authorized` — `272:3698` — 1728×2103
- `Home_authorized_incomplete` — `272:4139` — 1728×1027
- `Home_authorized_complete` — `369:6407` — 1728×1027

Notable design implications:

- guest and authenticated home states are distinct
- authenticated users have separate incomplete-profile and complete-profile states
- home uses large hero/banner variants plus Now Playing and Coming Soon card groups
- authenticated home includes a `Recently viewed` section

### Authorization — section `269:7564`

Four top-level 1728×1027 frames:

- `269:7602`
- `272:4752`
- `272:5061`
- `272:5370`

Authorization-specific component states are documented separately below.

### Sessions — section `272:5988`

- `Sessions` — `272:7289` — 1728×1556
- `Sessions_Filtered` — `276:9167` — 1728×1556

The requested Sessions screen IDs, supporting component IDs, and variant IDs listed in this document were verified in the editable Education copy `Zeb7RQ8mjGp04YIPde2ud2` on 2026-10-05: Days `119:3614`, Sessions card `119:3760`, Sessions time `276:10275`, pagination `429:7088`, and pagination buttons `429:7020`.

Accepted resolutions for Sessions source conflicts and undefined UI behavior are recorded in D-022 in `docs/06_DECISIONS.md`; those fallback policies are not additional Figma-defined states.

Use these two frames to verify:

- unfiltered/default sessions layout
- active-filter state
- sorting/pagination/filter panel treatment

### Buy ticket — section `284:15451`

The following frame mapping was verified on 2026-10-05 in the editable implementation-inspection file `Zeb7RQ8mjGp04YIPde2ud2`, using the second/GTU connection. All eight frames are named `Movie inside page`; their visible contents determine the states below.

| Frame ID | Visible state | Size | Implementation phase |
| --- | --- | --- | --- |
| `148:3565` | Base/full Movie Detail | 1728×1374 | Current Movie Detail scope |
| `291:20628` | Empty Seat Selection | 1728×1027 | Later Seat Selection |
| `408:8079` | Alternate empty Seat Selection composition | 1728×1027 | Later Seat Selection |
| `408:8520` | Alternate/duplicate empty Seat Selection composition | 1728×1027 | Later Seat Selection |
| `291:21072` | Selected-seat state | 1728×1027 | Later Seat Selection |
| `291:21718` | Checkout empty | 1728×1027 | Later Checkout |
| `291:22284` | Checkout filled | 1728×1027 | Later Checkout |
| `291:22766` | Confirmation | 1728×1027 | Later Confirmation |

Key base Movie Detail nodes:

- Navbar — `302:23560`
- Banner — `148:3877`
- Poster — `148:4126`
- Hero content — `148:4158`
- Sessions column — `148:3931`
- Date row — `148:3936`
- Venue group — `148:3943`
- Hall card row — `148:3946`
- Movie Detail ticket instance — `148:3952`; Default component — `119:3759`
- Details sidebar — `148:3970`
- Rating note — `148:3992`
- Footer — `148:3593`

Accepted Movie Detail presentation and pre-booking policies are recorded in D-023 in `docs/06_DECISIONS.md`. Its fallback treatments and Assignment-over-Figma additions are not additional Figma-defined states. Inspect exact live nodes again during implementation; the provenance/editable-copy divergence rule below still applies.

### My Profile — section `284:13297`

- `My profile_Information` — `284:13298` — 1728×959
- `My Profile_Tickets` — `284:17650` — 1728×959
- `My Profile_Tickets` — `291:19541` — 1728×959

Use these for:

- Personal Information tab
- Tickets tab variants / states

### Overlays — section `355:15478`

- Authorization overlay — `272:4462` — 403×399
- Authorization overlay — `272:4463` — 475×558
- Seat Selection overlay — `291:23211` — 1146×599
- Profile overlay — `355:11312` — 302×292
- Profile overlay — `355:11313` — 302×259
- `Overlay / Search – Prompt` — `361:6212` — 480×294
- `Overlay / Search – Results` — `361:6267` — 480×388
- `Overlay / Search – No results` — `361:6328` — 480×294

---

## 3. Desktop reference geometry

Most primary desktop screens are designed at:

- width: **1728 px**

Observed examples:

- Home
- Sessions
- Movie details / booking views
- Profile

The assignment mentions a 1920×1080 target environment. Use Figma for exact geometry and composition rather than stretching the 1728px design mechanically to 1920px.

---

## 4. Major component sets

The Components page contains **138 component/component-set nodes** in total.

The following are the primary reusable sets verified in the file.

### Universal / navigation / form components

#### Button — component set `97:1632`

Verified variants include:

- Primary — `90:1587`
- Primary hover — `97:1633`
- Secondary — `97:1637`
- Secondary hover — `97:1641`
- Transparent — `97:1669`
- Transparent hover — `97:1682`
- Notify — `108:1841`
- Notify Hover — `108:2127`
- Notify Success — `108:2134`
- Ghost — `272:3540`
- Pressed — `272:3545`
- other unnamed/legacy variants exist

#### Badge — component set `108:2079`

- Default — `108:2078`
- Red badge — `108:2080`

#### Icon set — component set `97:1627`

Verified icons include:

- Ticket — `97:1626`
- Bell — `108:1893`
- Timer — `108:2068`
- Error — `263:3520`
- Close — `269:4365`
- Arrow — `269:9395`
- User — `276:9691`
- Calendar — `284:16919`
- Log out — `272:3560`
- Checkbox — `272:7564`
- Checkbox checked — `272:7566`

#### Input

Standalone component:
- `263:3508`

State set — `263:3550`:

- Default — `263:3549`
- Hover — `263:3551`
- Focused — `263:3561`
- Filled — `263:3731`
- Error — `263:3595`
- Success — `263:3607`

#### Navbar — component set `240:1418`

- Unauthorized — `137:1978`
- Authorized — `240:1398`
- third state — `272:3210`

#### Tickets tab — component set `291:19183`

- Upcoming — `291:19182`
- Past — `291:19184`

#### Profile tabs — component set `291:19217`

- Default — `291:19216`
- second tab state — `291:19218`

---

## 5. Movie cards

### Card_Small — component set `108:1799`

- Default — `108:1798`
- Hover — `108:1800`
- Pressed — `108:1827`

Base instance size:
- about 329×87

### Card_medium — component set `108:2346`

Verified variants:
- Default — `108:2160`
- Variant2 — `108:2347`
- Variant3 — `108:2370`

Base size:
- 470×160

### Card_big — component set `108:2446`

- Default — `108:2445`
- Hover — `108:2792`
- Variant3 — `108:3026`

Default size:
- 260×452

Hover/expanded variants are wider.

---

## 6. Authentication / profile components

### Authorization modal — component set `269:4440`

- Login — `269:4439` — 403×399
- Sign up — `269:4543` — 475×558
- Signup_filled — `269:4724` — 475×558
- Login_filled — `269:4441` — 403×399

### Profile status menu — component set `355:11311`

- Incomplete — `355:11310` — 302×292
- Complete — `355:11309` — 302×259

### Avatar — component set `269:9467`

- Avatar — `269:9466`
- Avatar empty — `269:9465`

### Profile button — component set `276:9712`

- Default — `276:9672`
- Variant2 — `276:9713`

### Profile control — component set `276:9752`

- Default — `272:3175`
- Open — `276:9753`

---

## 7. Booking / ticketing components

### Seat Selection modal — component set `265:3958`

Each main modal state is approximately 1146×599.

Verified states:

- Confirmation — `265:3957`
- Seat selection_empty — `265:3956`
- Seat selected — `265:3954`
- Checkout — `265:3955`
- Checkout_Filled — `265:3953`

### Seat summary components

- `Seat` — `259:2207`
- `Summary` — `259:3082`

### Days — component set `119:3614`

- Default — `119:3612`
- Hover — `119:3738`
- Selected — `119:3747`
- Days_Small — `276:8986`
- Days_Small_Hover — `276:9003`
- Days_Small_Selected — `276:9010`

### Sessions card — component set `119:3760`

- Default — `119:3759`
- Hover — `119:4046`
- Selected — `125:4151`

### Sessions time — component set `276:10275`

- Default — `276:10274`
- Hover — `276:10276`
- Disabled — `276:10307`

### My tickets card

- `291:18200` — 1626×183

### Seat state component set — `119:3146`

- Held — `119:3145`
- Default — `119:3143`
- Disabled — `119:3142`
- Selected — `119:3144`

Each seat visual state is approximately 52×52.

### Seat row

- `Seats/Seats_row` — `119:3395`

### Booking progress — component set `388:6297`

- Seats — `259:3204`
- Checkout — `388:6298`

---

## 8. Hero / slider components

### Banner set — `131:4477`

Verified variants:

- The Odyssey — `131:4476`
- Variant2 — `137:1793`
- Variant3 — `137:1840`
- Variant4 — `137:1887`

Each banner is:

- 1728×760

A small slider/navigation control also exists in set `148:3212`.

---

## 9. Search components

### Search input — component set `332:10366`

States:

- Default — `332:10365`
- Hover — `332:10364`
- Focused — `332:10363`
- Type — `332:10362`
- Filled — `332:10361`

Size:
- 480×41

### Result item — component set `324:5938`

- Variant3 — `324:6200`
- Hover — `324:5936`

Result row size:
- 464×72

### Search result panel — component set `326:6262`

- Search Results — `326:6261` — 480×342
- No results found — `326:6260` — 480×248
- Empty — `332:10737` — 480×248

---

## 10. Pagination

### Pagination buttons — component set `429:7020`

- Default — `429:7019`
- Hover — `429:7021`
- Active — `429:7023`
- Arrow — `429:7025`
- Arrow hover — `429:7080`

Button size:
- 40×40

### Pagination assembled component

- `429:7088` — 328×40

---

## 11. Typography

Primary UI typeface:

- **Archivo**

Verified recurring Archivo styles:

### Archivo ExtraBold

- 40 px
- 24 px
- 20 px
- 18 px
- 14 px

### Archivo SemiBold

- 14 px
- 12 px
- 12 px with 6% letter spacing for all-caps labels such as `SESSIONS`

### Archivo Regular

- 16 px with about 130% line-height
- 14 px with about 130% line-height
- 12 px with about 130% line-height

A small amount of **Poppins Medium 14 px / 22 px line-height** is also present in the file, notably in numeric UI elements. Do not replace it automatically with Archivo when implementing a node that visibly uses it; check that Figma node directly.

Important:
- Exact line-height, letter-spacing, weight, and text color must be verified on the target Figma node during implementation.

---

## 12. Verified color palette usage

Most-used solid fills/strokes on the Components page include:

- `#FFFFFF`
- `#1E2031`
- `#A9A9A9`
- `#EC3013`
- `#505261`
- `#070C1C`
- `#2A2C3D`
- `#8A38F5`
- `#4ADE80`
- `#E27E04`
- `#444444`
- `#E3E3E3`

Observed use strongly indicates the following broad roles, but exact semantic token naming should be finalized only after checking the specific target components:

- `#070C1C` — dark application background
- `#FFFFFF` — primary light text/surfaces
- `#A9A9A9` — muted/secondary text
- `#EC3013` — primary red/orange accent
- `#1E2031`, `#2A2C3D`, `#505261` — dark surfaces, borders, disabled/secondary treatments
- `#4ADE80` — success/valid state
- `#E27E04` — warning/incomplete-profile treatment
- `#8A38F5` — purple accent used in some design states

Do not create final CSS token semantics purely from this frequency inventory; verify visual role on the target component first.

---

## 13. Key implementation rule

When implementing any screen or state:

1. Open the exact Figma frame/component.
2. Read exact design context for that node.
3. Match:
   - dimensions
   - spacing
   - padding
   - alignment
   - typography
   - colors
   - border radius
   - borders
   - shadows
   - hover/focus/selected/disabled/error states
   - asset placement
4. Do not approximate a value that can be read directly from Figma.

This file is an inventory and navigation aid, not a replacement for exact node-level inspection.

---

## 14. Important design-state coverage

The Figma file explicitly includes design coverage for:

- guest home
- authenticated home
- incomplete-profile home
- complete-profile home
- authorization modal states
- input default/hover/focus/filled/error/success
- sessions default and filtered
- movie detail / booking flow
- empty seat selection
- selected-seat state
- checkout empty/filled
- booking confirmation
- profile incomplete/complete menu
- profile personal information
- profile ticket states
- seat default/selected/held/disabled
- search prompt/results/no-results
- pagination default/hover/active/arrows

These states should be included in visual QA.

---

## 15. Current known ambiguities

- Some variant names in the Figma component library are generic (`Variant2`, `Variant3`, `State3`) and should not be assigned business meaning without opening the exact component/frame.
- The Figma file uses 1728px desktop frames while the assignment mentions 1920×1080 as a target display reference.
- Exact responsive behavior outside the supplied desktop composition is not fully specified by the current inventory and should not be invented beyond sensible layout behavior that preserves the assignment/design intent.

---

## 16. Figma implementation reference URL

Current implementation-inspection design (editable Education duplicate):

`https://www.figma.com/design/Zeb7RQ8mjGp04YIPde2ud2/`

Use file key `Zeb7RQ8mjGp04YIPde2ud2` for all current design inspection during implementation. The earlier/public/view-only key `5AncExEN8mTN1Wy02MMD6r` is retained above only as inventory provenance. Do not assume the copies remain identical; inspect each relevant live node in the editable file.

If a divergence is discovered between the earlier/original/public provenance source `5AncExEN8mTN1Wy02MMD6r` and the editable inspection copy `Zeb7RQ8mjGp04YIPde2ud2`, report it before implementation and do not silently assume equivalence. The editable duplicate does not automatically outrank the original merely because it is used for inspection. Resolve any correctness-affecting difference through the project's normal source-reconciliation process before coding.
