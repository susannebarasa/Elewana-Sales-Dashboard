// diagnose_change data bundle assembly (2026-07-17, revenue; extended 2026-07-18, occupancy).
//
// Pulls together every signal that could plausibly explain a change in the given metric and
// pre-computes deltas/percentages in JS — the reasoning step (copilotkit/route.ts) should never
// need to do its own arithmetic, only compare numbers it's already been handed. "Internal fetch"
// approach: runs the same in-process query templates every other aiQuery tool uses (runSafeQuery
// against the shared pool), not a second HTTP round-trip to this app's own /api/dashboard route.
//
// Two metrics share this one file/architecture but assemble genuinely different bundles — revenue
// has a real YoY basis everywhere; occupancy does NOT (Available Room Nights, the denominator,
// has no other year to compare against — same period-invariant-full-year-2026 rule as the rest of
// this dashboard's Occupancy %/ADR/RevPAR), so its bundle compares against Budget instead of LY
// wherever the metric itself is a %, and only uses a real YoY basis for Room Nights Sold (a raw
// count, not a %, so it CAN be compared year over year).
import type { Pool } from 'mysql2/promise'
import { runSafeQuery } from './sqlSafety'
import {
  buildTotalRoomRevenue, buildRevenueByPropertyYoY, mergePropertyRevenueYoY,
  buildMonthlyRevenueTrend, buildOccupancyAdrRevpar, availableNightsFor, occupancyVsBudget,
  buildAgentMoversByNights, buildMarketSegmentYoYQueries, buildCancellationDriverQueries,
  buildForecastPaceRatio, propertyNameById, buildNightsByProperty, propertyOccupancyVsBudget,
  buildMonthlyNightsTrend, buildRoomNightsSold, buildNightsByPropertyYoY, buildMarketSegmentNightsYoYQueries,
} from './templates'
import { getPortfolioBudget, getPropertyBudget } from '@/lib/budget'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const BUDGET_YEAR = 2026

export type DiagnoseChangeMetric = 'revenue' | 'occupancy' | 'adr'
export interface DiagnoseChangeScope { year: number; propertyId: string | null; propertyName: string | null }

// Shared shape both bundles reuse — nights-based agent movers apply identically to either metric
// (a revenue question and an occupancy question can both plausibly be explained by which agents
// are booking more/fewer forward nights).
export interface AgentMoversBlock {
  gainers: { agentName: string; tyNights: number; lyNights: number; deltaNights: number }[]
  decliners: { agentName: string; tyNights: number; lyNights: number; deltaNights: number }[]
}

export interface RevenueDiagnoseBundle {
  metric: 'revenue'
  scope: DiagnoseChangeScope
  headline: { revenue: number; revenueLy: number; deltaAbs: number; deltaPct: number | null }
  // Only populated portfolio-wide (propertyId === null) — a single-property question has already
  // answered "which property," so a property breakdown of itself doesn't apply.
  propertyYoY: { propertyName: string | null; revenue: number; revenueLy: number; deltaAbs: number; deltaPct: number | null }[] | null
  monthlyTrend: { month: string; revenue: number; revenueLy: number; deltaAbs: number }[]
  marketSegmentYoY: { segment: string; revenue: number; revenueLy: number; deltaAbs: number; deltaPct: number | null }[]
  agentMovers: AgentMoversBlock
  cancellationDrivers: { agentName: string; cancelledBookings: number; nightsLost: number; roomRevLost: number }[]
  occupancyVsBudget: {
    occPct: number | null
    adr: number | null
    revpar: number | null
    budgetRevenue: number | null
    budgetVariancePct: number | null
  }
  forecastPaceRatio: number
}

export interface OccupancyDiagnoseBundle {
  metric: 'occupancy'
  scope: DiagnoseChangeScope
  // Occupancy %/ADR/RevPAR are always full-year 2026 on this dashboard regardless of what year is
  // asked (see module comment) — true whenever scope.year !== 2026, surfaced here so the reasoning
  // step states this plainly rather than silently answering a different year than asked.
  fixedToCapacityYear: boolean
  headline: { occPct: number; budgetOccPct: number | null; varianceAbs: number | null; adr: number | null; revpar: number | null }
  // Only populated portfolio-wide — same reasoning as RevenueDiagnoseBundle.propertyYoY.
  propertyOccupancyVariance: { propertyName: string; occPct: number; budgetOccPct: number | null; varianceAbs: number | null }[] | null
  nightsTrend: { month: string; nights: number; nightsLy: number; deltaAbs: number }[]
  agentMovers: AgentMoversBlock
}

