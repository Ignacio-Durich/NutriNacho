# NutriNacho Dashboard — Test Infrastructure Specification (TEST_INFRA.md)

## 1. Overview & Architecture

This document defines the automated, opaque-box, requirement-driven end-to-end (E2E) testing infrastructure for the **NutriNacho** nutrition-tracking dashboard (`dashboard/index.html`, `dashboard/sw.js`, and `dashboard/manifest.json`).

The testing harness executes in **Node.js (v20+ / v26+)** with **zero external npm dependencies**, ensuring instantaneous execution, portability across local workstations and CI environments, and complete isolation from production code.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Node.js Test Runner                             │
│                     (tests/e2e_runner.js)                              │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┼────────────────────────┐
         ▼                         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   DOM Emulator   │     │  Supabase Mock   │     │  Service Worker  │
│  & VM Context    │     │  (REST / Table)  │     │   & Cache Mock   │
│ (tests/harness/) │     │ (tests/harness/) │     │ (tests/harness/) │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  ▼
         ┌──────────────────────────────────────────────────┐
         │              4-Tier Test Suites                  │
         │  Tier 1: Feature Coverage (R1–R7, >=35 tests)   │
         │  Tier 2: Boundary & Corner Cases (>=35 tests)    │
         │  Tier 3: Cross-Feature Combinations (>=7 tests)  │
         │  Tier 4: Real-World Scenarios (>=5 tests)        │
         └──────────────────────────────────────────────────┘
```

---

## 2. Directory Layout & File Organization

All test files reside inside the `tests/` directory at the project root:

```
/Users/Nacho/Documents/NutriNacho/
├── dashboard/
│   ├── index.html               # Production dashboard (HTML, CSS, JS)
│   ├── manifest.json            # PWA Web App Manifest
│   └── sw.js                    # PWA Service Worker (created in M3)
├── TEST_INFRA.md                # This specification
├── TEST_READY.md                # Test execution & readiness report
└── tests/
    ├── e2e_runner.js            # Main test runner CLI (entry point)
    ├── harness/
    │   ├── dom_env.js           # Headless HTML parser, DOM tree, and VM sandbox
    │   ├── supabase_mock.js     # Chainable Supabase client mock (metas, comidas)
    │   ├── chart_mock.js        # Chart.js v4 & Annotation plugin mock
    │   └── sw_mock.js           # ServiceWorker, CacheStorage & Navigator mock
    ├── fixtures/
    │   ├── metas_fixtures.js    # Goal rows for Nacho, Mamá, edge cases
    │   └── comidas_fixtures.js  # Rich historical meal fixtures (full days, gap days)
    ├── tier1_feature_coverage.js # Tier 1 test definitions (35 tests)
    ├── tier2_boundary_corner.js  # Tier 2 test definitions (35 tests)
    ├── tier3_cross_feature.js    # Tier 3 test definitions (7 tests)
    └── tier4_real_world.js       # Tier 4 test definitions (5 tests)
```

---

## 3. Test Runner CLI & Invocation

### Command Line Interface

```bash
# Run all 4 tiers against current dashboard/index.html (fails if tests fail)
node tests/e2e_runner.js

# Baseline characterization mode (records pass/fail counts, exits 0)
node tests/e2e_runner.js --baseline

# Filter by tier (1, 2, 3, or 4)
node tests/e2e_runner.js --tier=1
node tests/e2e_runner.js --tier=2

# Filter by feature (R1, R2, R3, R4, R5, R6, R7)
node tests/e2e_runner.js --feature=R1
node tests/e2e_runner.js --feature=R7

