# Elewana Dashboard — Metrics Dictionary

This document catalogs every metric computed anywhere in the dashboard: its definition, exact
formula, data source, filters/exclusions applied, known caveats, and the decision history behind
it (dates, prior bugs fixed, business-team confirmations). It exists so metric logic is looked up
once here rather than re-derived from scattered code comments each time.

**Scope:** every view/tab (Exec Summary, Sales Executive Summary, Pace, Occupancy, Trade
Partners/Agents, Market Segment Performance, Property Performance, Pipeline/P&L, Consultants,
Booking Status Movement, Daily, Finance/Sand River) plus the Agent/Property/Market-Segment profile
drill-downs — including metrics not currently surfaced on the Sales Executive Summary page.

**How to keep this current:** when a metric's formula, exclusions, or caveats change, update the
relevant section here in the same commit/PR that changes the code. Treat a stale entry here as a
bug — this file is meant to be authoritative, not historical.

---

## 1. Shared conventions (apply across almost every metric below)

### 1.1 Status codes (`reservations.status`)

Confirmed with the business team (2026-07-02 audit) — this is the single most consequential
convention in the app; getting it wrong previously inflated revenue figures by ~135%.

| Code | Meaning | Use in revenue metrics? |
|---|---|---|
| `'0'` | New inquiry | Never |
| `'10'` | Quote | Never |
| `'20'` | Provisional (on hold) | Only for pipeline/forward-booking/agent-activity metrics, never for actual revenue |
| `'30'` | Confirmed | **The only status for actual revenue, ADR, completed-stay metrics** |
| `'90'` | Cancelled/Archived | **Never** in any revenue metric — 58,580 records / ~$564M at risk if included |

- Past stays / YTD revenue / ADR: `status = '30'` only.
- Active/forward bookings, pipeline, agent activity: `status IN ('20','30')`.
- Never `IN ('20','30','90')` or `IN ('30','90')` for a revenue metric.
- **2026-07-06 audit** found 8 live locations still blending in `'20'` for what should have been
  confirmed-only revenue (e.g. Agent Room Revenue was $36.4M including provisional, $33.5M
  confirmed-only) — fixed; if a revenue figure looks ~5-10% too high, this mixing is the first
  thing to check.

### 1.2 Room Revenue vs Extras Revenue (critical distinction)

**Extras are ADDITIVE — never included in `reservations.total_amount` or
`itineraries.total_gross_amount`.** Investigation (active reservations, `status IN ('20','30')`):
`avg_res_total ≈ avg_itin_total` (Room Revenue only); `avg_extras_total` is a separate ~$6,211/res
average on top. 85.4% of active reservations carry extras; ~$159M total extras revenue at the time
of the 2026-07-02 audit. Never sum "Room Revenue" and "Extras Revenue" together and present it as
one already-combined total — they are reported as two distinct, additive streams everywhere in
this app.

**Room Revenue / Extras split is component-level, not table-level** (rebuilt 2026-07-08/09,
`src/lib/roomRevenue.ts`): every reservation joins `rate_components` (via `itineraries`), and each
component row is classified Room Revenue vs Extras vs an excluded pass-through fee by
`component_description`, using a **per-property-region classification map** (source: Faith's
`room_revenue_components.csv`, 8 July 2026 audit) — Kenya properties, Tanzania-mainland properties,
and "Serengeti Explorer style" properties each have their own component list
(`KENYA_ROOM_REVENUE_COMPONENTS`, `TANZANIA_MAINLAND_ROOM_REVENUE_COMPONENTS`,
`SERENGETI_EXPLORER_STYLE_ROOM_REVENUE_COMPONENTS`), falling back to
`DEFAULT_ROOM_REVENUE_COMPONENTS` for anything else (`src/lib/constants.ts`). Components matching
`EXCLUDED_FEE_COMPONENTS` (Conservation Fee, Park Fees, etc.) are neither Room Revenue nor Extras —
excluded from both.

There is also a **separate `extras` table** (distinct from `rate_components`) holding genuine
ancillary revenue (Activities, F&B, Beverage, Spa, Transfers) — see `EXTRAS_TABLE_REVENUE_CATEGORY_IDS`
in constants.ts for which categories are confirmed clean. A row counts as extras-table revenue if
it's a **Day Use leg** (any category) or tagged with one of the confirmed-clean categories
(2026-07-13 fix broadened this beyond Day Use only). **Currency gotcha:** `extras.currency` stores
long text labels ("Kenya Shilling", "US Dollars", not short codes) — currency conversion must check
the joined `rate_types.currency` (short codes) instead, or KES/TZS extras silently skip conversion.

**Day Use** (ACL/Kilindi etc.) is `$0` in `rate_components` — its real money lives entirely in the
`extras` table (2026-07-08 rebuild finding). A Day Use property showing `$0` Room Revenue is
expected, not a bug — check Extras Revenue instead.

### 1.3 Currency conversion