// Mix-shift diagnostic row shared by property- and segment-level ADR breakdowns — ADR = Revenue /
// Nights, so a blended ADR can move for two entirely different reasons: (a) the entity's OWN adr
// genuinely changed (deltaAbs/deltaPct below), or (b) nothing changed at the entity level but its
// SHARE of total nights shifted (nightsShareDeltaPts) — more/less of the portfolio's business
// moved toward this entity's price point without any rate actually moving. Both fields are always
// present together so the reasoning step can check both before assigning a cause.
export interface AdrMixRow {
  adr: number | null
  adrLy: number | null
  deltaAbs: number | null
  deltaPct: number | null
  /** This entity's % share of total nights this year. */
  nightsShare: number | null
  /** This entity's % share of total nights last year. */
  nightsShareLy: number | null
  /** Percentage-POINT change in nights share (nightsShare - nightsShareLy) — the mix-shift signal. */
  nightsShareDeltaPts: number | null
  // Precomputed here rather than left for the reasoning model to compare floats itself — live-
  // tested 2026-07-18: the model mis-compared two real bundle numbers ("$1,521 is below $1,408")
  // and got a mix-shift direction backwards as a result. Whether adr sits above/below the bundle's
  // own headline.adr fully determines mix-shift direction (see the reasoning prompt's rule), so
  // computing it once here removes that failure mode entirely instead of hoping the model does the
  // arithmetic correctly every time.
  aboveHeadlineAdr: boolean | null
}
export interface AdrDiagnoseBundle {
  metric: 'adr'
  scope: DiagnoseChangeScope
  headline: { adr: number | null; adrLy: number | null; deltaAbs: number | null; deltaPct: number | null; revenue: number; revenueLy: number; nights: number; nightsLy: number }
  // Only populated portfolio-wide — same reasoning as RevenueDiagnoseBundle.propertyYoY.
  propertyAdrYoY: (AdrMixRow & { propertyName: string | null })[] | null
  marketSegmentAdrYoY: (AdrMixRow & { segment: string })[]
  // Nights-pipeline movers (same forward-looking metric as the revenue/occupancy bundles) — NOT a
  // per-agent ADR figure. A genuine per-agent ADR YoY (own revenue ÷ own actualized nights, by
  // stay-year) has no existing audited query anywhere in this app to mirror, so rather than invent
  // one for a conversational answer, this reuses the same nights-mover proxy already used
  // elsewhere, with the reasoning prompt told explicitly what it does and doesn't show.
  agentMovers: AgentMoversBlock
}

export type DiagnoseChangeBundle = RevenueDiagnoseBundle | OccupancyDiagnoseBundle | AdrDiagnoseBundle

const n = (v: unknown): number => {
  const f = parseFloat(String(v ?? 0))
  return isFinite(f) ? f : 0
}
const pctDelta = (cur: number, prior: number): number | null => (prior > 0 ? ((cur - prior) / prior) * 100 : null)

// Helper kept separate only so the big Promise.all in assembleRevenueBundle stays readable — runs
// all N market segment queries concurrently, pairing each result back with its segment label.
function segmentRowsFetch(
  pool: Pool,
  queries: ReturnType<typeof buildMarketSegmentYoYQueries>,
  timeoutMs: number
): Promise<{ segment: string; row: { revenue: number; revenue_ly: number } | null }>[] {
  return queries.map(async ({ segment, query }) => {
    const rows = await runSafeQuery<{ revenue: number; revenue_ly: number }>(pool, query.sql, query.params, timeoutMs)
    return { segment, row: rows[0] ?? null }
  })
}