# JSON output mode (for machine consumption / CI reporting)
node tests/e2e_runner.js --json
```

### Exit Code Contract
- `0`: All executed tests passed successfully (or `--baseline` / `--allow-fail` specified).
- `1`: One or more executed tests failed.

---

## 4. Test Harness Specifications

### 4.1 DOM & Execution Environment (`tests/harness/dom_env.js`)
- Parses `dashboard/index.html` into a navigable DOM representation supporting:
  - `document.getElementById()`, `document.querySelector()`, `document.querySelectorAll()`
  - Element properties: `textContent`, `innerHTML`, `value`, `disabled`, `classList` (`add`, `remove`, `contains`, `toggle`), `style`
  - SVG elements (`circle`, `strokeDashoffset`, `stroke`)
  - Event listeners: `window.addEventListener()`, `document.addEventListener()`
- Executes `<script>` contents in a sandboxed `node:vm` context with global bindings:
  - `window`, `document`, `navigator`, `localStorage`, `setTimeout`, `setInterval`, `clearInterval`
  - `supabase`, `Chart`, `URL.createObjectURL()`, `URL.revokeObjectURL()`, `Blob`

### 4.2 Supabase Mocking Engine (`tests/harness/supabase_mock.js`)
- Replicates `@supabase/supabase-js` v2 query builder:
  - `.from(table)`
  - `.select(cols)`
  - `.eq(col, val)`
  - `.gte(col, val)`
  - `.order(col, { ascending })`
  - `.limit(n)`
- Supports simulated latency, network errors (`error: { message, code }`), empty responses (`data: []`), and table-specific dataset injection.

### 4.3 Chart.js Mocking Engine (`tests/harness/chart_mock.js`)
- Captures all instantiated `new Chart(ctx, config)` calls.
- Exposes:
  - `chart.data.labels`
  - `chart.data.datasets` (values, `backgroundColor`, `borderColor`, `borderDash`, `minBarLength`)
  - `chart.options.plugins.annotation.annotations` (labels, goal lines)
  - `chart.options.plugins.tooltip.callbacks`
  - `chart.destroy()`, `chart.update()`

### 4.4 Service Worker & Cache Mock (`tests/harness/sw_mock.js`)
- Simulates browser Service Worker lifecycle:
  - Evaluates `dashboard/sw.js` in a `ServiceWorkerGlobalScope` sandbox.
  - Event triggers: `install` (captures `event.waitUntil`), `activate`, `fetch` (captures `event.respondWith`).
  - Implements `caches.open()`, `cache.addAll()`, `cache.put()`, `cache.match()`.
  - Simulates offline network condition by disabling standard `fetch()`.

---

## 5. The 4-Tier Test Matrix

### Tier 1: Feature Coverage (>=35 tests, 5 per feature R1–R7)
1. **R1 Dynamic Goals (5 tests)**:
   - T1-R1-01: Fetches latest `metas` row for Nacho (`111111111`) and applies `cal`, `prot`, `carb`, `grasas` to macro cards.
   - T1-R1-02: Updates SVG progress ring targets (`#cal-meta`, `#prot-meta`, `#carb-meta`, `#grasas-meta`) with dynamic goals.
   - T1-R1-03: Updates Donut chart macro percentages using dynamic goals.
   - T1-R1-04: Updates chart goal line annotations (`goalLine` annotation value) with dynamic goals.
   - T1-R1-05: Injects dynamic goals into Gemini AI prompt (`generateAIAnalysis`).
2. **R2 Daily Score Card (5 tests)**:
   - T1-R2-01: Displays Daily Score card container and value element (`#daily-score-val` or equivalent).
   - T1-R2-02: Computes score out of 10 for balanced intake hitting all goals (~10.0 / 10).
   - T1-R2-03: Weights protein more heavily than other macros (protein deficit reduces score significantly).
   - T1-R2-04: Displays adherence badge (e.g. "Excelente", "Muy Bueno", "En Progreso", "Ajustar").
   - T1-R2-05: Updates score when switching users (Nacho vs Mamá).
3. **R3 Best & Worst Day Highlights (5 tests)**:
   - T1-R3-01: Displays Best Day card with date, score, and macro summary.
   - T1-R3-02: Displays Worst Day card with date, score, and macro deviation summary.
   - T1-R3-03: Correctly identifies the highest adherence day in a 7-day period as Best Day.
   - T1-R3-04: Correctly identifies the lowest adherence day in a 7-day period as Worst Day.
   - T1-R3-05: Dynamically recalculates best and worst days when date range changes (7d to 14d).
4. **R4 Missing Day Indicators (5 tests)**:
   - T1-R4-01: Chart X-axis generates contiguous calendar days of length `currentRange` ending at `hoyLogico()`.
   - T1-R4-02: Days with 0 meals are represented as visible empty/gray bars in trend charts.
   - T1-R4-03: Days with 0 meals feature a warning indicator (`⚠️` label or annotation).
   - T1-R4-04: Custom tooltip for missing days indicates unlogged day (`⚠️ Sin comidas registradas`).
   - T1-R4-05: All 4 charts (`chartCal`, `chartProt`, `chartCarb`, `chartGrasas`) apply missing day indicators consistently.
5. **R5 Period-over-Period Comparison (5 tests)**:
   - T1-R5-01: Expands query buffer in `fetchComidas` to at least `currentRange * 2` days.
   - T1-R5-02: Computes percentage delta for calories vs previous equivalent period (`#pop-cal-delta`).
   - T1-R5-03: Computes percentage delta for protein vs previous equivalent period (`#pop-prot-delta`).
   - T1-R5-04: Computes percentage deltas for carbs and fats vs previous equivalent period.
   - T1-R5-05: Renders delta badges inside or alongside `#averages-grid`.