`KES_USD_RATE = 129` (hardcoded, `src/lib/constants.ts`). Any amount where the joined
`rate_types.currency` (or, for the `extras` table specifically, still `rate_types.currency` — see
1.2's currency gotcha) is `'KES'` is divided by 129; everything else (assumed USD) passes through
unconverted. No live FX feed — a fixed rate, revisit if this becomes materially wrong.

### 1.4 Exclusion lists (apply to nearly every agent-scoped and revenue metric)

From `src/lib/constants.ts`:
- **`EXCLUDED_AGENT_IDS`**: `'0'` (system placeholder / walk-ins/unassigned), `'WB51589'`
  ("Elewana Travel (Test)" test account), plus others added as discovered (e.g. "Elewana Staff*"
  WB19, found during the 2026-07-09 Low-Season Occupancy Lift build).
- **`EXCLUDED_AGENT_NAME_PATTERN`**: `'%direct%'` (case-insensitive) — filters out direct-booking
  placeholder "agents." Has documented **carve-outs** (`AGENT_NAME_PATTERN_CARVEOUT_IDS`) for real
  trade partners whose name coincidentally contains "direct," confirmed against the segment
  mapping CSV — these must NOT be excluded despite matching the pattern.
  "Elewana Travel Limited" / "Elewana Travel Ltd Kenya" are Elewana's own confirmed-legitimate
  entities and are NOT excluded despite being Elewana-owned.
- **`EXCLUDED_RESERVATION_PREFIX`**: `'PA%'` — reservation numbers with this prefix are excluded
  (`reservation_number NOT LIKE 'PA%'`).
- **`NON_REVENUE_RATE_TYPE_IDS`**: Complimentary and FAM Stay rate types (both USD and KES
  variants) — excluded from revenue-bearing metrics (used as `r.rate_type NOT IN (...)`).
- **`EAR_RESIDENT_RATE_TYPE_IDS`**: East Africa Resident rate types — used to carve out a
  resident-specific ADR view where relevant (`r.rate_type IN (...)` for the resident-only branch).
- A separate **booking-COUNT filter** exists (constants.ts, distinct from the revenue/ADR exclusion
  logic above) — do not conflate the two; a metric counting *bookings* may use different exclusions
  than one summing *revenue*.

### 1.5 Property known-gaps / caveats registry

- **Little Elephant Pepper Camp (LEPC)** — `propertyId: null` in `PROPERTY_ROOM_COUNTS`
  (`src/lib/constants.ts`): no `properties.property_id` row exists yet (mid-construction, reopens
  1 June 2026). Excluded from the Property filter dropdown and from every property count/list
  everywhere (`Object.values(PROPERTY_ROOM_COUNTS).filter(c => c.propertyId !== null)`, currently
  17 of 18 properties). `$0` here is correct, not a data gap.
- **Ngorongoro Explorer (NXR)** — pre-opening, not operational until 1 May 2027; `$0`/null RevPAR
  is correct (`PROPERTY_REVPAR_CAVEATS`, `src/lib/constants.ts`).
  Excluded from any 2026 capacity calc.
- **Lewa Safari Camp (LSC)** — closed for refurbishment part of 2026 (reopens 1 June); its
  `roomnightsAvailable` figure in `PROPERTY_ROOM_COUNTS` is the untouched typical-year number, NOT
  adjusted for the closure — treat any capacity-denominator metric for this property as
  directional only (`PROPERTY_REVPAR_CAVEATS`).
- **Afrochic (WB639)** — the 2026 budget source file has `$0`/0 for all 12 months for this
  property, contradicting an earlier expectation of real budget data. Reported as-is (known,
  unresolved gap) — still included in `budget2026Monthly.json` so a corrected file drops in without
  a mapping change (`src/lib/budget.ts`).
- **Cheli & Peacock Safaris (RS23) vs WB133564** — RS23 (Kenya) was wrongly excluded as a
  "duplicate" of WB133564 (Tanzania); fixed 2026-07-09, restoring +$5.39M Agent Room Revenue. If an
  agent-dedup rule ever needs re-adding, check this history first.

### 1.6 Market Segment / Channel classification

Source: Faith's "Market Segment and Source Codes" CSV, confirmed 2026-07-13
(`src/lib/agentSegments.ts`, static snapshot at `src/data/agentSegments.json`, keyed by
lowercased/trimmed agent name — ResRequest has no `agent_id` column in the source CSV).

- **Market Segment** (9 values): `INT. AGENT`, `DMC`, `DMC (International Presence)`,
  `INT. DIRECT`, `LOCAL DIRECT`, `CLOSED USER GROUPS`, `DIGITAL`, `STAFF STAYS`, `Unallocated`.
  Uses the CSV's **"New Market Segment"** column, not the older "Market Segment" column.
- **Channel** (4 values): `B2B`, `B2C`, `NON REVENUE SEGMENTS`, `Unallocated`.
- **`Unallocated`** is a first-class, real value — ~30% of agents have it (blank CSV cell, or the
  agent isn't in the CSV at all) — never hidden, defaulted, or guessed into a real segment.
- SQL filtering by segment/channel is done by an `IN`/`NOT IN` list of literal agent names compiled
  from the static JSON at request time (`buildAgentFilterSql`) — not a live join, since the CSV has
  no agent_id.

### 1.7 Date-range convention

All date-range filters use **sargable** predicates (`col >= 'Y-M-01' AND col < 'first day after
range'`) rather than `YEAR(col)=? AND MONTH(col) BETWEEN ?` — the latter prevents MySQL from using
an index on the column (fixed 2026-07-09, `src/lib/dateRange.ts`). If you see a new date filter
written as `YEAR(...)`/`MONTH(...)`, that's a regression to flag.

### 1.8 Budget source

2026 monthly Budget (Room Nights / Revenue / ADR) per property, loaded from
`src/data/budget2026Monthly.json` (`src/lib/budget.ts`), confirmed 2026-07-13 against the source
file's own EC Group total ($39,926,885 Budget Room Revenue / 40,021 Budget Room Nights, matching to
rounding). **2026 only** — any other year returns `{rns: 0, rev: 0}` rather than silently reusing
2026 figures.

---

## Table of contents

1. [Shared conventions](#1-shared-conventions-apply-across-almost-every-metric-below)
2. [Exec Summary & Pace](#2-exec-summary--pace--room-revenue--occupancy--adr--revpar--pace--budget--forecast)
3. [Occupancy tab & Property Performance tab](#3-occupancy-tab--property-performance-tab)
4. [Trade Partners/Agents & Market Segment Performance](#4-trade-partnersagents--market-segment-performance)
5. [Pipeline/P&L & Consultants](#5-pipelinepl--consultants)
6. [Booking Status Movement, Cancellation Drivers & Low Season Agents](#6-booking-status-movement-cancellation-drivers--low-season-agents)
7. [Daily Tab & Non-Revenue API](#7-daily-tab--non-revenue-api)
8. [Finance Tab (Sand River Property)](#8-finance-tab-sand-river-property)
9. [Drill-down / Profile API routes](#9-drill-down--profile-api-routes)
10. [Audit findings — inconsistencies discovered while building this dictionary](#10-audit-findings--inconsistencies-discovered-while-building-this-dictionary)

---

## 2. Exec Summary & Pace — Room Revenue / Occupancy / ADR / RevPAR / Pace / Budget / Forecast

**Reuse note:** `KP_BASE`, `REVPAR`, `FORECAST`, and `KP_BASE.execPace` (built once in `route.ts`) feed three consumers: the Exec Summary tab (`ExecSummaryView.tsx`), the Pace tab (`PaceView.tsx`), and the standalone Sales Executive Summary page (`SalesExecutiveSummaryDesign.tsx` + its narrative, `src/lib/execNarrative.ts`). The narrative's own descriptor thresholds/wording are out of scope here (see execNarrative.ts directly) but it reads the exact same `KP_BASE.pace.budgetMtd/budgetYtd`, `KP_BASE.execPace.vsBudget`, `KP_BASE.occ.occPct/adr`, and `AGENT_PACE.gainers/decliners` fields documented below — no separate derivation.

### Room Revenue & Occupancy KPIs

#### Total Room Revenue
- **Definition:** Confirmed Room Revenue (Room-Revenue-only, per §1.2) for completed/actualized stays in the selected year/period.
- **Formula:** `revM = kpiRevNights.rev_raw / 1e6`. SQL: `rev_raw` via `ROOM_REVENUE_SUM_SQL` (component-level CASE classification, KES÷129 for `dt.currency='KES'`) over `itineraries i JOIN reservations r JOIN rate_components rc`, scoped to `i.date_in` in the selected year/month range AND `i.date_out <= CURDATE()` (actualized only).
- **Source:** `kpiRevNights` query (route.ts ~L857-886). Tables: `reservations`, `itineraries`, `rate_components`, `rate_types`.
- **Filters/exclusions:** `r.status = '30'` only (§1.1). `r.rate_type NOT IN NON_REVENUE_RATE_TYPE_IDS`, `reservation_number NOT LIKE 'PA%'` (§1.4). Property filter (`AND_P`) applied when a property is selected. No agent/channel/market filter (portfolio-wide).
- **Where shown:** Exec Summary (`kp.occ.rev`, labeled "Room Revenue (Actualized)" locally — see caveat), Pace tab indirectly via `KP_BASE.pace.rev` (same `revM` value, different label "Revenue on Books"), Sales Exec Summary KPI row.
- **Caveats/gaps:** `OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY = true` (constants.ts) — this figure is completed-stays-only, NOT full-year total (unlike `kpiTotalRevFullYear`, a separate denominator used elsewhere for Trade Partners' "% of total"). ExecSummaryView explicitly relabels it "Room Revenue (Actualized)" with caption "Stays already occurred — not full-year" specifically so it doesn't get compared apples-to-oranges against Agent Room Revenue (which includes forward-confirmed bookings) — code comment: "same honest-labeling pattern as AgentProfilePanel's 'Actualized, partial year' notes."
- **Decision history:** Room Revenue/Extras component split rebuilt 2026-07-08 (see §1.2, `project_room_revenue_extras_rebuild.md`). Day Use nights gap fix 2026-07-13. Extras-table revenue broadening 2026-07-13.

#### Revenue on Books
- **Definition:** Same underlying number as Total Room Revenue above (`revM`), relabeled for the Pace tab's KPI row.
- **Formula:** Identical to Total Room Revenue — `kpi(revM, '$M', 'Revenue on Books', ...)`.
- **Source:** `kpiRevNights` (same query, reused variable, not a second query).
- **Filters/exclusions:** Same as Total Room Revenue.
- **Where shown:** Pace tab (`kp.rev` in `KpiRow metrics={[kp.bookings, kp.rev, kp.idx, kp.lead]}`).
- **Caveats/gaps:** Despite the different label/caption ("YTD {cy}"), this is the SAME actualized-stays-only figure as Total Room Revenue, not a distinct "on the books" (confirmed forward+actual) total — a reader could reasonably expect "Revenue on Books" to include future confirmed bookings, but it does not.
- **Decision history:** None specific beyond the shared kpiRevNights history above.

#### Room Nights Sold
- **Definition:** Total nights stayed (confirmed, actualized), including Day Use "nights" (1 per leg, per Qlik convention).
- **Formula:** `totalNights = kpiRevNights.total_nights + kpiRevNights.day_use_nights`. `total_nights` = `SUM(GREATEST(DATEDIFF(date_out,date_in),0))` over actualized itineraries; `day_use_nights` = `COUNT(DISTINCT itinerary_id)` where `dayUseLegCase` is true (Day Use legs carry `date_in=date_out`, i.e. 0 under DATEDIFF, but count as 1 sold night).
- **Source:** `kpiRevNights` query, `nights` and `dayuse` subqueries.
- **Filters/exclusions:** `status='30'`, actualized (`date_out <= CURDATE()`), standard rate-type/PA-prefix exclusions (§1.4), property filter applied.
- **Where shown:** Exec Summary KPI row (`kp.occ.nights`), Pace tab indirectly, Property Performance, Sales Exec Summary.
- **Caveats/gaps:** Day Use nights fix confirmed live 2026-07-13 as ~29% of a 10,672-night gap vs Qlik's Trade Partner Scorecard.
- **Decision history:** 2026-07-13 Day Use nights gap fix (code comment + `project_room_revenue_extras_rebuild.md`).

#### Avg Daily Rate (ADR)
- **Definition:** Room-Revenue-only average nightly rate (Extras excluded, per hospitality convention).
- **Formula:** `adr = ROUND(rev.rev_raw / GREATEST(nights.total_nights, 1))` — computed in SQL, **against the pre-Day-Use-fix `nights.total_nights`** (not the JS-merged `totalNights` that adds `day_use_nights`).
- **Source:** `kpiRevNights` query (the `adr` column, computed inside the SQL itself, not in JS assembly).
- **Filters/exclusions:** Same population as Room Nights Sold/Total Room Revenue (`status='30'`, actualized).
- **Where shown:** Exec Summary (`kp.occ.adr`, MiniStat "ADR" card), Pace tab indirectly.
- **Caveats/gaps:** Code comment explicitly flags: "Day Use nights gap... does NOT affect `adr`, which is computed inside SQL against the pre-fix `nights.total_nights` only." This means ADR's denominator is slightly smaller than the Room Nights Sold KPI card's own denominator shown right next to it on the same dashboard — a deliberate, documented inconsistency (Day Use rooms have $0 Room Revenue per §1.2, so including them in ADR's denominator would understate ADR).
- **Decision history:** Room Revenue/Extras split 2026-07-08; explicitly preserved unchanged during the 2026-07-13 Day Use nights fix.

#### Extras Revenue
- **Definition:** Additive ancillary revenue (F&B, activities, transfers, Day Use charges) — never blended into Room Revenue (§1.2).
- **Formula:** `extrasM = (kpiRevNights.extras_raw + kpiRevNights.extras_table_revenue) / 1e6`. `extras_raw` = `EXTRAS_SUM_SQL` (rate_components rows NOT classified Room Revenue and NOT an excluded fee); `extras_table_revenue` = `extrasTableRevenueSumSql` over the separate `extras` table (Day Use legs, any category, + confirmed-clean categories per `EXTRAS_TABLE_REVENUE_CATEGORY_IDS`).
- **Source:** `kpiRevNights` query, `rev` and `dayuse` subqueries.
- **Filters/exclusions:** Same population as Total Room Revenue. Currency conversion checks `rate_types.currency` per the §1.2/§1.3 currency gotcha.
- **Where shown:** Exec Summary KP_BASE.occ.extras (not directly on ExecSummaryView's cards currently, but part of KP_BASE), Property Performance.
- **Caveats/gaps:** Thresholds (`thG:8, thY:5`) flagged in code as "placeholder round numbers, not yet calibrated against a full year of live Extras figures."
- **Decision history:** Rebuilt 2026-07-08 (component-level split), broadened 2026-07-13 (extras-table revenue beyond Day Use only) — see `project_room_revenue_extras_rebuild.md`.

#### RevPAR (portfolio-wide)
- **Definition:** Revenue per available room-night, aggregated across a defined "clean" 15-property subset of the portfolio (excludes properties with capacity caveats).
- **Formula:** `portfolioRevpar = portfolioRevenueSum / portfolioAvailableSum`, where `portfolioRevenueSum = Σ actualByPropMap.get(propertyId)` and `portfolioAvailableSum = Σ cap.roomnightsAvailable` (Dennis-confirmed annual capacity, `PROPERTY_ROOM_COUNTS`), summed over every property in `PROPERTY_ROOM_COUNTS` EXCEPT ones with `!cap.propertyId` (LEPC) or in `PORTFOLIO_AGG_EXCLUDE_IDS = {WB146935 (NXR), WB37957 (LSC)}`.
- **Source:** `budgetActualByPropRows` (Room Revenue by property, full-year 2026 fixed) + `revparNightsRows` (sold nights by property, full-year 2026 fixed) + `PROPERTY_ROOM_COUNTS` (static capacity).
- **Filters/exclusions:** `status='30'`, full-year 2026 hardcoded (NOT the selected year/period — see caveat), `i.date_out > i.date_in`, standard rate-type/PA exclusions. **No property-level `AND_P` filter on the underlying queries** — when a single property is selected, the code recomputes from the SAME maps scoped to that one property (`selectedCap`) rather than re-querying.
- **Where shown:** Exec Summary (`kp.occ.revpar`, MiniStat "RevPAR"), Pace tab indirectly, Sales Exec Summary.
- **Caveats/gaps:** **Full-year-2026-only, period-invariant** — does not respect the MTD/YTD/Annual toggle at all (code comment: "neither respects the Topbar's MTD/YTD toggle"). No YoY comparator exists (`kpi()` called with no `ly` argument) — "no genuine per-property-capacity query exists for a prior year yet, so no YoY badge rather than a fabricated one." Excludes NXR (pre-opening) and LSC (refurb, capacity figure not adjusted for closure) per §1.5.
- **Decision history:** Added 2026-07-14d (RevPAR by property) as a nights-only query specifically to avoid a fan-out bug: "joining rate_components in the same query as a nights SUM multiplies nights by however many revenue components each itinerary leg has, inflating 'sold nights' 4-7x" — caught during feasibility testing. Portfolio-wide aggregate added 2026-07-15 for the Sales Executive Summary KPI row.

#### RevPAR (by property)
- **Definition:** Same RevPAR formula, per-property (not aggregated), for the property drill-down / Property Performance table.
- **Formula:** `revpar = roomRevenue / availableNights` per property; `adr = roomRevenue / soldNights` (property-level ADR, distinct calc from the portfolio ADR above); `occPct = (soldNights / availableNights) * 100`.
- **Source:** `revparByProperty` (built from `actualByPropMap`/`revparNightsMap`, same source queries as portfolio RevPAR above), iterated over all of `PROPERTY_ROOM_COUNTS` (18 properties, not just the clean 15).
- **Filters/exclusions:** Same as portfolio RevPAR.
- **Where shown:** `REVPAR.byProperty` — Property Performance tab primarily; not directly rendered in ExecSummaryView/PaceView's own cards, but part of the `exec-summary`/`pace` view's fetched data.
- **Caveats/gaps:** Explicit per-property `caveat` field carried through for LEPC ("No property record exists yet"), NXR/LSC (pre-opening / refurb capacity-not-adjusted) — never silently hidden, per §1.5.
- **Decision history:** 2026-07-14d.

#### Occupancy %
- **Definition:** Portfolio-wide (or single-property) sold-nights ÷ available-nights, expressed as a percentage, with a Budget-derived comparator (NOT a YoY comparator).
- **Formula:** `portfolioOccPct = (portfolioSoldSum / portfolioAvailableSum) * 100`. Budget side: `portfolioOccPctBudget = (occBudgetRns / availableSum) * 100`, where `occBudgetRns` is `getPortfolioBudget(cy,1,12).rns` (or `getPropertyBudget` if a property is selected) — derived, not a dedicated field in the budget file (§1.8 has no native occupancy-target column).
- **Source:** Same `actualByPropMap`/`revparNightsMap`/`PROPERTY_ROOM_COUNTS` as RevPAR, plus `src/lib/budget.ts`.
- **Filters/exclusions:** Same population/exclusion set as portfolio RevPAR (full-year-2026, 15/18-property scoping).
- **Where shown:** Exec Summary KPI row (`kp.occ.occPct`).
- **Caveats/gaps:** The `ly` slot on this metric is actually a **Budget** value, not a real prior year (`budget: true` flag tells `KpiRow`/`budgetVariance` to render "BUDGET" instead of "vs LY" — same convention as `pace.budgetMtd/budgetYtd`). Period-invariant (full-year 2026 only), same as RevPAR.
- **Decision history:** 2026-07-15 (portfolio aggregate for Sales Exec Summary KPI row); Occupancy vs Budget derivation added 2026-07-16.

#### Cancellation Rate
- **Definition:** Share of reservations that ended up Cancelled (status 90) out of all inquiry-through-cancelled records, for the selected period.
- **Formula:** `cancelRate = safePct(cancelledCt, cancelTotalCt)` where `cancelledCt = COUNT(status='90')`, `cancelTotalCt = COUNT(status IN ('20','30','90'))`.
- **Source:** `kpiCancel` / `kpiCancelLy` queries, over `reservations` directly (no itinerary join — semi-join-safe per the `AND_P_RESV` fragment note in route.ts).
- **Filters/exclusions:** Faith-confirmed methodology. Date basis is `date_created` (booking-intake), NOT `i.date_in` — code comment flags this as a deliberate choice since "a cancelled reservation has no meaningful 'stay' to anchor on," explicitly inviting correction ("correct me if a different date field was intended").
- **Where shown:** `KP_BASE.occ.cancel` — not directly on ExecSummaryView/PaceView cards, but part of the shared KP_BASE object both views receive.
- **Caveats/gaps:** Standard calendar YoY (not STLY) since this metric has a real calendar year to compare against.
- **Decision history:** Faith-confirmed methodology (status codes per §1.1).

### Pace & Budget Attainment

#### Confirmed Bookings (Pace tab)
- **Definition:** Count of confirmed bookings with a future arrival date, in a bounded 1-year forward window, compared against the same bounded window exactly one year prior (STLY).
- **Formula:** `confirmedBkgsBounded = COUNT(DISTINCT reservation_number)` where `status='30' AND i.date_in > CURDATE() AND i.date_in <= CURDATE()+1YR`. STLY counterpart (`kpiConfirmedStly`) is the same shape shifted back exactly one year: `i.date_in > CURDATE()-1YR AND i.date_in <= CURDATE()`.
- **Source:** `kpiConfirmedBounded`, `kpiConfirmedStly`.
- **Filters/exclusions:** Standard rate-type/PA exclusions (§1.4), `r.total_amount > 0`, property filter applied.
- **Where shown:** Pace tab (`kp.bookings`).
- **Caveats/gaps:** Deliberately NOT the same as `kpiConfirmed` (used for Pace Index/Conversion Rate elsewhere) — code comment explains an earlier open-ended STLY lookback was tested and rejected: "status='30' never expires (unlike Provisional, which self-resolves), so it swept up an entire extra year of now-past confirmed bookings... a -68% 'delta' that was a measurement artifact, not a real signal." The bounded-symmetric-window fix corrected this.
  **CONFIRMED INTENTIONAL, not a bug (2026-07-17)** — a client flagged that this KPI's variance (-56.3% vs STLY, live) diverges sharply from Pace Index's own variance (-12.9% vs LY, same tab, same moment) and asked whether one was broken. Investigation found the gap is NOT primarily the status-set mismatch documented in §10.3/below (isolated live: Provisional bookings are <1% of Pace Index's LY denominator for a fully-elapsed prior period, so that mismatch contributes almost nothing here). The **actual, dominant driver is the two metrics using structurally different date-window SHAPES on purpose**: this KPI is a rolling, today-relative 12-month window (forward pipeline momentum); Pace Index (below) is a fixed calendar-period window (this year's Jan-through-current-month vs the same months last year). A same-length-window check confirmed this directly: the identical status='30'-only population over a fixed 7-month span (5,100 bookings) vs a rolling 12-month span (9,693 bookings) — nearly 2x from window length/seasonality alone, no status difference involved. **Decision: do NOT unify the two conventions** — forcing this KPI onto Pace Index's calendar-window basis would either break its forward-pipeline meaning or reintroduce the exact rejected -68% artifact above (a calendar "current year" window is mostly already-elapsed by mid-year, same failure mode). Both are correct, deliberately different lenses on booking momentum; a large gap between them is expected, not a signal of a bug. A caption ("vs STLY (rolling 12mo)") and tooltip now state this explicitly on the card itself.
- **Decision history:** Fix documented inline in route.ts (undated in-code, but part of the STLY-basis rework referenced by `kpiForecastPace`/`kpiConfirmedStly` comments, 2026-07-14 era). Re-investigated and confirmed intentional 2026-07-17 (client question); no calculation changed, caption/tooltip added.

#### Pace Index
- **Definition:** Ratio of this-year confirmed bookings to last-year confirmed bookings for the same period, expressed as a "100 = last year" index.
- **Formula:** `paceIdx = (confirmedBkgs / lyBkgs) * 100`, rounded to 1 decimal. `confirmedBkgs` = `kpiConfirmed` (unbounded future-dated confirmed count); `lyBkgs` = `kpiLyBkgs.cnt` (status IN ('20','30'), prior-year same period, `|| 1` floor guard against divide-by-zero).
- **Source:** `kpiConfirmed`, `kpiLyBkgs`.
- **Filters/exclusions:** `kpiConfirmed`: `status='30'`, `i.date_in > CURDATE()`, `r.total_amount > 0`, standard exclusions. `kpiLyBkgs`: `status IN ('20','30')` — note this denominator INCLUDES Provisional, a genuine asymmetry vs. the numerator's confirmed-only population (not flagged as a bug in-code, but worth noting as a basis mismatch between numerator and denominator — see §10.3).
- **Where shown:** Pace tab (`kp.idx`), also reused as-is for `KP_BASE.execPace.vsStly` on the Sales Exec Summary ("same number... not a new query," per code comment).
- **Caveats/gaps:** The numerator/denominator status-set mismatch (30-only vs 20+30) noted above is now flagged (§10.3 was the original finding; see this same tab's Confirmed Bookings entry above for the fuller 2026-07-17 investigation and why it's intentional, not a bug). In practice this status-set piece is a minor contributor — the bigger, equally intentional difference is that this metric uses a fixed calendar-period window (this year's selected months vs the same months last year), while Confirmed Bookings alongside it uses a rolling, today-relative 12-month window; the two are not meant to reconcile. A caption ("100 = last year (same months)") and tooltip now state this explicitly on the card itself.
- **Decision history:** Reused directly for `EXEC_PACE.vsStly` (2026-07-15). Re-investigated alongside Confirmed Bookings 2026-07-17 (client question); no calculation changed, caption/tooltip added.

#### Avg Lead Time
- **Definition:** Average number of days between booking creation and stay arrival.
- **Formula:** `avgLead = ROUND(AVG(DATEDIFF(i.date_in, r.date_created)))`, defaulting to 120 if null (`i(kpiLead?.avg_lead) || 120`).
- **Source:** `kpiLead` / `kpiLeadLy`.
- **Filters/exclusions:** `status IN ('20','30')`, `i.date_in > r.date_created`, date-range on `r.date_created`, standard rate-type/PA exclusions.
- **Where shown:** Pace tab (`kp.lead`).
- **Caveats/gaps:** Code comment: "biased toward multi-leg reservations (each leg contributes one data point to the AVG with a different date_in)... not fixed here, as it requires a MIN(date_in) dedup that changes the query shape" — a known, deliberately-deferred data-quality issue.
- **Decision history:** Logged as a lower-priority open item in-code, not yet fixed.

#### MTD vs Budget / YTD vs Budget
- **Definition:** Actual confirmed Room Revenue for the real current month (MTD) or Jan-through-real-current-month (YTD) vs. the 2026 monthly budget file's target for the same span.
- **Formula:** `mtdActualRevM = kpiBudgetActual.mtd_rev / 1e6`; `ytdActualRevM = kpiBudgetActual.ytd_rev / 1e6`. Budget side: `getPortfolioBudget(cy, realCurrentMonth, realCurrentMonth)` (or `getPropertyBudget` if a property is selected) for MTD; `getPortfolioBudget(cy, 1, realCurrentMonth)` for YTD (§1.8).
- **Source:** `kpiBudgetActual` query + `src/lib/budget.ts`.
- **Filters/exclusions:** `status='30'`, Room-Revenue-only (`ROOM_REVENUE_CASE`), standard exclusions. **Deliberately NOT actualized-stays-only** — code comment: "a budget target is compared against everything confirmed for that period, not just completed stays" (contrast with `kpiRevNights`'s actualized restriction). Anchored to `realCurrentMonth`/`realCurrentYear` (today), NOT the selected year/period filter — "'vs Budget' is inherently 'how are we doing right now,' not a re-sliceable historical view."
- **Where shown:** Exec Summary ("Actual vs Budget" mini-stat card, MTD/YTD), Pace tab (Forecast card's `budgetMtd`/`budgetYtd` mini-stat row), Sales Exec Summary narrative sentence 1 (`execNarrative.ts`).
- **Caveats/gaps:** Budget file is 2026-only — any other selected year still computes this comparison but shows $0 budget (§1.8). Property selection narrows BOTH sides (actual via `AND_P`, budget via `getPropertyBudget`) — code flags this as "decision #3, 'no exceptions'": once one side is scoped to a property, the other must match or the comparison silently becomes property-actual-vs-portfolio-budget.
- **Decision history:** Added 2026-07-13.

#### Pace vs Budget %
- **Definition:** Single ratio expressing YTD actual revenue as a percentage of YTD budget revenue (100 = exactly on budget).
- **Formula:** `execPaceVsBudgetPct = (ytdActualRevM / ytdBudgetRevM) * 100` (0 if no budget).
- **Source:** Same `kpiBudgetActual`/`budget.ts` inputs as YTD vs Budget above — "same inputs as pace.budgetYtd, just expressed as a single ratio instead of a $ figure + badge."
- **Filters/exclusions:** Identical to MTD/YTD vs Budget.
- **Where shown:** Exec Summary ("Pace %" mini-stat, "vs Forecast"/"vs STLY" card group — actually this is `vsBudget`, shown in the 4-card KPI row as `kp.execPace.vsBudget`), Sales Exec Summary narrative sentence 1.
- **Caveats/gaps:** None beyond those already listed for YTD vs Budget (same basis).
- **Decision history:** 2026-07-15 (Sales Executive Summary "Pace row").

#### Pace vs Forecast %
- **Definition:** Ratio of summed Forecast Room Nights to summed Budget Room Nights, across ONLY the rolling 3-month-ahead forecast window (never the full year).
- **Formula:** `execPaceVsForecastPct = (forecastNightsSum / forecastBudgetSum) * 100`, where both sums are `forecastByMonth.reduce(...)` over exactly the 3 `forecastTargetMonths`.
- **Source:** Derived from `forecastByMonth` (see Forecast Room Nights below) — no separate query.
- **Filters/exclusions:** Inherits Forecast Room Nights' full filter/formula chain.
- **Where shown:** Exec Summary Pace-% mini-stat card ("vs Forecast", severity-colored by threshold rather than delta since there's no `ly`).
- **Caveats/gaps:** Code comment explicitly warns: "NEVER silently rolled up across all 12 [months] when 9 have no real forecast figure" — the `d` caption names the exact 3-month range (e.g. "Aug 2026–Oct 2026 forecast vs budget") specifically so this doesn't misread as an annual figure.
- **Decision history:** 2026-07-15.

#### Pace vs STLY %
- **Definition:** Relabeled reuse of Pace Index (100 = last year) for the Sales Exec Summary's 3-card pace row.
- **Formula:** Identical value to `paceIdx` above — `kpi(paceIdx, 'pct', 'Pace vs STLY %', ...)`.
- **Source:** Same `kpiConfirmed`/`kpiLyBkgs` as Pace Index — not a new query.
- **Filters/exclusions:** Same as Pace Index (including the numerator/denominator status-set asymmetry noted there — §10.3).
- **Where shown:** Exec Summary Pace-% mini-stat card ("vs STLY").
- **Caveats/gaps:** Formatted as `'pct'` here vs `'f1'` on the Pace tab's own Pace Index card — same underlying number, different display format between the two tabs.
- **Decision history:** 2026-07-15.

### Forecast

#### Forecast Room Nights
- **Definition:** Dennis's revenue-manager formula for expected Room Nights in each of the next 3 target months (the month AFTER the current in-progress month, +1 to +3).
- **Formula:** `forecastNights = confirmedNights + provisionalComponent + adjustedPickup - expectedCancellations`, where:
  - `confirmedNights = confirmed_nights_raw + day_use_nights` (status='30' nights in the target month, from `kpiForecastTargetRows`)
  - `provisionalComponent = ROUND(provisional_nights_raw * 0.3)` (status='20' nights × 30%)
  - `adjustedPickup = ROUND(stlyIncrementalPickup * forecastPaceRatio)`, where `stlyIncrementalPickup = MAX(stlyFinalNights - stlyOnBooksNights, 0)` — the TRUE incremental pickup a year ago (final settled nights minus what was already on the books at the equivalent lead time last year), scaled by this-year-vs-last-year forward pace
  - `expectedCancellations = ROUND(forecastCancelRateLy * confirmedNights)`
- **Source:** `kpiForecastTargetRows` (confirmed+provisional nights per target month), `kpiForecastStlyRows` (STLY final vs on-books nights), `kpiForecastPace` (this-year vs last-year forward-nights pace ratio), `kpiForecastCancelLyFullYear` (LY full-year cancel rate, confirmation_date-scoped).
- **Filters/exclusions:** Standard rate-type/PA exclusions, property filter (`AND_P`) applied to target/STLY rows. `kpiForecastCancelLyFullYear` scopes cancellation numerator/denominator to `confirmation_date IS NOT NULL` (see Expected Cancellation Rate below).
- **Where shown:** Pace tab ("Forecast Room Nights vs Budget" table, `forecast.byMonth`), rolled up into Pace vs Forecast % on Exec Summary.
- **Caveats/gaps:** This formula went through TWO major revisions after live overshoot audits:
  - **2026-07-14b fix:** original version used the ENTIRE final STLY-month total as "pick-up," which the code comment says caused "~90% of a month's eventual nights are already on the books a full year before departure... double-counted almost the entire base — the root cause of the 114-123%-of-Budget overshoot." Fixed to the true incremental delta (final minus on-books).
  - **2026-07-14c fix:** Expected Cancellations originally used the same status='90'/'20','30','90' denominator as the general Cancellation Rate KPI, which computed to 59.9% — "Faith confirmed the real expected rate is 5-10%." Root cause: that denominator "lumped in every status='20' quote/low-intent record," and the numerator counted "every archived/lapsed record regardless of whether it was ever a real confirmed booking" — investigation found only 7.1% of 2025's status='90' records ever had a `confirmation_date`. Fixed by scoping both sides to `confirmation_date IS NOT NULL`, landing at 9.7% for 2025.
- **Decision history:** 2026-07-14 (original), 2026-07-14b (incremental-pickup fix), 2026-07-14c (cancellation-rate fix). See code comments in route.ts ~L1439-1505 for the full audit trail.

#### Forecast Pace Ratio
- **Definition:** Scaling factor expressing "this year's forward booking pace" relative to "last year's pace at the same lead time" — used to scale the Adjusted Pick-Up component of Forecast Room Nights.
- **Formula:** `forecastPaceRatio = forecastPaceThisYear / forecastPaceLastYear` (defaults to 1 — no adjustment — if `forecastPaceLastYear <= 0`). `this_year_forward_nights` = all currently-confirmed future nights (unbounded); `last_year_forward_nights_same_leadtime` = confirmed nights for the equivalent forward window a year ago, bounded by `r.date_created <= CURDATE()-1YR` so it reflects what was on the books AT THAT POINT last year, not the eventual final total.
- **Source:** `kpiForecastPace` query.
- **Filters/exclusions:** `status='30'`, standard rate-type/PA exclusions, property filter applied.
- **Where shown:** Pace tab caption ("pace ratio {forecast.paceRatio.toFixed(2)}×").
- **Caveats/gaps:** No status-history snapshot table exists in this schema — the `r.date_created <=` bound is a proxy for "what was known then," not a true point-in-time snapshot.
- **Decision history:** 2026-07-14e (bundled with Forecast Room Nights work).

#### Expected Cancellation Rate (LY, full-year)
- **Definition:** Full-year prior-year cancellation rate used as the multiplier for Forecast Room Nights' "Expected Cancellations" subtraction.
- **Formula:** `forecastCancelRateLy = forecastCancelledLy / forecastCancelTotalLy`, where both are scoped to `confirmation_date IS NOT NULL` (see Forecast Room Nights caveat above for why this scoping was chosen over the general Cancellation Rate's status-based scoping).
- **Source:** `kpiForecastCancelLyFullYear`.
- **Filters/exclusions:** Full year (`ly`, months 1-12) hardcoded, NOT period-filtered by the Topbar's MTD/YTD/Annual toggle.
- **Where shown:** Pace tab caption ("LY cancel rate {(...).toFixed(1)}%").
- **Caveats/gaps:** This is a DIFFERENT formula/population from the standalone Cancellation Rate KPI (`kpiCancel`, status-based) documented above — same concept, deliberately different methodology, confirmed against Faith's 5-10% expectation. Do not assume these two "cancellation rate" figures elsewhere on the dashboard will match.
- **Decision history:** 2026-07-14c (see Forecast Room Nights above for the full audit narrative).

#### Total Rev Full Year (denominator)
- **Definition:** Dedicated full-year Room Revenue denominator, used ONLY for Trade Partners' "% of total" ratio (Agent Room Revenue ÷ this figure) — NOT used by Exec Summary/Pace's own cards directly, but built from the same query family and worth documenting here since it's easily confused with `revM`.
- **Formula:** `totalRevFullYearM = kpiTotalRevFullYear.rev_raw / 1e6`.
- **Source:** `kpiTotalRevFullYear` query — `ROOM_REVENUE_SUM_SQL` over `i.date_in` in the selected year/month range, `i.date_out > i.date_in` (no actualized cutoff).
- **Filters/exclusions:** `status='30'`, standard exclusions, property filter applied (kept same-basis as `kpiAgentRev`'s numerator per the "decision #3, no exceptions" property-filter pass).
- **Where shown:** Not directly on ExecSummaryView/PaceView cards — feeds `arevPct`/`arevPctLabel` on the Trade Partners tab. Included here because it's a distinct basis from `kpiRevNights`'s actualized-only `revM`, and the two are easy to conflate.
- **Caveats/gaps:** Code comment: "Dedicated full-year denominator (kpiTotalRevFullYear), NOT revM (which is actualized-only for Occupancy)."
- **Decision history:** Split out from the Occupancy query "this session" (undated in-code) specifically so Occupancy could stay actualized-only while Trade Partners' ratio kept a same-basis comparison against Agent Room Revenue.

### Supporting chart data (shared by both tabs)

#### Monthly Booking Pace (PD)
- **Definition:** Monthly confirmed Room Revenue trend, current year vs LY, for the "Monthly Booking Pace" line chart.
- **Formula:** `PD.actual[m] = ROUND(SUM(Room Revenue for month m, cy) / 1000, 1)`; `PD.ly[m]` same for `ly`. SQL: `caseInYearMonthRange` + `ROOM_REVENUE_CASE`, grouped by `MONTH(r.date_created)`.
- **Source:** `pdRows` query.
- **Filters/exclusions:** `status='30'` only (as of the 2026-07-16 fix below), Room-Revenue-only, standard exclusions, property filter applied. Date basis is `r.date_created` (booking date), NOT `i.date_in` (stay date) — different from most other revenue queries in this section.
- **Where shown:** Exec Summary and Pace tab's "Monthly Booking Pace" line chart (identical chart, both tabs).
- **Caveats/gaps:** Explicitly flagged in-code as a real bug found and fixed: "Was status IN ('20','30') over raw r.total_amount (blended Room+Extras, includes Pipeline) despite being captioned 'confirmed bookings' everywhere it's shown... a real discrepancy, caught when asked 'what do we have on Booking Pace, use only verified figures.'" User confirmed fixing this dashboard-wide even though it changed already-shown numbers.
- **Decision history:** 2026-07-16 fix (status-mixing + blended-revenue correction) — see `project_revenue_status_mixing_audit.md`.

#### Bookings by Property (OD.props)
- **Definition:** Relative occupancy ranking of properties over the last 90 days, used for the "Bookings by Property" bar chart on both Exec Summary and Pace.
- **Formula:** `oc = ROUND((bkgs / maxBkgs) * 95)` — a relative index (not a real occupancy %), where `bkgs = COUNT(DISTINCT itinerary_id)` and `adr = ROUND(room_rev / GREATEST(nights,1))`.
- **Source:** `ocPropRows` query.
- **Filters/exclusions:** `status='30'`, `i.date_in` within the last 90 days AND `< CURDATE()` (past arrivals only), Room-Revenue-only ADR. **This query has NO `AND_P` property filter applied at all** — always returns the full top-10 portfolio ranking regardless of the selected property.
- **Where shown:** Exec Summary and Pace tab bar charts.
- **Caveats/gaps:** When a property is selected in the filter bar, ExecSummaryView does NOT filter this chart down — it highlights the selected property's bar (solid + bordered) while dimming the rest, "rather than filtering the ranking down to one bar (which would defeat this chart's comparative purpose)" per the 2026-07-16 code comment. PaceView's version of this same chart has NO highlight treatment at all — property selection has zero visible effect on Pace tab's "Bookings by Property" chart. This is the same underlying query as §3's "Occupancy by Property" card, which has its own labeling caveat — see §10.10.
- **Decision history:** 2026-07-16 ("no exceptions" pass) added the spotlight-highlight behavior to Exec Summary only.

#### Forward Booking Pace (PF)
- **Definition:** Confirmed vs Provisional share of forward bookings by month, next ~4 months.
- **Formula:** One row per reservation (deduped via `MIN(date_in)` as first leg) bucketed to its first upcoming arrival month; `cf`/`pv` = % of bookings Confirmed/Provisional in that bucket, `cf_val`/`pv_val` = summed `total_amount` (raw reservation total, NOT Room-Revenue-split).
- **Source:** `pfRows` query.
- **Filters/exclusions:** `status IN ('20','30')`, `i.date_in > CURDATE()` through `+5 months`, standard rate-type/PA exclusions, property filter applied.
- **Where shown:** Pace tab only ("Forward Booking Pace" bars) — NOT shown on Exec Summary.
- **Caveats/gaps:** Unlike `pdRows` (fixed 2026-07-16 to Room-Revenue-only), this query's dollar values (`cf_val`/`pv_val`) still use raw `total_amount` (i.e., blended Room Revenue + Extras) — see §10.2.
- **Decision history:** Dedup-by-reservation fix noted in-code (undated) — "Previously summed r.total_amount across all itinerary rows, inflating by ~2–3x."

---

## 3. Occupancy tab & Property Performance tab

**Query IDs:** `ocPropRows`, `arrRows`, `dayUseArrRows`, `kpiRevNights`, `kpiRevNightsLy`, `kpiCancel`, `kpiCancelLy`, `budgetActualByPropRows`, `revparNightsRows`, `extrasByPropRows`, `dayUseExtrasByPropRows` (`src/app/api/dashboard/route.ts`). Assembled into `OD` (line ~2006), `REVPAR.byProperty`/`revparByProperty` (line ~2531), `PROPERTY_PERFORMANCE` (line ~2578), and the `occ` branch of `KP_BASE` (line ~2375). Rendered by `src/components/views/OccView.tsx` and `src/components/views/PropertyPerformanceView.tsx`.

Both `revparByProperty` and `PROPERTY_PERFORMANCE` are full-year-2026-fixed (hardcoded `dateInFullYear('i.date_in', 2026)`), independent of the Topbar's MTD/YTD/period toggle — the whole tab does not respect the standard period filter the way Pace/Trade Partners do. Note also the server-side response cache on `/api/dashboard` (keyed by view/year/period/channel/market/property, now with sync_logs-based invalidation — see the Sales Exec Summary performance work) — every figure below can be stale until the underlying data actually refreshes.

### Bookings by Property ("Occupancy by Property" card)

#### Relative Bookings Bar (mislabeled "Occupancy" — see §10.10)
- **Definition:** A normalized bar showing each property's booking volume relative to the busiest property in the list, over the trailing 90 days. **This is not a true occupancy percentage** — it does not divide by available room-nights.
- **Formula:** `oc = round((bkgs / maxBkgs) * 95)` where `bkgs = COUNT(DISTINCT itinerary_id)` and `maxBkgs = max(bkgs)` across the top-10 properties returned; capped at 95 so the busiest property's bar never fills 100%.
- **Source:** `ocPropRows` — subquery `nt` in `route.ts` ~line 265: `itineraries i JOIN reservations r`, `status='30'`, `i.date_in >= CURDATE()-90d AND i.date_in < CURDATE()`, `i.date_out > i.date_in`, `i.property IS NOT NULL`, top 10 by `bkgs DESC`.
- **Filters/exclusions:** `r.status='30'` (confirmed only, §1.1), `rate_type NOT IN NON_REV_IDS` (§1.4), `reservation_number NOT LIKE 'PA%'` (§1.4). Limited to top 10 properties by booking count — properties outside the top 10 (e.g. low-volume ones) do not appear at all in this card.
- **Where shown:** `OccView.tsx` "Occupancy by Property" card (`LinearProgress` bars), lines 105-136.
- **Caveats/gaps:** See §10.10 — card title says "Occupancy by Property" but the underlying value is a relative-bookings index, not `soldNights/availableNights`. The genuine occupancy % (nights-based) exists elsewhere on the same tab — in the RevPAR table's `Occ%` column. Also unlike the rest of the tab's `OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY` convention, this query is arrivals-based (`date_in` in the last 90 days) with **no `date_out <= CURDATE()` actualized-stays gate**.
- **Decision history:** Room Revenue/Extras split (2026-07-08) changed the ADR numerator in the sibling query but did not touch this bookings-count logic.

#### ADR by Property, last 90 days ("Revenue by Property" chart — mislabeled, see §10.10)
- **Definition:** Average Daily Rate per property, Room-Revenue-only, over the trailing 90 days (confirmed stays only).
- **Formula:** `adr = ROUND(rev.room_rev / GREATEST(nt.nights, 1))` where `room_rev` = `ROOM_REVENUE_SUM_SQL` (see §1.2) over the same 90-day/confirmed-only window, and `nights = SUM(GREATEST(DATEDIFF(date_out, date_in), 0))`.
- **Source:** `ocPropRows` — the `rev` subquery joined to `nt` on `property`, `route.ts` ~lines 281-293. Assembled as `OD.props[i].ar` (line 2011).
- **Filters/exclusions:** Same as Bookings by Property above — `status='30'`, last-90-day `date_in` window, `NON_REV_IDS`, `PA%` exclusion (§1.4).
- **Where shown:** Two places, both reading the same `OD.props[].ar` field: (1) `OccView.tsx` "Revenue by Property" bar chart — chart data is `data.OD.props.map(p => p.ar)`, i.e. it plots **ADR dollars**, not revenue, even though the card title is "Revenue by Property" (the caption underneath, "ADR from ResRequest bookings — last 90 days," correctly names what's actually plotted). (2) The "Occupancy by Property" list card, where the `$` figure to the right of each progress bar is this same ADR value.
- **Caveats/gaps:** See §10.10 — **title/data mismatch**: heading reads "Revenue by Property" but the chart's actual data series is ADR per property, not a revenue total.
- **Decision history:** 2026-07-08 Room Revenue/Extras split fix: ADR numerator changed from `total_gross_amount` (blended) to Room-Revenue-only.

### Monthly Arrival Revenue Trend (portfolio-wide, not per-property)

#### Arrival Revenue Trend — Actual / LY / Extras / Extras LY
- **Definition:** Monthly Room Revenue (actual year vs. LY) plus Extras Revenue (actual vs. LY) by arrival month, YTD through the current selected month. Portfolio-wide (not broken out by property in this chart, despite living on the Occupancy tab).
- **Formula:** `act`/`ly_val` = `SUM(rate_components.amount_gross)` where `ROOM_REVENUE_CASE` is true, KES converted ÷129 (§1.3), grouped by `MONTH(i.date_in)`, ÷1000 for thousands display. `extras`/`extras_ly` = same but `NOT ROOM_REVENUE_CASE AND NOT EXCLUDED_FEE_CASE`. Day Use extras from `dayUseArrRows` (the `extras`-table equivalent, keyed on `internal_property`) are added in JS.
- **Source:** `arrRows` (route.ts ~line 304) + `dayUseArrRows` (~line 326), merged into `OD.arr`.
- **Filters/exclusions:** `status='30'` only, `NON_REV_IDS`, `PA%` exclusion (§1.4), current-year-through-selected-month vs. same-period-LY (`dateInTwoYearsThroughMonth`). Component classification per §1.2.
- **Where shown:** `OccView.tsx` "Arrival Revenue Trend" line chart.
- **Caveats/gaps:** Not property-scoped despite the page context — this is the one chart on the Occupancy tab that's portfolio-aggregate, not per-property. Uses `i.date_in`-based YTD, a **different date basis** than the rest of the Occupancy tab's actualized-stays convention.
- **Decision history:** 2026-07-08 split (Room Revenue vs Extras, previously blended `total_gross_amount`). Day Use merge added same date.

### RevPAR by Property

#### RevPAR by Property (Room Revenue ÷ Available Room Nights)
- **Definition:** Revenue Per Available Room, full-year 2026, confirmed-only, Room-Revenue basis (explicitly **not** blended with Extras).
- **Formula:** `revpar = roomRevenue / availableNights` where `roomRevenue` = `budgetActualByPropRows`' `rev` (per property, via `actualByPropMap`) and `availableNights` = `PROPERTY_ROOM_COUNTS[property].roomnightsAvailable` (Dennis's confirmed annual capacity figure — §1.5). `adr = roomRevenue / soldNights` (only if `soldNights > 0`, else `null`). `occPct = (soldNights / availableNights) * 100`.
- **Source:** `budgetActualByPropRows` (route.ts ~line 936) joined in JS to `revparNightsRows` (~line 1514: nights-only, deliberately **no `rate_components` join** in the same query — joining rate_components alongside a nights SUM multiplies nights 4-7x by however many revenue-component rows each leg has) and `PROPERTY_ROOM_COUNTS`.
- **Filters/exclusions:** `status='30'` (confirmed only), `rate_type NOT IN NON_REV_IDS`, `reservation_number NOT LIKE 'PA%'` (§1.4). Full calendar-year 2026 `i.date_in`, **not** actualized-stays-only and **not** Topbar-period-filtered.
- **Where shown:** `OccView.tsx` "RevPAR by Property" table; same underlying array (`REVPAR.byProperty`) feeds `PROPERTY_PERFORMANCE`'s `revpar`/`occPct`/`adr`/`soldNights`/`roomRevenue` columns on the Property Performance tab.
- **Caveats/gaps:** Built over all 18 entries in `PROPERTY_ROOM_COUNTS` (not the 17-property budget list), so caveat properties always appear as rows — LEPC (`null` everywhere, real caveat), NXR (`$0` correct, not a gap), LSC (computed but directional-only) — see §1.5. Rows with `revpar === null` sort to the bottom.
- **Decision history:** Built 2026-07-14d ("RevPAR by property"). Fan-out bug caught during feasibility testing before shipping.

#### Room Nights Sold / Available Room Nights by Property
- **Definition:** The two raw components behind RevPAR/Occ% — nights actually sold (confirmed, full-year 2026) vs. Dennis's externally-sourced annual capacity figure.
- **Formula:** `soldNights = SUM(GREATEST(DATEDIFF(date_out, date_in), 0))`, `status='30'`, full-year 2026. `availableNights` is a static lookup from `PROPERTY_ROOM_COUNTS[property].roomnightsAvailable` — **not derived from any database query** (ResRequest has no room/unit capacity field at all).
- **Source:** `revparNightsRows` (soldNights) + `PROPERTY_ROOM_COUNTS` (availableNights, static, from Dennis's "Property Abbreviations & Locations" file).
- **Filters/exclusions:** Same as RevPAR above.
- **Where shown:** RevPAR table's "Sold Nights"/"Available Nights" columns; "Room Nights Sold" column on `PropertyPerformanceView.tsx`.
- **Caveats/gaps:** `roomnightsAvailable` represents "a typical year of operation" per the source file's own header, but LSC/LEPC/NXR are known exceptions — see §1.5. Also flagged but unused anywhere: KLZ, SXR, and KHL each have an unexplained ~4x-larger second figure in the source file, explicitly **not used** pending confirmation with Dennis.
- **Decision history:** `PROPERTY_ROOM_COUNTS` replaced 2026-07-13 (old low-confidence single-entry map, conflicting 6/7/8 sources for Lodo Springs) with Dennis's confirmed figures.

#### Occupancy % by Property (true, nights-based — RevPAR table's "Occ%" column)
- **Definition:** The genuine per-property occupancy percentage: nights actually sold as a share of nights available, full-year 2026.
- **Formula:** `occPct = (soldNights / availableNights) * 100`, rounded to 1 decimal.
- **Source:** Same as RevPAR above.
- **Filters/exclusions:** Same as RevPAR above.
- **Where shown:** RevPAR table "Occ%" column; "Occupancy %" column (`PropertyPerformanceView.tsx`).
- **Caveats/gaps:** This is the metric that the "Occupancy by Property" card further up the same page (the relative-bookings bar) is easily confused with — see §10.10. Same LEPC/NXR/LSC caveats apply (§1.5).
- **Decision history:** Same batch as RevPAR, 2026-07-14d.

### Portfolio-level Occupancy % / RevPAR (aggregate, not per-property)

#### Portfolio RevPAR / Occupancy % (KP_BASE.occ.revpar / occPct)
- **Definition:** A single portfolio-wide (or, if a property filter is active, single-property) RevPAR and Occupancy % figure, aggregated as sums across properties — **explicitly not an average of each property's own RevPAR/Occ%**.
- **Formula:** `portfolioRevpar = sum(roomRevenue) / sum(availableNights)`; `portfolioOccPct = (sum(soldNights) / sum(availableNights)) * 100`, summed across the properties in `PROPERTY_ROOM_COUNTS` **excluding** `PORTFOLIO_AGG_EXCLUDE_IDS = {'WB146935' (NXR), 'WB37957' (LSC)}` and LEPC (null id) — 15 "clean" properties. If a specific property is selected, the same maps are re-scoped to that one property instead (fixed 2026-07-16, "no exceptions" pass).
- **Source:** Reuses `actualByPropMap` and `revparNightsMap` — the identical per-property maps `REVPAR.byProperty`/`PROPERTY_PERFORMANCE` draw from.
- **Filters/exclusions:** Same underlying queries as RevPAR by Property; additionally excludes NXR/LSC/LEPC from the aggregate (§1.5).
- **Where shown:** Not rendered on `OccView.tsx`'s KpiRow. **Is** shown as "Avg Occupancy %" on `PropertyPerformanceView.tsx`'s KPI row — comment there explicitly notes this reuses the server-computed nights-weighted figure "rather than a naive re-average here." Also feeds Sales Executive Summary.
- **Caveats/gaps:** The "Avg Occupancy %" label could be misread as a simple average of the table's own `occPct` column below it — it is not; it's the weighted sum-of-sums aggregate, deliberately excluding LEPC/NXR/LSC (§1.5). No `ly` comparator exists ("no prior-year property-level capacity query exists yet"). Thresholds (55/45) are flagged in-code as "first-pass placeholders."
- **Decision history:** Built 2026-07-15 for Sales Executive Summary's KPI row; re-scoped to respect the property filter 2026-07-16.

#### Occupancy % vs Budget (portfolio/property)
- **Definition:** A derived Budget-side occupancy target, since `budget2026Monthly.json` has no dedicated occupancy field.
- **Formula:** `occBudgetRns = getPropertyBudget/getPortfolioBudget(..., months 1-12).rns`; `portfolioOccPctBudget = (occBudgetRns / availableSum) * 100` — the same formula that produces the Actual side, applied to Budget Room Nights instead of sold nights.
- **Source:** `budget2026Monthly.json` via `src/lib/budget.ts` (§1.8) ÷ `PROPERTY_ROOM_COUNTS` availableNights.
- **Filters/exclusions:** 2026-only (§1.8); full-year basis.
- **Where shown:** Carried in `KP_BASE.occ.occPct`'s `ly` slot with `budget: true`, so `KpiRow` labels it "BUDGET" instead of a YoY badge.
- **Caveats/gaps:** Same 2026-only / Afrochic-$0 caveat as all Budget figures (§1.5, §1.8).
- **Decision history:** Built 2026-07-16.

### Extras Revenue by Property

#### Extras Revenue by Property
- **Definition:** Extras (non-Room-Revenue rate_components + Day Use/extras-table revenue), summed per property, full-year 2026, portfolio-wide (all agents).
- **Formula:** `extrasRevenue = round(extrasByPropMap.get(propertyId) + dayUseExtrasByPropMap.get(propertyId))`, `null` if `propertyId` is `null` (LEPC).
- **Source:** `extrasByPropRows` (route.ts ~line 1691) + `dayUseExtrasByPropRows` (~line 1706 — the portfolio-wide sibling of the agent-scoped `dayUsePropRows` used on Trade Partners, just without the `agent_id` filter).
- **Filters/exclusions:** `status='30'`, full-year 2026 `i.date_in`, `NON_REV_IDS`, `PA%` exclusion (§1.4). Component classification per §1.2.
- **Where shown:** `PropertyPerformanceView.tsx` "Extras Revenue" column only — **not shown anywhere on `OccView.tsx`**.
- **Caveats/gaps:** Day Use properties (ACL/Kilindi) will show `$0` Room Revenue but real money in Extras Revenue — expected per §1.2. LEPC gets `null`, consistent with every other LEPC figure (§1.5).
- **Decision history:** Built 2026-07-15.

### Property-Level Budget Variance

#### Budget Variance % by Property
- **Definition:** Actual Room Revenue as a percentage of each property's full-year 2026 Budget Room Revenue.
- **Formula:** `variancePct = round((actual / budgetFullYear.rev) * 1000) / 10`; `null` if `budgetFullYear.rev` is `0`.
- **Source:** `actualByPropMap` ÷ `getPropertyBudget(propertyId, 2026, 1, 12)` (§1.8), assembled into `budgetByProp`, merged into `PROPERTY_PERFORMANCE`.
- **Filters/exclusions:** Same as `budgetActualByPropRows` above (§1.1, §1.4); Budget side is 2026-only (§1.8).
- **Where shown:** `PropertyPerformanceView.tsx` — "Budget Variance %" table column (chip colored green if `≥100%`, red if `<100%`) and the corresponding bar chart (excludes null-budget properties from the chart only; the table still lists them).
- **Caveats/gaps:** Afrochic (WB639) always `null` here (§1.5). `budgetByProp` is built off `getAllBudgetProperties()` (17 properties), but `PROPERTY_PERFORMANCE` is built off `revparByProperty`'s 18-property list — LEPC/NXR/LSC still appear as rows with their own RevPAR-side caveat.
- **Decision history:** Built 2026-07-13, merged into `PROPERTY_PERFORMANCE` 2026-07-15.

#### Properties At/Over Budget (count) / Properties Under Budget (count)
- **Definition:** Portfolio KPI counts of how many properties are at-or-above vs. below 100% of their full-year Budget.
- **Formula:** Computed **client-side** in `PropertyPerformanceView.tsx`: `overBudgetCount = rows.filter(r => r.budgetVariancePct !== null && r.budgetVariancePct >= 100).length`; `underBudgetCount` analogous with `< 100`. Caption: "of N with a budget set" — null-budget properties excluded from both numerator and denominator.
- **Source:** `data.PROPERTY_PERFORMANCE` (client-side derivation).
- **Filters/exclusions:** Same as Budget Variance % by Property.
- **Where shown:** `PropertyPerformanceView.tsx` KPI row, "Properties At/Over Budget" (green) and "Properties Under Budget" (red).
- **Caveats/gaps:** Client-computed, not part of `KP_BASE`. Afrochic and any other `$0`-budget property is excluded from both counts (§1.5).
- **Decision history:** Built 2026-07-15.

### Property Performance — Portfolio Summary KPIs

#### Total Room Revenue (portfolio KPI, Property Performance page)
- **Definition:** Sum of Room Revenue across every row currently in the Property Performance table, full-year 2026.
- **Formula:** Computed **client-side**: `totalRoomRevenue = rows.reduce((s, r) => s + (r.roomRevenue ?? 0), 0)` — a re-sum of `PROPERTY_PERFORMANCE`'s own `roomRevenue` field, not a separate server-side query/KPI.
- **Source:** `data.PROPERTY_PERFORMANCE[].roomRevenue`.
- **Filters/exclusions:** Same as `budgetActualByPropRows` (§1.1, §1.4); full-year 2026.
- **Where shown:** `PropertyPerformanceView.tsx` KPI row, "Total Room Revenue" card.
- **Caveats/gaps:** Client-side sum inherits LEPC/NXR/LSC caveats silently (§1.5). Not itself a `KP_BASE` field, so it can drift from any other "Total Room Revenue" figure elsewhere in the app if their underlying property lists ever differ.
- **Decision history:** Built 2026-07-15.

### Not property-level, computed within the same query batch but not property-scoped

#### Cancellation Rate (kp.occ.cancel)
- **Definition:** Portfolio-wide (not per-property) share of reservations cancelled, by booking-intake date (`date_created`), current period vs. same-period-last-year.
- **Formula/Source/Filters:** See §2's Cancellation Rate entry — same query (`kpiCancel`/`kpiCancelLy`), fetched as part of the `occ` view's query bundle.
- **Where shown:** Included in this write-up only because its query is fetched by the `occ` view bundle — **not rendered on `OccView.tsx`** (moved 2026-07-09 to be a headline card on Booking Status Movement instead, "so it's not losing visibility, just not duplicated here").
- **Decision history:** 2026-07-09 — moved off the Occupancy tab onto Booking Status Movement.

### Fields computed but not currently rendered

- **`country`** (`PROPERTY_PERFORMANCE[].country`): Kenya/Tanzania/Unknown, derived from the property-ID sets (with a hardcoded LEPC-name fallback to `'Kenya'`) — computed but **not displayed** in `PropertyPerformanceView.tsx`'s table.
- **`keys`** (`PROPERTY_PERFORMANCE[].keys`): physical room-key count from `PROPERTY_ROOM_COUNTS` — also computed and merged into every row but **not displayed**.
- Both fields exist in the API response and could be surfaced (e.g. a Country filter/grouping or a Keys column) without any new query.

---

## 4. Trade Partners/Agents & Market Segment Performance

**Views:** `src/components/views/AgentsView.tsx` (Trade Partners tab), `src/components/views/MarketSegmentPerformanceView.tsx` (Market Segment Performance tab). Query IDs per `src/lib/dashboardViews.ts` `VIEW_QUERY_IDS['tp']` and `['market-segment-performance']`. Assembly logic in `src/app/api/dashboard/route.ts` (`AD` block, `KP_BASE.agents` block, `AGENT_PACE`/`CANCEL_DRIVERS`/`LOW_SEASON_AGENTS` blocks, `MARKET_SEGMENT_PERFORMANCE` block).

### Agent Leaderboard Metrics (`AD.yearly`, Top Trade Partners table)

#### Agent Room Revenue
- **Definition:** Total confirmed Room Revenue attributed to an agent, current period.
- **Formula:** `agRows`'s `rv` subquery — reservations-only (no itinerary join), summing `${ROOM_REVENUE_SUM_SQL}` (§1.2), grouped by `r.agent_id`. Deliberately NOT the reservation/itinerary-join subquery used for nights/ADR in the same query.
- **Source:** `agRows` (`reservations` JOIN `itineraries` JOIN `rate_components`, LEFT JOIN `rate_types`), `agLyRows` for LY, `dayUseAgentRows` merged in JS for Day Use extras.
- **Filters/exclusions:** `r.status = '30'` only (§1.1). §1.4 agent-ID/name exclusions, non-revenue rate types, `PA%` prefix, plus Market Segment/Channel filter (`AND_A`) and property filter (`AND_P`).
- **Where shown:** Top Trade Partners table, "Room Revenue ($k)" column; also feeds `AD.byMonth`/`AD.byProp` charts.
- **Caveats/gaps:** Pre-existing bug used to inflate revenue 1.5–2.9x per agent by joining all three tables and summing `r.total_amount` across itinerary legs — the reservations-only subquery is the fix.
- **Decision history:**
  - Pre-existing bug (undated): revenue joined all three tables and summed across legs, inflating rv_raw by ~1.5–2.9x per agent.
  - **2026-07-07** (revenue status-mixing audit): `status IN ('20','30')` → `status='30'` only. Portfolio-wide Agent Room Revenue was $36.4M (mixed) → $33.5M (confirmed-only), an 8.9% overstatement (later re-baselined by the Cheli & Peacock fix below).
  - **2026-07-09 (Tier 3):** `rv` was `r.total_amount` (blended) — rebuilt as a `rate_components`-based Room/Extras split.
  - **2026-07-09** (Cheli & Peacock): RS23 had been wrongly excluded as a "duplicate" of WB133564. Fix restored **+$5.39M**: Agent Room Revenue $31.14M → $36.53M (full-year 2026); Agent Room Revenue as % of Total Room Revenue 81% → 95%.

#### Agent Room Nights
- **Definition:** Nights booked (stay-length sum), current period, per agent.
- **Formula:** `agRows`'s `lg.nt` — a separate itinerary-join sub-subquery, deliberately split from the revenue subquery so joining `rate_components` for the ADR numerator doesn't multiply nights by component count per itinerary leg.
- **Source:** `agRows` (nested `nt` subquery).
- **Filters/exclusions:** `status IN ('20','30')` — **NOT** `status='30'` alone (activity, not revenue — §1.1). §1.4 exclusions + `AND_A`/`AND_P` apply. See §10.3 for the cross-metric nights-basis inconsistency this creates.
- **Where shown:** Top Trade Partners table, "Nights" column.
- **Decision history:** 2026-07-09 Tier 3 restructure.

#### Agent ADR — Portfolio basis (`nr_adr`)
- **Definition:** Average daily rate per agent, non-resident/portfolio basis, Room-Revenue-only.
- **Formula:** `agRows`'s `lg.adr` = `ROUND(roomrev.room_rev / GREATEST(nt.nt, 1))`.
- **Source:** `agRows` (`lg` nested join of `nt` and `roomrev` subqueries).
- **Filters/exclusions:** `status IN ('20','30')` (activity basis, matching nights). §1.4 exclusions apply.
- **Where shown:** Top Trade Partners table, "ADR" column (`r.nr_adr`).
- **Decision history:** **2026-07-09** — retrofitted to Room-Revenue-only (previously would have blended Extras).

#### Agent ADR — Resident basis (`r_adr`)
- **Definition:** Same ADR concept, scoped to East Africa Resident rate-type bookings only (§1.4 `EAR_RESIDENT_RATE_TYPE_IDS`).
- **Formula:** `agRows`'s `res.r_adr` — a `LEFT JOIN` sibling subquery to `lg`, identical shape but `rate_type IN (EAR_IDS)` instead of `NOT IN`.
- **Source:** `agRows` (`res` nested join).
- **Filters/exclusions:** `status IN ('20','30')`; resident rate-type carve-out. `LEFT JOIN` — agents with zero resident-rate bookings get `NULL`/0.
- **Where shown:** Present in the `AgentYearly` type/payload but not visibly rendered as its own column in `AgentsView.tsx`'s current table (the visible "ADR" column is `nr_adr`). See §10.9 for the `radr` naming collision this creates elsewhere.
- **Decision history:** **2026-07-09** — introduced/fixed alongside `nr_adr`.

#### Agent Extras Revenue
- **Definition:** Non-Room-Revenue ancillary spend attributed to an agent's bookings, additive to Agent Room Revenue per §1.2.
- **Formula:** `AD.yearly[].extras = Math.round((extras_raw + dayUseAgentMap.get(agentId)) / 1000)`.
- **Source:** `agRows` (`extras_raw`), `dayUseAgentRows` (extras-table).
- **Filters/exclusions:** `agRows`' extras subquery: `status='30'` only. `dayUseAgentRows`: `status='30'`, `r.agent_id IS NOT NULL`, §1.4, `AND_A`/`AND_P`.
- **Where shown:** Top Trade Partners table "Extras ($k)" column; `AD.byMonth`/`AD.byProp` Extras series.
- **Decision history:** 2026-07-08/09 rebuild (§1.2); 2026-07-13 broadened extras-table categories beyond Day Use only.

#### Conversion Rate / Materialisation Rate
- **Definition:** Share of an agent's pipeline that materialized into confirmed bookings (Faith's confirmed methodology) — "confirmed ÷ held."
- **Formula:** `agentConversionRows`: `confirmed_ct / total_ct` where `total_ct` counts a DISTINCT-deduped subquery of `status IN ('20','30') OR (status='90' AND prov_date IS NOT NULL)`, and `confirmed_ct` counts the `status='30'` subset.
- **Source:** `agentConversionRows` (`reservations` JOIN `itineraries` JOIN `agents`, DISTINCT-deduped).
- **Filters/exclusions:** §1.4 + `AND_A`/`AND_P`. Date basis: `YEAR(i.date_in)=cy`, **full calendar year**, deliberately NOT the selected `monthLo`/`monthHi` period.
- **Where shown:** Top Trade Partners table, "Conversion" column.
- **Decision history:** **2026-07-14f** — added, replicating the pre-existing Agent Profile methodology.

#### Properties Produced (per agent)
- **Definition:** Count of distinct properties an agent booked into, current period.
- **Formula:** `agentPropCountRows`: `COUNT(DISTINCT i.property)` grouped by `r.agent_id`.
- **Source:** `agentPropCountRows`.
- **Filters/exclusions:** `status='30'` only; §1.4; `AND_A`/`AND_P`. Date basis: `r.date_created`, `cy`/`monthLo`/`monthHi` — same period as `AD.yearly`'s own row (deliberately different basis from Conversion Rate above).
- **Where shown:** Top Trade Partners table, "Properties" column.
- **Decision history:** **2026-07-14f** — added alongside Conversion Rate and Country.

#### Agent YoY Revenue Change
- **Definition:** Year-over-year change in an agent's Room Revenue, current period vs. same period last year.
- **Formula:** `up = rv > lyRv`; `cg = signedPct(rv, lyRv)`, `lyRv` from `agLyMap` (keyed by agent **name**, not ID).
- **Source:** `agRows` (current), `agLyRows` (LY comparator).
- **Filters/exclusions:** Both sides `status='30'` only.
- **Where shown:** Top Trade Partners table "YoY" chip.
- **Decision history:** **2026-07-07** — matched to `agRows`' status fix. **2026-07-09 (Tier 3):** rebuilt Room-Revenue-only.

#### Agent Country
- **Definition:** Agent's country, for display/context in the leaderboard.
- **Formula:** `r.agent_physical_country || r.agent_postal_country || null` — physical preferred, postal fallback.
- **Source:** `agRows` (`a.agent_physical_country`, `a.agent_postal_country`).
- **Where shown:** Top Trade Partners table, "Country" column.
- **Decision history:** **2026-07-14f**.

#### Market Segment / Channel (agent-level tag)
- **Definition:** Per §1.6 — each agent row carries a Channel and a Market Segment tag.
- **Formula:** `lookupAgentSegment(r.nm)` — JS-side lookup by agent name (§1.6).
- **Where shown:** Top Trade Partners table Channel chip + Market Segment caption.
- **Decision history:** **2026-07-13** — `ch` was **hardcoded `'B2B'` for every row** before this fix. On hold per `project_channel_market_segment_blocked.md` until Faith's segment file stabilized (resolved 2026-07-13, confirmed live 2026-07-16).

### Portfolio-Level Agent KPI Cards (`KP_BASE.agents`)

#### Active Trade Partners (Active Agents count)
- **Definition:** Count of distinct agents with any qualifying activity in the period.
- **Formula:** `kpiAgents`: `COUNT(DISTINCT r.agent_id)`.
- **Source:** `kpiAgents` (current), `kpiAgentsLy` (LY).
- **Filters/exclusions:** `status IN ('20','30')` (§1.1), `r.total_amount > 0`, §1.4, `AND_A`/`AND_P`. Date basis: `i.date_in` (stay date), not `r.date_created`.
- **Where shown:** KPI card "Active Trade Partners."
- **Decision history:** Date-basis fix (`date_created`→`date_in`) to correct undercount. **2026-07-09**, `kpiAgentsLy` added as a real YoY comparator.

#### Agent Room Revenue (portfolio KPI card)
- **Definition:** Same concept as the leaderboard metric above, aggregated portfolio-wide with a "% of total" caption.
- **Formula:** `arevM = arevRaw / 1e6`; `arevPct = round((arevM / totalRevFullYearM) * 100)`.
- **Source:** `kpiAgentRev` (numerator), `kpiTotalRevFullYear` (denominator).
- **Filters/exclusions:** `status='30'` only. §1.4, `AND_A`/`AND_P` on both numerator and denominator.
- **Where shown:** KPI card "Agent Room Revenue," caption `arevPctLabel`.
- **Caveats/gaps:** Documents a **pre-existing, unfixed asymmetry**: `kpiAgentRev`'s `rev` subquery filters on `i.date_in` while its own `lg` (Portfolio ADR/Avg Length of Stay) sub-subquery filters on `r.date_created` — "flagged for a future decision."
- **Decision history:**
  - Original bug: 2.04x inflation on `arev_raw` from itinerary-join fan-out.
  - `arev_raw`'s date filter changed `r.date_created` → `i.date_in`.
  - **2026-07-07**: both `rev` and `lg` `status IN ('20','30')` → `status='30'` only. Live-verified: Portfolio ADR $1,178 → $1,071, Avg Length of Stay 2.5 → 2.3 nights.
  - **2026-07-08**: `lg`'s `port_adr` numerator changed from `total_gross_amount` (blended) → Room-Revenue-only.
  - **2026-07-08b (Tier 2):** dedup trick removed, switched to summing `rate_components` directly.
  - **2026-07-09** (Cheli & Peacock): +$5.39M — portfolio Agent Room Revenue $31.14M → $36.53M full-year 2026, % of Total Room Revenue 81% → 95%, Active Trade Partners 933 → 934, Portfolio ADR $1,010 → $990.
  - **2026-07-13**: `extras_table_revenue` broadened beyond Day Use only.

#### Agent Extras Revenue (portfolio KPI card)
- **Definition:** Portfolio-wide sibling to Agent Room Revenue KPI.
- **Formula:** `agentExtrasM = (kpiAgentRev.extras_raw + kpiAgentRev.extras_table_revenue) / 1e6`.
- **Source:** `kpiAgentRev`.
- **Where shown:** KPI card "Agent Extras Revenue."
- **Decision history:** **2026-07-08b (Tier 2)** — introduced. **2026-07-13** — broadened beyond Day Use.

#### Portfolio ADR (`nradr`)
- **Definition:** Blended average daily rate across all agent-linked bookings, Room-Revenue-only.
- **Formula:** `kpiAgentRev`'s `lg.port_adr = ROUND(room_rev / GREATEST(nights, 1))`, `r.date_created` basis.
- **Where shown:** KPI card "Portfolio ADR."
- **Decision history:** Same 2026-07-07/08/08b history as Agent Room Revenue.

#### Avg Length of Stay (field name `radr` — naming collision, see §10.9)
- **Definition:** Average nights per booking, portfolio-wide, agent-linked bookings only.
- **Formula:** `kpiAgentRev`'s `lg.avg_stay = ROUND(nights / GREATEST(res_ct, 1), 1)`.
- **Where shown:** `AgentsView.tsx`'s `MiniStatRow` ("Portfolio Avg Length of Stay"), reading `kp.radr`. **Despite the field name, this is NOT the resident-ADR figure** (`AD.yearly[].r_adr`) — see §10.9.
- **Decision history:** Live-verified **2026-07-07**: 2.5 → 2.3 nights. **2026-07-09** — moved to `MiniStatRow` caption rather than a 5th KPI card.

### Revenue by Property (Agent-Scoped) — `AD.byProp`

#### Agent Revenue by Property
- **Definition:** Room Revenue + Extras, agent-scoped, broken out per property (top 16 by revenue).
- **Formula:** `agPropRows` — `rv`/`ly_val` via Room Revenue classification, `extras`/`extras_ly` via the Extras classification, grouped by `i.property`. Day Use revenue merged in separately from `dayUsePropRows`.
- **Source:** `agPropRows`, `dayUsePropRows`.
- **Filters/exclusions:** `status='30'` only; `r.agent_id IS NOT NULL`; `i.property IS NOT NULL`; §1.4; `AND_A`/`AND_P`. Ordered `rv DESC LIMIT 16`.
- **Where shown:** AgentsView "Revenue by Property" bar chart (top 10 of the 16 fetched).
- **Caveats/gaps:** Day Use revenue (ACL/Kilindi) is NOT in the `agPropRows` result — `$0` in rate_components (§1.2). `dayUsePropRows` previously had a scope bug: no agent scoping at all (fed an agent-scoped display with portfolio-wide Day Use money) — fixed 2026-07-13.
- **Decision history:** **2026-07-07** (status-mixing); **2026-07-08** (Room Revenue/Extras split); **2026-07-13** (`dayUsePropRows` agent-scope bug fixed).

### Channel Mix (`AD.ch`) — currently unused/dead in the UI (see §10.9)

#### Channel Mix by Rate Type
- **Definition:** Distribution of reservation counts across the top 5 `rate_type` values (mislabeled "Channel" — NOT the same taxonomy as §1.6).
- **Formula:** `chRows`: `GROUP BY rate_type ORDER BY cnt DESC LIMIT 5`, then `v = round((cnt / chTotal) * 100)` in JS.
- **Source:** `chRows` (`reservations` only).
- **Where shown:** **Nowhere currently** — `data.AD.ch` is fetched (part of `VIEW_QUERY_IDS['tp']`) but no component reads it. Likely dead/legacy code still queried on every Trade Partners load — see §10.9.
- **Decision history:** None found beyond original construction.

### Agent Pace — Gainers/Decliners (`AGENT_PACE`)

#### Agent Pace (Forward Room Nights vs Same-Lead-Time LY)
- **Definition:** Forward-window (next 12 months) Room Nights vs. the equivalent forward window a year ago, **as it stood at that point in time** — avoids the structural bias of comparing an in-progress number to a fully-realized one.
- **Formula:** `agentPaceRows`: `ty_nights` in `(CURDATE(), CURDATE()+1yr]`; `ly_nights_same_leadtime` in `(CURDATE()-1yr, CURDATE()]` bounded by `r.date_created <= CURDATE()-1yr`. `absVar = ty - ly`; `>=20`-night floor applied in JS on either side.
- **Source:** `agentPaceRows`.
- **Filters/exclusions:** `status='30'` only. §1.4, `AND_A`/`AND_P`.
- **Where shown:** AgentsView "Agent Pace — Gainers"/"Decliners" tables (top 10 each by `absVar`).
- **Caveats/gaps:** The naive version (forward vs. now-completed trailing-12mo total) was tested live and rejected: it showed every major established agent as a huge decliner (Cheli & Peacock -39.7%, Micato -55.4%) purely from comparing a still-accumulating number to an already-realized one. Corrected version: Cheli & Peacock -10.7%, Micato -28.1%.
- **Decision history:** **2026-07-14e** — built with the same-leadtime fix baked in from the start.

### Named Cancellation Drivers (`CANCEL_DRIVERS`, agent-scoped)

#### Cancelled Bookings / Nights Lost / Revenue Lost (per agent)
- **Definition:** Agents whose confirmed bookings were cancelled in the last 30 days, ranked by Room Revenue lost.
- **Formula:** `cancelDriverNightsRows` (bookings/nights) + `cancelDriverRevRows` (Room-Revenue-only $), merged by `agent_id`, sorted by `revenueLost` desc, top 15.
- **Source:** `cancelDriverNightsRows`, `cancelDriverRevRows`.
- **Filters/exclusions:** `status='90'` (cancelled) **AND `confirmation_date IS NOT NULL`**. Window: `last_change_date >= CURDATE() - 30 days`. §1.4, `AND_A`/`AND_P`.
- **Where shown:** AgentsView "Named Cancellation Drivers" table.
- **Caveats/gaps:** `last_change_date` validated as the correct "cancelled on" field over `updated_at` — 75% of all-time cancelled records fell in "the last 30 days" by `updated_at` (a nightly-sync artifact) vs. a plausible 3% by `last_change_date`. Without the `confirmation_date IS NOT NULL` filter, one agent (RS23) showed 10,263 all-time "cancelled bookings" — with the filter: 223.
- **Decision history:** **2026-07-14e** — built. **2026-07-14h (REVISED)** — added the missing `confirmation_date IS NOT NULL` filter.

### Low-Season Occupancy Lift (`LOW_SEASON_AGENTS`, agent-scoped)

#### Low-Season Room Nights / Revenue / % of Annual Business
- **Definition:** Per-agent Room Nights/Revenue in the low season (Feb–May), and what share of annual Room Revenue that represents — identifies agents already comfortable selling low season, as low-risk "push further" candidates.
- **Formula:** `lowSeasonByAgentRows`: `total_nights`/`total_revenue` (full calendar year) vs `low_nights`/`low_revenue` (months 2–5). `lowSeasonPct = round(lowSeasonRevenue/totalRevenue*1000)/10` (**Revenue-based**). Filtered to `totalNights >= 100`, sorted descending by `lowSeasonPct`, top 20.
- **Source:** `lowSeasonByAgentRows` (Room-Revenue-only).
- **Filters/exclusions:** `status='30'` only, full calendar year (`YEAR(i.date_in)=cy`, NOT `monthLo`/`monthHi`-bounded). §1.4, `AND_A`/`AND_P`.
- **Where shown:** AgentsView "Low-Season Occupancy Lift" table.
- **Caveats/gaps:** Feb–May window confirmed live against 2024+2025 portfolio-wide sold-nights-by-month — the only 4 months below the flat 8.3%-per-month share. The 100-night floor was itself tuned live (a 20-night floor let single lucky bookings hit a meaningless 100%). Portfolio's own Feb-May share of annual nights is ~15% — the implicit benchmark, though not displayed in the UI.
- **Decision history:** **2026-07-09** (Linda's Dashboard KPI #2) — built with a 20-night floor, same-day revised to 100-night floor.

### Market Segment Aggregates (`MARKET_SEGMENT_PERFORMANCE`)

#### Market Segment Revenue (Room Revenue by Segment)
- **Definition:** Room Revenue rolled up by Market Segment (9 values incl. Unallocated, §1.6), current period.
- **Formula:** One query per `MARKET_SEGMENT_VALUES` entry (9 total) — `rv.rv_cy`/`rv.rv_ly`, scoped by `buildAgentFilterSql('a', channel, segment)` rather than a SQL `GROUP BY` (Market Segment has no DB column, §1.6). Runs as a separate concurrent batch (`marketSegmentRawRows`).
- **Source:** the per-segment `marketSegments` query batch.
- **Filters/exclusions:** `status='30'` only. `r.agent_id IS NOT NULL`. §1.4 agent-ID/name exclusions — **note: no `AGENT_NAME_PATTERN_CARVEOUT_SQL`/`%direct%` LIKE exclusion appears in this query**, unlike `agRows`/`agPropRows`/etc. — see §10.11.
- **Where shown:** MarketSegmentPerformanceView bar chart + table, "Room Revenue" column.
- **Caveats/gaps:** Budget has no segment dimension at all — no Budget/variance column exists for this view by design.
- **Decision history:** **2026-07-15** — built, run concurrently with the main query batch for load-time reasons.

#### Market Segment Room Nights
- **Definition:** Room Nights rolled up by Market Segment, current period.
- **Formula:** Same per-segment query, `nt.nt_cy`/`nt.nt_ly` — `SUM(GREATEST(DATEDIFF(date_out,date_in),0))`.
- **Filters/exclusions:** `status='30'` only — differs from the agent-level leaderboard Nights convention (`status IN ('20','30')`), see §10.3.
- **Where shown:** MarketSegmentPerformanceView table, "Room Nights" column; denominator for segment ADR below.
- **Decision history:** **2026-07-15**.

#### Market Segment ADR
- **Definition:** Average daily rate within a Market Segment.
- **Formula:** `adr = roomNights > 0 ? round(roomRevenue / roomNights) : null` — JS-derived, no separate query.
- **Caveats/gaps:** Unlike some other ADR figures in this app (e.g. `agRows`' `nr_adr`, which mixes confirmed-only revenue with activity-basis nights), Market Segment ADR's two inputs are BOTH `status='30'` — no basis asymmetry here.
- **Decision history:** **2026-07-15**.

#### Market Segment YoY %
- **Definition:** Standard calendar year-over-year % change in Room Revenue for a segment — explicitly NOT the bounded-STLY re-anchor treatment used for Pipeline/Confirmed-Bookings elsewhere.
- **Formula:** `yoyPct = rvLy > 0 ? round(((roomRevenue - rvLy) / rvLy) * 1000) / 10 : null`.
- **Where shown:** MarketSegmentPerformanceView table "YoY %" column and bar-chart color (green=growth, red=decline, gray=no base).
- **Decision history:** **2026-07-15**.

#### Market Segment Active Agents
- **Definition:** Count of distinct active agents within a Market Segment, current period.
- **Formula:** `ag.active_agents = COUNT(DISTINCT r.agent_id)`.
- **Filters/exclusions:** `status IN ('20','30')` (activity basis, §1.1) — mixed into the same KPI row as its confirmed-only siblings above; same missing `%direct%` carve-out caveat as Market Segment Revenue — see §10.11.
- **Where shown:** MarketSegmentPerformanceView table, "Active Agents" column.
- **Decision history:** **2026-07-15**.

---

## 5. Pipeline/P&L & Consultants

### Pipeline Funnel

#### Total Forward Bookings
- **Definition:** Count and value of every active (not-yet-arrived) booking, confirmed or provisional combined — the top of the forward pipeline funnel.
- **Formula:** `total_ct = COUNT(CASE WHEN total_amount > 0 THEN 1 END)`, `total_val = SUM(IFNULL(total_amount,0))`, over a `SELECT DISTINCT r.reservation_number, r.status, r.provision_expiry_date, (KES-converted total_amount)` subquery — the `DISTINCT` collapses one row per reservation before summing. `pc` (funnel-bar fill) = 100.
- **Source:** query `plfRow`, `reservations` joined to `itineraries` (`i.date_in > CURDATE()`) and `rate_types`, assembled into `PLF[0]`.
- **Filters/exclusions:** `r.status IN ('20','30')` (§1.1 forward-booking rule), `i.date_in > CURDATE()`, `r.rate_type NOT IN NON_REV_IDS`, `reservation_number NOT LIKE 'PA%'` (§1.4), KES conversion (§1.3), plus `AND_P` if a property is selected.
- **Where shown:** Pipeline/P&L tab, `PipelineView.tsx` — "Pipeline Funnel" card, first bar.
- **Caveats/gaps:** Fixed fan-out bug — previously summed `r.total_amount` across all itinerary rows (2.92x inflation on `total_val`).
- **Decision history:** Pre-existing fan-out bug fixed via the `DISTINCT` subquery, same era as the other PLF/YTD/pipeline dedup fixes below.

#### Confirmed (Pipeline Funnel stage)
- **Definition:** The subset of Total Forward Bookings that are status Confirmed — second funnel stage.
- **Formula:** `cf_ct = COUNT(CASE WHEN status='30' AND total_amount > 0 THEN 1 END)`, `cf_val = SUM(CASE WHEN status='30' THEN total_amount ELSE 0 END)`, `pc = safePct(cf_ct, total_ct)` (percent of Total Fwd Bkgs).
- **Source:** query `plfRow` (same query as Total Forward Bookings), assembled into `PLF[1]`.
- **Filters/exclusions:** Same population as Total Forward Bookings, additionally `status='30'`.
- **Where shown:** Pipeline/P&L tab funnel row "Confirmed."
- **Caveats/gaps:** Distinct from the "Confirmed Bookings" KPI card (different bound — see below); do not conflate the funnel-stage count with the KPI card's count.
- **Decision history:** Same plfRow dedup fix.

#### Provisional (Pipeline Funnel stage)
- **Definition:** The subset of Total Forward Bookings on hold (status Provisional, "20").
- **Formula:** `pv_ct = COUNT(CASE WHEN status='20' AND total_amount > 0 THEN 1 END)`, `pv_val = SUM(CASE WHEN status='20' THEN total_amount ELSE 0 END)`, `pc = safePct(pv_ct, total_ct)`.
- **Source:** query `plfRow`, assembled into `PLF[2]`.
- **Filters/exclusions:** Same as Total Forward Bookings, `status='20'` per §1.1.
- **Where shown:** Pipeline/P&L tab funnel row "Provisional."
- **Decision history:** Same plfRow dedup fix.

#### Options Held
- **Definition:** A **subset of Provisional**, not an independent 5th funnel stage — provisional bookings whose hold (`provision_expiry_date`) has not yet lapsed. Indented/muted in the UI to signal it's not additive to the funnel total.
- **Formula:** `ho_ct = COUNT(CASE WHEN status='20' AND provision_expiry_date > CURDATE() AND total_amount > 0 THEN 1 END)`; **`pc = safePct(ho_ct, pv_ct)`** — percent of Provisional, deliberately not percent of Total Fwd Bkgs.
- **Source:** query `plfRow`, assembled into `PLF[3]`.
- **Where shown:** Pipeline/P&L tab — indented "↳ Options Held" row, "X% of Provisional — not counted separately in Total Fwd Bkgs."
- **Decision history:** Same plfRow dedup fix; the "subset, not stage" UI treatment appears deliberate.

#### YTD Arrivals
- **Definition:** Past check-ins so far this year — explicitly **not** part of the forward pipeline; a standalone stat, not a funnel stage.
- **Formula:** `ytd_ct = COUNT(*)`, `ytd_val = SUM(IFNULL(KES-converted total_amount,0))` over reservations whose `reservation_number` appears in a dedup subquery filtering `date_in < CURDATE()` in the full year `cy`.
- **Source:** query `ytdRow`. Assembled into `YTD_ARR = { ct, vl }`.
- **Filters/exclusions:** `r.status = '30'` only (§1.1 — completed/past population). `rate_type NOT IN NON_REV_IDS`, `PA%` exclusion (§1.4), KES conversion (§1.3), `AND_P_BARE`.
- **Where shown:** Pipeline/P&L tab, bottom strip of the "Pipeline Funnel" card, "Past check-ins this year · not part of forward pipeline."
- **Caveats/gaps:** Fixed fan-out bug: previously joined `itineraries` directly, inflating `ytd_val` 2.23x ($251M → $112M correct). Intentionally NOT a PLF funnel stage — comparing a past-dated population against forward-looking stages "would compare two disjoint populations."
- **Decision history:** Same-era fan-out/dedup fix family as `plfRow`/`kpiPipeline`.

#### Upcoming Arrivals (Next-Arrivals Table)
- **Definition:** A per-leg display list of the next 6 confirmed-or-provisional check-ins across the whole portfolio — a drill-down-ready table, not an aggregate metric.
- **Formula:** No aggregation — one row per itinerary leg: `ci = i.date_in`, `nt = DATEDIFF(...)`, `vl = IFNULL(i.total_gross_amount, r.total_amount)` (KES-converted), `st` mapped from `r.status`. `ORDER BY i.date_in ASC LIMIT 6`.
- **Source:** query `pltRows`. Assembled into `PLT`.
- **Filters/exclusions:** `i.date_in > CURDATE()`, `r.status IN ('20','30')`, `i.date_out > i.date_in`, §1.4, full agent exclusion set, property filter.
- **Where shown:** Pipeline/P&L tab, "Upcoming Arrivals" card/table; Agent/Property cells click through to their profile drill-downs.
- **Caveats/gaps:** Deliberately **not** deduplicated to one row per reservation (unlike the aggregate metrics above) — a multi-leg reservation legitimately shows multiple rows.
- **Decision history:** No dedicated fix noted.

### Pipeline KPIs

#### Confirmed Bookings (KPI card)
- **Definition:** Count of confirmed reservations checking in within a fixed forward 1-year window, compared against the same window shifted back exactly one year (STLY).
- **Formula:** Current: `COUNT(DISTINCT r.reservation_number)` where `status='30' AND i.date_in > CURDATE() AND i.date_in <= CURDATE()+1YEAR`. STLY: same shape shifted to `(CURDATE()-1YEAR, CURDATE()]`.
- **Source:** `kpiConfirmedBounded` (current), `kpiConfirmedStly` (comparison).
- **Filters/exclusions:** `rate_type NOT IN NON_REV_IDS`, `PA%` exclusion (§1.4), `total_amount > 0`, property filter.
- **Where shown:** `KP_BASE.pace.bookings` — fetched by the `pl` view too, though `PipelineView.tsx` itself only renders the `pipeline` sub-object, not `pace.bookings` directly.
- **Caveats/gaps:** An earlier open-ended STLY lookback was rejected: status='30' never expires, so it swept up an entire extra year of now-past confirmed bookings (13,910 vs. the live 4,451 — a -68% "delta" that was a measurement artifact). This bounded pair is intentionally separate from the unbounded `kpiConfirmed` used for Pace Index and Pipeline's own Conversion Rate below.
- **Decision history:** STLY-bounding fix (undated, logged alongside `kpiPipelineStly`).

#### Pipeline Value
- **Definition:** Total dollar value of open (provisional, not-yet-arrived) bookings.
- **Formula:** `pipeline_raw = SUM(IFNULL(KES-converted r.total_amount,0))` where `status='20'` and reservation_number is in a subquery of itineraries with `date_in > CURDATE()`. STLY comparison uses the identical shape with `CURDATE()` replaced by `CURDATE()-1YEAR`.
- **Source:** `kpiPipeline` / `kpiPipelineStly`; `KP_BASE.pipeline.val`.
- **Filters/exclusions:** `status='20'` (§1.1), §1.4, KES conversion (§1.3), property filter.
- **Where shown:** Pipeline/P&L tab KPI row, "Pipeline Value."
- **Caveats/gaps:** Fixed fan-out bug — previously 2.51x inflation ($20.3M → $8.1M correct). Comparison basis is STLY (not standard YoY) since this query is `CURDATE()`-relative with no calendar year of its own.
- **Decision history:** Fan-out/dedup fix (same era as `plfRow`/`ytdRow`); STLY re-anchoring added alongside `kpiConfirmedStly`.

#### Open Opportunities
- **Definition:** Count of open (provisional) reservations in the pipeline.
- **Formula:** `pipeline_opps = COUNT(CASE WHEN total_amount > 0 THEN 1 END)`, same WHERE/subquery as Pipeline Value.
- **Source:** `kpiPipeline` (current) / `kpiPipelineStly`; `KP_BASE.pipeline.opps`.
- **Where shown:** Pipeline/P&L tab KPI row, "Open Opportunities."
- **Caveats/gaps:** Feeds directly into Conversion Rate and Avg Deal Value below.
- **Decision history:** Same query fix history as Pipeline Value.

#### Pipeline Conversion Rate
- **Definition:** Share of all opportunities (confirmed + still-open/provisional) that have converted to Confirmed.
- **Formula:** `totalOpps = confirmedBkgs + pipelineOpps`; `convRate = ROUND(safePct(confirmedBkgs, totalOpps) * 10) / 10`. `confirmedBkgs` here is the **unbounded** `kpiConfirmed` count — not the bounded `kpiConfirmedBounded` used for the Confirmed Bookings KPI card.
- **Source:** `kpiConfirmed` + `kpiPipeline` (current), `kpiConfirmedStly` + `kpiPipelineStly` (STLY); `KP_BASE.pipeline.conv`.
- **Where shown:** Pipeline/P&L tab KPI row, "Conversion Rate"; also reused wholesale as Consultants tab's "Best Conv. Rate" (see below — see §10.4).
- **Decision history:** No dedicated fix beyond the underlying `kpiConfirmed`/`kpiPipeline` dedup fixes.

#### Avg Deal Value
- **Definition:** Average dollar value of an open (provisional) opportunity.
- **Formula:** `avgDeal = pipelineOpps > 0 ? ROUND((pipelineM * 1000 / pipelineOpps) * 10) / 10 : 0`. STLY variant is `undefined` (not 0) when `pipelineOppsStly` is 0.
- **Source:** derived in JS from `kpiPipeline`/`kpiPipelineStly`; `KP_BASE.pipeline.avg`.
- **Where shown:** Pipeline/P&L tab KPI row, "Avg Deal Value."
- **Decision history:** None dedicated; inherits Pipeline Value/Open Opportunities' history.

### Consultant Performance

#### Active Consultants
- **Definition:** Count of distinct consultants (`reservations.consultant` code) with at least one active booking in the selected period.
- **Formula:** `n_consult = COUNT(DISTINCT consultant)` where `status IN ('20','30')`, `consultant IS NOT NULL AND != ''`, `total_amount > 0`.
- **Source:** `kpiConsult` (current) / `kpiConsultLy` (standard YoY, calendar-anchored); `KP_BASE.consult.n`.
- **Filters/exclusions:** §1.1 (active/pipeline), §1.4, date range via `date_created` (§1.7).
- **Where shown:** Consultants tab KPI row, "Active Consultants."
- **Decision history:** None dedicated.

#### Consultant Total Bookings (KPI)
- **Definition:** Total booking count across all active consultants in the period.
- **Formula:** `total_bkgs = COUNT(*)`, same WHERE clause as Active Consultants.
- **Source:** `kpiConsult` / `kpiConsultLy`; `KP_BASE.consult.bkgs`.
- **Where shown:** Consultants tab KPI row, "Total Bookings."
- **Decision history:** None dedicated.

#### Avg Revenue per Consultant
- **Definition:** Average Agent Room Revenue attributable per active consultant in the period.
- **Formula:** `avgRevK = nConsult > 0 ? ROUND((arevM * 1000) / nConsult) : 0`. LY variant `undefined` (not 0) when `nConsultLy` is 0.
- **Source:** `kpiAgentRev` (numerator) combined with `kpiConsult` (`n_consult`, denominator); `KP_BASE.consult.avg`.
- **Caveats/gaps:** **Population mismatch, not called out in code** — the numerator (Agent Room Revenue) is scoped by `agent_id` and `i.date_in`, while the denominator (Active Consultants) is scoped by the separate `consultant` field and `date_created` — two different dimensions and date bases. See §10.4.
- **Where shown:** Consultants tab KPI row, "Avg Rev/Consultant."
- **Decision history:** No dedicated fix; assembled from two independently-fixed queries.

#### Best Conv. Rate (Consultants KPI)
- **Definition:** Not an independently-computed per-consultant metric — reuses the Pipeline tab's overall Conversion Rate value wholesale.
- **Formula:** Identical `convRate` variable as Pipeline Conversion Rate.
- **Source:** `kpiConfirmed` + `kpiPipeline` (same as Pipeline Conversion Rate); `KP_BASE.consult.top`.
- **Where shown:** Consultants tab KPI row, "Best Conv. Rate" / "top consultant."
- **Caveats/gaps:** Code comment is explicit: reuses Pipeline's rate "held per standing instruction alongside Pipeline's cards." The label "top consultant" is misleading — there is no per-consultant conversion-rate computation anywhere. See §10.4.
- **Decision history:** Explicitly a "standing instruction," not a bug.

#### Consultant Booking Count (table column)
- **Definition:** Number of active bookings handled by a given consultant in the period; also the table's sort/rank key (top 10 shown).
- **Formula:** `bk = COUNT(CASE WHEN r.total_amount > 0 THEN 1 END)`, grouped by `r.consultant`, `ORDER BY bk DESC LIMIT 10`.
- **Source:** `cdRows` (the `counts` subquery, reservations-only); `CD[].bk`.
- **Filters/exclusions:** `status IN ('20','30')` (§1.1), consultant present, §1.4, date range on `date_created`.
- **Where shown:** `ConsultView.tsx` "Consultant Performance" table, "Bookings" column.
- **Caveats/gaps:** Counts (`bk`/`cv`) deliberately keep a *different* population/join shape than `rv`/`extras` in the same row (see below) — to avoid the `rate_components` join fanning out the reservation-level COUNT.
- **Decision history:** 2026-07-09 (Tier 3): revenue split out of the booking-count query specifically to avoid the fan-out.

#### Consultant Room Revenue (table column)
- **Definition:** Confirmed Room Revenue attributed to a consultant in the period (Extras reported separately, §1.2).
- **Formula:** `rv = ROOM_REVENUE_SUM_SQL / 1000` (in $k), grouped by `r.consultant`, LEFT JOIN'd onto the booking-count row.
- **Source:** `cdRows` (the `rev` subquery); `CD[].rv`.
- **Filters/exclusions:** `status='30'` **only** (differs from `bk`/`cv`'s `IN ('20','30')` in the same row — deliberate, per §1.1).
- **Where shown:** `ConsultView.tsx` table, "Room Revenue ($k)" column.
- **Decision history:** **2026-07-07** (status-mixing audit) — gated to `status='30'`. **2026-07-09** (Tier 3) — moved to component-level Room/Extras split, split into its own subquery to avoid fan-out.

#### Consultant Extras Revenue (table column)
- **Definition:** Extras revenue attributed to a consultant — additive, never summed into Room Revenue.
- **Formula:** `extras = EXTRAS_SUM_SQL / 1000` (in $k), same subquery/join as Consultant Room Revenue.
- **Filters/exclusions:** Same as Consultant Room Revenue. **Uses only `rate_components`-classified Extras, NOT the separate `extras` table** — see §10.12: unlike `kpiAgentRev`/`kpiRevNights`, `cdRows` does not appear to merge in Day Use/extras-table revenue.
- **Where shown:** `ConsultView.tsx` table, "Extras ($k)" column.
- **Decision history:** Same as Consultant Room Revenue (2026-07-07, 2026-07-09 Tier 3).

#### Consultant Share of Bookings
- **Definition:** Each consultant's booking count as a percentage of all active bookings in the period (portfolio-wide, not just the displayed top 10).
- **Formula:** `cv = bk * 100.0 / (correlated COUNT(*) over all reservations with status IN ('20','30') + standard exclusions)`.
- **Source:** `cdRows`; `CD[].cv`.
- **Caveats/gaps:** The denominator lacks a `consultant IS NOT NULL` filter (present in the numerator) — so `cv` is genuinely "% of all bookings including unassigned," not "% of bookings among consultants" — the displayed consultants' `cv` values will not sum to 100%. Not documented in any code comment.
- **Where shown:** `ConsultView.tsx` table, "Share" column.
- **Decision history:** No dedicated fix comment.

#### Consultant YoY (cg/up chip)
- **Definition:** Year-over-year change in a consultant's Room Revenue, signed % chip.
- **Formula:** `cg = signedPct(rv, lyRv)`; `up = rv > lyRv`. `lyRv` from `cdLyMap`, keyed by consultant code.
- **Source:** current-year `rv` from `cdRows`; prior-year from `cdLyRows`.
- **Filters/exclusions:** Both sides `status='30'` only, matched filters, Room-Revenue-only on both sides.
- **Where shown:** `ConsultView.tsx` table, "YoY" column.
- **Caveats/gaps:** Before the fixes below, this chip had `cg` hardcoded `'+0%'` and `up` derived from list position (placeholder/fake data) — now a real YoY comparison.
- **Decision history:** **2026-07-07** (status-mixing audit, gated to `status='30'`); **2026-07-09** (Tier 3, switched to Room-Revenue-only via rate_components).

---

## 6. Booking Status Movement, Cancellation Drivers & Low Season Agents

### Booking Status Movement

Source view: `src/components/views/BookingStatusMovementView.tsx`, data key `BOOKING_STATUS_MOVEMENT`, assembled from `VIEW_QUERY_IDS['booking-status-movement']` = `bookingConfirmedProvisionalByMonth`, `bookingCancelledByMonth`, `bookingNewConfirmedByMonth`, `bookingConversionRow`. Deliberately **no drill-down table** — this view is about movement over time, not comparing discrete entities.

Each bucket uses a genuinely **different date basis**, deliberately, not an inconsistency:
- Confirmed/Provisional: `i.date_in` (stay date)
- New Confirmed: `r.date_created` (booking intake)
- Cancelled: `r.last_change_date`, gated by `r.confirmation_date IS NOT NULL`

$ values here are `total_amount` (currency-converted per §1.3), matching Pace/Pipeline's "booking value" convention — **not** the Room-Revenue-only split (§1.2) used by Occupancy/Property Performance/Cancellation Drivers, since this view tracks overall booking-status flow, not room-revenue accounting.

#### Confirmed (by month)
- **Definition:** Total value/count of bookings whose stay falls in the selected period and are currently status Confirmed.
- **Formula:** Reservation-deduped (`MIN(i.date_in)` per `reservation_number`) so `total_amount` isn't inflated by itinerary-leg fan-out. Summed/grouped by `MONTH(first_date_in)`. Currency-converted per §1.3.
- **Source:** `bookingConfirmedProvisionalByMonth` — `reservations` JOIN `itineraries` JOIN `agents`, LEFT JOIN `rate_types`.
- **Filters/exclusions:** `r.status IN ('20','30')` (Confirmed branch = `'30'`), period/year via §1.7 sargable range, `r.rate_type NOT IN NON_REV_IDS` (§1.4), `PA%` exclusion, plus market/channel (`AND_A`) and property (`AND_P`) filters. No agent-name/agent-ID exclusion list applied here — deviation from most agent-scoped metrics, though the `agents` join exists (used only for `AND_A`).
- **Where shown:** KPI card "Confirmed" + monthly trend chart.
- **Decision history:** Built 2026-07-15 as part of the 4 new top-level views.

#### Provisional (by month)
- **Definition:** Total value/count of bookings whose stay falls in the selected period and are currently status Provisional.
- **Formula:** Same query/dedup as Confirmed; `status='20'` branch of the same CASE aggregation.
- **Filters/exclusions:** Identical to Confirmed above. Per §1.1, Provisional here is legitimate — this is an active/forward-booking metric.
- **Where shown:** KPI card "Provisional" + monthly trend chart.
- **Decision history:** 2026-07-15 build.

#### Cancelled (by month)
- **Definition:** Confirmed bookings that were subsequently cancelled, counted/valued in the month cancelled (not the month of the original stay).
- **Formula:** `COUNT(DISTINCT reservation_number)` and `SUM(total_amount)`, grouped by `MONTH(r.last_change_date)`. No itinerary join needed — no fan-out risk.
- **Source:** `bookingCancelledByMonth`.
- **Filters/exclusions:** `r.status='90' AND r.confirmation_date IS NOT NULL` — the validated Cancellation Drivers methodology. Period via `dateInYearMonthRange('r.last_change_date', ...)`.
- **Where shown:** KPI card "Cancelled" (red accent) + monthly trend chart.
- **Decision history:** Reuses the `confirmation_date IS NOT NULL` fix originally validated for Cancellation Drivers (2026-07-14h) — built into this query from the start (2026-07-15).

#### New Confirmed (by month)
- **Definition:** Bookings both *created* and already Confirmed within the selected period.
- **Formula:** `COUNT(*)` and `SUM(total_amount)` grouped by `MONTH(r.date_created)`. No itinerary join.
- **Source:** `bookingNewConfirmedByMonth`.
- **Filters/exclusions:** `r.status='30' AND r.total_amount > 0`, period via `date_created`.
- **Where shown:** MiniStatRow "New Confirmed" + monthly trend chart line.
- **Caveats/gaps:** A genuinely different population from Confirmed above (which is `i.date_in`, stay-date basis) — this tracks bookings CREATED and confirmed within the window.
- **Decision history:** 2026-07-15 build; moved from full KPI card to MiniStatRow 2026-07-09 (display only).

#### Booking Conversion Rate (Provisional → Confirmed)
- **Definition:** Share of the in-period pipeline that genuinely converted from a **pre-existing** Provisional state to Confirmed — excluding bookings created and confirmed in the same period (those belong to New Confirmed instead).
- **Formula:** `total_ct` counts a deduped subquery (`status IN ('20','30') OR (status='90' AND prov_date IS NOT NULL)`, `i.date_in` basis). `confirmed_ct`/`confirmed_val` = only `status='30'` rows whose `date_created` falls **outside** the current period. `ratePct = confirmed_ct / total_ct * 100`.
- **Source:** `bookingConversionRow`.
- **Where shown:** MiniStatRow "Provisional → Confirmed" — tooltip: "Only counts bookings that were Provisional before this period and converted within it."
- **Caveats/gaps:** The displayed rate reads as "share of the pipeline that converted from a pre-existing Provisional state," not a raw confirmed-count rate.
- **Decision history:** **2026-07-09 fix** — see Net Pick-up entry below for the full before/after. Prior to this fix, "Provisional → Confirmed" counted 7,075 bookings / $22.4M, exactly 100% of the whole Confirmed bucket (a pure double-count). After: 3,325 bookings / $15.06M, a genuine non-overlapping subset.

#### Net Pick-up
- **Definition:** Net change in confirmed pipeline value for the period — new business gained minus confirmed business lost to cancellation.
- **Formula:** `netPickup = newConfirmed.value + provisionalToConfirmed.value − cancelled.value`.
  - **The double-count bug and its fix:** Before 2026-07-09, "Provisional → Confirmed" counted every Confirmed booking with a prior Provisional-eligible history, which was exactly the same population as the whole Confirmed bucket (100% overlap, $22.4M/7,075 bookings). Net Pick-up was then double-counting the same bookings under two addends, inflating the total to **$38.3M**.
  - **The fix:** redefine "Provisional → Confirmed" to *exclude* bookings whose `date_created` also falls inside the current period (those belong to New Confirmed instead), making the two addends mutually exclusive by construction. Net Pick-up after the fix: **$31.35M**.
- **Source:** Derived in JS from `bookingNewConfirmedByMonth` + `bookingConversionRow` + `bookingCancelledByMonth`. No new query.
- **Where shown:** KPI card "Net Pick-up," tooltip: "New Confirmed... + Provisional → Confirmed... − Cancelled. The two conversion sources are mutually exclusive by date_created, so this is a non-overlapping net figure."
- **Caveats/gaps:** **Stale-comment discrepancy found during this audit** — `src/types/index.ts` (above `BookingStatusMovementData`) still describes the two populations as able to "overlap for a booking created AND confirmed-for-a-stay within the same window" — this describes the **pre-fix** behavior. Post-2026-07-09, the two populations are deliberately made non-overlapping. The type-file comment was not updated to match and should be corrected. See §10.1.
- **Decision history:**

  | Metric | Before (pre-2026-07-09) | After (2026-07-09 fix) |
  |---|---|---|
  | Provisional → Confirmed | $22.4M / 7,075 bookings (100% of Confirmed) | $15.06M / 3,325 bookings |
  | Net Pick-up | $38.3M (inflated) | $31.35M |

  Verified live via dev server against `/api/dashboard?period=y&year=2026`. Thread closed out 2026-07-09.

#### Waitlisted
- **Definition:** N/A — not a real metric, kept as a placeholder card only. No waitlist status code exists in ResRequest (only 0/10/20/30/90).
- **Where shown:** MiniStatRow "Waitlisted" card, "Not Tracked."
- **Decision history:** Full-size "Waitlisted" card dropped 2026-07-09 (it was never counting anything), replaced with this placeholder. Booking Amendments dropped entirely at the same time (no version/amendment-count column exists in the schema).

### Cancellation Drivers

Data key `CANCEL_DRIVERS`, built from `cancelDriverNightsRows` + `cancelDriverRevRows`.

**Verified reality check:** neither `execNarrative.ts` nor `ExecutiveStoryPanel.tsx` reads `CANCEL_DRIVERS` or `LOW_SEASON_AGENTS` today — `dashboardViews.ts` explicitly documents both as unread by the narrative. The only component that actually renders `CANCEL_DRIVERS`/`LOW_SEASON_AGENTS` is `AgentsView.tsx` (Trade Partners / `tp` view) — see §4 for the agent-scoped documentation of these same metrics (documented once there to avoid duplication).

### Low Season Agents

Data key `LOW_SEASON_AGENTS`, built from `lowSeasonByAgentRows`. See §4's "Low-Season Occupancy Lift" entry for the full formula/caveats — documented there since `AgentsView.tsx` is the only consumer.

---

## 7. Daily Tab & Non-Revenue API

*(References §1.1–§1.8 = Shared Conventions; not repeated here.)*

Unlike the portfolio-aggregate views, the Daily tab is reservation/booking-level detail — three KPI-summary numbers plus three underlying reservation tables, all scoped to a rolling arrival window rather than a fiscal period. `/api/non-revenue` is a separate, currently UI-less audit endpoint that deliberately quarantines non-commercial revenue away from every headline figure elsewhere in the app.

### Daily Arrivals / Provisionals (`/api/daily`, `DailyView.tsx`)

Single endpoint, `?window=` (allowed `3|7|14|21`, default 3), plus optional `?consultant=` and `?property=` params scoping the entire tab. Property values are whitelisted against `VALID_PROPERTY_IDS` (2026-07-16 fix — Daily was the last view left unfiltered). A reusable `AGENT_EXCLUSION_SQL` fragment (§1.4's full bundle) is applied to every one of the six parallel queries.

#### Arrivals Next 3 Days
- **Definition:** Count of distinct confirmed reservations arriving at any property in the next 3 calendar days — a fixed window, independent of the T-minus toggle.
- **Formula:** `COUNT(DISTINCT r.reservation_number) WHERE status='30' AND i.date_in BETWEEN CURDATE() AND CURDATE()+3d`, plus `AGENT_EXCLUSION_SQL` and optional consultant/property filters.
- **Where shown:** `DailyView.tsx` KPI card "Arrivals Next 3 Days."
- **Caveats/gaps:** Card also carries a permanently-null "need action" sub-metric — no balance-outstanding/voucher-status fields exist anywhere in ResRequest (confirmed via full schema search).
- **Decision history:** Built 2026-07-03; property-filter join added 2026-07-16.

#### Provisionals Expiring This Week
- **Definition:** Count of distinct provisional reservations whose hold expires in the next 7 days.
- **Formula:** `COUNT(DISTINCT r.reservation_number) WHERE status='20' AND r.provision_expiry_date BETWEEN CURDATE() AND CURDATE()+7d`.
- **Where shown:** `DailyView.tsx` KPI card "Provisionals Expiring This Week."
- **Caveats/gaps:** Genuine data-quality gap: 471 of 1,277 open provisionals (37%) already have a `provision_expiry_date` in the past but are still status='20' — status doesn't auto-transition on expiry. An "Overdue" bucket doesn't exist yet — flagged, not built. This KPI itself correctly excludes those past-due rows.
- **Decision history:** Built 2026-07-03; itinerary join added 2026-07-16 for the property filter.

#### Expiring Provisionals Value
- **Definition:** Total booking value at risk across the provisional holds expiring this week.
- **Formula:** Client-side sum of the Expiring Provisionals table's `value` field (see below).
- **Caveats/gaps:** Underlying query is `LIMIT 20` — if more than 20 provisionals are expiring, this KPI **undercounts** the true value at risk.
- **Decision history:** Added 2026-07-09 (4-card standard).

#### Booking Value — Upcoming Arrivals (T-window)
- **Definition:** Total booking value (a proxy for cash/revenue exposure, not a confirmed outstanding balance) for confirmed reservations arriving within the selected T-minus window.
- **Formula:** Deduped subquery, `status='30' AND total_amount > 0 AND i.date_in BETWEEN CURDATE() AND CURDATE()+windowDays`, summed after dedup to one row per reservation.
- **Caveats/gaps:** No payment-ledger table exists in ResRequest — confirmed via a full schema search across every table for payment/paid/balance/deposit/outstanding/voucher — none exist. This figure is a proxy, "Actual payments are tracked in Opera" per the UI tooltip.
- **Decision history:** Built 2026-07-03.

#### Confirmed Arrivals table (Next N Days)
- **Definition:** List of confirmed reservations arriving within the selected window, one row per reservation-per-property.
- **Formula:** `GROUP BY r.reservation_number, ..., i.property, ...`, `MIN(i.date_in)` as arrival date, room count, KES-converted balance.
- **Caveats/gaps:** A genuine multi-property circuit still shows as separate rows per property-stay, but multiple rooms at the same property/date collapse into one row with a room count — confirmed via `accommodation_type` differing while property/dates were identical. Guest column uses `reservation_name`, not `guest_name` (does not exist).
- **Decision history:** Room-split/rollup fix applied in a later session than the 2026-07-03 original build.

#### Expiring Provisionals table
- **Definition:** List of up to 20 provisional reservations whose hold expires within 7 days, one row per reservation.
- **Formula:** `ROW_NUMBER() OVER (PARTITION BY reservation_number ORDER BY date_in ASC, itinerary_id ASC)`, keeps `rn_leg=1`, `LIMIT 20`.
- **Caveats/gaps:** Dedup keeps only the earliest leg, so `value` may understate a multi-leg provisional's true exposure. `LIMIT 20` caps both this table and the Expiring Provisionals Value KPI derived from it.
- **Decision history:** Built 2026-07-03; MySQL 8.0.44 window-function availability confirmed live at build time.

#### Booking Value table (Next N Days)
- **Definition:** List of confirmed reservations with value > 0 arriving within the selected window — same scope as Confirmed Arrivals, but **not** rolled up.
- **Caveats/gaps:** **Known, deliberately unfixed inconsistency** — this table has the identical root-cause construction as Confirmed Arrivals' pre-fix state (still per-leg, not rolled up); the room-split fix was scoped only to the Confirmed Arrivals table.
- **Decision history:** Built 2026-07-03; explicitly excluded from the later room-rollup fix.

#### Consultant filter list
- **Definition:** Dropdown of named consultants used to scope the whole Daily tab.
- **Formula:** `SELECT DISTINCT r.consultant, CONCAT(first_name,' ',last_name)`, `status IN ('20','30')`, name fields non-null.
- **Caveats/gaps:** ~28% of active reservations have a `consultant` ID but no matching name and are silently excluded from the dropdown (not from the underlying KPI/table filtering, which filters on the raw ID).
- **Decision history:** Built 2026-07-03.

### Non-Revenue Bookings (`/api/non-revenue`)

A standalone audit endpoint — **not currently wired to any UI component**. Approved 2026-07-08: both categories below are real, calculated figures, but must NOT be added to Room Revenue, Extras, or any Total shown on the main Sales/Trade Partners/Occupancy views. Basis: `status='30'` only, `i.date_in`, all channels (portfolio-wide audit, no agent filter), `i.date_out > i.date_in`.

#### Pass-Through Fees
- **Definition:** Sum of pass-through fee/tax components on **revenue-bearing** bookings, broken out by fee type (Conservation Fee, Park Fees, Infrastructure Tax, Concession Fee, Waitlist).
- **Formula:** Per fee group, currency-converted sum, `status='30'`, `rate_type NOT IN NON_REV_IDS` — critically **includes** the non-revenue-rate-type exclusion so a fee on a FAM/Comp/Staff booking doesn't double-count here AND in Non-Revenue Business below.
- **Caveats/gaps:** ALL "Park Fees*"/"Conservation Fee*" variants are 100% Kenya-linked in live data (confirmed 8 July 2026) — zero Tanzania rows. `WAITLIST_COMPONENTS` is $0 always.
- **Decision history:** Groupings approved 2026-07-08.

#### Non-Revenue Business
- **Definition:** Total itinerary value of bookings under non-commercial rate types (Complimentary, FAM Stay, Staff Rate, TNC Staff), broken out by category.
- **Formula:** Per category group, `SUM(IFNULL(...total_gross_amount...))`, `status='30'`, `rate_type IN (<category's rate-type list>)` — the exact inverse of every other revenue metric's exclusion.
- **Caveats/gaps:** Rate-type lists partition `NON_REVENUE_RATE_TYPE_IDS` exactly (7+13+16+14=50, confirmed by count match). No reservation-level dedup applied (unlike the Daily tab's Cash Outstanding KPI).
- **Decision history:** Groupings approved 2026-07-08.

#### Grand Total (non-revenue)
- **Definition:** Combined Pass-Through Fees + Non-Revenue Business — money moving through the system deliberately excluded from every revenue-facing metric elsewhere in the app.
- **Decision history:** Approved 2026-07-08.

---

## 8. Finance Tab (Sand River Property)

**Scope note:** This is a standalone finance-specific module (`FinanceView.tsx`, `src/lib/sandRiverFinance.ts`, `FinanceNarrativePanel.tsx`), entirely independent of the shared `/api/dashboard` payload and of §1's ResRequest/MySQL-derived conventions. Data source is manually-imported MIS data (a hand-extracted Excel workbook), not a live DB query — §1.1–§1.8 do **not** apply here; this section documents its own separate conventions. A RECON panel reconciling this data against ResRequest was explicitly scoped out and does not exist.

### Data Source & Refresh Model

#### Sand River MIS Extraction
- **Definition:** The single upstream data source for the entire Finance tab — a manually re-extracted snapshot of Sand River Mara Eco Camp's Actual/Budget/Last-Year P&L figures.
- **Formula:** Read from `SRM_Full_Workbook_Real_Data.xlsx`'s `'SRM'` tab (a 45-tab workbook — read **by name**, never by index) via `src/data/_extract_srm.py`, which writes the static `src/data/sandRiverFinance.json`.
- **Caveats/gaps:** Re-extraction is still a hand-pasted JSON replacement each month, no auto-pick-current-month logic (per the user's explicit "simple manual refresh" call). A missed monthly re-extraction silently leaves the prior month's snapshot live.
- **Decision history:** 2026-07-10 re-extraction fixed a prior "No Selection" month-selector bug in the source sheet — Actual/Budget/Last Year are now all real for MTD/YTD/Annualised. Report period = 2026-06-01.

#### Report Period
- **Definition:** The calendar month the current MIS snapshot represents (independent of the app's global date filters, which this tab ignores).
- **Formula:** Static value from workbook cell `D3`; `{ label: 'Jun', month: 6, year: 2026 }`.
- **Where shown:** `FinanceView.tsx` header + period-toggle button labels.

### Period Toggle (MTD / YTD / Annualised)

#### Period Selector
- **Definition:** Three time-window views — MTD, YTD, Annualised — over the same data.
- **Formula:** Deliberately **local component state**, NOT the Topbar's shared global `filters.period` (the global filter cluster is hidden for this view). Maps to workbook column triples.
- **Caveats/gaps:** **Annualised Actual is a blended figure** — actual-to-date + forecast, since the year isn't over. Treat as part-actual/part-forecast, not a completed-year figure.

### KPI Cards (Net Revenue, Contribution to HO, EBITDA, Net Profit)

#### Net Revenue (Sand River)
- **Definition:** Total net revenue for the selected period, Actual vs Budget vs Last Year.
- **Formula:** Direct cell read, workbook row 111. `variancePct = round((actual-budget)/abs(budget)*1000)/10`, `null` if budget is 0/None.
- **Where shown:** KPI card row; also P&L table `netRevenue` row; feeds `FinanceNarrativePanel`.
- **Decision history:** 2026-07-10 — became real data.

#### Contribution to HO
- **Formula:** Direct cell read, workbook row 15.
- **Decision history:** 2026-07-10 real-data cutover.

#### EBITDA (Sand River)
- **Formula:** Direct cell read, workbook row 18.
- **Where shown:** KPI card row; the Net Profit Waterfall's largest single driver of a Net Profit miss is typically an EBITDA-adjacent HO cost line, per the narrative.
- **Decision history:** 2026-07-10 real-data cutover.

#### Net Profit (Sand River)
- **Definition:** Bottom-line net profit for the period (labelled `NOP` in the P&L table).
- **Formula:** Direct cell read, workbook row 23. KPI key `netProfit` reads the same row as P&L line key `nop`.
- **Caveats/gaps:** Can be negative (a loss) — `fmtMoney` explicitly preserves the sign.
- **Decision history:** 2026-07-10 real-data cutover.

#### Variance (Absolute & %)
- **Formula:** `varianceAbs = round(actual - budget)`; `variancePct = round((actual-budget)/abs(budget)*1000)/10`, both `null` if inputs missing/budget=0.
- **Caveats/gaps:** For cost lines stored negative in the sheet, value-minus-budget already equals the correct signed variance without separate magnitude math — documented explicitly to avoid a future double-negation bug.

### 4-Tier RAG Classification

#### RAG Status (green / amber / red / deepRed)
- **Definition:** A severity classification of Actual vs Budget vs Last-Year — extends the rest of the app's 3-tier scheme with a 4th tier specific to Finance.
- **Formula** (`rag()` in `_extract_srm.py`):
  ```python
  def rag(actual, budget, last_year):
      if actual is None or budget is None: return None
      if actual >= budget: return 'green'
      if budget != 0 and actual >= budget * 0.95: return 'amber'
      if last_year is not None and actual >= last_year: return 'red'
      return 'deepRed'
  ```
  green = at/above budget; amber = below budget but within 5%; red = >5% below budget but at/above last year; **deepRed = >5% below budget AND below last year**.
- **Where shown:** KPI card border/accent color; colors green `#3B6D11`, amber `#B7632A`, red `#C0392B`, deepRed `#7B1A1A` (`RAG_DEEP_RED`, `designTokens.ts`).
- **Caveats/gaps:** `amber`'s hex (`#B7632A`) is the same as `CHART_COLORS.trend` (terracotta) elsewhere in the app — a possible visual-ambiguity risk, not flagged as an issue anywhere, just an observation. Last Year is never shown on the KPI card face but is required to compute the 4-tier RAG and used in the narrative's YoY commentary — a silent input.
- **Decision history:** Introduced with the 2026-07-16 design pass; real values populated once Actual data became real (2026-07-10).

### Data-Status Badges (NDL / TBC / ok)

#### Data Status
- **Definition:** A tri-state completeness/confidence flag per KPI or P&L line — distinct from RAG (performance-severity) — availability/trust judgment.
- **Formula:** `'ndl'` = No Data Loaded; `'tbc'` = To Be Confirmed; `'ok'` = live, verified. As of 2026-07-10, all 4 KPIs and all populated P&L lines are `'ok'` except 3 `topDriver{1,2,3}` placeholders, hardcoded `'ndl'`.
- **Caveats/gaps:** "No current Finance line item is genuinely TBC" — the styling/logic exists and is kept-ready but has no live use today.
- **Decision history:** Real cutover 2026-07-10.

### Chart-Level Data Status

#### Chart Status (ndl / budget-only / ok)
- **Definition:** A separate 3-state flag gating which series a chart can draw.
- **Formula:** `'ndl'` → EmptyState. `'budget-only'` → dashed Budget-only series + note. `'ok'` → both series. For the Net Profit Waterfall specifically, `'budget-only'` is treated the same as `'ndl'` since it's inherently a variance chart.
- **Decision history:** Comment dated 2026-07-16.

### Monthly Series (Budget vs Actual)

#### Monthly Budget / Actual Revenue, Managed Costs, Imposed Costs
- **Formula:** Direct cell reads across a 12-column row range. Actual side uses `actual_or_null()` — returns `null` (not `0`) for any month index at or after the current month (elapsed-months-only).
- **Caveats/gaps:** Chart.js renders a null point as a gap — the correct visual for "not yet actualized," not a fabricated dip to zero.
- **Decision history:** 2026-07-10 real-data cutover (Actual side was previously always null).

### Net Profit Waterfall (Bridge Chart)

#### Net Profit Waterfall Bridge Steps
- **Definition:** A 6-bar bridge chart: `Budget NP → Revenue Var → Managed Cost Var → Imposed Cost Var → HO Cost Var → Actual NP`.
- **Formula:** Bars 1 and 6 are `'total'` bars anchored at 0; bars 2-5 are floating bridges equal to that P&L line's variance, colored green/red by sign; totals use `budgetGold`.
- **Caveats/gaps:** Bar 6 is NOT required to land where bar 5's bridge ends — the gap, if any, is real D&A/Finance Cost/other-non-EBITDA variance the 4-bar bridge deliberately doesn't cover.
- **Decision history:** Built to the exact 6-bar spec in the source SKILL.md §17.

### Profit & Loss Table

#### P&L Line Items (Summary / Detail modes)
- **Definition:** A 16-row P&L breakdown with a Summary/Detail toggle.
- **Formula:** Each line has per-period `value`/`budget`/`variance` — direct cell reads per a fixed row map. `TOTAL_ROW_KEYS` render as highlighted total rows; `nop` alone renders bold.
- **Caveats/gaps:** Cost rows keep the sheet's own sign (already negative) — no flipping anywhere.
- **Decision history:** Real Actual data landed 2026-07-10; fields changed from a flat value to a per-period record at that point, since the table must show the Actual/Variance for whichever period tab is selected.

### Executive Narrative (Finance)

#### Finance Executive Narrative
- **Definition:** A deterministic, template-generated headline + body + 3 KPI pills — visually a dark-themed sibling panel, not a reuse of Sales Executive Summary's panel.
- **Formula:** Headline: YTD Net Revenue variance vs budget, Net Profit swing to loss/profit. Body: YTD vs LY, largest EBITDA driver, RAG-based behind-budget-and-LY callout, provenance/caveat line. Pills: June Occupancy, Cost per $1 Revenue MTD, YTD EBITDA Gap to Budget.
- **Caveats/gaps:** `fmtk()` reports magnitude only, direction expressed in words — avoids a double-negative like "a -$263.7K loss." No personalized greeting (no user-identity/auth system).
- **Decision history:** 2026-07-16, alongside the broader Exec Summary narrative work that same date.

### Out of Scope (explicitly, for this tab)

- **RECON (ResRequest vs MIS reconciliation)** — explicitly excluded from scope; no comparison between this tab's numbers and the main dashboard's ResRequest-derived numbers should be assumed possible.
- **AI Query Box / MotherDuck / DuckDB queries** — explicitly out of scope, never build them here.

---

## 9. Drill-down / Profile API routes

Covers `src/app/api/agent/[agentId]/route.ts`, `src/app/api/property/[propertyId]/route.ts`, `src/app/api/market-segment/[segment]/route.ts`, `src/app/api/agents/top/route.ts`, and `src/app/api/agents/search/route.ts`, plus the panels that render them. All conventions build on §1.1–§1.8; only route-specific deviations are called out.

**Standing pattern across this whole area:** a "list capped at N, separate COUNT query is the true total" idiom recurs for every table inside Agent Profile — the displayed list is `LIMIT 20`, but the header/"+N more" figure comes from an unbounded `COUNT(DISTINCT reservation_number)` sibling query. **A value SUM computed by summing only the visible rows is therefore a floor, not the true total, whenever the count exceeds 20** — see §10.5/§10.6.

### Agent Profile

Route: `src/app/api/agent/[agentId]/route.ts`. Panel: `AgentProfilePanel.tsx` (also reused, subset of fields, by `AgentPerformanceDrillPanel.tsx`).

No agent-name/id exclusion filter (§1.4) is applied anywhere in this route — the agent was already selected via search or a rendered row, both of which already exclude test/direct agents upstream.

#### Revenue YTD + YoY
- **Formula:** `ROOM_REVENUE_SUM_SQL` (§1.2), `i.date_in` basis, `status='30'` only; `revenueYtdLy` is the identical query with `ly = cy-1`.
- **Where shown:** `AgentProfilePanel.tsx` "Room Revenue YTD" stat + YoY badge.
- **Caveats/gaps:** `revenueYtdLy` is a real value, always present (0 only if genuinely no confirmed revenue last year) — the panel suppresses the YoY badge entirely (not a 0%/Infinity%) when LY is 0.
- **Decision history:** FIX 2026-07-07 (status-mixing audit) — `status IN ('20','30')` → `'30'` only. FIX 2026-07-08b (Tier 2) — dedup-via-DISTINCT removed, switched to a direct `rate_components`-based subquery.

#### Extras YTD + YoY
- **Formula:** `EXTRAS_SUM_SQL` + extras-table Day Use sum for two hardcoded property/accommodation-type pairs, summed in JS.
- **Caveats/gaps:** Hardcoded Day Use property/accommodation-type pairs rather than a data-driven flag — a new Day Use product/property needs a manual code update or it's silently excluded.
- **Decision history:** Same 2026-07-08b restructure; extras-table broadening 2026-07-13.

#### Room Nights
- **Formula:** `SUM(GREATEST(DATEDIFF(date_out,date_in),0))`, actualized (`date_out <= CURDATE()`), own subquery (no `rate_components` join, avoids fan-out).
- **Caveats/gaps:** Uses the `date_in`-basis nights pattern (matching `kpiRevNights`), deliberately NOT the `date_created`-based nights pattern also present in the codebase (`kpiAgentRev`'s `lg` subquery) — two different nights bases coexist in the app.
- **Decision history:** No dedicated fix beyond inheriting `dashboard/route.ts`'s pattern.

#### ADR
- **Formula:** `ROUND(room_rev / GREATEST(total_nights,1))`, same actualized-stay population as Room Nights.
- **Decision history:** FIX 2026-07-08 — numerator was blended `total_gross_amount`, now Room-Revenue-only.

#### Conversion Rate / Materialisation
- **Formula:** `safePct(confirmed_ct, total_ct)`; denominator is `status IN ('20','30') OR (status='90' AND prov_date IS NOT NULL)`.
- **Where shown:** `AgentProfilePanel.tsx` "Conversion Rate"; `AgentPerformanceDrillPanel.tsx` "Materialisation" (same field, different label).
- **Decision history:** Major fix — denominator previously `status IN ('20','30')` only, silently excluding bookings held Provisional and later Cancelled. Verified live against Qlik for Asilia Africa Limited (WA54, 2026): old query gave 95%; Qlik's "Material % (space held)" showed 24.4%. Recomputed with cancelled-but-was-provisional rows included: 25.9%, landing next to Qlik's figure.

#### Property Breakdown (revenue / extras / bookings / % of total per property)
- **Formula:** Room Revenue/Extras (`status='30'`) + Day Use extras merged, top 10 by revenue. Bookings = `COUNT(DISTINCT reservation_number)` over the wider `status IN ('20','30')`.
- **Caveats/gaps:** `rv` and `bookings` in the same row have different status populations by design. **`AgentPerformanceDrillPanel`'s "Properties Produced" stat is silently truncated at 10** (`propertyBreakdown.length`) if an agent has business at more than 10 properties (portfolio max is 18) — no separate true-count query exists for this one. See §10.6.
- **Decision history:** FIX 2026-07-07 (status-mixing); FIX 2026-07-08 (Room Revenue/Extras split, Day Use merged in).

#### Confirmed Arrivals Upcoming (count + total value)
- **Formula:** `status='30'`, next 30 days, grouped by reservation+property, `LIMIT 20`. True count: separate unbounded `COUNT(DISTINCT reservation_number)`.
- **Caveats/gaps:** **List capped at 20; `confirmedArrivalsTotalCt` is the true total** — a client-side sum of the 20 visible rows is a floor whenever an agent has more than 20 upcoming arrivals; no true summed total value is exposed. Deliberately does NOT use the Conversion Rate's `prov_date`-inclusive widening — a currently-Confirmed booking's provisional history is irrelevant to whether it belongs in this list.
- **Decision history:** Same room-split idiom as the Daily tab's Confirmed Arrivals table.

#### Provisional Bookings Pending (count + value + expiring-soon threshold)
- **Formula:** `status='20'`, `LIMIT 20`, ordered by arrival date. True count: separate unbounded query. Expiring-soon UI threshold: `daysToExpiry <= 2` (a client-side constant, not API-returned).
- **Caveats/gaps:** Same "list capped at 20, count is the true total" pattern as Confirmed Arrivals.
- **Decision history:** `provision_expiry_date` confirmed as the real field (same one proven reliable in the Daily tab, 2026-07-03).

#### Cancellation History (all-time cancelled bookings / nights lost / revenue lost)
- **Formula:** `status='90' AND confirmation_date IS NOT NULL`, `LIMIT 20`. Revenue lost from a separate Room-Revenue-only query, merged by reservation number. Summary totals (unbounded) feed the true `totalCancelledBookings`/`totalNightsLost`/`totalRevenueLost`.
- **Where shown:** `AgentPerformanceDrillPanel.tsx` only — NOT shown in `AgentProfilePanel.tsx`.
- **Caveats/gaps:** Same list-capped-at-20 pattern, but here the API DOES return a true summed value total (`totalRevenueLost`) in addition to the true count — unlike Confirmed Arrivals/Provisional Bookings.
- **Decision history:** Built 2026-07-14g. **REVISED 2026-07-14h**: without the `confirmation_date IS NOT NULL` filter, RS23 alone showed 10,263 "cancelled bookings" / 48,465 "nights lost" all-time. With the filter: 223 bookings / 1,196 nights — a 97.8% reduction. `last_change_date` validated live the same night as the correct "when cancelled" field.

#### First Booking Date
- **Formula:** `MIN(date_created)`, all-time, deliberately **no status filter** — "the relationship history includes quotes/cancellations, not just confirmed business."
- **Where shown:** Footer "First Booking" (formatted WITH year, unlike the panel's near-term arrival/expiry dates which omit it).

#### Assigned Consultant
- **Formula:** Most-recent-reservation snapshot (`ORDER BY date_created DESC LIMIT 1`), display name from `consultant_first_name`/`last_name` (not the `WBxxxx` code).
- **Caveats/gaps:** A "most-recent-reservation" snapshot, not a stored assignment field.

#### Commission
- **Formula:** `rv_commission_perc` from the same most-recent-reservation snapshot, mapped to a known tier name (`COMMISSION_TIERS`) when it matches exactly.
- **Caveats/gaps:** `rv_commission_perc` is real (never NULL) but exactly 0.00 on 99.76% of ALL reservations app-wide — a displayed 0% is far more likely "not populated for this record" than a genuine zero. The panel shows an explicit caveat note in this case.

#### Country (header)
- **Formula:** `agent_physical_country || agent_postal_country || null`.
- **Caveats/gaps:** Physical and postal country can genuinely differ (confirmed live — one agent showed physical=South Africa, postal=Mauritius).

#### Channel / Market Segment (header)
- **Formula:** `lookupAgentSegment(agent_name)` — see §1.6.
- **Decision history:** FIX 2026-07-13 — replaced a placeholder with the real CSV-backed lookup.

### Property Profile

Route: `src/app/api/property/[propertyId]/route.ts`. Panel: `PropertyProfilePanel.tsx`. Opened only from Property Performance — shows exactly that view's own KPI set, no monthly trend chart, no arrivals/cancellation history (that richer shape belongs to Agent Profile).

**Route-wide basis note:** hardcoded to full-year 2026 (not parameterized by `year`), because of its Budget Variance dependency on `budget2026Monthly.json` (§1.8) — "same full-year-2026-fixed basis as dashboard/route.ts's PROPERTY_PERFORMANCE so the table and the panel never disagree."

Unlike Agent Profile, this route DOES apply the full §1.4 exclusion set to its Top Agents query — "this is a ranking across MANY agents."

#### Room Revenue / Extras Revenue / RevPAR / Occupancy % / ADR / Room Nights Sold / Budget Variance %
- Same formulas/sources as §3's property-level entries (`roomRevRow`, `extrasRow`+`dayUseExtrasRow`, `nightsRow`, `PROPERTY_ROOM_COUNTS`, `getPropertyBudget`) — this route mirrors `dashboard/route.ts`'s `budgetActualByPropRows`/`extrasByPropRows`/`revparNightsRows`/property-budget logic exactly, scoped to one property.
- **Caveats/gaps:** Subject to §1.5's property-level caveats registry throughout — LEPC never reaches this route at all (nothing to click); NXR/LSC caveats surface via `profile.caveat` (from `PROPERTY_REVPAR_CAVEATS`), rendered as a warning Alert in the panel.

#### Top Agents (per property: revenue / nights / % of property total)
- **Definition:** Top 10 agents by Room Revenue contributing to this property, full-year 2026 — the inverse of Agent Profile's propertyBreakdown.
- **Formula:** Two-subquery join (revenue via rate_components, nights via a separate non-joined subquery). `pctOfPropertyTotal` computed in JS.
- **Filters/exclusions:** Full §1.4 exclusion set (unlike Agent Profile's own route).
- **Caveats/gaps:** **Hard-capped at 10, with no corresponding true-count query** — unlike Agent Profile's lists, there is no "+N more" indicator and no unbounded count exposed; if a property has more than 10 contributing agents, the remainder are simply invisible (silent truncation). See §10.6.
- **Decision history:** Built 2026-07-15.

### Market Segment Profile

Route: `src/app/api/market-segment/[segment]/route.ts`. Panel: `MarketSegmentProfilePanel.tsx`. Opened only from Market Segment Performance. **Unlike** Property Profile, this route is NOT hardcoded to 2026 — accepts `year`/`period`/`channel` and applies the same `i.date_in`-basis month bounding as `/api/dashboard`, so this drill-down never contradicts the table it was opened from.

#### Room Revenue / Room Nights / ADR / YoY %
- Same basis as §4's Market Segment aggregates (`status='30'`, §1.7 sargable range, §1.4 exclusions, §1.6 segment filter via `buildAgentFilterSql`). YoY is standard calendar YoY (a separate `lyRow` query, `cy-1`, same month window) — NOT the bounded-STLY treatment Pipeline/Confirmed-Bookings use.

#### Active Agents
- **Formula:** `COUNT(DISTINCT r.agent_id)`, `status IN ('20','30')` (§1.1 activity basis) — wider than its Room Revenue/Nights/ADR/YoY siblings in the same overview, which are `status='30'`-only. See §10.7.
- **Decision history:** Built 2026-07-15.

#### Property Breakdown (per property: revenue / nights, within segment)
- **Definition:** Every property this segment's confirmed business touches — NOT top-N capped (properties are naturally ≤18 portfolio-wide).
- **Where shown:** `MarketSegmentProfilePanel.tsx` "Property Breakdown" table — clickable through to Property Profile.

#### Agent Breakdown (top 10 agents: revenue / nights, within segment) + total count
- **Formula:** Same two-subquery join pattern as Property Profile's Top Agents, `LIMIT 10`. True count: separate `COUNT(DISTINCT agent_id)` query, unbounded.
- **Caveats/gaps:** Same "list capped (at 10 here), count field is the true total" pattern as Agent Profile's lists — a revenue sum over only the visible 10 rows is a floor whenever the true count exceeds 10. Unlike Property Profile's Top Agents (no count at all), this route DOES expose a true count alongside the capped list.
- **Decision history:** 10-cap chosen because "segments can have far more member agents than a single property's top contributors."

### Agent Search / Top Agents

Two small endpoints feeding the global "Find Agent" search — not profile routes, but the entry point into Agent Profile.

#### Top Agents (default "Find Agent" suggestions)
- **Definition:** Top 12 agents by Room Revenue, default dropdown suggestions before typing. Global (Topbar), not scoped to any one view's data batch.
- **Formula:** `status='30'`, `date_created`-basis (note: NOT `i.date_in` like most other revenue queries), `LIMIT 12`.
- **Caveats/gaps:** A deliberately trimmed copy of `agRows` (same revenue definition, same ordering) WITHOUT the nights/ADR sub-joins, since the dropdown only needs id+name. Cached in-process 5 minutes, keyed by filter combo — a result can be stale for up to 5 minutes after underlying data changes.
- **Decision history:** FIX 2026-07-10 — previously read off `data.AD.yearly`, which only existed after the Trade Partners view's own batch had loaded, so the dropdown showed "No data" on every other tab until the user visited Trade Partners first. Rebuilt as its own independent, Topbar-global endpoint.

#### Agent Search (typed query)
- **Definition:** Free-text search over agent names, activated at 2+ characters, Trade Partners tab only.
- **Formula:** `agent_name LIKE '%q%'`, `ORDER BY agent_name ASC LIMIT 20`. No revenue computation, no date filter.
- **Caveats/gaps:** Pure alphabetical name match, no revenue/ranking signal at all — unlike Top Agents' revenue-ranked list.

---

## 10. Audit findings — inconsistencies discovered while building this dictionary

These surfaced organically while 8 parallel reviewers traced every metric's actual code — none were the target of a deliberate hunt, so treat this as a partial, not exhaustive, list. None are urgent production bugs (nothing here misstates money to a user without at least a partial caveat already in place), but several are worth a deliberate decision rather than sitting undiscovered.

1. **Stale comment describing pre-fix Net Pick-up behavior** (`src/types/index.ts`, above `BookingStatusMovementData`) — still describes `newConfirmed`/`provisionalToConfirmed` as able to overlap for a booking created-and-confirmed in the same window. That was true before the 2026-07-09 fix; post-fix the two are deliberately mutually exclusive. The UI tooltip already states the corrected claim — only the type-file comment is stale. **Low-risk, easy fix**: update the comment to avoid a future contributor "fixing" an already-fixed bug based on stale documentation. See §6.

2. **Forward Booking Pace (`pfRows`) still uses raw blended `total_amount`**, unlike its sibling Monthly Booking Pace (`pdRows`), which was fixed 2026-07-16 to Room-Revenue-only (§1.2). The two charts sit next to each other on the Pace tab and could easily be assumed to share a basis. See §2.

3. **Pace Index has an unflagged numerator/denominator status-set mismatch** — numerator (`kpiConfirmed`) is `status='30'` only, denominator (`kpiLyBkgs`) is `status IN ('20','30')`. Not documented anywhere in code. Also, agent-leaderboard Nights/ADR use `status IN ('20','30')` (activity basis) in the same row as Agent Room Revenue's `status='30'`, while Market Segment Nights uses `status='30'` only — three different conventions for "nights," each individually defensible per §1.1, but not shared across the app. See §2, §4.
   **RESOLVED as documented-and-intentional, 2026-07-17** (not requiring further decision) — investigated after a client flagged Pace Index (-12.9%) diverging sharply from Confirmed Bookings (-56.3%) on the same tab. This status-set piece turned out to be a minor contributor; the dominant cause is a *separate*, also-intentional difference (fixed calendar-period window vs. rolling today-relative window) — see §2's Confirmed Bookings/Pace Index entries for the full investigation, live numbers, and why the two are deliberately not unified. Both KPI cards now carry a caption + tooltip stating this.

4. **Avg Revenue per Consultant** divides an agent/stay-date-scoped revenue figure by a consultant/booking-date-scoped headcount — two different dimensions and two different date bases mixed into one ratio. Separately, **"Best Conv. Rate" on the Consultants tab is literally the Pipeline tab's portfolio-wide Conversion Rate**, not a per-consultant figure, despite the "top consultant" caption — confirmed intentional by a code comment ("held per standing instruction"), but worth reconfirming that instruction still stands before treating it as expected, documented behavior. See §5.

5. **"Properties Produced" is silently truncated at 10** in `AgentPerformanceDrillPanel.tsx` (`propertyBreakdown.length`, itself capped by a `LIMIT 10` query) — an agent producing at more than 10 of the portfolio's 18 properties will show an undercounted stat with no indication it's capped. See §9.

6. **Property Profile's Top Agents list is hard-capped at 10 with no true-count query at all** — unlike every other capped list in this app (Agent Profile's Confirmed Arrivals/Provisional/Cancellation, Market Segment Profile's Agent Breakdown), there is no "+N more" indicator and no unbounded count exposed. A property with more than 10 contributing agents silently loses the rest. See §9.

7. **Market Segment Profile's "Active Agents" mixes `status IN ('20','30')`** into the same KPI overview row as its Room Revenue/Nights/ADR/YoY siblings, which are all `status='30'`-only — consistent with §1.1's activity-vs-revenue convention individually, but easy to misread as apples-to-apples with its neighbors on the same card row. See §9.

8. **Two unrelated "Channel" concepts coexist**: `AD.yearly[].ch` (the real §1.6 Market Segment/Channel taxonomy, per-agent) vs. `AD.ch`/`chRows` (a `rate_type`-grouped array, unrelated, and apparently **dead code** — fetched on every Trade Partners load but not rendered by any component found in this audit). Worth either removing the unused query or repurposing it. See §4.

9. **`radr` naming collision across two levels**: `KP_BASE.agents.radr` means **Avg Length of Stay** (a naming collision, not an ADR at all — code itself acknowledges this is confusing), while `AD.yearly[].r_adr` means **resident-rate ADR** (a real ADR figure), and `AD.yearly[].nr_adr` means non-resident/portfolio ADR. Three similarly-named fields, three different meanings, at two different levels of the same payload. See §4.

10. **Two mislabeled cards/charts on the Occupancy tab**: "Occupancy by Property" is actually a relative-bookings index (not `soldNights/availableNights` — the real occupancy % exists elsewhere on the same page, in the RevPAR table's "Occ%" column), and "Revenue by Property" actually plots **ADR per property**, not a revenue total (the caption underneath correctly says "ADR," but the prominent heading doesn't match). These are the two most user-facing findings in this list — worth a quick label fix (or, for the first, a data-source change) since both cards sit directly next to the genuinely-correct occupancy%/revenue figures elsewhere on the same tab. See §3.

11. **Market Segment aggregate queries (Revenue and Active Agents) appear to omit the `%direct%` name-pattern exclusion carve-out** (`AGENT_NAME_PATTERN_CARVEOUT_SQL`) that every agent-level leaderboard query includes — worth confirming with the team whether this is intentional (a segment total is expected to differ slightly from a sum of its member agents) or a gap that should be closed for exact reconciliation. See §4.

12. **Consultant Extras Revenue** only sums `rate_components`-classified Extras — unlike `kpiAgentRev`/`kpiRevNights` at the KPI level, it does not appear to merge in Day Use/`extras`-table revenue. A Day-Use-heavy consultant's true extras total could understate on this table relative to the KPI-level treatment of the same concept elsewhere. See §5.

13. **`kpiAgentRev`'s own two subqueries use different date bases** — the revenue side (`rev`) filters on `i.date_in` while the sibling Portfolio ADR/Avg Length of Stay side (`lg`) filters on `r.date_created`. Already flagged in-code as "a pre-existing asymmetry... flagged for a future decision," reproduced here so it isn't lost. See §4.

---

## 11. Maintenance notes

- **`diagnose_change` (AI Query Box, `src/lib/aiQuery/diagnoseChange.ts`) works from a fixed, hand-picked bundle of signals and does not automatically discover new dashboard metrics.** Whenever a new metric or major feature is added to the dashboard, revisit whether `diagnose_change`'s bundle should be extended to include it — this requires a deliberate build-and-test step, not an automatic update.

---