async function assembleRevenueBundle(pool: Pool, year: number, propertyId: string | null, timeoutMs: number): Promise<RevenueDiagnoseBundle> {
  const propertyName = propertyId ? propertyNameById(propertyId) : null

  const headlineCyQ = buildTotalRoomRevenue(year, 'otb', propertyId)
  const headlineLyQ = buildTotalRoomRevenue(year - 1, 'otb', propertyId)
  const monthlyQ = buildMonthlyRevenueTrend(year, propertyId)
  const occQ = buildOccupancyAdrRevpar(propertyId)
  const agentMoversQ = buildAgentMoversByNights(propertyId)
  const segmentQueries = buildMarketSegmentYoYQueries(year, propertyId)
  const cancelQ = buildCancellationDriverQueries(propertyId)
  const forecastQ = buildForecastPaceRatio(propertyId)
  const propertyYoYQ = propertyId ? null : buildRevenueByPropertyYoY(year, 'otb')

  const [
    headlineCyRow, headlineLyRow, monthlyRows, occRow,
    agentMoversRows, segmentRows, cancelNightsRows, cancelRevRows, forecastRow,
    propertyCyRows, propertyLyRows,
  ] = await Promise.all([
    runSafeQuery<{ revenue: number }>(pool, headlineCyQ.sql, headlineCyQ.params, timeoutMs),
    runSafeQuery<{ revenue: number }>(pool, headlineLyQ.sql, headlineLyQ.params, timeoutMs),
    runSafeQuery<{ m: number; revenue: number; revenue_ly: number }>(pool, monthlyQ.sql, monthlyQ.params, timeoutMs),
    runSafeQuery<{ revenue: number; nights: number }>(pool, occQ.sql, occQ.params, timeoutMs),
    runSafeQuery<{ agent_id: string; agent_name: string; ty_nights: number; ly_nights_same_leadtime: number }>(pool, agentMoversQ.sql, agentMoversQ.params, timeoutMs),
    Promise.all(segmentRowsFetch(pool, segmentQueries, timeoutMs)),
    runSafeQuery<{ agent_id: string; agent_name: string; cancelled_bookings: number; nights_lost: number }>(pool, cancelQ.nights.sql, cancelQ.nights.params, timeoutMs),
    runSafeQuery<{ agent_id: string; room_rev_lost: number }>(pool, cancelQ.revenue.sql, cancelQ.revenue.params, timeoutMs),
    runSafeQuery<{ this_year_forward_nights: number; last_year_forward_nights_same_leadtime: number }>(pool, forecastQ.sql, forecastQ.params, timeoutMs),
    propertyYoYQ ? runSafeQuery<{ property_id: string; revenue: number }>(pool, propertyYoYQ.cy.sql, propertyYoYQ.cy.params, timeoutMs) : Promise.resolve([]),
    propertyYoYQ ? runSafeQuery<{ property_id: string; revenue: number }>(pool, propertyYoYQ.ly.sql, propertyYoYQ.ly.params, timeoutMs) : Promise.resolve([]),
  ])

  const revenue = n(headlineCyRow[0]?.revenue)
  const revenueLy = n(headlineLyRow[0]?.revenue)

  const monthlyTrend = monthlyRows
    .map((r) => {
      const m = n(r.m)
      const rev = n(r.revenue)
      const lyRev = n(r.revenue_ly)
      return { month: MONTH_ABBR[m - 1] ?? String(m), revenue: rev, revenueLy: lyRev, deltaAbs: rev - lyRev }
    })
    .sort((a, b) => MONTH_ABBR.indexOf(a.month) - MONTH_ABBR.indexOf(b.month))

  const marketSegmentYoY = segmentRows
    .map(({ segment, row }) => {
      const rev = n(row?.revenue)
      const lyRev = n(row?.revenue_ly)
      return { segment, revenue: rev, revenueLy: lyRev, deltaAbs: rev - lyRev, deltaPct: pctDelta(rev, lyRev) }
    })
    .sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs))

  const agentMovers = buildAgentMoversBlock(agentMoversRows)

  const cancelRevMap = new Map(cancelRevRows.map((r) => [r.agent_id, n(r.room_rev_lost)]))
  const cancellationDrivers = cancelNightsRows
    .map((r) => ({
      agentName: r.agent_name,
      cancelledBookings: n(r.cancelled_bookings),
      nightsLost: n(r.nights_lost),
      roomRevLost: cancelRevMap.get(r.agent_id) ?? 0,
    }))
    .sort((a, b) => b.roomRevLost - a.roomRevLost)
    .slice(0, 5)

  const occRevenue = n(occRow[0]?.revenue)
  const occNights = n(occRow[0]?.nights)
  const available = availableNightsFor(propertyId)
  const occPct = available > 0 ? (occNights / available) * 100 : null
  const revpar = available > 0 ? occRevenue / available : null
  const adr = occNights > 0 ? occRevenue / occNights : null
  const budget = year === BUDGET_YEAR
    ? (propertyId ? getPropertyBudget(propertyId, year, 1, 12) : getPortfolioBudget(year, 1, 12))
    : null

  const forecastThisYear = n(forecastRow[0]?.this_year_forward_nights)
  const forecastLastYear = n(forecastRow[0]?.last_year_forward_nights_same_leadtime)

  const propertyYoY = propertyYoYQ
    ? mergePropertyRevenueYoY(propertyCyRows, propertyLyRows).map((r) => ({
        propertyName: r.propertyName,
        revenue: r.revenue,
        revenueLy: r.revenueLy,
        deltaAbs: r.revenue - r.revenueLy,
        deltaPct: r.yoyPct,
      })).sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs))
    : null

  return {
    metric: 'revenue',
    scope: { year, propertyId, propertyName },
    headline: { revenue, revenueLy, deltaAbs: revenue - revenueLy, deltaPct: pctDelta(revenue, revenueLy) },
    propertyYoY,
    monthlyTrend,
    marketSegmentYoY,
    agentMovers,
    cancellationDrivers,
    occupancyVsBudget: {
      occPct, adr, revpar,
      budgetRevenue: budget ? budget.rev : null,
      budgetVariancePct: budget && budget.rev > 0 ? Math.round((occRevenue / budget.rev) * 1000) / 10 : null,
    },
    forecastPaceRatio: forecastLastYear > 0 ? Math.round((forecastThisYear / forecastLastYear) * 1000) / 1000 : 1,
  }
}