6. **R6 PWA Offline Support & Service Worker (5 tests)**:
   - T1-R6-01: Service worker file `dashboard/sw.js` exists and registers `install` and `fetch` listeners.
   - T1-R6-02: `dashboard/index.html` registers service worker on load (`navigator.serviceWorker.register`).
   - T1-R6-03: Service worker precaches app shell assets (`index.html`, `manifest.json`, CDN scripts).
   - T1-R6-04: Service worker intercepts Supabase REST requests and caches successful 200 responses.
   - T1-R6-05: Displays offline banner (`#offline-banner`) when network status is offline.
7. **R7 CSV Data Export (5 tests)**:
   - T1-R7-01: CSV export button exists in the dashboard UI (`#btn-export-csv` or `exportPeriodCSV`).
   - T1-R7-02: Generates valid CSV header: `Fecha,Comida,Calorías,Proteína (g),Carbohidratos (g),Grasas (g)` (or equivalent).
   - T1-R7-03: Prepend UTF-8 BOM (`\uFEFF`) to CSV content for Excel compatibility.
   - T1-R7-04: Formats downloaded filename as `NutriNacho_<User>_<Range>d_<Date>.csv`.
   - T1-R7-05: Exports all meals within the active date range.

---

### Tier 2: Boundary & Corner Cases (>=35 tests, 5 per feature R1–R7)
1. **R1 Goals Boundaries (5 tests)**:
   - T2-R1-01: Empty `metas` table returns `[]` -> cleanly falls back to `USUARIOS_DEFAULT`.
   - T2-R1-02: Supabase query error/offline -> cleanly falls back to `USUARIOS_DEFAULT` without crashing.
   - T2-R1-03: Partial `metas` row (e.g. `carbohidratos_g` is null) -> merges with fallback default.
   - T2-R1-04: Multiple `metas` rows for same user -> selects newest by `fecha_creacion DESC LIMIT 1`.
   - T2-R1-05: Unknown user ID -> applies fallback safely without undefined property errors.
2. **R2 Daily Score Boundaries (5 tests)**:
   - T2-R2-01: Today has 0 meals logged -> displays `—/10` and "Sin registros hoy" (no false penalty).
   - T2-R2-02: Single meal logged today (partial day) -> calculates proportional score without negative numbers.
   - T2-R2-03: High protein overage (125% of goal) -> maintains optimal score plateau (body recomposition rule).
   - T2-R2-04: Extreme calorie surplus (160% of goal) -> score is penalized, clamped at minimum 0.0.
   - T2-R2-05: Exact 100% adherence across all 4 macros -> outputs perfect `10.0 / 10`.
3. **R3 Best/Worst Days Boundaries (5 tests)**:
   - T3-R3-01: Entire selected period has 0 logged meals -> displays graceful fallback message.
   - T3-R3-02: Exactly 1 day with meals logged in period -> Best Day shows that day, Worst Day indicates insufficient days for comparison.
   - T3-R3-03: Two days tied with identical score -> breaks tie prioritizing higher protein adherence ratio.
   - T3-R3-04: Tied score and tied protein ratio -> breaks tie prioritizing closer calorie adherence.
   - T3-R3-05: Unlogged days (0 meals) -> excluded from Best/Worst candidate ranking (belongs to R4).
4. **R4 Missing Days Boundaries (5 tests)**:
   - T4-R4-01: Entire period has 0 meals -> all bars render as missing stubs with `⚠️`.
   - T4-R4-02: Today has 0 meals -> today's bar renders as missing stub without throwing errors.
   - T4-R4-03: Single missing day between logged days -> correctly identified and positioned chronologically.
   - T4-R4-04: 7-day moving average curve does not plummet to 0 on missing days (interpolates or ignores).
   - T4-R4-05: Nominal missing bar height is subtle (non-zero for visibility, but distinct from real data).
5. **R5 Period Deltas Boundaries (5 tests)**:
   - T5-R5-01: Previous period has 0 meals logged -> avoids `Infinity` / `NaN`, displays `s/d` (sin datos).
   - T5-R5-02: Current period has 0 meals logged -> displays `-100%` or `0 comidas` with neutral styling.
   - T5-R5-03: Both current and previous periods have identical average -> displays `0%` or `→` stable.
   - T5-R5-04: Extreme increase (>100% delta) -> formats cleanly without breaking UI layout.
   - T5-R5-05: Directional color rule: Protein increase is green, protein decrease is red.
