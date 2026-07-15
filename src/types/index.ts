export interface PaceData {
  months: string[]
  actual: number[]
  ly: number[]
}

export interface PipelineFutureItem {
  mo: string
  cf: number
  pv: number
  wt: number
  cv: string
  pval: string
  bg: number
}

export interface OccupancyData {
  props: { nm: string; id: string | null; oc: number; ar: number }[]
  arr: { months: string[]; act: number[]; ly: number[]; extras: number[]; extrasLy: number[] }
}

export interface AgentYearly {
  id: string
  nm: string
  rv: number
  extras: number
  nt: number
  nr_adr: number
  r_adr: number
  ch: string
  // Market Segment — from the segment mapping CSV's "New Market Segment" column (INT. AGENT,
  // DMC, DMC (International Presence), INT. DIRECT, LOCAL DIRECT, CLOSED USER GROUPS, DIGITAL,
  // STAFF STAYS) or 'Unallocated' — see src/lib/agentSegments.ts.
  mkt: string
  up: boolean
  cg: string
  // Country (2026-07-14f) — agent_physical_country preferred, agent_postal_country fallback,
  // null if neither set. Same precedence as Agent Profile's header (see src/app/api/agent/
  // [agentId]/route.ts).
  country: string | null
  // Properties Produced (2026-07-14f) — COUNT(DISTINCT property) this agent booked, same
  // period/basis as rv/nt (r.date_created, cy/monthLo/monthHi).
  propertiesProduced: number
  // Materialisation/Conversion Rate (2026-07-14f) — Faith's confirmed methodology, exact
  // replica of Agent Profile's own conversionRate field, GROUPed across every agent. Fixed to
  // full calendar year (YEAR(i.date_in)=cy), NOT the selected monthLo/monthHi period — see
  // route.ts's agentConversionRows query comment for why.
  conversionRate: number
}

// Agent directory (2026-07-16b, Agent Leaderboard payload trim) — lightweight sibling to
// AgentYearly, one entry per agent (ALL of them, not capped), used only by SesAgentSearch.tsx's
// "Find Agent" so every agent stays searchable even though AgentData.yearly itself is now capped
// to the top 150 by revenue. Just the 4 fields SesAgentSearch needs: id (onSelectAgent), nm +
// country (its filterOptions stringify), mkt (kept for the same segment-badge convention as
// AgentYearly, not currently rendered by SesAgentSearch but cheap to include).
export interface AgentDirectoryItem {
  id: string
  nm: string
  country: string | null
  mkt: string
}

export interface AgentData {
  // Top 150 by revenue (agRows is already ORDER BY rv_raw DESC) — full field set, unchanged
  // shape from before the 2026-07-16b trim. See yearlyDirectory below for the full agent list.
  yearly: AgentYearly[]
  // ALL agents (same population as `yearly` would have been pre-trim, ~833), minimal fields only.
  yearlyDirectory: AgentDirectoryItem[]
  byProp: { pr: string; id: string | null; rv: number; ly: number; extras: number; extrasLy: number }[]
  byMonth: { months: string[]; act: number[]; ly: number[]; extras: number[]; extrasLy: number[] }
  occByMonth: { months: string[]; act: number[]; ly: number[] }
  adr: { months: string[]; nr: number[]; res: number[] }
  ch: { lb: string; v: number; co: string }[]
}

export interface PipelineFunnelItem {
  st: string
  ct: number
  vl: string
  pc: number
}

// YTD Arrivals is a standalone stat, not a PLF funnel stage — it compares a
// past-dated population (arrivals so far this year) against the funnel's
// forward-looking (date_in > CURDATE()) stages, so it has no meaningful "% of
// total" within PLF. See PipelineView.tsx.
export interface YtdArrivalsStat {
  ct: number
  vl: string
}

export interface PipelineTableItem {
  ag: string
  agentId: string
  pr: string
  propertyId: string | null
  ci: string
  nt: number
  vl: string
  st: string
}

export interface ConsultantItem {
  nm: string
  bk: number
  rv: number
  extras: number
  cv: string
  cg: string
  up: boolean
}