async function assembleOccupancyBundle(pool: Pool, year: number, propertyId: string | null, timeoutMs: number): Promise<OccupancyDiagnoseBundle> {
  const propertyName = propertyId ? propertyNameById(propertyId) : null

  const occQ = buildOccupancyAdrRevpar(propertyId)
  const agentMoversQ = buildAgentMoversByNights(propertyId)
  const nightsTrendQ = buildMonthlyNightsTrend(year, propertyId)
  const nightsByPropQ = propertyId ? null : buildNightsByProperty()

  const [occRow, agentMoversRows, nightsTrendRows, nightsByPropRows] = await Promise.all([
    runSafeQuery<{ revenue: number; nights: number }>(pool, occQ.sql, occQ.params, timeoutMs),
    runSafeQuery<{ agent_id: string; agent_name: string; ty_nights: number; ly_nights_same_leadtime: number }>(pool, agentMoversQ.sql, agentMoversQ.params, timeoutMs),
    runSafeQuery<{ m: number; nights: number; nights_ly: number }>(pool, nightsTrendQ.sql, nightsTrendQ.params, timeoutMs),
    nightsByPropQ ? runSafeQuery<{ property_id: string; nights: number }>(pool, nightsByPropQ.sql, nightsByPropQ.params, timeoutMs) : Promise.resolve([]),
  ])

  const occNights = n(occRow[0]?.nights)
  const occRevenue = n(occRow[0]?.revenue)
  const available = availableNightsFor(propertyId)
  const adr = occNights > 0 ? occRevenue / occNights : null
  const revpar = available > 0 ? occRevenue / available : null
  const { occPct, budgetOccPct, varianceAbs } = occupancyVsBudget(propertyId, occNights)

  const nightsTrend = nightsTrendRows
    .map((r) => {
      const m = n(r.m)
      const nights = n(r.nights)
      const nightsLy = n(r.nights_ly)
      return { month: MONTH_ABBR[m - 1] ?? String(m), nights, nightsLy, deltaAbs: nights - nightsLy }
    })
    .sort((a, b) => MONTH_ABBR.indexOf(a.month) - MONTH_ABBR.indexOf(b.month))

  const propertyOccupancyVariance = nightsByPropQ
    ? propertyOccupancyVsBudget(nightsByPropRows).sort((a, b) => (a.varianceAbs ?? Infinity) - (b.varianceAbs ?? Infinity))
    : null

  return {
    metric: 'occupancy',
    scope: { year, propertyId, propertyName },
    fixedToCapacityYear: year !== BUDGET_YEAR,
    headline: { occPct, budgetOccPct, varianceAbs, adr, revpar },
    propertyOccupancyVariance,
    nightsTrend,
    agentMovers: buildAgentMoversBlock(agentMoversRows),
  }
}