6. **R6 PWA Offline Boundaries (5 tests)**:
   - T6-R6-01: Cache fallback when Supabase network throws -> serves last successful cached response.
   - T6-R6-02: Offline indicator toggle: `offline` event displays `#offline-banner`, `online` hides it.
   - T6-R6-03: Reconnecting `online` event automatically re-triggers `loadAll()` to refresh state.
   - T6-R6-04: Gemini AI request while offline -> catches error and displays friendly offline warning.
   - T6-R6-05: Manifest validation: `display: "standalone"`, `theme_color: "#0f172a"`, valid start URL.
7. **R7 CSV Export Boundaries (5 tests)**:
   - T7-R7-01: Meal names containing commas -> properly wrapped in double quotes per RFC 4180.
   - T7-R7-02: Meal names containing double quotes -> escaped as `""`.
   - T7-R7-03: Meal names containing Spanish accented characters (á, é, í, ó, ú, ñ) -> preserved via UTF-8 BOM.
   - T7-R7-04: Exporting period with 0 meals -> downloads valid CSV with header row only or displays friendly notice.
   - T7-R7-05: User name with accents (Mamá) -> sanitized in filename (`NutriNacho_Mama_...`).
8. **Layout & Viewport Boundary (Additional)**:
   - TB-CSS-01: Viewport at 320px width has zero horizontal overflow (`scrollWidth <= clientWidth`).

---

### Tier 3: Cross-Feature Combinations (>=7 tests)
1. **T3-XF-01**: User switching (Nacho ↔ Mamá) triggers dynamic goal fetch, updates macro rings, and recalculates Daily Score.
2. **T3-XF-02**: Range switching (7d -> 14d -> 30d) updates charts, regenerates contiguous calendar with missing days, and recalculates period deltas.
3. **T3-XF-03**: Offline mode simulation: cached dynamic goals and cached meals load successfully, displaying the offline banner with active dynamic goals.
4. **T3-XF-04**: CSV export of a period containing unlogged/missing days exports only actual logged meals without inserting phantom zero rows.
5. **T3-XF-05**: Dynamic goals update reflects simultaneously across Daily Score, Best/Worst adherence evaluation, and Chart target lines.
6. **T3-XF-06**: Rapid user switching (Nacho -> Mamá -> Nacho) avoids race conditions; active state strictly corresponds to `currentUser`.
7. **T3-XF-07**: Period buffer expansion: switching to 30d range queries 67+ days, enabling full 30d period comparison against the preceding 30 days.

---

### Tier 4: Real-World Application Scenarios (>=5 tests)
1. **T4-RW-01 (Nacho Full Day)**: Nacho logs 4 balanced meals throughout the day hitting 2280 kcal and 188g protein. Daily score reflects high rating (>= 9.0), progress rings close to 100%, and streak advances.
2. **T4-RW-02 (Mamá Gap Days Journey)**: Mamá logs meals on Monday and Thursday but forgets Tuesday, Wednesday, Friday, Saturday, Sunday. Charts show 5 missing gray bars with ⚠️; Period deltas calculate averages based on logged days; Daily score shows `—/10` if today is unlogged.
3. **T4-RW-03 (Range Switch & CSV Export Journey)**: User inspects 7d trend, switches range to 14d, inspects Best and Worst days for 14d, then clicks Export CSV. Exported file contains all 14d meals, filename specifies `14d`, and character encoding is pristine.
4. **T4-RW-04 (Auto-Refresh State Preservation)**: User navigates past meal dates (`mealDayOffset = -2`). 30-second `setInterval(loadAll, 30000)` executes. Dashboard refreshes data without resetting user's selected past day back to today.
5. **T4-RW-05 (Complete Offline & Reconnection Journey)**: User opens dashboard online -> data cached -> network disconnects -> user navigates ranges -> offline banner displays cached data -> network reconnects -> live data automatically refetched and banner disappears.

---

## 6. Authoritative Expected Output Derivation

All expected values are derived from:
1. `ORIGINAL_REQUEST.md` (authoritative specification of R1–R7, weights, layouts, filenames).
2. `PROJECT.md` (interface contracts, mathematical score weights: 40% protein, 30% calories, 15% carbs, 15% fats; period-over-period windows; CSV RFC 4180 BOM).
3. The baseline production code `dashboard/index.html` (existing element IDs, utility functions `fechaLogica`, `hoyLogico`, `formatDate`, `diffLabel`, `setRing`).
4. Live Supabase database telemetry (Nacho ID `111111111`, Mamá ID `222222222`, `metas` schema, `comidas` schema).