export interface KpiMetric {
  v: number
  fmt: string
  lbl: string
  d: string
  // Optional (2026-07-16 design pass) — cards with no genuine good/bad threshold (e.g. a raw
  // portfolio total with no target) omit these and render a neutral accent bar instead of a
  // fabricated RAG verdict. See KpiRow.tsx's rag().
  thG?: number
  thY?: number
  inv?: boolean
  // Real prior-year value, same units as v. Omitted when no genuine LY query
  // exists for this card — KpiRow renders no YoY % in that case rather than
  // fabricating one.
  ly?: number
  // True for cards whose `ly` is a same-time-last-year (STLY) comparison — i.e.
  // an anchor-shifted-back-a-year query, not "this year's total vs last year's
  // total" for the same calendar period. Used by forward-looking, CURDATE()-
  // relative metrics (Pipeline, Confirmed Bookings) that have no year to swap.
  // KpiRow renders these with an explicit "STLY" tag so they're not mistaken
  // for a standard YoY comparison.
  stly?: boolean
  // True for cards whose `ly` slot carries a Budget comparison value (2026 monthly Budget CSV —
  // see src/lib/budget.ts) rather than a real prior-year or STLY value. KpiRow renders these
  // with a "BUDGET" tag, same mechanism as the STLY tag above.
  budget?: boolean
}

export interface KpiBase {
  pace: {
    bookings: KpiMetric
    rev: KpiMetric
    idx: KpiMetric
    budgetMtd: KpiMetric
    budgetYtd: KpiMetric
    lead: KpiMetric
  }
  occ: {
    nights: KpiMetric
    adr: KpiMetric
    rev: KpiMetric
    extras: KpiMetric
    cancel: KpiMetric
    // Portfolio-wide RevPAR / Occupancy % (Sales Executive Summary KPI row, 2026-07-15) —
    // aggregated across the same 15 "clean" properties as REVPAR.byProperty (excludes LEPC
    // [no property record], NXR [pre-opening], LSC [refurb, non-typical-year capacity] — see
    // dashboard/route.ts). No `ly` yet: no prior-year property-level capacity query exists to
    // build a real comparator, so no YoY badge is shown rather than fabricating one.
    revpar: KpiMetric
    occPct: KpiMetric
  }
  agents: {
    active: KpiMetric
    arev: KpiMetric
    extras: KpiMetric
    nradr: KpiMetric
    radr: KpiMetric
  }
  pipeline: {
    val: KpiMetric
    opps: KpiMetric
    conv: KpiMetric
    avg: KpiMetric
  }
  consult: {
    n: KpiMetric
    bkgs: KpiMetric
    avg: KpiMetric
    top: KpiMetric
  }
  // Sales Executive Summary "Pace row" (2026-07-15) — three portfolio-wide pace RATIOS
  // (100 = on target), distinct from pace.* above which are absolute $/count cards used by
  // the full Pace tab. vsForecast covers only the rolling 3-month forecast window that
  // FORECAST.byMonth actually has data for (see that field's `d` caption for the exact months)
  // — never silently rolled up across all 12 months.
  execPace: {
    vsBudget: KpiMetric
    vsForecast: KpiMetric
    vsStly: KpiMetric
  }
}

// Property-level Budget vs Actual (2026-07-13) — full-year 2026 fixed, see
// src/lib/budget.ts for the underlying data source and Afrochic caveat. variancePct is
// null (not 0 or Infinity) when a property has no budget set, e.g. Afrochic.
export interface BudgetByPropertyItem {
  propertyId: string
  property: string
  actual: number
  budget: number
  variancePct: number | null
}

export interface BudgetData {
  byProp: BudgetByPropertyItem[]
}

// Forecast Room Nights (2026-07-14) — Dennis's revenue-manager formula:
// Forecast = Confirmed Nights + (Provisional Nights x 30%) + Adjusted Pick-Up - Expected
// Cancellations. See src/app/api/dashboard/route.ts's Forecast query block/assembly comments
// for the exact basis of each piece. budgetNights is the same 2026 Budget CSV used elsewhere
// (src/lib/budget.ts) for that single target month, so Forecast/Budget can sit side by side.
export interface ForecastMonthItem {
  year: number
  month: number
  monthLabel: string
  confirmedNights: number
  provisionalComponent: number
  adjustedPickup: number
  expectedCancellations: number
  forecastNights: number
  budgetNights: number
}