// ADR = Revenue ÷ Nights, so unlike Occupancy %/RevPAR it has no capacity-denominator dependency
// and CAN genuinely be compared year over year using whatever `year` is asked (2026-07-18, added
// as diagnose_change's third metric). Property/segment breakdowns carry BOTH the entity's own ADR
// delta (rate effect) and its nights-SHARE delta (mix effect) — see AdrMixRow's own comment — so
// the reasoning step can tell a genuine rate change apart from a portfolio-level mix shift instead
// of defaulting to "rates went up/down" for every case.
async function assembleAdrBundle(pool: Pool, year: number, propertyId: string | null, timeoutMs: number): Promise<AdrDiagnoseBundle> {
  const propertyName = propertyId ? propertyNameById(propertyId) : null

  const revCyQ = buildTotalRoomRevenue(year, 'otb', propertyId)
  const revLyQ = buildTotalRoomRevenue(year - 1, 'otb', propertyId)
  const nightsCyQ = buildRoomNightsSold(year, 'otb', propertyId)
  const nightsLyQ = buildRoomNightsSold(year - 1, 'otb', propertyId)
  const agentMoversQ = buildAgentMoversByNights(propertyId)
  const propertyYoYQ = propertyId ? null : buildRevenueByPropertyYoY(year, 'otb')
  const propertyNightsYoYQ = propertyId ? null : buildNightsByPropertyYoY(year)
  const segmentRevQueries = buildMarketSegmentYoYQueries(year, propertyId)
  const segmentNightsQueries = buildMarketSegmentNightsYoYQueries(year, propertyId)

  const [
    revCyRow, revLyRow, nightsCyRow, nightsLyRow, agentMoversRows,
    propRevCyRows, propRevLyRows, propNightsCyRows, propNightsLyRows,
    segmentRevRows, segmentNightsRows,
  ] = await Promise.all([
    runSafeQuery<{ revenue: number }>(pool, revCyQ.sql, revCyQ.params, timeoutMs),
    runSafeQuery<{ revenue: number }>(pool, revLyQ.sql, revLyQ.params, timeoutMs),
    runSafeQuery<{ nights: number }>(pool, nightsCyQ.sql, nightsCyQ.params, timeoutMs),
    runSafeQuery<{ nights: number }>(pool, nightsLyQ.sql, nightsLyQ.params, timeoutMs),
    runSafeQuery<{ agent_id: string; agent_name: string; ty_nights: number; ly_nights_same_leadtime: number }>(pool, agentMoversQ.sql, agentMoversQ.params, timeoutMs),
    propertyYoYQ ? runSafeQuery<{ property_id: string; revenue: number }>(pool, propertyYoYQ.cy.sql, propertyYoYQ.cy.params, timeoutMs) : Promise.resolve([]),
    propertyYoYQ ? runSafeQuery<{ property_id: string; revenue: number }>(pool, propertyYoYQ.ly.sql, propertyYoYQ.ly.params, timeoutMs) : Promise.resolve([]),
    propertyNightsYoYQ ? runSafeQuery<{ property_id: string; nights: number }>(pool, propertyNightsYoYQ.cy.sql, propertyNightsYoYQ.cy.params, timeoutMs) : Promise.resolve([]),
    propertyNightsYoYQ ? runSafeQuery<{ property_id: string; nights: number }>(pool, propertyNightsYoYQ.ly.sql, propertyNightsYoYQ.ly.params, timeoutMs) : Promise.resolve([]),
    Promise.all(segmentRowsFetch(pool, segmentRevQueries, timeoutMs)),
    Promise.all(segmentNightsRowsFetch(pool, segmentNightsQueries, timeoutMs)),
  ])

  const revenue = n(revCyRow[0]?.revenue)
  const revenueLy = n(revLyRow[0]?.revenue)
  const nights = n(nightsCyRow[0]?.nights)
  const nightsLy = n(nightsLyRow[0]?.nights)
  const adr = nights > 0 ? revenue / nights : null
  const adrLy = nightsLy > 0 ? revenueLy / nightsLy : null

  const propertyAdrYoY = (propertyYoYQ && propertyNightsYoYQ)
    ? buildPropertyAdrMixRows(propRevCyRows, propRevLyRows, propNightsCyRows, propNightsLyRows, adr)
    : null
  const marketSegmentAdrYoY = buildSegmentAdrMixRows(segmentRevRows, segmentNightsRows, adr)

  return {
    metric: 'adr',
    scope: { year, propertyId, propertyName },
    headline: {
      adr, adrLy,
      deltaAbs: adr !== null && adrLy !== null ? adr - adrLy : null,
      deltaPct: adr !== null && adrLy !== null && adrLy > 0 ? ((adr - adrLy) / adrLy) * 100 : null,
      revenue, revenueLy, nights, nightsLy,
    },
    propertyAdrYoY,
    marketSegmentAdrYoY,
    agentMovers: buildAgentMoversBlock(agentMoversRows),
  }
}

function segmentNightsRowsFetch(
  pool: Pool,
  queries: ReturnType<typeof buildMarketSegmentNightsYoYQueries>,
  timeoutMs: number
): Promise<{ segment: string; row: { nights: number; nights_ly: number } | null }>[] {
  return queries.map(async ({ segment, query }) => {
    const rows = await runSafeQuery<{ nights: number; nights_ly: number }>(pool, query.sql, query.params, timeoutMs)
    return { segment, row: rows[0] ?? null }
  })
}

// Shared by property- and segment-level breakdowns — computes both lenses (own-ADR delta, nights-
// share delta) from the same four raw numbers so the two can never accidentally drift out of sync.
// headlineAdr is the bundle's own blended ADR (current year) — passed in so aboveHeadlineAdr can be
// precomputed here instead of asking the reasoning model to compare two floats itself.
function computeAdrMixRow(rev: number, revLy: number, nightsVal: number, nightsLyVal: number, totalNights: number, totalNightsLy: number, headlineAdr: number | null): AdrMixRow {
  const adr = nightsVal > 0 ? rev / nightsVal : null
  const adrLy = nightsLyVal > 0 ? revLy / nightsLyVal : null
  const nightsShare = totalNights > 0 ? (nightsVal / totalNights) * 100 : null
  const nightsShareLy = totalNightsLy > 0 ? (nightsLyVal / totalNightsLy) * 100 : null
  return {
    adr, adrLy,
    deltaAbs: adr !== null && adrLy !== null ? adr - adrLy : null,
    deltaPct: adr !== null && adrLy !== null && adrLy > 0 ? ((adr - adrLy) / adrLy) * 100 : null,
    nightsShare, nightsShareLy,
    nightsShareDeltaPts: nightsShare !== null && nightsShareLy !== null ? nightsShare - nightsShareLy : null,
    aboveHeadlineAdr: adr !== null && headlineAdr !== null ? adr > headlineAdr : null,
  }
}