export interface ForecastData {
  byMonth: ForecastMonthItem[]
  // This-year-vs-last-year forward booking pace ratio used to scale Adjusted Pick-Up — see
  // kpiForecastPace in route.ts. 1 = pacing exactly even with last year at the same lead time.
  paceRatio: number
  // Full-year-LY cancellation rate used for Expected Cancellations. REVISED 2026-07-14c:
  // cancelled-after-confirmed (status='90' AND confirmation_date IS NOT NULL) ÷ ever-confirmed
  // (confirmation_date IS NOT NULL) — 9.7% for 2025, matching Faith's 5-10% expectation. NOT the
  // same as KP_BASE.occ.cancel's 59.9%, which measures a different, much broader population
  // (all quotes/provisionals, not just genuinely-confirmed-then-cancelled bookings) — see
  // kpiForecastCancelLyFullYear in route.ts. NOT period-filtered — full year always.
  cancelRateLy: number
}

// RevPAR by property (2026-07-14d) — full-year 2026, confirmed only, Room-Revenue-only basis
// (NOT blended with Extras). Available Room Nights comes from Dennis's PROPERTY_ROOM_COUNTS
// capacity file (src/lib/constants.ts). `caveat` is non-null for 3 properties with known capacity
// gaps (LEPC: no property record at all; NXR: pre-opening, genuinely $0; LSC: stale
// typical-year denominator) — always show the caveat text rather than a bare number or a blank.
// revenue/nights/revpar/adr/occPct are all null only for LEPC (propertyId is null — nothing to
// query); NXR and LSC still compute real (if caveated) numbers.
export interface RevParPropertyItem {
  propertyName: string
  propertyId: string | null
  roomRevenue: number | null
  soldNights: number | null
  availableNights: number
  revpar: number | null
  adr: number | null
  occPct: number | null
  caveat: string | null
}

export interface RevParData {
  byProperty: RevParPropertyItem[]
}

// Property Performance (2026-07-15) — one row per property, merging RevParPropertyItem's
// Room Revenue/RevPAR/Occ%/ADR/Room Nights Sold/caveat with Budget Variance % and Extras Revenue.
// Same 18-property PROPERTY_ROOM_COUNTS list as RevParPropertyItem (not the Budget file's own 17 —
// see budget.ts's Afrochic caveat), so caveat properties (LEPC/NXR/LSC) appear as rows with a
// caveat rather than being silently dropped, same convention as RevParPropertyItem itself.
export interface PropertyPerformanceItem {
  propertyId: string | null
  propertyName: string
  country: string
  keys: number
  roomRevenue: number | null
  extrasRevenue: number | null
  revpar: number | null
  occPct: number | null
  adr: number | null
  soldNights: number | null
  budgetVariancePct: number | null
  caveat: string | null
}

// Property Profile Panel's Top Agents table (2026-07-15) — the inverse of Agent Profile's
// propertyBreakdown (agent -> their properties): here, property -> its top agents. Top 10 by
// Room Revenue, pctOfPropertyTotal = this agent's Room Revenue / the property's total Room
// Revenue x 100 — same convention as Agent Profile's propertyBreakdown query.
export interface PropertyTopAgent {
  agentId: string
  agentName: string
  roomRevenue: number
  roomNights: number
  pctOfPropertyTotal: number
}

// Property Profile Panel (2026-07-15) — deliberately tight, scoped to exactly what the Property
// Performance table itself shows (per the context-aware drill-down standing instruction: a panel
// opened from a given view shows that view's own KPI set, not a generic one). No monthly trend
// chart, no arrivals/cancellation history — see Agent Profile/Agent Performance drill-down for
// that richer, differently-scoped shape.
export interface PropertyProfile {
  propertyId: string
  propertyName: string
  country: string
  keys: number
  roomRevenue: number | null
  extrasRevenue: number | null
  revpar: number | null
  occPct: number | null
  adr: number | null
  soldNights: number | null
  budgetVariancePct: number | null
  caveat: string | null
  topAgents: PropertyTopAgent[]
}

// Market Segment Performance (2026-07-15) — one row per Market Segment value (see
// agentSegments.ts's MARKET_SEGMENT_VALUES, including Unallocated). Period/year-filtered, same
// convention as Agent Room Revenue (i.date_in basis, status='30', respects the selected
// year/period) — NOT full-year-2026-fixed like Property Performance, since there's no Budget
// dependency here forcing that basis. yoyPct is standard calendar YoY (this period vs the same
// period last year), same pattern as Agent Room Revenue's own YoY — NOT the bounded-STLY
// re-anchor treatment used for forward-looking Pipeline/Confirmed-Bookings cards. No Budget
// column — budget_2026_monthly.csv has no segment/channel dimension, confirmed infeasible rather
// than approximated with a pro-rata proxy.
export interface MarketSegmentPerformanceItem {
  segment: string
  roomRevenue: number
  roomNights: number
  adr: number | null
  yoyPct: number | null
  activeAgents: number
}

export interface MarketSegmentPropertyBreakdown {
  propertyId: string | null
  propertyName: string
  roomRevenue: number
  roomNights: number
}

export interface MarketSegmentAgentBreakdown {
  agentId: string
  agentName: string
  roomRevenue: number
  roomNights: number
}

// Market Segment Profile (2026-07-15) — deliberately tight, same principle as Property Profile:
// shows exactly Market Segment Performance's own KPI set. agentBreakdown is capped at 10 (see
// agentBreakdownTotalCount for the "+N more" indicator, same pattern as Agent Profile's Active
// Bookings tables) rather than a hard cap or an unbounded list — segments can have far more
// member agents than a single property's top contributors.
export interface MarketSegmentProfile {
  segment: string
  roomRevenue: number
  roomNights: number
  adr: number | null
  yoyPct: number | null
  activeAgents: number
  propertyBreakdown: MarketSegmentPropertyBreakdown[]
  agentBreakdown: MarketSegmentAgentBreakdown[]
  agentBreakdownTotalCount: number
}

// Agent Pace, Winners/Losers (2026-07-14e) — Trade Partners tab. Same-leadtime STLY basis (this
// year's forward-window nights vs last year's forward-window nights AS THEY STOOD at the
// equivalent point in time, bounded by date_created) — NOT the naive forward-vs-completed-window
// comparison, which was tested live and rejected for systematically showing every large
// established agent as a huge decliner. See agentPaceRows in route.ts for the full story.
// pctVar is null when lyNights is 0 (no meaningful ratio, e.g. a brand-new agent).
export interface AgentPaceItem {
  agentId: string
  agentName: string
  tyNights: number
  lyNights: number
  absVar: number
  pctVar: number | null
}

export interface AgentPaceData {
  gainers: AgentPaceItem[]
  decliners: AgentPaceItem[]
}

// Named Cancellation Drivers (2026-07-14e) — Trade Partners tab. Last 30 days by
// r.last_change_date (validated as the correct "when cancelled" field — date_created is booking
// intake, updated_at is a generic sync timestamp), Room-Revenue-only $ (not blended with Extras).
// Sorted by revenueLost descending, top 15.
export interface CancellationDriverItem {
  agentId: string
  agentName: string
  cancelledBookings: number
  nightsLost: number
  revenueLost: number
}

// Low-Season Occupancy Lift (2026-07-09, Linda's Dashboard KPI #2) — Trade Partners tab. Low
// season = Feb/Mar/Apr/May, confirmed live against 2024+2025 portfolio-wide sold-nights-by-month
// (see the lowSeasonByAgentRows query in route.ts for the full seasonality read) — the only 4
// months below the flat per-month share, a clear contiguous trough with April as the deepest
// point. lowSeasonPct is Revenue-based (lowSeasonRevenue / totalRevenue), full calendar year,
// Room-Revenue-only basis (matches every other agent revenue figure on this tab). Minimum 100
// annual room nights, sorted descending by lowSeasonPct, top 20 — see route.ts's own comment for
// why (proven low-season sellers surfaced first, as the lowest-risk "push further" candidates;
// the 100-night floor keeps tiny agents whose one lucky booking hits 100% from crowding it out).
export interface LowSeasonAgentItem {
  agentId: string
  agentName: string
  lowSeasonNights: number
  lowSeasonRevenue: number
  totalNights: number
  totalRevenue: number
  lowSeasonPct: number
}

// Context-aware drill-down click context (2026-07-15 standing instruction) — a click on a
// property/agent carries not just its id but WHICH view it was clicked from, so the resulting
// panel can show that view's own KPI set rather than one fixed generic panel regardless of
// origin. Property Performance is the first (and today, only) consumer of this shape — existing
// Agent panels (AgentProfilePanel, AgentPerformanceDrillPanel) are untouched and keep their
// existing plain-agentId props, per the standing instruction's own scoping to "views built from
// here on." Extend `type`/`sourceView` as new views adopt this pattern, rather than inventing a
// new click-context shape per view.
export interface EntityClickContext {
  type: 'property' | 'agent' | 'segment'
  id: string
  sourceView: string
}