// Property nights SHARE is computed against the sum of nights across whichever properties this
// query batch actually returned (i.e. the portfolio total) — mirrors mergePropertyRevenueYoY's own
// "union of both years' property ids" precedent so a property with LY nights but none this year
// (or vice versa) still gets a row instead of silently disappearing.
function buildPropertyAdrMixRows(
  revCyRows: { property_id: string; revenue: number }[],
  revLyRows: { property_id: string; revenue: number }[],
  nightsCyRows: { property_id: string; nights: number }[],
  nightsLyRows: { property_id: string; nights: number }[],
  headlineAdr: number | null
): (AdrMixRow & { propertyName: string | null })[] {
  const revCyMap = new Map(revCyRows.map((r) => [r.property_id, n(r.revenue)]))
  const revLyMap = new Map(revLyRows.map((r) => [r.property_id, n(r.revenue)]))
  const nightsCyMap = new Map(nightsCyRows.map((r) => [r.property_id, n(r.nights)]))
  const nightsLyMap = new Map(nightsLyRows.map((r) => [r.property_id, n(r.nights)]))
  const totalNightsCy = nightsCyRows.reduce((sum, r) => sum + n(r.nights), 0)
  const totalNightsLy = nightsLyRows.reduce((sum, r) => sum + n(r.nights), 0)

  const propertyIds = new Set<string>([
    ...Array.from(revCyMap.keys()), ...Array.from(revLyMap.keys()),
    ...Array.from(nightsCyMap.keys()), ...Array.from(nightsLyMap.keys()),
  ])
  const out: (AdrMixRow & { propertyName: string | null })[] = []
  propertyIds.forEach((propertyId) => {
    out.push({
      propertyName: propertyNameById(propertyId),
      ...computeAdrMixRow(
        revCyMap.get(propertyId) ?? 0, revLyMap.get(propertyId) ?? 0,
        nightsCyMap.get(propertyId) ?? 0, nightsLyMap.get(propertyId) ?? 0,
        totalNightsCy, totalNightsLy, headlineAdr
      ),
    })
  })
  // Biggest genuine own-ADR movers first — nightsShareDeltaPts is still present on every row
  // regardless of this ordering, so a mix-shift-only property (flat ADR, big share swing) is never
  // hidden from the reasoning step, just not ranked first.
  return out.sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0))
}

// Segment nights SHARE is computed against the sum across MARKET_SEGMENT_VALUES only (bookings
// with no resolvable agent/segment are excluded from both the numerator and this denominator) —
// same segment-classification scope as marketSegmentYoY elsewhere in this file, not the portfolio
// headline nights total.
function buildSegmentAdrMixRows(
  revRows: { segment: string; row: { revenue: number; revenue_ly: number } | null }[],
  nightsRows: { segment: string; row: { nights: number; nights_ly: number } | null }[],
  headlineAdr: number | null
): (AdrMixRow & { segment: string })[] {
  const nightsMap = new Map(nightsRows.map((r) => [r.segment, r.row]))
  const totalNightsCy = nightsRows.reduce((sum, r) => sum + n(r.row?.nights), 0)
  const totalNightsLy = nightsRows.reduce((sum, r) => sum + n(r.row?.nights_ly), 0)

  return revRows.map(({ segment, row }) => {
    const nightsRow = nightsMap.get(segment)
    return {
      segment,
      ...computeAdrMixRow(
        n(row?.revenue), n(row?.revenue_ly),
        n(nightsRow?.nights), n(nightsRow?.nights_ly),
        totalNightsCy, totalNightsLy, headlineAdr
      ),
    }
  }).sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0))
}

function buildAgentMoversBlock(rows: { agent_name: string; ty_nights: number; ly_nights_same_leadtime: number }[]): AgentMoversBlock {
  const all = rows
    .map((r) => {
      const ty = n(r.ty_nights)
      const ly = n(r.ly_nights_same_leadtime)
      return { agentName: r.agent_name, tyNights: ty, lyNights: ly, deltaNights: ty - ly }
    })
    .filter((r) => r.tyNights >= 20 || r.lyNights >= 20) // meaningful-volume filter, same bar as dashboard's Agent Pace
  return {
    gainers: [...all].sort((a, b) => b.deltaNights - a.deltaNights).slice(0, 5),
    decliners: [...all].sort((a, b) => a.deltaNights - b.deltaNights).slice(0, 5),
  }
}

export async function assembleDiagnoseChangeBundle(
  pool: Pool,
  metric: DiagnoseChangeMetric,
  year: number,
  propertyId: string | null,
  timeoutMs: number
): Promise<DiagnoseChangeBundle> {
  if (metric === 'occupancy') return assembleOccupancyBundle(pool, year, propertyId, timeoutMs)
  if (metric === 'adr') return assembleAdrBundle(pool, year, propertyId, timeoutMs)
  return assembleRevenueBundle(pool, year, propertyId, timeoutMs)
}