// Booking Status Movement (2026-07-15) — Confirmed/Provisional/Cancelled only, per the confirmed
// Leadership BI gap: no Waitlisted status code exists anywhere in ResRequest (only 0/10/20/30/90),
// so it is NOT fabricated here — the UI shows it as an explicit "Not Tracked" card instead of a
// number. Booking Amendments dropped entirely — no version/amendment-count column or change-log
// table exists in the schema, confirmed before proposing scope, not approximated.
//
// Date bases (deliberately different per metric, not an inconsistency):
//   - confirmed/provisional: i.date_in (stay date), reservation-deduped (MIN(date_in) per
//     reservation, mirroring PF's own dedup pattern) to avoid the itinerary-join fan-out bug.
//   - newConfirmed: r.date_created (booking intake) — genuinely a different population than
//     confirmed above (bookings CREATED in this window, not bookings STAYING in this window).
//   - cancelled: r.last_change_date, gated by r.confirmation_date IS NOT NULL — the exact
//     proven Cancellation Drivers methodology (see CancellationDriverItem).
// $ values are total_amount (currency-converted), matching Pace/Pipeline's "booking value"
// convention — NOT the Room-Revenue-only split used by Occupancy/Property Performance/
// Cancellation Drivers, since this view tracks overall booking-status flow, not room-revenue
// accounting specifically.
export interface BookingStatusBucket {
  count: number
  value: number
}
export interface ProvisionalToConfirmed {
  count: number
  totalCount: number
  value: number
  ratePct: number
}
export interface BookingStatusMonthlyTrend {
  months: string[]
  confirmed: number[]
  provisional: number[]
  cancelled: number[]
  // Added 2026-07-09 (4-card standardization pass) — New Confirmed moved off the main KPI row
  // into this chart as a 4th line, since the monthly data already existed server-side
  // (bookingNewConfirmedByMonth) with no new query needed.
  newConfirmed: number[]
}
// netPickup = newConfirmed.value + provisionalToConfirmed.value - cancelled.value, per the
// confirmed formula. Flagged nuance (not hidden): newConfirmed (date_created basis) and
// provisionalToConfirmed (date_in basis) are different populations that can overlap for a
// booking created AND confirmed-for-a-stay within the same window — this is the formula as
// explicitly confirmed, not silently presented as a perfectly clean/non-overlapping number.
export interface BookingStatusMovementData {
  confirmed: BookingStatusBucket
  provisional: BookingStatusBucket
  cancelled: BookingStatusBucket
  newConfirmed: BookingStatusBucket
  provisionalToConfirmed: ProvisionalToConfirmed
  netPickup: number
  monthlyTrend: BookingStatusMonthlyTrend
}

export interface DashboardData {
  PD: PaceData
  PF: PipelineFutureItem[]
  OD: OccupancyData
  AD: AgentData
  PLF: PipelineFunnelItem[]
  YTD_ARR: YtdArrivalsStat
  PLT: PipelineTableItem[]
  CD: ConsultantItem[]
  KP_BASE: KpiBase
  BUDGET: BudgetData
  FORECAST: ForecastData
  REVPAR: RevParData
  PROPERTY_PERFORMANCE: PropertyPerformanceItem[]
  MARKET_SEGMENT_PERFORMANCE: MarketSegmentPerformanceItem[]
  BOOKING_STATUS_MOVEMENT: BookingStatusMovementData
  AGENT_PACE: AgentPaceData
  CANCEL_DRIVERS: CancellationDriverItem[]
  LOW_SEASON_AGENTS: LowSeasonAgentItem[]
  lastUpdated: string
}

export interface DailyKpi {
  arrivalsNext3d: number
  arrivalsNeedAction: number | null
  arrivalsNeedActionNote: string
  provisionalsExpiring7d: number
  cashOutstanding: number
  cashOutstandingNote: string
}

export interface DailyConsultant {
  id: string
  name: string
}

export interface DailyArrivalItem {
  reservationNumber: string
  guest: string
  agent: string
  agentId: string
  property: string
  propertyId: string | null
  arrivalDate: string
  daysToArrival: number
  balance: number
  roomCount?: number
  status: string
}

export interface DailyProvisionalItem {
  reservationNumber: string
  agent: string
  agentId: string
  property: string
  propertyId: string | null
  arrivalDate: string
  daysToArrival: number
  expiryDate: string
  daysToExpiry: number
  value: number
}

export interface DailyData {
  window: number
  consultant: string | null
  consultants: DailyConsultant[]
  kpi: DailyKpi
  arrivals: DailyArrivalItem[]
  expiringProvisionals: DailyProvisionalItem[]
  cashOutstanding: DailyArrivalItem[]
  lastUpdated: string
}

export interface AgentSearchResult {
  id: string
  name: string
}

// Non-Revenue audit figures (/api/non-revenue) — pass-through fees and
// FAM/Complimentary/Staff business. Computed and available, but deliberately
// kept OUT of Room Revenue, Extras, and every Total on the main leadership
// views. See src/app/api/non-revenue/route.ts for the full basis note.
export interface NonRevenueData {
  passThroughFees: {
    total: number
    byFee: { name: string; amount: number }[]
  }
  nonRevenueBusiness: {
    total: number
    byCategory: { category: string; amount: number }[]
  }
  grandTotal: number
  appliedFilters: { year: number; period: 'm' | 'y' | 'a'; monthRange: [number, number] }
}

export interface AgentPropertyBreakdown {
  property: string
  revenue: number
  extras: number
  bookings: number
}

export interface AgentConfirmedArrival {
  reservationNumber: string
  property: string
  arrivalDate: string
  roomCount: number
  value: number
}

export interface AgentProvisionalBooking {
  reservationNumber: string
  property: string
  arrivalDate: string
  expiryDate: string
  daysToExpiry: number | null
  roomCount: number
  value: number
}

// Cancellation History (2026-07-14g) — Agent Performance drill-down panel. All-time (no window —
// unlike the portfolio-wide Cancellation Drivers table's 30-day cutoff, a per-agent history view
// needs a longer lookback to be meaningful), Room-Revenue-only revenueLost, sorted by
// cancelledDate descending, top 20. cancelledDate is r.last_change_date — validated live tonight
// as the correct "when cancelled" field (see CANCEL_DRIVERS in DashboardData for the full story).
export interface AgentCancellationItem {
  reservationNumber: string
  property: string
  arrivalDate: string
  cancelledDate: string
  nightsLost: number
  revenueLost: number
  roomCount: number
}

export interface AgentSummaryKpis {
  revenueYtd: number
  // Prior-year revenue for the same i.date_in-bound population — real value,
  // always present (0 only if the agent genuinely had no confirmed revenue
  // last year). Panel only shows a YoY % when this is > 0.
  revenueYtdLy: number
  // Room Revenue / Extras split (2026-07-08b) — sibling to revenueYtd, same basis.
  extrasYtd: number
  extrasYtdLy: number
  confirmedBookings: number
  roomNights: number
  adr: number
  conversionRate: number
  avgBookingValue: number
}

export interface AgentProfile {
  agentId: string
  agentName: string
  year: number
  country: string | null
  // Channel (B2B / B2C / NON REVENUE SEGMENTS) and Market Segment (New Market Segment column) —
  // see src/lib/agentSegments.ts. Both are 'Unallocated' when Faith's segment CSV has no row (or
  // a blank cell) for this agent — a real, known classification gap, never hidden or guessed.
  channel: string
  marketSegment: string
  commission: {
    label: string
    // Non-null when the raw % is 0 — real value, but 99.76% of ALL reservations
    // app-wide carry rv_commission_perc=0.00, so a 0% shown alone reads as a
    // confident business fact when it's far more likely this field simply isn't
    // used for this agent/record. See AgentProfilePanel for display treatment.
    note: string | null
  }
  footer: {
    consultant: string
    firstBookingDate: string
    totalBookingsAllTime: number
  }
  monthlyRevenue: { months: string[]; act: number[]; ly: number[]; extras: number[]; extrasLy: number[] }
  summary: AgentSummaryKpis
  propertyBreakdown: AgentPropertyBreakdown[]
  confirmedArrivals: AgentConfirmedArrival[]
  confirmedArrivalsTotalCt: number
  provisionalBookings: AgentProvisionalBooking[]
  provisionalTotalCt: number
  // Cancellation History (2026-07-14g) — see AgentCancellationItem above. totalRevenueLost/
  // totalNightsLost/totalCancelledBookings are all-time totals (the list itself is capped at 20).
  cancellationHistory: AgentCancellationItem[]
  cancellationSummary: {
    totalCancelledBookings: number
    totalNightsLost: number
    totalRevenueLost: number
  }
}