// diagnose_change reasoning prompt (2026-07-17, revenue; made metric-agnostic 2026-07-18) — built
// alongside the bundle assembly it describes rather than in copilotkit/route.ts, since Next.js App
// Router route.ts files may only export recognized HTTP handlers (GET/POST/etc.) and a small set
// of config keys — any other export breaks the route's generated type validation (confirmed live:
// exporting this function from route.ts for a test failed `next`'s own type-check with "Property
// ... is incompatible with index signature"). The route calls this as a plain imported helper for
// its SEPARATE reasoning Claude call (distinct from Step 2's answer-formatting pass) — the
// reasoning call decides WHAT the drivers are; Step 2 only polishes prose afterward and must never
// be allowed to re-derive or restate causes on its own.
//
// Metric-agnostic by design (2026-07-18, occupancy added) — rather than duplicate this whole rule
// set per metric, it describes the bundle generically ("whichever breakdown arrays are present")
// so the same guardrails apply to any future metric's bundle without rewriting this prompt again.
// The one thing that IS metric-specific is the comparison basis: revenue has a real YoY basis
// everywhere; occupancy's % fields (Occupancy % itself) have no real YoY basis at all (Available
// Room Nights has no other year to divide by — same period-invariant-full-year rule as the rest of
// the dashboard) and compare against Budget instead, EXCEPT nightsTrend (a raw count, not a %,
// which genuinely can be compared year over year) — called out explicitly so the model doesn't
// mislabel a Budget comparison as "YoY" or vice versa.
export function buildDiagnoseChangeSystemPrompt(bundle: DiagnoseChangeBundle): string {
  const scope = bundle.scope
  const scopeLabel = scope.propertyName ? `${scope.propertyName} (property-level)` : 'portfolio-wide'
  const metricLabel = bundle.metric === 'occupancy' ? 'Occupancy %' : bundle.metric === 'adr' ? 'ADR (Average Daily Rate)' : 'Room Revenue'
  const basisNote = bundle.metric === 'occupancy'
    ? `Occupancy % has NO real year-over-year basis on this dashboard — Available Room Nights (the denominator) has no other year to compare against, so headline/propertyOccupancyVariance compare against BUDGET, not last year (label them "vs Budget," never "YoY"). nightsTrend is the one exception — it's a raw count, not a %, so it genuinely compares this year vs last year (label it "YoY"). The bundle is always full-year ${scope.year !== 2026 ? '2026 (fixedToCapacityYear: true — the requested year ' + scope.year + ' has no capacity data, so this is 2026 regardless)' : '2026'}.`
    : bundle.metric === 'adr'
    ? `ADR (= Revenue ÷ Nights) has NO capacity-denominator problem, unlike Occupancy %/RevPAR — it genuinely compares ${scope.year} vs ${scope.year - 1} throughout (label deltas "YoY"). Every row in propertyAdrYoY/marketSegmentAdrYoY carries BOTH the entity's own adr/adrLy (did ITS rate move) and nightsShare/nightsShareLy/nightsShareDeltaPts (did ITS SHARE of total nights move) — see the mix-shift rule below for how to use both. agentMovers here is the SAME forward-pipeline-nights proxy used for the revenue/occupancy metrics — it is NOT a per-agent ADR figure and must never be described as one; it only shows an agent's nights delta.`
    : `${metricLabel} compares ${scope.year} vs ${scope.year - 1} (a real YoY basis) throughout — label deltas "YoY".`
  const adrMixShiftRule = bundle.metric === 'adr'
    ? `\n1a. ADR is a derived ratio (Revenue ÷ Nights), so a change in blended/portfolio ADR can come from either (a) a genuine rate change — specific properties'/segments' own adr vs adrLy actually moved — or (b) a mix shift — nights moving toward a lower- or higher-ADR property/segment (nightsShareDeltaPts) even though no individual rate changed at all. For each candidate entity, check BOTH fields before describing a cause: if its own adr/adrLy are close (small deltaAbs/deltaPct) but |nightsShareDeltaPts| is large, describe this explicitly as a MIX SHIFT (e.g. "a mix shift — Segment A's own ADR held roughly flat but its share of nights rose 8.2pts, pulling the blend down"), and never call this "rates fell/rose at Segment A." Conversely, if an entity's own adr/adrLy moved meaningfully while its nightsShareDeltaPts is small, describe that as a genuine RATE CHANGE, not a mix effect. If both are large, name both effects explicitly and distinctly. Never default to a rate-change narrative when the numbers show a mix effect, and never label a nights-share shift as a rate change.
1b. The DIRECTION of any mix-shift claim is not a judgment call, and you must not compare the adr numbers yourself — each row already carries a precomputed aboveHeadlineAdr boolean (true = this entity's own adr is above the bundle's headline.adr; false = below) specifically so you don't have to eyeball two numbers and risk getting the comparison backwards. Use it directly: aboveHeadlineAdr=false + positive nightsShareDeltaPts (gaining share) → mechanically PULLS THE BLEND DOWN. aboveHeadlineAdr=false + negative nightsShareDeltaPts (losing share) → PUSHES THE BLEND UP. aboveHeadlineAdr=true + positive nightsShareDeltaPts → PUSHES THE BLEND UP. aboveHeadlineAdr=true + negative nightsShareDeltaPts → PULLS THE BLEND DOWN. A mix shift toward a lower-ADR entity (aboveHeadlineAdr=false, share rising) can NEVER be described as pulling the blend up, and vice versa — if a rate change and a mix shift point in opposite directions, say plainly that one partly offset the other rather than crediting both toward the same outcome.`
    : ''
  return `You are a BI analyst for Elewana Collection, a luxury safari and lodge company. You are given a JSON data bundle of real, already-computed ${metricLabel} figures for ${scopeLabel}, and must explain WHAT drove the change — not just restate the headline number.

${basisNote}

Rules, in strict priority order:
1. Every causal claim must trace back to a specific number in the bundle. Compare the magnitude of items across whichever breakdown arrays are present in the bundle (e.g. propertyYoY/propertyOccupancyVariance/propertyAdrYoY if present — portfolio-wide questions only, marketSegmentYoY/marketSegmentAdrYoY, agentMovers gainers/decliners, cancellationDrivers, monthlyTrend/nightsTrend). Rank the 2-3 biggest actual contributors by the size of their contribution to the overall change. Name each one with its real figure, formatted inline like "Kilindi -$871k (-29.5% YoY)" or "Serengeti Explorer +12.4pts vs Budget" — never round away the specifics into vague language.${adrMixShiftRule}
2. If nothing stands out — the deltas are small and spread thinly across many properties/segments/agents relative to the size of the overall change — say so plainly and honestly: "no single driver stands out — the change appears broadly distributed." Do not force a top-3 narrative onto a genuinely diffuse pattern.
3. AFTER naming a real, number-backed driver, you may add AT MOST one brief sentence of general hospitality-industry color commentary (typical seasonality, common booking-cycle timing, typical commission structures) to contextualize it. This sentence must describe a general, industry-wide pattern only — e.g. "typically a shoulder-season effect" — and must NEVER attribute a specific reason, cause, or characteristic (e.g. "mid-market distribution," "high-volume lower-ADR bookings," any claim about WHY a specific named property/agent/segment moved) to that named entity unless the bundle itself contains a field showing it. If you don't know why a specific agent/property/segment moved beyond the number itself, just report the number — do not guess a plausible-sounding reason for it. Phrase any industry commentary as an explicit qualifier — "typically," "this pattern is common in the region during this period" — never as a confirmed fact about Elewana's own operations, since that has not been checked against real data here. This commentary must always come after and alongside a real driver, never in place of one, and must NEVER be used to fill the no-clear-driver case in rule 2 — a diffuse pattern stays "no single driver stands out," not a seasonality story.
4. Never invent a number not present in the bundle. Never state a cause you cannot point to a specific bundle field for — this includes inventing WHY a specific named agent/property/segment moved (e.g. their customer mix, distribution strategy, or market positioning) when the bundle only shows THAT it moved, not why. This also means never inventing an unnamed cause or event even with hedging language ("likely due to," "suggesting a disruption in," "possibly reflecting") — a trend array only shows THAT a period moved, not why; report the figure and stop, don't hypothesize an event for it. Only say something caused a change when a bundle field actually names that cause (e.g. cancellationDrivers naming real cancelled bookings/revenue lost).
4a. This same rule covers STATUS and RANKING claims, not just causal ones: agentMovers only shows an agent's nights DELTA (gain/decline), never their overall booking volume or rank among all agents — never call an agent "the property's largest partner," "the top agent," "a key/major account," or similar unless a bundle field literally ranks or sizes them that way. If the bundle only shows a delta, describe only the delta.
5. Never reinterpret or expand a name from the bundle (e.g. segment names like "DMC" or "INT. AGENT") — use them exactly as given, don't guess what an abbreviation stands for, and don't add a parenthetical gloss inferring what one name's relationship to a similarly-named one might be (e.g. don't describe "DMC" as the "domestic" counterpart to "DMC (International Presence)" — that distinction is not stated anywhere in the bundle; use both names exactly as given, with no added interpretation).
6. Never mislabel the comparison basis — use "YoY" only where the basis note above says it's real YoY, and "vs Budget" where it says Budget. Don't call a Budget comparison "YoY" or vice versa.
7. Write 2-4 sentences, exec-facing, numbers inline throughout.`
}
