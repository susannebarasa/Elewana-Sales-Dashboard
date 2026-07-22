export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import type { DashboardData } from '@/types'
import {
  NON_REVENUE_RATE_TYPE_IDS,
  EXCLUDED_AGENT_IDS,
  EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN,
  AGENT_NAME_PATTERN_CARVEOUT_SQL,
  EXCLUDED_RESERVATION_PREFIX,
  EAR_RESIDENT_RATE_TYPE_IDS,
  KES_USD_RATE,
  PROPERTY_ROOM_COUNTS,
  KENYA_PROPERTY_IDS,
  TANZANIA_MAINLAND_PROPERTY_IDS,
  SERENGETI_EXPLORER_STYLE_PROPERTY_IDS,
  PROPERTY_REVPAR_CAVEATS,
} from '@/lib/constants'
import { ROOM_REVENUE_SUM_SQL, EXTRAS_SUM_SQL, ROOM_REVENUE_CASE, EXCLUDED_FEE_CASE, extrasTableRevenueCase, extrasTableRevenueSumSql, dayUseLegCase } from '@/lib/roomRevenue'
import { lookupAgentSegment, buildAgentFilterSql, MARKET_SEGMENT_VALUES } from '@/lib/agentSegments'
import { getPortfolioBudget, getPropertyBudget, getAllBudgetProperties } from '@/lib/budget'
import { runWithConcurrencyLimit } from '@/lib/concurrency'
import {
  dateInYearMonthRange,
  dateInTwoYearMonthRange,
  dateInYearThroughMonth,
  dateInTwoYearsThroughMonth,
  dateInFullYear,
  caseInYearMonthRange,
} from '@/lib/dateRange'
import { parseDashboardView, queryIdsForView, type DashboardQueryId } from '@/lib/dashboardViews'

// ── helpers ──────────────────────────────────────────────────────────────────
const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}
const i = (v: unknown, def = 0): number => Math.round(n(v, def))

const fmtM = (v: number): string =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`

const signedPct = (cur: number, prev: number): string => {
  if (!prev) return '+0%'
  const p = Math.round(((cur - prev) / prev) * 100)
  return (p >= 0 ? '+' : '') + p + '%'
}

const safePct = (num: number, den: number): number =>
  den > 0 ? Math.round((num / den) * 100) : 0

// Server-side cache (2026-07-15, invalidation reworked 2026-07-16b) — keyed by the exact
// view/year/period/channel/market/property combination. This route fires 60+ queries per request
// at the top-level `all`/`exec-summary` views; at the app's real usage pattern (most loads use
// the default filters, repeatedly, across the day) caching turns nearly all repeat loads into an
// instant cache hit with zero DB round-trips, without touching any of the underlying query logic.
// Module-level Map — fine for this app's single persistent Node process (not a serverless/
// multi-instance deployment); would need a shared store (Redis etc.) if that ever changes.
// `lastUpdated` is baked into the cached `data` at fetch time and returned as-is on a hit — see
// todayStr below, now date+time (not just date) specifically so the Topbar's "Data as at" label
// makes a stale cache visible, per the user's explicit "don't let this look real-time" instruction.
//
// THE REAL FIX (2026-07-16b): a cache hit is no longer trusted purely on elapsed time. Instead,
// `isCacheEntryFresh` below checks sync_logs for the most recent COMPLETED reservations sync
// (cheap — 71 rows, indexed on (sync_type, sync_status) and end_time) — if one finished AFTER
// this entry was cached, the entry is stale regardless of age, so a hit right after a sync still
// gets fresh data. A 6-hour max-age remains as a pure safety net (covers sync_logs being
// unreachable/empty, or simply never having synced) — see its try/catch below, which falls back
// to that max-age check ALONE so a sync_logs problem can never take down the whole dashboard.
const CACHE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000
const dashboardCache = new Map<string, { data: DashboardData; cachedAt: number }>()

// Returns true if a cache entry cached at `cachedAt` is still safe to serve. Only called on a
// cache HIT (no point running this on a miss — the route is about to refetch anyway).
async function isCacheEntryFresh(cachedAt: number): Promise<boolean> {
  const age = Date.now() - cachedAt
  if (age >= CACHE_FALLBACK_MAX_AGE_MS) return false
  try {
    const row = await queryOne<{ t: string | Date | null }>(
      `SELECT MAX(end_time) AS t FROM sync_logs WHERE sync_type='reservations' AND sync_status='completed'`
    )
    const lastSyncMs = row?.t ? new Date(row.t).getTime() : NaN
    if (isFinite(lastSyncMs) && lastSyncMs > cachedAt) return false
    return true
  } catch (err) {
    // sync_logs unreachable/erroring — fall back to the 6h max-age check alone (already passed
    // above, so the entry stays valid). Never let this check take down the whole route.
    console.error('[dashboard API] sync_logs freshness check failed, falling back to max-age only', err)
    return true
  }
}

// Property filter (2026-07-09) — known-good propertyId set, same source of truth as
// revparByProperty/PROPERTY_PERFORMANCE below. Excludes Little Elephant Pepper Camp (propertyId
// null, no ResRequest record yet) — nothing to filter by for a property with no rows.
const VALID_PROPERTY_IDS = new Set(
  Object.values(PROPERTY_ROOM_COUNTS).map((p) => p.propertyId).filter((id): id is string => id !== null)
)

// ── route ────────────────────────────────────────────────────────────────────
// FIX (this session): year/period query params are now real filters (previously the GET
// handler took no request at all — Channel/Year/Period toggles in the UI were cosmetic).
// channel/market are accepted and plumbed through but NOT yet applied as real WHERE-clause
// filters beyond 'all' — see the note above KP_BASE assembly for why, and the Part 2 report.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const today = new Date()
    const realCurrentYear = today.getFullYear()
    const yearParam = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10)
    const cy = Number.isFinite(yearParam) ? yearParam : realCurrentYear
    const ly = cy - 1
    const isCurrentYear = cy === realCurrentYear
    const realCurrentMonth = today.getMonth() + 1
    const period = (req.nextUrl.searchParams.get('period') ?? 'y') as 'm' | 'y' | 'a'
    // MTD/YTD are inherently "relative to today" — they only mean something for the real
    // current year. For any other selected year, always show the full 12 months regardless
    // of period (there's no meaningful "month to date" for a completed past year).
    const monthLo = period === 'm' && isCurrentYear ? realCurrentMonth : 1
    const monthHi = period === 'a' ? 12 : isCurrentYear ? realCurrentMonth : 12
    const cm = monthHi // kept for the few call sites still using the old single-bound name
    const channel = req.nextUrl.searchParams.get('channel') ?? 'all'
    const market = req.nextUrl.searchParams.get('market') ?? 'all'
    // Property (2026-07-09) — validated against PROPERTY_ROOM_COUNTS' known propertyId set (same
    // "internal, generated data only, safe to inline" reasoning as buildAgentFilterSql) rather than
    // trusted verbatim from the query string, since it's inlined directly into SQL below.
    const propertyParam = req.nextUrl.searchParams.get('property') ?? 'all'
    const property = propertyParam !== 'all' && VALID_PROPERTY_IDS.has(propertyParam) ? propertyParam : 'all'

    const view = parseDashboardView(req.nextUrl.searchParams.get('view'))
    const needed = queryIdsForView(view)
    const cacheKey = `${view}|${cy}|${period}|${channel}|${market}|${property}`
    const cached = dashboardCache.get(cacheKey)
    if (cached && (await isCacheEntryFresh(cached.cachedAt))) {
      return NextResponse.json({
        ...cached.data,
        appliedFilters: { year: cy, period, monthRange: [monthLo, monthHi], channel, market, property, view },
      })
    }

    // Date + time (not just date) — see the cache comment above for why: a 3-minute TTL is
    // invisible on a date-only label, so this makes staleness legible in the Topbar.
    const todayStr = today.toISOString().slice(0, 16).replace('T', ' ')

    // FIX (2026-07-13, Channel/Market Segment filtering): channel/market were previously accepted
    // and echoed in appliedFilters but never applied to any query. Real filtering, added to the
    // 11 agent-scoped queries that feed the Trade Partners tab (Active Trade Partners, Agent Room
    // Revenue/Extras/ADR/Avg Stay, Top Trade Partners table + its YoY comparison, Revenue by
    // Property/Month for agent bookings, and their three Day Use companion queries). NOT applied
    // to portfolio-wide/all-channel queries (Occupancy tab, Pipeline, Consultants) or the Agent
    // Profile route — see src/lib/agentSegments.ts for the Unallocated-handling rationale.
    // AND_A/AND_A2 are pre-formatted with a leading ' AND ' (or '' when no filter is active) so
    // call sites can just append them to a WHERE clause without conditional string-building.
    const agentFilterA = buildAgentFilterSql('a', channel, market)
    const agentFilterA2 = buildAgentFilterSql('a2', channel, market)
    const AND_A = agentFilterA ? ` AND ${agentFilterA}` : ''
    const AND_A2 = agentFilterA2 ? ` AND ${agentFilterA2}` : ''

    // Property (2026-07-09) — same AND_A/AND_A2 pattern, one shared fragment appended everywhere
    // an itineraries alias (i / i2) is already joined. Two Booking Status Movement queries
    // (Cancelled-by-month, New Confirmed-by-month) deliberately have NO itinerary join at all —
    // added specifically to avoid the itinerary-leg fan-out bug fixed in commit 806c539 — so AND_P
    // is intentionally NOT appended there; those two figures don't narrow by property (flagged in
    // project_new_top_level_views memory going forward, not silently dropped).
    const propertyEscaped = property.replace(/'/g, "''")
    const AND_P = property !== 'all' ? ` AND i.property = '${propertyEscaped}'` : ''
    const AND_P2 = property !== 'all' ? ` AND i2.property = '${propertyEscaped}'` : ''
    // Different-shape variant (2026-07-16, "no exceptions" property-filter pass) — for the 3
    // queries that filter via `reservation_number IN (SELECT DISTINCT ... FROM itineraries WHERE
    // ...)` with no alias on itineraries at all (ytdRow, kpiPipeline, kpiPipelineStly), so AND_P's
    // `i.property` reference doesn't apply — this is the same fragment against the bare column.
    const AND_P_BARE = property !== 'all' ? ` AND property = '${propertyEscaped}'` : ''
    // Semi-join variant (2026-07-16, "no exceptions" pass, risky-query batch) — for queries that
    // aggregate directly over `reservations` with NO itinerary join at all (pdRows, chRows,
    // cdRows' counts subquery, kpiConsult/kpiConsultLy, kpiCancel/kpiCancelLy,
    // kpiForecastCancelLyFullYear, bookingCancelledByMonth, bookingNewConfirmedByMonth). A plain
    // JOIN to itineraries here would fan out every COUNT(*)/SUM() by leg count (the exact
    // commit-806c539 bug) — but `IN (SELECT DISTINCT ...)` is a semi-join, which by SQL
    // definition tests set membership and can never duplicate outer rows, no matter how many
    // itinerary legs a reservation has. Safe without any dedup restructuring.
    // `reservation_number` is left unqualified since none of the 10 call sites join another
    // table that also has that column (rate_types/agents don't) — MySQL resolves it unambiguously.
    const AND_P_RESV = property !== 'all' ? ` AND reservation_number IN (SELECT DISTINCT reservation_number FROM itineraries WHERE property = '${propertyEscaped}')` : ''
    // Shared display name for the selected property (2026-07-16) — used anywhere a label/caption
    // needs to say which property is filtered, instead of each call site re-deriving its own
    // lookup. Object.entries(PROPERTY_ROOM_COUNTS) is keyed by display name, so this reverses it.
    const selectedPropertyName = property !== 'all'
      ? Object.entries(PROPERTY_ROOM_COUNTS).find(([, cap]) => cap.propertyId === property)?.[0] ?? null
      : null

    // Build exclusion arrays once — mysql2 expands array params into IN(?,?,...) automatically
    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
    const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
    const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
    const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN // '%direct%'
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX // 'PA%'
    const EAR_IDS = Array.from(EAR_RESIDENT_RATE_TYPE_IDS)
    const KES_RATE = KES_USD_RATE // 129

    // View-scoped + concurrency-limited batch (2026-07-09 / 2026-07-15).
    // Cold path (exec-summary) runs ~16 queries instead of ~67; throttle still caps at 12 in flight.
    // View-scoped query execution (2026-07-09) — only run queries needed for `view`.
    // Cold path (exec-summary default) drops from ~67 to ~16 round-trips.
    const allQueries: Partial<Record<DashboardQueryId, () => Promise<unknown>>> = {
      // PD — monthly booking pace (2026-07-16, verified-figures fix). Was status IN ('20','30')
      // over raw r.total_amount (blended Room+Extras, includes Pipeline) despite being captioned
      // "confirmed bookings" everywhere it's shown (ExecSummaryView, PaceView, and the new Sales
      // Executive Summary page) — a real discrepancy, caught when asked "what do we have on
      // Booking Pace, use only verified figures." Now status='30' only + Room-Revenue-only split
      // (rate_components/ROOM_REVENUE_CASE), matching the app-wide "revenue = confirmed, Room
      // Revenue only" convention every other figure follows. User confirmed fixing this everywhere
      // (not just the new page) even though it changes numbers already shown on the existing Pace
      // and Exec Summary tabs. Requires an itinerary+rate_components join now, so AND_P (i.property)
      // replaces the old bare-reservation AND_P_RESV; the join is SUM-only (no COUNT/DISTINCT
      // alongside it), so the itinerary-leg fan-out that join can cause doesn't double-count here.
      pdRows: () => query<{ m: number; mn: string; actual: number; ly_val: number }>(
        `SELECT MONTH(r.date_created) AS m, LEFT(MONTHNAME(r.date_created),3) AS mn,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', cy, 1, cm)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS actual,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', ly, 1, cm)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS ly_val
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND (${dateInTwoYearsThroughMonth('r.date_created', cy, ly, cm)})
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}
        GROUP BY MONTH(r.date_created), LEFT(MONTHNAME(r.date_created),3) ORDER BY m`,
        [KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // PF — forward pipeline next 4 months.
      // FIX: inner subquery deduplicates to one row per reservation (MIN date_in as first leg),
      // so each reservation's total_amount is counted exactly once and bucketed to its first
      // upcoming arrival month. Previously summed r.total_amount across all itinerary rows,
      // inflating by ~2–3x and incorrectly splitting multi-leg revenue across months.
      pfRows: () => query<{ mo: string; yr: number; mon: number; cf: number; pv: number; cf_val: number; pv_val: number }>(
        `SELECT DATE_FORMAT(first_date_in,'%b %Y') AS mo, YEAR(first_date_in) AS yr, MONTH(first_date_in) AS mon,
          COUNT(CASE WHEN status='30' THEN 1 END)*100.0/GREATEST(COUNT(*),1) AS cf,
          COUNT(CASE WHEN status='20' THEN 1 END)*100.0/GREATEST(COUNT(*),1) AS pv,
          SUM(CASE WHEN status='30' THEN IFNULL(total_amount,0) ELSE 0 END) AS cf_val,
          SUM(CASE WHEN status='20' THEN IFNULL(total_amount,0) ELSE 0 END) AS pv_val
        FROM (
          SELECT r.reservation_number, r.status,
            CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END AS total_amount,
            MIN(i.date_in) AS first_date_in
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status IN ('20','30')
            AND i.date_in > CURDATE() AND i.date_in <= DATE_ADD(CURDATE(), INTERVAL 5 MONTH)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.reservation_number, r.status, dt.currency, r.total_amount
        ) deduped
        GROUP BY yr, mon, mo
        ORDER BY yr, mon LIMIT 4`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // OD.props — top 10 properties last 90 days (confirmed stays only, all channels)
      // FIX (2026-07-08, Room Revenue / Extras split): adr numerator was i.total_gross_amount
      // (everything blended) — now Room-Revenue-only, per hospitality convention. bkgs
      // (COUNT DISTINCT itinerary_id) is immune to the rate_components join fan-out, so it stays
      // in the same subquery as nights; only the revenue numerator needed its own subquery.
      ocPropRows: () => query<{ nm: string; property_id: string; bkgs: number; adr: number }>(
        `SELECT nt.nm, nt.property AS property_id, nt.bkgs, ROUND(rev.room_rev/GREATEST(nt.nights,1)) AS adr
        FROM (
          SELECT i.property, COALESCE(p.name, i.property) AS nm,
            COUNT(DISTINCT i.itinerary_id) AS bkgs,
            SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nights
          FROM itineraries i
          LEFT JOIN properties p ON i.property=p.property_id
          JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.status = '30'
            AND i.date_in >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
            AND i.date_in < CURDATE() AND i.date_out > i.date_in AND i.property IS NOT NULL
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
          GROUP BY i.property, COALESCE(p.name, i.property)
        ) nt
        JOIN (
          SELECT i.property, ${ROOM_REVENUE_SUM_SQL} AS room_rev
          FROM itineraries i
          JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30'
            AND i.date_in >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
            AND i.date_in < CURDATE() AND i.date_out > i.date_in AND i.property IS NOT NULL
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
          GROUP BY i.property
        ) rev ON nt.property = rev.property
        ORDER BY nt.bkgs DESC LIMIT 10`,
        [NON_REV_IDS, RES_PREFIX, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // OD.arr — arrival revenue by month YTD (confirmed stays only)
      // FIX (2026-07-08, Room Revenue / Extras split): act/ly_val were i.total_gross_amount
      // (everything blended). Split into Room Revenue (act, ly_val) and Extras (extras,
      // extras_ly) via a rate_components join — no nights aggregate in this query, so no
      // fan-out risk from the join. Day Use revenue (ACL/Kilindi) merged in from the separate
      // dayUseArrRows query below, in JS (same reasoning as AD.byProp).
      arrRows: () => query<{ m: number; mn: string; act: number; ly_val: number; extras: number; extras_ly: number }>(
        `SELECT MONTH(i.date_in) AS m, LEFT(MONTHNAME(i.date_in),3) AS mn,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS act,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, cm)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS ly_val,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, cm)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras_ly
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND (${dateInTwoYearsThroughMonth('i.date_in', cy, ly, cm)})
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}
        GROUP BY MONTH(i.date_in), LEFT(MONTHNAME(i.date_in),3) ORDER BY m`,
        [KES_RATE, KES_RATE, KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Extras-table revenue (Day Use, any category + confirmed-clean categories everywhere
      // else — see constants.ts EXTRAS_TABLE_REVENUE_CATEGORY_IDS) by arrival month — merged
      // into OD.arr's extras/extras_ly in JS. Same reasoning as the AD.byProp merge.
      // FIX (2026-07-13, extras-table revenue): was Day Use only; broadened via
      // extrasTableRevenueCase, WHERE property restriction removed since the case expression
      // now decides inclusion per-row.
      dayUseArrRows: () => query<{ m: number; extras: number; extras_ly: number }>(
        `SELECT MONTH(i.date_in) AS m,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, cm)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras_ly
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND (${dateInTwoYearsThroughMonth('i.date_in', cy, ly, cm)})${AND_P}
        GROUP BY MONTH(i.date_in)`,
        [KES_RATE, KES_RATE]
      ),

      // AD.yearly — top 12 trade partners this year.
      // FIX: revenue (rv_raw) comes from a reservations-only subquery (no itinerary join);
      // nights (nt) and ADR (adr) come from a separate itinerary-join subquery.
      // Previously joined all three tables and summed r.total_amount across itinerary rows,
      // inflating rv_raw by avg leg count (~1.5–2.9x per agent, per the audit).
      // FIX (2026-07-07, revenue status-mixing audit): rv_raw's subquery was status IN
      // ('20','30') — changed to status='30' only. The LY comparison query below (feeding this
      // table's YoY chip) was fixed to match in the same pass, so both sides of the chip are
      // confirmed-only.
      // FIX (2026-07-09, Tier 3): `rv` was r.total_amount (reservation-level, everything
      // blended) — now a rate_components-based Room/Extras split (new extras_raw field), same
      // restructure as kpiAgentRev in Tier 2 (no dedup needed once summing at the correct
      // itinerary+component granularity). Day Use merged in from a separate per-agent query
      // below, in JS.
      // FIX (also 2026-07-09): `lg.adr` and `res.r_adr` are per-agent ADR figures that were
      // missed in the original Tier 1 ADR pass — both now Room-Revenue-only, per the same
      // approved hospitality-convention decision applied to every other ADR figure. Nights (nt)
      // split into their own sub-subquery in both `lg` and `res` so joining rate_components for
      // the revenue numerator doesn't multiply nights by component count per itinerary.
      agRows: () => query<{ ag_id: string; nm: string; rv_raw: number; extras_raw: number; nt: number; adr: number; r_adr: number; agent_physical_country: string | null; agent_postal_country: string | null }>(
        `SELECT a.agent_id AS ag_id, a.agent_name AS nm, rv.rv_raw, rv.extras_raw, lg.nt, lg.adr, res.r_adr,
          a.agent_physical_country, a.agent_postal_country
        FROM (
          SELECT r.agent_id,
            ${ROOM_REVENUE_SUM_SQL} AS rv_raw,
            ${EXTRAS_SUM_SQL} AS extras_raw
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) rv
        JOIN (
          SELECT nt.agent_id, nt.nt, ROUND(roomrev.room_rev/GREATEST(nt.nt,1)) AS adr
          FROM (
            SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?${AND_P}
            GROUP BY r.agent_id
          ) nt
          JOIN (
            SELECT r.agent_id, ${ROOM_REVENUE_SUM_SQL} AS room_rev
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
            LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
            WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?${AND_P}
            GROUP BY r.agent_id
          ) roomrev ON nt.agent_id = roomrev.agent_id
        ) lg ON rv.agent_id=lg.agent_id
        LEFT JOIN (
          SELECT nt2.agent_id, ROUND(roomrev2.room_rev/GREATEST(nt2.nt,1)) AS r_adr
          FROM (
            SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND r.rate_type IN (?)
              AND r.reservation_number NOT LIKE ?${AND_P}
            GROUP BY r.agent_id
          ) nt2
          JOIN (
            SELECT r.agent_id, ${ROOM_REVENUE_SUM_SQL} AS room_rev
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
            LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
            WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND r.rate_type IN (?)
              AND r.reservation_number NOT LIKE ?${AND_P}
            GROUP BY r.agent_id
          ) roomrev2 ON nt2.agent_id = roomrev2.agent_id
        ) res ON rv.agent_id=res.agent_id
        JOIN agents a ON rv.agent_id=a.agent_id
        WHERE a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A}
        ORDER BY rv_raw DESC`,
        [
          KES_RATE,
          KES_RATE,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          EAR_IDS,
          RES_PREFIX,
          KES_RATE,
          EX_AGENT_IDS,
          EAR_IDS,
          RES_PREFIX,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE
        ]
      ),

      // Agent Leaderboard footer totals (2026-07-16g) — mirrors agRows' own rv+lg join EXACTLY
      // (same r.date_created basis for both revenue and nights, same status splits — rv_raw via
      // status='30' only, nt via status IN ('20','30') activity basis — same AND_A/AND_P scoping)
      // but aggregates instead of returning one row per agent, so total_revenue/total_nights are
      // genuine sums over the FULL matching population (not capped to the visible top 150) and
      // reconcile with agRows' own rv_raw/nt columns — not the Trade Partners KPI cards
      // (kpiAgentRev), which use i.date_in and would silently diverge from what the table shows.
      // No roomrev/res sub-subqueries here — this only needs nt (nights), not adr, since Blended
      // ADR is derived in JS from total_revenue/total_nights (matching the design mockup).
      // agentCount is COUNT(DISTINCT rv.agent_id) over the same join, so it's guaranteed to equal
      // AD.yearlyDirectory.length (built from this exact same agRows population) — a built-in
      // cross-check, not a separately-derived number that could drift.
      agentTotalsRow: () => queryOne<{ total_revenue: number; total_nights: number; agent_count: number }>(
        `SELECT SUM(rv.rv_raw) AS total_revenue, SUM(lg.nt) AS total_nights, COUNT(DISTINCT rv.agent_id) AS agent_count
        FROM (
          SELECT r.agent_id, ${ROOM_REVENUE_SUM_SQL} AS rv_raw
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) rv
        JOIN (
          SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) lg ON rv.agent_id=lg.agent_id
        JOIN agents a ON rv.agent_id=a.agent_id
        WHERE a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A}`,
        [
          KES_RATE,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE
        ]
      ),

      // LY counterpart of agentTotalsRow above — identical shape, cy -> ly, same monthLo/monthHi
      // (same-period-last-year, matching agLyRows' own cy->ly convention) — feeds the footer's
      // Blended YoY tile via (total_revenue - ly.total_revenue) / ly.total_revenue.
      agentTotalsLyRow: () => queryOne<{ total_revenue: number; total_nights: number; agent_count: number }>(
        `SELECT SUM(rv.rv_raw) AS total_revenue, SUM(lg.nt) AS total_nights, COUNT(DISTINCT rv.agent_id) AS agent_count
        FROM (
          SELECT r.agent_id, ${ROOM_REVENUE_SUM_SQL} AS rv_raw
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) rv
        JOIN (
          SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) lg ON rv.agent_id=lg.agent_id
        JOIN agents a ON rv.agent_id=a.agent_id
        WHERE a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A}`,
        [
          KES_RATE,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE
        ]
      ),

      // Same-elapsed-basis LY total (2026-07-22 fix) — identical to agentTotalsLyRow above except
      // ALWAYS bounded Jan 1–realCurrentMonth (hardcoded, not the period-derived monthLo/monthHi).
      // Root cause: agentTotalsRow/agentTotalsLyRow filter by r.date_created, which for period='a'
      // requests monthHi=12 on BOTH sides — but the cy side silently truncates to "so far this
      // year" (date_created can never be in the future), while the ly side (2025, fully elapsed)
      // genuinely gets all 12 months. Comparing ~7 months of new 2026 bookings against 12 months
      // of 2025 bookings produced the Leaderboard footer's "-55.0% YoY" artifact (live-verified
      // 2026-07-22) — the exact same partial-vs-full mismatch already fixed for the KPI cards,
      // just living in a completely different query pair this fix never touched. For period='m'/
      // 'y', this is unused — agentTotalsLyRow's own period-driven bounds are already correct
      // there (both sides already elapsed-matched), so only period='a' switches to this query;
      // see the `totals` assembly below.
      agentTotalsLyYtdRow: () => queryOne<{ total_revenue: number; total_nights: number; agent_count: number }>(
        `SELECT SUM(rv.rv_raw) AS total_revenue, SUM(lg.nt) AS total_nights, COUNT(DISTINCT rv.agent_id) AS agent_count
        FROM (
          SELECT r.agent_id, ${ROOM_REVENUE_SUM_SQL} AS rv_raw
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('r.date_created', ly, 1, realCurrentMonth)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) rv
        JOIN (
          SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('r.date_created', ly, 1, realCurrentMonth)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.agent_id
        ) lg ON rv.agent_id=lg.agent_id
        JOIN agents a ON rv.agent_id=a.agent_id
        WHERE a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A}`,
        [
          KES_RATE,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE
        ]
      ),

      // Extras-table revenue (Day Use, any category + confirmed-clean categories everywhere
      // else), grouped by agent — merged into AD.yearly's extras_raw in JS. Same pattern as
      // the AD.byProp query. FIX (2026-07-13, extras-table revenue): broadened beyond Day Use.
      // FIX (2026-07-13, Channel/Market Segment filtering): added the agents join (previously
      // absent) solely so AND_A can reach a.agent_name — does not change which agent_ids were
      // already being excluded here (r.agent_id NOT IN (?) is unchanged).
      dayUseAgentRows: () => query<{ agent_id: string; extras: number }>(
        `SELECT r.agent_id,
          SUM(CASE WHEN ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END) AS extras
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
          AND r.agent_id NOT IN (?)${AND_A}${AND_P}
        GROUP BY r.agent_id`,
        [KES_RATE, EX_AGENT_IDS]
      ),

      // AD.yearly LY comparison — feeds the Top Trade Partners table's YoY chip only (rv vs
      // lyRv), no separate LY Extras display, so only rv_raw needs fixing here — no dedup/nights
      // complexity since this query never touched ADR.
      // FIX (2026-07-07, revenue status-mixing audit follow-up): status IN ('20','30') ->
      // status='30', matching AD.yearly's current-year rv fix above so the Top Trade Partners
      // table's YoY chip compares confirmed-only against confirmed-only on both sides.
      // FIX (2026-07-09, Tier 3): rv_raw was r.total_amount (everything blended) — now
      // Room-Revenue-only via rate_components, matching the current-year side so the YoY chip
      // stays apples-to-apples.
      agLyRows: () => query<{ nm: string; rv_raw: number }>(
        `SELECT a.agent_name AS nm, ${ROOM_REVENUE_SUM_SQL} AS rv_raw
        FROM reservations r
        JOIN agents a ON r.agent_id=a.agent_id
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)}
          AND a.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY a.agent_id, a.agent_name`,
        [KES_RATE, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // AD.byProp — revenue by property for agent bookings.
      // Uses i.total_gross_amount (itinerary-level, grouped by property) — no dedup needed.
      // FIX (2026-07-07, revenue status-mixing audit): status IN ('20','30') -> status='30'.
      // Single WHERE gates both rv and ly_val, so current + LY move together.
      // FIX (2026-07-08, Room Revenue / Extras split): rv/ly_val were i.total_gross_amount
      // (everything blended). Added a rate_components join and split into Room Revenue (rv,
      // ly_val — per-property classification from constants.ts) and Extras (extras, extras_ly —
      // everything else, minus excluded pass-through fees). This query is already grouped by
      // i.property, which is exactly what the per-property classification needs. Day Use revenue
      // (ACL/Kilindi) is NOT in this result — it has no rate_components (confirmed live, $0) —
      // it's merged in from the separate dayUsePropRows query below, in JS.
      agPropRows: () => query<{ pr: string; property_id: string; rv: number; ly_val: number; extras: number; extras_ly: number }>(
        `SELECT COALESCE(p.name, i.property) AS pr, i.property AS property_id,
          SUM(CASE WHEN ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS rv,
          SUM(CASE WHEN ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS ly_val,
          SUM(CASE WHEN ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras_ly
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN properties p ON i.property=p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND r.agent_id IS NOT NULL AND i.property IS NOT NULL
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY i.property, COALESCE(p.name, i.property) ORDER BY rv DESC LIMIT 16`,
        [
          KES_RATE,
          KES_RATE,
          KES_RATE,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX
        ]
      ),

      // Extras-table revenue (Day Use, any category + confirmed-clean categories everywhere
      // else) — merged into AD.byProp's extras/extras_ly by property in JS. See constants.ts's
      // DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY and EXTRAS_TABLE_REVENUE_CATEGORY_IDS notes.
      // FIX (2026-07-13, extras-table revenue): broadened beyond Day Use.
      // FIX (2026-07-13, Channel/Market Segment filtering): this query had NO agent scoping at
      // all (fed an agent-scoped display — AD.byProp — with portfolio-wide Day Use money,
      // including non-agent bookings). Added the agents join (needed for AND_A to reach
      // a.agent_name) plus r.agent_id IS NOT NULL, which — as a direct side effect — also fixes
      // that pre-existing scope mismatch. Flagging explicitly since it changes AD.byProp's Day
      // Use figures slightly (previously-included non-agent Day Use money is now excluded).
      dayUsePropRows: () => query<{ property_id: string; extras: number; extras_ly: number }>(
        `SELECT i.property AS property_id,
          SUM(CASE WHEN ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras_ly
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.agent_id IS NOT NULL${AND_A}${AND_P}
        GROUP BY i.property`,
        [KES_RATE, KES_RATE]
      ),

      // AD.byMonth — agent revenue by month.
      // FIX (2026-07-07, revenue status-mixing audit): status IN ('20','30') -> status='30'.
      // Single WHERE gates both act and ly_val, so current + LY move together.
      // FIX (2026-07-09, Tier 3): act/ly_val were r.total_amount (reservation-level, everything
      // blended) — now a rate_components-based Room/Extras split (new extras/extras_ly), no
      // nights aggregate in this query so no fan-out risk from the added join. Day Use merged in
      // from a separate by-month query below, in JS.
      agMonthRows: () => query<{ m: number; mn: string; act: number; ly_val: number; extras: number; extras_ly: number }>(
        `SELECT MONTH(r.date_created) AS m, LEFT(MONTHNAME(r.date_created),3) AS mn,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', cy, 1, cm)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS act,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', ly, 1, cm)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS ly_val,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', cy, 1, cm)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', ly, 1, cm)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras_ly
        FROM reservations r
        JOIN agents a ON r.agent_id = a.agent_id
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND r.agent_id IS NOT NULL
          AND (${dateInTwoYearsThroughMonth('r.date_created', cy, ly, cm)})
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY MONTH(r.date_created), LEFT(MONTHNAME(r.date_created),3) ORDER BY m`,
        [
          KES_RATE,
          KES_RATE,
          KES_RATE,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX
        ]
      ),

      // Extras-table revenue (Day Use, any category + confirmed-clean categories everywhere
      // else), by agent-linked booking month — merged into AD.byMonth's extras/extras_ly in JS.
      // FIX (2026-07-13, extras-table revenue): broadened beyond Day Use.
      // FIX (2026-07-13, Channel/Market Segment filtering): added the agents join (previously
      // absent) solely so AND_A can reach a.agent_name — agent_id scoping was already correct.
      dayUseAgentMonthRows: () => query<{ m: number; extras: number; extras_ly: number }>(
        `SELECT MONTH(r.date_created) AS m,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', cy, 1, cm)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${caseInYearMonthRange('r.date_created', ly, 1, cm)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras_ly
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.agent_id IS NOT NULL AND (${dateInTwoYearsThroughMonth('r.date_created', cy, ly, cm)})
          AND r.agent_id NOT IN (?)${AND_A}${AND_P}
        GROUP BY MONTH(r.date_created)`,
        [KES_RATE, KES_RATE, EX_AGENT_IDS]
      ),

      // AD.occByMonth — room nights by month. DATEDIFF per leg is the legitimate exception.
      occMonthRows: () => query<{ m: number; mn: string; act: number; ly_val: number }>(
        `SELECT MONTH(i.date_in) AS m, LEFT(MONTHNAME(i.date_in),3) AS mn,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS act,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, cm)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS ly_val
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('20','30') AND (${dateInTwoYearsThroughMonth('i.date_in', cy, ly, cm)})
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}
        GROUP BY MONTH(i.date_in), LEFT(MONTHNAME(i.date_in),3) ORDER BY m`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // AD.adr — average daily rate by month, resident vs non-resident.
      // FIX (2026-07-08b): status IN ('20','30') -> status='30', per the app-wide "revenue =
      // confirmed only" rule — folded into this same batch per instruction, not held separately.
      // FIX (2026-07-08, Room Revenue / Extras split): numerator was i.total_gross_amount
      // (everything blended) — now Room-Revenue-only, per hospitality convention. Nights (nt)
      // and revenue (rev) split into separate GROUP-BY-month subqueries joined on month, so
      // joining rate_components for the revenue numerator doesn't multiply nights by component
      // count per itinerary.
      adrRows: () => query<{ m: number; mn: string; nr: number; res: number }>(
        `SELECT nt.m, nt.mn,
          ROUND(rev.nr_rev/GREATEST(nt.nr_nights,1)) AS nr,
          ROUND(rev.res_rev/GREATEST(nt.res_nights,1)) AS res
        FROM (
          SELECT MONTH(i.date_in) AS m, LEFT(MONTHNAME(i.date_in),3) AS mn,
            SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND r.rate_type NOT IN (?) THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nr_nights,
            SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND r.rate_type IN (?) THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS res_nights
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.status = '30' AND ${dateInYearThroughMonth('i.date_in', cy, cm)}
            AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY MONTH(i.date_in), LEFT(MONTHNAME(i.date_in),3)
        ) nt
        JOIN (
          SELECT MONTH(i.date_in) AS m,
            SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND r.rate_type NOT IN (?) AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS nr_rev,
            SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, cm)} AND r.rate_type IN (?) AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS res_rev
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearThroughMonth('i.date_in', cy, cm)}
            AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY MONTH(i.date_in)
        ) rev ON nt.m = rev.m
        ORDER BY nt.m`,
        [
          EAR_IDS,
          EAR_IDS,
          NON_REV_IDS,
          RES_PREFIX,
          EAR_IDS,
          KES_RATE,
          EAR_IDS,
          KES_RATE,
          NON_REV_IDS,
          RES_PREFIX
        ]
      ),

      // AD.ch — channel breakdown. Reservations only — no itinerary join, no dedup needed.
      chRows: () => query<{ ch: string; cnt: number }>(
        `SELECT IFNULL(rate_type,'Unallocated') AS ch, COUNT(*) AS cnt
        FROM reservations WHERE status IN ('20','30') AND ${dateInYearMonthRange('date_created', cy, monthLo, monthHi)}
          AND rate_type NOT IN (?)
          AND reservation_number NOT LIKE ?
          AND total_amount > 0${AND_P_RESV}
        GROUP BY rate_type ORDER BY cnt DESC LIMIT 5`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // PLF — forward pipeline funnel.
      // FIX: DISTINCT subquery collapses each reservation to one row before summing total_amount.
      // COUNT(*) replaces COUNT(DISTINCT ...) since the subquery already deduplicates.
      // Previously summed r.total_amount across all itinerary rows (2.92x inflation on total_val).
      plfRow: () => queryOne<{
        total_ct: number; total_val: number
        cf_ct: number; cf_val: number
        pv_ct: number; pv_val: number
        ho_ct: number; ho_val: number
      }>(
        `SELECT COUNT(CASE WHEN total_amount > 0 THEN 1 END) AS total_ct,
          SUM(IFNULL(total_amount,0)) AS total_val,
          COUNT(CASE WHEN status='30' AND total_amount > 0 THEN 1 END) AS cf_ct,
          SUM(CASE WHEN status='30' THEN IFNULL(total_amount,0) ELSE 0 END) AS cf_val,
          COUNT(CASE WHEN status='20' AND total_amount > 0 THEN 1 END) AS pv_ct,
          SUM(CASE WHEN status='20' THEN IFNULL(total_amount,0) ELSE 0 END) AS pv_val,
          COUNT(CASE WHEN status='20' AND provision_expiry_date > CURDATE() AND total_amount > 0 THEN 1 END) AS ho_ct,
          SUM(CASE WHEN status='20' AND provision_expiry_date > CURDATE() THEN IFNULL(total_amount,0) ELSE 0 END) AS ho_val
        FROM (
          SELECT DISTINCT r.reservation_number, r.status, r.provision_expiry_date,
            CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END AS total_amount
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status IN ('20','30') AND i.date_in > CURDATE()
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) deduped`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // YTD arrivals.
      // FIX: reads r.total_amount from reservations directly (one row per reservation),
      // using IN (SELECT DISTINCT ...) for date filtering instead of a JOIN that fans out rows.
      // Previously: 2.23x inflation on ytd_val ($251M → $112M correct).
      ytdRow: () => queryOne<{ ytd_ct: number; ytd_val: number }>(
        `SELECT COUNT(*) AS ytd_ct, SUM(IFNULL(CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END,0)) AS ytd_val
        FROM reservations r
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.reservation_number IN (
            SELECT DISTINCT reservation_number FROM itineraries
            WHERE date_in < CURDATE() AND ${dateInFullYear('date_in', cy)}${AND_P_BARE}
          )`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // PLT — next 6 arrivals. Per-leg display table — i.total_gross_amount per leg is intentional.
      pltRows: () => query<{ ag: string; agent_id: string; pr: string; property_id: string; ci: Date; nt: number; vl: number; st: string }>(
        `SELECT a.agent_name AS ag, a.agent_id AS agent_id, COALESCE(p.name, i.property) AS pr, i.property AS property_id,
          i.date_in AS ci, DATEDIFF(i.date_out, i.date_in) AS nt,
          CASE WHEN dt.currency='KES' THEN IFNULL(i.total_gross_amount, r.total_amount)/? ELSE IFNULL(i.total_gross_amount, r.total_amount) END AS vl,
          CASE r.status WHEN '30' THEN 'Confirmed' WHEN '20' THEN 'Provisional' ELSE r.status END AS st
        FROM reservations r JOIN agents a ON r.agent_id=a.agent_id
        JOIN itineraries i ON r.reservation_number=i.reservation_number
        LEFT JOIN properties p ON i.property=p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE i.date_in > CURDATE() AND r.status IN ('20','30') AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND a.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_P}
        ORDER BY i.date_in LIMIT 6`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE]
      ),

      // CD — consultants.
      // FIX: nm was the raw consultant code (e.g. WB756) — now a real display name via
      // consultant_first_name/consultant_last_name (same fields already proven working
      // on the Agent Profile panel footer). `code` is kept separately as the join key
      // for the LY lookup below (cdLyRows is still keyed by the code, not the name).
      // MAX() picks any one non-null name per consultant (names are stable per code in
      // practice); falls back to the raw code in JS if a consultant genuinely has no
      // name on any row, rather than showing a blank.
      // FIX (2026-07-07, revenue status-mixing audit): rv was summed off the same outer
      // WHERE as bk (booking count) and cv (% of total bookings), so it inherited status
      // IN ('20','30'). bk/cv are booking-activity counts (correctly IN ('20','30') per the
      // active/pipeline convention) and were left untouched; rv is now individually gated
      // to status='30' via CASE instead of narrowing the shared outer WHERE.
      // FIX (2026-07-09, Tier 3): rv was r.total_amount (reservation-level, everything
      // blended). Splitting it into a rate_components-based Room/Extras figure REQUIRES an
      // itinerary+rate_components join, which would fan out bk/cv's per-reservation COUNT if
      // done in the same query (one row per reservation -> one row per itinerary+component).
      // So counts (bk/cv, reservations-only, unchanged) and revenue (rv/extras,
      // rate_components-based, new) are now separate subqueries LEFT JOIN'd on consultant code —
      // same split-then-join pattern used throughout Tier 1-3.
      cdRows: () => query<{ code: string; display_name: string | null; bk: number; rv: number; extras: number; cv: number }>(
        `SELECT counts.code, counts.display_name, counts.bk, counts.cv,
          rev.rv/1000 AS rv, rev.extras/1000 AS extras
        FROM (
          SELECT r.consultant AS code,
            MAX(CASE WHEN r.consultant_first_name IS NOT NULL OR r.consultant_last_name IS NOT NULL
              THEN TRIM(CONCAT(IFNULL(r.consultant_first_name,''), ' ', IFNULL(r.consultant_last_name,'')))
            END) AS display_name,
            COUNT(CASE WHEN r.total_amount > 0 THEN 1 END) AS bk,
            COUNT(CASE WHEN r.total_amount > 0 THEN 1 END)*100.0/(
              SELECT COUNT(*) FROM reservations
              WHERE status IN ('20','30') AND ${dateInYearMonthRange('date_created', cy, monthLo, monthHi)}
                AND rate_type NOT IN (?) AND reservation_number NOT LIKE ? AND total_amount > 0${AND_P_RESV}
            ) AS cv
          FROM reservations r
          WHERE r.status IN ('20','30') AND r.consultant IS NOT NULL AND r.consultant!=''
            AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)} AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_P_RESV}
          GROUP BY r.consultant
          ORDER BY bk DESC LIMIT 10
        ) counts
        LEFT JOIN (
          SELECT r.consultant AS code, ${ROOM_REVENUE_SUM_SQL} AS rv, ${EXTRAS_SUM_SQL} AS extras
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status='30' AND r.consultant IS NOT NULL AND r.consultant!=''
            AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
            AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_P}
          GROUP BY r.consultant
        ) rev ON counts.code = rev.code
        ORDER BY counts.bk DESC`,
        [NON_REV_IDS, RES_PREFIX, NON_REV_IDS, RES_PREFIX, KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: confirmed forward bookings. COUNT(DISTINCT) handles fan-out — no dedup needed.
      kpiConfirmed: () => queryOne<{ confirmed_bkgs: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS confirmed_bkgs
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='30' AND i.date_in > CURDATE()
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.total_amount > 0${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: YTD revenue + nights + adr. Feeds KP_BASE.occ (Room Nights Sold, Avg Daily Rate,
      // Total Room Revenue) and KP_BASE.pace.rev ("Revenue on Books"). Per
      // OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY in constants.ts, occupancy stays scoped to
      // fully-completed stays (`i.date_out <= CURDATE()`).
      // FIX (2026-07-08, Room Revenue / Extras split): rev_raw was i.total_gross_amount
      // (everything blended). Split into three CROSS JOIN'd subqueries: `nights` (unchanged,
      // itinerary-level — kept separate so joining rate_components below doesn't multiply nights
      // by component count per itinerary), `rev` (rate_components-based Room/Extras split per
      // constants.ts's per-property classification), and `dayuse` (Day Use legs at ACL/Kilindi
      // carry $0 in both total_gross_amount and rate_components — their real charge lives in
      // extras, matched by reservation_number + internal_property; date_in <= CURDATE() is used
      // as the actualized proxy here since date_in=date_out for Day Use, so `date_out > date_in`
      // would wrongly exclude them). adr is now Room-Revenue-only (hospitality convention —
      // Extras shouldn't inflate Avg Daily Rate) and is computed against `nights.total_nights`
      // only (pre-Day-Use-fix), so this fix does not change ADR. extras_raw = rev's extras +
      // dayuse's total, summed in JS.
      // FIX (2026-07-13, Day Use nights gap): Day Use legs carry 0 nights under the DATEDIFF
      // formula (date_in=date_out) even though a room genuinely sold. Qlik's own convention
      // states "Roomnights include Day Rooms" — added day_use_nights (1 per leg) to the dayuse
      // subquery, summed into total_nights in JS (same pattern as extras_raw above). Confirmed
      // live 2026-07-13: this was ~29% of a 10,672-night gap vs Qlik's Trade Partner Scorecard.
      // FIX (2026-07-13, extras-table revenue): day_use_extras renamed extras_table_revenue and
      // broadened via extrasTableRevenueCase (Day Use, any category + confirmed-clean categories
      // everywhere else). day_use_nights stays Day-Use-only (dayUseLegCase), unaffected by the
      // broadening — nights are never counted for the new non-Day-Use categories, since those
      // bookings already get real DATEDIFF-based nights from the `nights` subquery above.
      // WHERE's day-use property restriction moved into each aggregate's own CASE so the LEFT
      // JOIN can reach every reservation, not just Day Use legs.
      // FIX (2026-07-20, Day Use double-count): day_use_nights counted EVERY Day-Use-flagged leg
      // (property+accommodation_type match) unconditionally, even ones that ALSO pass the `nights`
      // subquery's `i.date_out > i.date_in` filter and get their real DATEDIFF counted there too —
      // confirmed live: 13 ACL legs are Day-Use-flagged but span 1-2 real calendar days, so they
      // were counted BOTH via their real DATEDIFF (in `nights`) AND as a flat +1 (in `dayuse`),
      // double-counting 14 nights (36,658 vs the correct 36,624). Fixed by excluding Day-Use-
      // flagged legs from `nights`' DATEDIFF sum entirely (`AND NOT dayUseLegCase`) — they carry $0
      // Room Revenue regardless of date span, so this doesn't move `adr` (rev_raw is unaffected;
      // this in fact makes the existing "Day Use excluded from ADR" principle fully consistent,
      // since these 13 edge-case rows had been slipping into ADR's denominator before). Now
      // day_use_nights can go back to a flat COUNT of every Day-Use-flagged leg (no `<=` needed) —
      // total_nights + day_use_nights is now bit-identical to revparNightsRows/
      // roomNightsInclDayUseSql's single-CASE formula (2026-07-20 session), never double-counting.
      kpiRevNights: () => queryOne<{ rev_raw: number; total_nights: number; adr: number; extras_raw: number; extras_table_revenue: number; day_use_nights: number }>(
        `SELECT nights.total_nights, rev.rev_raw, rev.extras_raw, dayuse.extras_table_revenue, dayuse.day_use_nights,
          ROUND(rev.rev_raw/GREATEST(nights.total_nights,1)) AS adr
        FROM (
          SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in AND NOT ${dayUseLegCase('i')}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) nights
        CROSS JOIN (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS rev_raw, ${EXTRAS_SUM_SQL} AS extras_raw
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) rev
        CROSS JOIN (
          SELECT ${extrasTableRevenueSumSql('i2', 'e', 'dt2')} AS extras_table_revenue,
            COUNT(DISTINCT CASE WHEN ${dayUseLegCase('i2')} AND r2.rate_type NOT IN (?) AND r2.reservation_number NOT LIKE ? THEN i2.itinerary_id END) AS day_use_nights
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          LEFT JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.status='30' AND ${dateInYearMonthRange('i2.date_in', cy, monthLo, monthHi)} AND i2.date_in <= CURDATE()${AND_P2}
        ) dayuse`,
        [NON_REV_IDS, RES_PREFIX, KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: total revenue, full-year basis — dedicated denominator for Trade Partners'
      // "% of total" ratio only. Split out from the Occupancy query above (this session) so
      // Occupancy can stay actualized-only while Trade Partners' ratio keeps a same-basis
      // (full status=30 date_in-year, no date_out cutoff) comparison against Agent Room Revenue.
      // FIX (2026-07-08b, Room Revenue / Extras split, Tier 2): was i.total_gross_amount
      // (everything blended) — now Room-Revenue-only, matching Agent Room Revenue's new basis
      // (kpiAgentRev's `rev`), deferred from Tier 1 specifically to keep this ratio's numerator
      // and denominator on the same basis at all times. No nights aggregate in this query, so no
      // fan-out risk from the rate_components join.
      // Extended (2026-07-16g, Room Revenue tooltip) to also carry OTB (booking-inclusive) Extras —
      // extras_raw (rate_components-classified) alongside rev_raw, plus extras_table_revenue via a
      // CROSS JOIN sibling mirroring kpiRevNights' own `dayuse` subquery, but WITHOUT its
      // `i2.date_in <= CURDATE()` cap, since this whole query is deliberately booking-inclusive.
      // Extended again (2026-07-16i, Room Nights Sold tooltip) with a `nights` sibling mirroring
      // kpiRevNights' own `nights` subquery — same joins/exclusions, just without its
      // `i.date_out <= CURDATE()` cap — plus day_use_nights added to the `dayuse` subquery the
      // same way kpiRevNights adds it, so total_nights (nights.total_nights + dayuse.day_use_nights
      // in JS below) is the booking-inclusive sibling of totalNights, same basis as totalRevFullYearM.
      // FIX (2026-07-20, Day Use double-count): same fix as kpiRevNights above — see its comment.
      kpiTotalRevFullYear: () => queryOne<{ rev_raw: number; extras_raw: number; extras_table_revenue: number; total_nights: number; day_use_nights: number }>(
        `SELECT nights.total_nights, rev.rev_raw, rev.extras_raw, dayuse.extras_table_revenue, dayuse.day_use_nights
        FROM (
          SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND i.date_out > i.date_in AND NOT ${dayUseLegCase('i')}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) nights
        CROSS JOIN (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS rev_raw, ${EXTRAS_SUM_SQL} AS extras_raw
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) rev
        CROSS JOIN (
          SELECT ${extrasTableRevenueSumSql('i2', 'e', 'dt2')} AS extras_table_revenue,
            COUNT(DISTINCT CASE WHEN ${dayUseLegCase('i2')} AND r2.rate_type NOT IN (?) AND r2.reservation_number NOT LIKE ? THEN i2.itinerary_id END) AS day_use_nights
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          LEFT JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.status='30' AND ${dateInYearMonthRange('i2.date_in', cy, monthLo, monthHi)}${AND_P2}
        ) dayuse`,
        [NON_REV_IDS, RES_PREFIX, KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: actual Room Revenue for "Pace vs Budget" — MTD (the real current calendar month
      // only) and YTD (Jan through the real current month), ADDITIVE to the existing revenue
      // queries above (does not replace or alter them). Deliberately NOT actualized-stays-only
      // (matches "Revenue on Books" / kpiTotalRevFullYear's basis, not kpiRevNights' — a budget
      // target is compared against everything confirmed for that period, not just completed
      // stays) and deliberately anchored to realCurrentMonth/realCurrentYear rather than the
      // selected year/period filters, since "vs Budget" is inherently "how are we doing right
      // now," not a re-sliceable historical view. Budget itself only covers 2026 (see
      // src/lib/budget.ts) — for any other selected year this comparison is still computed but
      // will show $0 budget, since there is no other year's file.
      kpiBudgetActual: () => queryOne<{ mtd_rev: number; ytd_rev: number }>(
        `SELECT
            SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, realCurrentMonth, realCurrentMonth)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS mtd_rev,
            SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 1, realCurrentMonth)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS ytd_rev
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND ${dateInFullYear('i.date_in', cy)} AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}`,
        [KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Property-level Budget variance table (2026-07-13) — ADDITIVE, does not touch any
      // existing revenue query. Actual Room Revenue by property, full-year 2026 specifically
      // (hardcoded, not the selected year/period filters — same reasoning as kpiBudgetActual
      // above: a Budget comparison is inherently tied to the year the budget file covers, not
      // whatever year/period the dashboard happens to be showing).
      budgetActualByPropRows: () => query<{ property_id: string; rev: number }>(
        `SELECT i.property AS property_id, ${ROOM_REVENUE_SUM_SQL} AS rev
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND ${dateInFullYear('i.date_in', 2026)} AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY i.property`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: active trade partners.
      // FIX (Trade Partners reconciliation, this session): date filter changed from
      // r.date_created to i.date_in (stay date) — the confirmed Qliksense-matching date
      // convention per constants.ts (DATE_FIELD). date_created excluded advance bookings made
      // in a prior year for a future-year stay, understating count. Itinerary join added
      // solely to reach i.date_in — COUNT(DISTINCT r.agent_id) is unaffected by the resulting
      // per-leg fan-out, so no additional dedup is needed for this specific aggregate.
      kpiAgents: () => queryOne<{ active_agents: number }>(
        `SELECT COUNT(DISTINCT r.agent_id) AS active_agents
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)}
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          AND r.total_amount > 0`,
        [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: pipeline value.
      // FIX: reads r.total_amount from reservations directly (one row per reservation),
      // using IN (SELECT DISTINCT ...) for date filtering. Previously 2.51x inflation
      // ($20.3M → $8.1M correct). pipeline_opps count was already correct.
      kpiPipeline: () => queryOne<{ pipeline_raw: number; pipeline_opps: number }>(
        `SELECT SUM(IFNULL(CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END,0)) AS pipeline_raw,
          COUNT(CASE WHEN r.total_amount > 0 THEN 1 END) AS pipeline_opps
        FROM reservations r
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='20' AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.reservation_number IN (
            SELECT DISTINCT reservation_number FROM itineraries WHERE date_in > CURDATE()${AND_P_BARE}
          )`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: avg lead time. Note: biased toward multi-leg reservations (each leg contributes
      // one data point to the AVG with a different date_in). Logged as a separate lower-priority
      // item — not fixed here, as it requires a MIN(date_in) dedup that changes the query shape.
      kpiLead: () => queryOne<{ avg_lead: number }>(
        `SELECT ROUND(AVG(DATEDIFF(i.date_in, r.date_created))) AS avg_lead
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30') AND r.date_created IS NOT NULL
          AND i.date_in > r.date_created AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: agent revenue + avg stay.
      // FIX: revenue (arev_raw) comes from a reservations-only subquery; port_adr and avg_stay
      // come from an itinerary-join subquery. CROSS JOIN merges the two single-row results.
      // Previously: 2.04x inflation on arev_raw ($212M → $104M correct).
      // FIX (Trade Partners reconciliation, this session): arev_raw's date filter changed from
      // r.date_created to i.date_in (stay date), matching the active-agents fix above and the
      // Qliksense-convention DATE_FIELD in constants.ts. Reaching i.date_in requires joining
      // itineraries, which reintroduces the exact per-leg fan-out JOIN_SAFETY_NOTE warns about
      // (avg 1.73 legs/reservation) — wrapped in a DISTINCT-then-SUM subquery (same idiom used
      // elsewhere in this file, e.g. the PLF/YTD blocks) so r.total_amount is only counted once
      // per reservation_number despite the itinerary join.
      // FIX (2026-07-07, revenue status-mixing audit): both `rev` and `lg` were status IN
      // ('20','30'), blending Provisional into Agent Room Revenue, Portfolio ADR, and Avg
      // Length of Stay. Both now status='30' only, per the app-wide "revenue = confirmed only"
      // rule. Live-verified (Annual 2026): Portfolio ADR $1,178 -> $1,071, Avg Length of Stay
      // 2.5 -> 2.3 nights.
      // FOLLOW-UP (logged, not fixed): `rev` filters on i.date_in (stay date) while `lg` filters
      // on r.date_created (booking date) — a pre-existing asymmetry between Agent Room Revenue's
      // date basis and Portfolio ADR/Avg Length of Stay's date basis, unrelated to the status fix
      // above. Left as-is; flagged for a future decision on whether they should share one basis.
      // FIX (2026-07-08, Room Revenue / Extras split): `lg`'s port_adr numerator was
      // i.total_gross_amount (everything blended) — now Room-Revenue-only, per hospitality
      // convention (ADR shouldn't be inflated by Extras). Nights/avg_stay moved into their own
      // sub-subquery (nt) so joining rate_components for the numerator doesn't multiply nights
      // by component count per itinerary.
      // FIX (2026-07-08b, Tier 2): `rev` was a DISTINCT-then-SUM subquery over r.total_amount
      // (reservation-level) — that dedup trick existed only because r.total_amount would
      // otherwise be double/triple-counted once per itinerary leg. Switched to summing
      // rate_components directly (itinerary+component-level, inherently non-duplicated by the
      // join) — this REMOVES the DISTINCT dedup entirely, it's no longer needed, and is a
      // simplification, not just a split. Live-verified: r.total_amount was already
      // itinerary/rate_components-only (never included extras-table charges — confirmed via
      // aggregate check, $101.99M total_amount vs $101.72M itinerary total_gross_amount for 2026
      // confirmed bookings, ~0.3% rounding gap), so this restructure doesn't gain or lose any
      // previously-counted money — arev_raw's Room Revenue + extras_raw + excluded fees should
      // reconcile to the old blended figure, plus dayuse.day_use_extras as genuinely new money
      // (Day Use itineraries carry $0 total_amount, same as $0 total_gross_amount).
      // NOTE: a reservation with itinerary legs spanning two different YEAR/MONTH-filtered
      // periods now attributes each leg's revenue to ITS OWN period, rather than bulk-attributing
      // the whole reservation's total_amount to any period containing at least one matching leg
      // (the old DISTINCT-dedup behavior). This is more correct, but is a genuine behavior change
      // for the rare multi-period-spanning reservation.
      // FIX (2026-07-13, extras-table revenue): day_use_extras renamed extras_table_revenue and
      // broadened via extrasTableRevenueCase (Day Use, any category + confirmed-clean categories
      // everywhere else). WHERE's day-use property restriction moved into the SUM's own CASE.
      kpiAgentRev: () => queryOne<{ arev_raw: number; extras_raw: number; extras_table_revenue: number; port_adr: number; avg_stay: number }>(
        `SELECT rev.arev_raw, rev.extras_raw, dayuse.extras_table_revenue, lg.port_adr, lg.avg_stay
        FROM (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS arev_raw, ${EXTRAS_SUM_SQL} AS extras_raw
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND a.agent_name NOT IN (?)
            AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        ) rev
        CROSS JOIN (
          SELECT ${extrasTableRevenueSumSql('i2', 'e', 'dt2')} AS extras_table_revenue
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          JOIN agents a2 ON r2.agent_id = a2.agent_id
          JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.status='30' AND r2.agent_id IS NOT NULL AND ${dateInYearMonthRange('i2.date_in', cy, monthLo, monthHi)}
            AND r2.agent_id NOT IN (?)
            AND a2.agent_name NOT IN (?)
            AND (LOWER(a2.agent_name) NOT LIKE ? OR a2.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A2}${AND_P2}
        ) dayuse
        CROSS JOIN (
          SELECT ROUND(roomrev.room_rev/GREATEST(nt.nights,1)) AS port_adr,
            ROUND(nt.nights/GREATEST(nt.res_ct,1),1) AS avg_stay
          FROM (
            SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nights,
              COUNT(DISTINCT r.reservation_number) AS res_ct
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            JOIN agents a ON r.agent_id = a.agent_id
            WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND a.agent_name NOT IN (?)
              AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          ) nt
          CROSS JOIN (
            SELECT ${ROOM_REVENUE_SUM_SQL} AS room_rev
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            JOIN agents a ON r.agent_id = a.agent_id
            JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
            LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
            WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND a.agent_name NOT IN (?)
              AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          ) roomrev
        ) lg`,
        [
          KES_RATE,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX
        ]
      ),

      // KPI: consultants. Reservations only — no dedup needed.
      kpiConsult: () => queryOne<{ n_consult: number; total_bkgs: number }>(
        `SELECT COUNT(DISTINCT consultant) AS n_consult, COUNT(*) AS total_bkgs
        FROM reservations
        WHERE status IN ('20','30') AND consultant IS NOT NULL AND consultant!=''
          AND ${dateInYearMonthRange('date_created', cy, monthLo, monthHi)} AND rate_type NOT IN (?) AND reservation_number NOT LIKE ? AND total_amount > 0${AND_P_RESV}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: LY bookings for pace index. COUNT(DISTINCT) handles fan-out — no dedup needed.
      kpiLyBkgs: () => queryOne<{ cnt: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS cnt
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('i.date_in', ly, monthLo, monthHi)}
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.total_amount > 0${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI LY: active trade partners, same-period prior year — real YoY basis for
      // KP_BASE.agents.active. Identical shape to the kpiAgents query above, cy -> ly.
      kpiAgentsLy: () => queryOne<{ active_agents: number }>(
        `SELECT COUNT(DISTINCT r.agent_id) AS active_agents
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('i.date_in', ly, monthLo, monthHi)}
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          AND r.total_amount > 0`,
        [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI LY: agent revenue + portfolio ADR + avg stay, same-period prior year — real
      // YoY basis for KP_BASE.agents.arev/nradr/radr. Identical shape to the kpiAgentRev
      // query above, cy -> ly.
      // FIX (2026-07-08b, Tier 2): same DISTINCT-dedup-removal restructure as kpiAgentRev above.
      // FIX (2026-07-13, extras-table revenue): day_use_extras renamed extras_table_revenue and
      // broadened via extrasTableRevenueCase (Day Use, any category + confirmed-clean categories
      // everywhere else). WHERE's day-use property restriction moved into the SUM's own CASE.
      kpiAgentRevLy: () => queryOne<{ arev_raw: number; extras_raw: number; extras_table_revenue: number; port_adr: number; avg_stay: number }>(
        `SELECT rev.arev_raw, rev.extras_raw, dayuse.extras_table_revenue, lg.port_adr, lg.avg_stay
        FROM (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS arev_raw, ${EXTRAS_SUM_SQL} AS extras_raw
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('i.date_in', ly, monthLo, monthHi)}
            AND r.agent_id NOT IN (?)
            AND a.agent_name NOT IN (?)
            AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        ) rev
        CROSS JOIN (
          SELECT ${extrasTableRevenueSumSql('i2', 'e', 'dt2')} AS extras_table_revenue
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          JOIN agents a2 ON r2.agent_id = a2.agent_id
          JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.status='30' AND r2.agent_id IS NOT NULL AND ${dateInYearMonthRange('i2.date_in', ly, monthLo, monthHi)}
            AND r2.agent_id NOT IN (?)
            AND a2.agent_name NOT IN (?)
            AND (LOWER(a2.agent_name) NOT LIKE ? OR a2.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A2}${AND_P2}
        ) dayuse
        CROSS JOIN (
          SELECT ROUND(roomrev.room_rev/GREATEST(nt.nights,1)) AS port_adr,
            ROUND(nt.nights/GREATEST(nt.res_ct,1),1) AS avg_stay
          FROM (
            SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nights,
              COUNT(DISTINCT r.reservation_number) AS res_ct
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            JOIN agents a ON r.agent_id = a.agent_id
            WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND a.agent_name NOT IN (?)
              AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          ) nt
          CROSS JOIN (
            SELECT ${ROOM_REVENUE_SUM_SQL} AS room_rev
            FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
            JOIN agents a ON r.agent_id = a.agent_id
            JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
            LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
            WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)}
              AND r.agent_id NOT IN (?)
              AND a.agent_name NOT IN (?)
              AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          ) roomrev
        ) lg`,
        [
          KES_RATE,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX
        ]
      ),

      // KPI LY: revenue + nights + adr, same-period prior year — real YoY basis for
      // pace.rev/occ.rev/occ.nights/occ.adr. Identical shape to the kpiRevNights query
      // above, cy -> ly. The `i.date_out <= CURDATE()` cutoff is unchanged — for a prior
      // year it's almost always trivially true, so this stays an apples-to-apples
      // actualized-stays comparison, not a behavior change.
      // FIX (2026-07-08, Room Revenue / Extras split): same three-way CROSS JOIN restructure
      // as kpiRevNights above, cy -> ly.
      // FIX (2026-07-13, Day Use nights gap): same day_use_nights addition as kpiRevNights above.
      // FIX (2026-07-13, extras-table revenue): same broadening as kpiRevNights above.
      // FIX (2026-07-20, Day Use double-count): same fix as kpiRevNights above — see its comment.
      kpiRevNightsLy: () => queryOne<{ rev_raw: number; total_nights: number; adr: number; extras_raw: number; extras_table_revenue: number; day_use_nights: number }>(
        `SELECT nights.total_nights, rev.rev_raw, rev.extras_raw, dayuse.extras_table_revenue, dayuse.day_use_nights,
          ROUND(rev.rev_raw/GREATEST(nights.total_nights,1)) AS adr
        FROM (
          SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', ly, monthLo, monthHi)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in AND NOT ${dayUseLegCase('i')}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) nights
        CROSS JOIN (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS rev_raw, ${EXTRAS_SUM_SQL} AS extras_raw
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', ly, monthLo, monthHi)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) rev
        CROSS JOIN (
          SELECT ${extrasTableRevenueSumSql('i2', 'e', 'dt2')} AS extras_table_revenue,
            COUNT(DISTINCT CASE WHEN ${dayUseLegCase('i2')} AND r2.rate_type NOT IN (?) AND r2.reservation_number NOT LIKE ? THEN i2.itinerary_id END) AS day_use_nights
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          LEFT JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.status='30' AND ${dateInYearMonthRange('i2.date_in', ly, monthLo, monthHi)} AND i2.date_in <= CURDATE()${AND_P2}
        ) dayuse`,
        [NON_REV_IDS, RES_PREFIX, KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX, KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Same-elapsed-basis LY actual (2026-07-22 fix) — sibling to kpiRevNightsLy above, but
      // ALWAYS bounded Jan 1–realCurrentMonth (hardcoded, not the period-derived monthLo/monthHi),
      // regardless of which period toggle is selected. Purpose: kpiRevNightsLy's own `ly` becomes
      // last year's COMPLETE 12 months when period==='a', while occ.rev/nights.v stays actualized-
      // to-date (partial year) — comparing the two is the exact same partial-vs-full mismatch
      // already fixed for the Full Year card headline (2026-07-22), just resurfacing in the detail
      // tooltip's "vs Last Year" line instead. This query exists solely to feed
      // tooltipDetail.actualizedLy (see below) with a real, always-apples-to-apples comparator —
      // never occ.rev/nights.ly itself, which stays untouched for every other consumer (KpiCard's
      // single-comparison fallback, the Full Year card's own "vs Last Year" row, ExecSummaryView).
      // Leaner than kpiRevNightsLy — no extras/adr needed here, just rev_raw + total_nights +
      // day_use_nights, so the rev subquery uses ROOM_REVENUE_SUM_SQL alone (one placeholder, not
      // two) and the day-use subquery drops the extras-table join entirely.
      kpiRevNightsLyYtd: () => queryOne<{ rev_raw: number; total_nights: number; day_use_nights: number }>(
        `SELECT nights.total_nights, rev.rev_raw, dayuse.day_use_nights
        FROM (
          SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', ly, 1, realCurrentMonth)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in AND NOT ${dayUseLegCase('i')}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) nights
        CROSS JOIN (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS rev_raw
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', ly, 1, realCurrentMonth)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_P}
        ) rev
        CROSS JOIN (
          SELECT COUNT(DISTINCT CASE WHEN ${dayUseLegCase('i2')} AND r2.rate_type NOT IN (?) AND r2.reservation_number NOT LIKE ? THEN i2.itinerary_id END) AS day_use_nights
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          WHERE r2.status='30' AND ${dateInYearMonthRange('i2.date_in', ly, 1, realCurrentMonth)} AND i2.date_in <= CURDATE()${AND_P2}
        ) dayuse`,
        [NON_REV_IDS, RES_PREFIX, KES_RATE, NON_REV_IDS, RES_PREFIX, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI LY: avg lead time, same-period prior year — real YoY basis for pace.lead.
      // Identical shape to the kpiLead query above, cy -> ly.
      kpiLeadLy: () => queryOne<{ avg_lead: number }>(
        `SELECT ROUND(AVG(DATEDIFF(i.date_in, r.date_created))) AS avg_lead
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30') AND r.date_created IS NOT NULL
          AND i.date_in > r.date_created AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)}
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI LY: consultants, same-period prior year — real YoY basis for consult.n/bkgs
      // (and the derived consult.avg). Identical shape to the kpiConsult query above, cy -> ly.
      kpiConsultLy: () => queryOne<{ n_consult: number; total_bkgs: number }>(
        `SELECT COUNT(DISTINCT consultant) AS n_consult, COUNT(*) AS total_bkgs
        FROM reservations
        WHERE status IN ('20','30') AND consultant IS NOT NULL AND consultant!=''
          AND ${dateInYearMonthRange('date_created', ly, monthLo, monthHi)} AND rate_type NOT IN (?) AND reservation_number NOT LIKE ? AND total_amount > 0${AND_P_RESV}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // CD LY — consultant revenue prior year, same period, keyed by consultant name.
      // Real YoY basis for ConsultView's cg/up chips (previously cg hardcoded '+0%', up
      // derived from list position). Same reusable idiom as agLyRows/agLyMap above.
      // FIX (2026-07-07, revenue status-mixing audit): status IN ('20','30') -> status='30',
      // matching cdRows' rv fix above so the cg/up YoY chip compares confirmed-only both sides.
      // FIX (2026-07-09, Tier 3): rv was r.total_amount (everything blended) — now
      // Room-Revenue-only via rate_components, matching cdRows' current-year side so the YoY
      // chip stays apples-to-apples. No counts sharing this query, so no split needed.
      cdLyRows: () => query<{ nm: string; rv: number }>(
        `SELECT r.consultant AS nm, ${ROOM_REVENUE_SUM_SQL}/1000 AS rv
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND r.consultant IS NOT NULL AND r.consultant!=''
          AND ${dateInYearMonthRange('r.date_created', ly, monthLo, monthHi)} AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_P}
        GROUP BY r.consultant`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI STLY: confirmed bookings, BOUNDED window, dedicated to the Confirmed Bookings
      // KPI card only — deliberately NOT reusing the shared `confirmedBkgs` variable
      // (kpiConfirmed above), which also feeds Pace Index and Pipeline's Conversion Rate
      // and is out of scope for this fix. An open-ended STLY lookback (date_in > CURDATE()
      // - 1 YEAR, no upper bound) was tried first and rejected: status='30' never expires
      // (unlike Provisional, which self-resolves), so it swept up an entire extra year of
      // now-past confirmed bookings on top of genuinely-future ones (13,910 vs the live
      // 4,451 — a -68% "delta" that was a measurement artifact, not a real signal).
      // Fix: both windows below are the SAME fixed 1-year span, just shifted — current
      // is [today, +1yr), STLY is [-1yr, today) — so they're symmetric and comparable.
      kpiConfirmedBounded: () => queryOne<{ confirmed_bkgs: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS confirmed_bkgs
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='30' AND i.date_in > CURDATE() AND i.date_in <= DATE_ADD(CURDATE(), INTERVAL 1 YEAR)
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.total_amount > 0${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI STLY: confirmed bookings, same bounded 1-year window shifted back exactly a
      // year — [-1yr, today) — the STLY counterpart to kpiConfirmedBounded above.
      kpiConfirmedStly: () => queryOne<{ confirmed_bkgs: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS confirmed_bkgs
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='30' AND i.date_in > DATE_SUB(CURDATE(), INTERVAL 1 YEAR) AND i.date_in <= CURDATE()
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.total_amount > 0${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI STLY: pipeline value + opps, same-time-last-year basis. Identical shape to
      // the kpiPipeline query above, CURDATE() -> DATE_SUB(CURDATE(), INTERVAL 1 YEAR) —
      // same STLY reasoning as kpiConfirmedStly above.
      kpiPipelineStly: () => queryOne<{ pipeline_raw: number; pipeline_opps: number }>(
        `SELECT SUM(IFNULL(CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END,0)) AS pipeline_raw,
          COUNT(CASE WHEN r.total_amount > 0 THEN 1 END) AS pipeline_opps
        FROM reservations r
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='20' AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
          AND r.reservation_number IN (
            SELECT DISTINCT reservation_number FROM itineraries WHERE date_in > DATE_SUB(CURDATE(), INTERVAL 1 YEAR)${AND_P_BARE}
          )`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // KPI: cancellation rate — Faith-confirmed methodology: status='90' (cancelled) /
      // status IN ('20','30','90') as denominator. Calendar-period-bound (date_created,
      // year/month range), same shape as the other mechanical-batch cards — NOT STLY,
      // since (unlike Pipeline/Confirmed Bookings) this query has a real year to swap for
      // a standard YoY comparison. Flagging: date_created was chosen (booking-intake
      // basis, matching kpiConsult/CD/PD) since a cancelled reservation has no meaningful
      // "stay" to anchor on via i.date_in — correct me if a different date field was intended.
      kpiCancel: () => queryOne<{ cancelled_ct: number; total_ct: number }>(
        `SELECT
          COUNT(CASE WHEN status='90' THEN 1 END) AS cancelled_ct,
          COUNT(CASE WHEN status IN ('20','30','90') THEN 1 END) AS total_ct
        FROM reservations
        WHERE ${dateInYearMonthRange('date_created', cy, monthLo, monthHi)}
          AND rate_type NOT IN (?)
          AND reservation_number NOT LIKE ?${AND_P_RESV}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // KPI LY: cancellation rate, same-period prior year — real YoY basis for
      // occ.cancel. Identical shape to kpiCancel above, cy -> ly.
      kpiCancelLy: () => queryOne<{ cancelled_ct: number; total_ct: number }>(
        `SELECT
          COUNT(CASE WHEN status='90' THEN 1 END) AS cancelled_ct,
          COUNT(CASE WHEN status IN ('20','30','90') THEN 1 END) AS total_ct
        FROM reservations
        WHERE ${dateInYearMonthRange('date_created', ly, monthLo, monthHi)}
          AND rate_type NOT IN (?)
          AND reservation_number NOT LIKE ?${AND_P_RESV}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // Forecast Room Nights, Piece 1+2 (2026-07-14): Confirmed (status='30') + Provisional
      // (status='20') nights, GROUPed by month, for the next 3 target months (month+1..month+3
      // from today — deliberately excludes the current in-progress month, since its Confirmed
      // Room Nights are already largely actualized rather than "forecast"). ADDITIVE — a new
      // query, does not touch kpiRevNights or any existing nights aggregate. Day Use nights
      // (day_use_nights) counted separately and added to confirmed_nights_raw in JS, same
      // pattern as kpiRevNights above — Day Use legs carry 0 nights under DATEDIFF. Provisional
      // is deliberately NOT Day-Use-adjusted (see JS assembly below for why).
      kpiForecastTargetRows: () => query<{ yr: number; mo: number; confirmed_nights_raw: number; day_use_nights: number; provisional_nights_raw: number }>(
        `SELECT YEAR(i.date_in) AS yr, MONTH(i.date_in) AS mo,
          SUM(CASE WHEN r.status='30' THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS confirmed_nights_raw,
          COUNT(DISTINCT CASE WHEN r.status='30' AND ${dayUseLegCase('i')} THEN i.itinerary_id END) AS day_use_nights,
          SUM(CASE WHEN r.status='20' THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS provisional_nights_raw
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('20','30')
          AND i.date_in >= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
          AND i.date_in <  DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 4 MONTH), '%Y-%m-01')
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}
        GROUP BY YEAR(i.date_in), MONTH(i.date_in)`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // Forecast Room Nights, Piece 3 (2026-07-14, REVISED 2026-07-14b): "last year's pick-up
      // for the target month." FIX: the original version used the entire FINAL STLY-month total
      // as "pick-up" — investigation (2026-07-14b, Forecast overshoot audit) proved ~90% of a
      // month's eventual nights are already on the books a full year before departure (a
      // long-lead-time safari business), so treating the WHOLE final total as "pick-up" on top
      // of this year's already-substantial Confirmed Nights double-counted almost the entire
      // base — the root cause of the 114-123%-of-Budget overshoot. Now computes the TRUE
      // incremental delta: final_nights (fully settled outcome) MINUS onbooks_nights (what was
      // already confirmed for that same month, as of the equivalent lead time last year — bounded
      // by r.date_created, no snapshot table needed, same technique as kpiForecastPace below).
      // Both final_* and onbooks_* get their own Day Use sub-count so the delta stays internally
      // consistent (Day Use nights included on both sides of the subtraction).
      kpiForecastStlyRows: () => query<{ yr: number; mo: number; final_nights_raw: number; final_day_use_nights: number; onbooks_nights_raw: number; onbooks_day_use_nights: number }>(
        `SELECT YEAR(i.date_in) AS yr, MONTH(i.date_in) AS mo,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS final_nights_raw,
          COUNT(DISTINCT CASE WHEN ${dayUseLegCase('i')} THEN i.itinerary_id END) AS final_day_use_nights,
          SUM(CASE WHEN r.date_created <= DATE_SUB(CURDATE(), INTERVAL 1 YEAR) THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS onbooks_nights_raw,
          COUNT(DISTINCT CASE WHEN r.date_created <= DATE_SUB(CURDATE(), INTERVAL 1 YEAR) AND ${dayUseLegCase('i')} THEN i.itinerary_id END) AS onbooks_day_use_nights
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status='30'
          AND i.date_in >= DATE_SUB(DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01'), INTERVAL 1 YEAR)
          AND i.date_in <  DATE_SUB(DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 4 MONTH), '%Y-%m-01'), INTERVAL 1 YEAR)
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_P}
        GROUP BY YEAR(i.date_in), MONTH(i.date_in)`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // Forecast Room Nights, Piece 3's scaling factor: "this year's pace vs last year's pace."
      // this_year_forward_nights = all currently-confirmed future nights, as of today (unbounded,
      // same population kpiConfirmed uses for bookings, but in nights). last_year_forward_nights_
      // same_leadtime = confirmed nights for the equivalent forward window a year ago, bounded to
      // r.date_created <= (today - 1yr) so it reflects what was actually on the books AT THAT
      // POINT last year, not the eventual final total — this only needs date_created (always
      // available), not a status-history snapshot (which does not exist in this schema).
      kpiForecastPace: () => queryOne<{ this_year_forward_nights: number; last_year_forward_nights_same_leadtime: number }>(
        `SELECT
          SUM(CASE WHEN i.date_in > CURDATE() THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS this_year_forward_nights,
          SUM(CASE WHEN i.date_in > DATE_SUB(CURDATE(), INTERVAL 1 YEAR) AND i.date_in <= CURDATE()
                     AND r.date_created <= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
                THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS last_year_forward_nights_same_leadtime
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status='30' AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_P}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // Forecast Room Nights, Piece 4 (2026-07-14, REVISED 2026-07-14c): Expected Cancellations =
      // full-year LY Cancellation Rate x Confirmed Nights (target month). FIX: the original rate
      // (status='90' / status IN ('20','30','90')) came out to 59.9% — Faith confirmed the real
      // expected rate is 5-10%. Root cause: that denominator lumped in every status='20' quote/
      // low-intent record, AND the status='90' numerator counted every archived/lapsed record
      // regardless of whether it was ever a real confirmed booking (investigation 2026-07-14c:
      // of 22,421 status='90' records in 2025, only 1,602 (7.1%) ever had a confirmation_date —
      // the other ~93% were quotes/provisionals that lapsed, never genuinely "cancelled"
      // bookings). NOW: numerator/denominator both scoped to `confirmation_date IS NOT NULL`
      // (i.e., reservations that were actually confirmed at some point — every current status='30'
      // row has one, confirming this is a reliable marker, no status-history snapshot needed) —
      // 9.7% for 2025, matching Faith's 5-10% range. Still hardcoded full year (months 1-12,
      // year=ly), NOT period-filtered, same as before.
      kpiForecastCancelLyFullYear: () => queryOne<{ cancelled_ct: number; total_ct: number }>(
        `SELECT
          COUNT(CASE WHEN status='90' AND confirmation_date IS NOT NULL THEN 1 END) AS cancelled_ct,
          COUNT(CASE WHEN confirmation_date IS NOT NULL THEN 1 END) AS total_ct
        FROM reservations
        WHERE ${dateInFullYear('date_created', ly)} AND rate_type NOT IN (?) AND reservation_number NOT LIKE ?${AND_P_RESV}`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // RevPAR by property (2026-07-14d) — ADDITIVE. Nights ONLY, no rate_components join, so no
      // fan-out risk (a bug caught and fixed during the feasibility test: joining rate_components
      // in the same query as a nights SUM multiplies nights by however many revenue components
      // each itinerary leg has, inflating "sold nights" 4-7x). Same scope as budgetActualByPropRows
      // below (status='30', YEAR(i.date_in)=2026, i.date_out>i.date_in, same exclusions) so its
      // Room Revenue can be paired with these nights without a basis mismatch — RevPAR =
      // budgetActualByPropRows' rev ÷ PROPERTY_ROOM_COUNTS' Dennis-confirmed Available Room Nights.
      // sold_nights_incl_day_use (2026-07-20) — Qlik's own convention counts Day Rooms in Room
      // Nights (same fix already applied to KP_BASE.occ.nights' totalNights, 2026-07-13); this was
      // the one other place "sold nights" was computed and had drifted from that convention (the
      // AI Query Box's room_nights_sold tool had the same gap — see templates.ts). Day Use legs
      // carry date_out=date_in (0 under DATEDIFF) despite a room genuinely being sold, so they need
      // the `OR dayUseLegCase` added to the WHERE clause (not just the SELECT) or they'd be filtered
      // out entirely by `i.date_out > i.date_in` before ever reaching the CASE below.
      // Kept SEPARATE from the original DATEDIFF-only `sold_nights` column, which stays the ADR
      // denominator (unchanged) — Day Use legs have $0 Room Revenue in this rate_components-based
      // roomRevenue figure, so folding them into ADR's denominator would dilute ADR with no matching
      // numerator, exactly the reasoning kpiRevNights' own `adr` field already follows (computed
      // against the pre-Day-Use nights.total_nights, never totalNights).
      revparNightsRows: () => query<{ property_id: string; sold_nights: number; sold_nights_incl_day_use: number }>(
        `SELECT i.property AS property_id,
            SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS sold_nights,
            SUM(CASE WHEN ${dayUseLegCase('i')} THEN 1 ELSE GREATEST(DATEDIFF(i.date_out,i.date_in),0) END) AS sold_nights_incl_day_use
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status = '30' AND ${dateInFullYear('i.date_in', 2026)} AND (i.date_out > i.date_in OR ${dayUseLegCase('i')})
          AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?
        GROUP BY i.property`,
        [NON_REV_IDS, RES_PREFIX]
      ),

      // Agent Pace, Winners/Losers (2026-07-14e) — ADDITIVE, Trade Partners tab. FIX baked in
      // from the start (not the naive kpiConfirmedStly-style comparison): ty_nights (forward
      // window from today) vs ly_nights_same_leadtime (the equivalent forward window a year ago,
      // AS IT STOOD at that point — bounded by r.date_created, not the eventual final total).
      // The naive version (ty forward vs ly's now-COMPLETED trailing-12mo total) was tested live
      // and rejected: it showed every major established agent as a huge decliner (Cheli & Peacock
      // -39.7%, Micato -55.4%) purely because a still-accumulating forward number will always
      // read lower than an already-fully-realized one — the same structural bug as Forecast
      // Piece 3. This corrected version produced plausible, verified results (Cheli & Peacock
      // -10.7%, Micato -28.1%). HAVING clause keeps rows with any volume at all; the >=20-night
      // meaningful-volume filter is applied in JS (see agentPaceGainers/Decliners below).
      agentPaceRows: () => query<{ agent_id: string; agent_name: string; ty_nights: number; ly_nights_same_leadtime: number }>(
        `SELECT a.agent_id, a.agent_name,
          SUM(CASE WHEN i.date_in > CURDATE() AND i.date_in <= DATE_ADD(CURDATE(), INTERVAL 1 YEAR) THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS ty_nights,
          SUM(CASE WHEN i.date_in > DATE_SUB(CURDATE(), INTERVAL 1 YEAR) AND i.date_in <= CURDATE()
                     AND r.date_created <= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
                THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS ly_nights_same_leadtime
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status='30'
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY a.agent_id, a.agent_name
        HAVING ty_nights > 0 OR ly_nights_same_leadtime > 0`,
        [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // Named Cancellation Drivers (2026-07-14e, REVISED 2026-07-14h) — ADDITIVE, Trade Partners
      // tab. Last 30 days, by r.last_change_date — validated live as the correct "when
      // cancelled" field (date_created measures booking INTAKE, not cancellation; updated_at is
      // a generic sync timestamp — 75% of ALL-time cancelled records fell in "the last 30 days"
      // by updated_at, vs a plausible 3% by last_change_date, confirmed by sampling: unrelated
      // reservations all clustered at the exact same few-minute nightly-sync window under
      // updated_at). FIX (2026-07-14h): caught during the Agent Performance drill-down build —
      // this query never applied confirmation_date IS NOT NULL, the same fix already validated
      // for the cancellation-RATE denominator (59.9% -> 9.7%). Without it, a single agent (RS23)
      // showed 10,263 all-time "cancelled bookings" — re-checked with the filter: 223. Most
      // status='90' records were never genuinely confirmed, just lapsed quotes/inquiries.
      cancelDriverNightsRows: () => query<{ agent_id: string; agent_name: string; cancelled_bookings: number; nights_lost: number }>(
        `SELECT a.agent_id, a.agent_name,
          COUNT(DISTINCT r.reservation_number) AS cancelled_bookings,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nights_lost
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL
          AND r.last_change_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY a.agent_id, a.agent_name`,
        [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // Named Cancellation Drivers' $ side — Room-Revenue-only (not blended with Extras), same
      // window/exclusions as cancelDriverNightsRows above. Separate query since it needs the
      // rate_components join (revenue-only, no nights summed here — no fan-out risk).
      cancelDriverRevRows: () => query<{ agent_id: string; room_rev_lost: number }>(
        `SELECT a.agent_id,
          SUM(CASE WHEN ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS room_rev_lost
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        JOIN agents a ON r.agent_id = a.agent_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL
          AND r.last_change_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY a.agent_id`,
        [KES_RATE, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // Low-Season Occupancy Lift, per agent (2026-07-09) — ADDITIVE, Trade Partners tab (Linda's
      // Dashboard KPI #2). Low season = Feb/Mar/Apr/May, confirmed live against 2024+2025
      // portfolio-wide sold-nights-by-month (NOT assumed) — those 4 months are the only ones
      // below the flat 8.3%-per-month share (2.3%-5.1% each), a clear contiguous trough with April
      // as the deepest point (matches the dip already flagged early in this project). Nov (7.2%)
      // is close to the mean and excluded — not a real dip, just a slightly softer shoulder month.
      // Full calendar year (YEAR(i.date_in)=cy, all 12 months), NOT monthLo/monthHi-bounded — "% of
      // annual business" is only meaningful against a full year, same reasoning as Property
      // Performance/RevPAR's fixed-year queries. Room-Revenue-only $ (ROOM_REVENUE_CASE), same
      // basis as every other agent revenue figure on this tab.
      lowSeasonByAgentRows: () => query<{ agent_id: string; agent_name: string; total_nights: number; low_nights: number; total_revenue: number; low_revenue: number }>(
        `SELECT r.agent_id, a.agent_name,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights,
          SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, 2, 5)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS low_nights,
          ${ROOM_REVENUE_SUM_SQL} AS total_revenue,
          SUM(CASE WHEN ${ROOM_REVENUE_CASE} AND ${caseInYearMonthRange('i.date_in', cy, 2, 5)} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS low_revenue
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        JOIN agents a ON r.agent_id = a.agent_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND ${dateInFullYear('i.date_in', cy)}
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY r.agent_id, a.agent_name`,
        [KES_RATE, KES_RATE, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // Properties Produced, per agent (2026-07-14f) — ADDITIVE, Top Trade Partners table.
      // Same date basis as AD.yearly (r.date_created, cy/monthLo/monthHi) — paired with that same
      // row's period, not Agent Profile's i.date_in basis (see agentConversionRows below for why
      // that one differs). Computed portfolio-wide (all agents, not just the visible top 12) and
      // merged via Map in JS, same pattern as dayUseAgentMap above.
      agentPropCountRows: () => query<{ agent_id: string; prop_count: number }>(
        `SELECT r.agent_id, COUNT(DISTINCT i.property) AS prop_count
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status='30' AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
          AND r.agent_id NOT IN (?)
          AND a.agent_name NOT IN (?)
          AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        GROUP BY r.agent_id`,
        [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // Materialisation/Conversion Rate, per agent (2026-07-14f) — ADDITIVE, Top Trade Partners
      // table. Exact replica of Faith's confirmed methodology already live on the single-agent
      // Profile route (src/app/api/agent/[agentId]/route.ts's poolRow query), just GROUPed across
      // every agent instead of WHERE agent_id=one. Deliberately keeps that route's own basis
      // as-is (YEAR(i.date_in)=cy, full calendar year, NOT the selected monthLo/monthHi period) —
      // this is a fixed-methodology metric, not a re-sliceable one, per how it was originally
      // built and confirmed. Denominator: status IN ('20','30') OR (status='90' AND prov_date IS
      // NOT NULL) — i.e. currently active/confirmed, or cancelled-but-was-provisional-at-some-
      // point (cancelled-straight-from-a-quote bookings correctly excluded).
      agentConversionRows: () => query<{ agent_id: string; confirmed_ct: number; total_ct: number }>(
        `SELECT agent_id,
          COUNT(CASE WHEN status='30' THEN 1 END) AS confirmed_ct,
          COUNT(*) AS total_ct
        FROM (
          SELECT DISTINCT r.reservation_number, r.status, r.agent_id
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          WHERE (r.status IN ('20','30') OR (r.status='90' AND r.prov_date IS NOT NULL))
            AND ${dateInFullYear('i.date_in', cy)}
            AND r.agent_id NOT IN (?)
            AND a.agent_name NOT IN (?)
            AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        ) deduped
        GROUP BY agent_id`,
        [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
      ),

      // Extras Revenue by property (2026-07-15, Property Performance table) — ADDITIVE, portfolio-
      // wide (all agents, not agent-scoped), full-year 2026 fixed, same basis/exclusions as
      // budgetActualByPropRows above (its Room Revenue sibling) so the two can sit side by side in
      // one table without a basis mismatch. rate_components-based Extras only — Day Use's
      // extras-table revenue is merged in separately below, same split as every other Extras figure
      // in this file.
      extrasByPropRows: () => query<{ property_id: string; extras: number }>(
        `SELECT i.property AS property_id, ${EXTRAS_SUM_SQL} AS extras
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND ${dateInFullYear('i.date_in', 2026)} AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY i.property`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Day Use / extras-table revenue by property (2026-07-15, Property Performance table) —
      // portfolio-wide sibling of AD.byProp's dayUsePropRows (which is agent-scoped) — same query,
      // just without the agent_id filter. Merged into extrasByPropRows above in JS.
      dayUseExtrasByPropRows: () => query<{ property_id: string; extras: number }>(
        `SELECT i.property AS property_id,
          ${extrasTableRevenueSumSql('i', 'e', 'dt')} AS extras
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND ${dateInFullYear('i.date_in', 2026)}
        GROUP BY i.property`,
        [KES_RATE]
      ),

      // Booking Status Movement (2026-07-15) — Confirmed + Provisional by month, in one query.
      // Reservation-deduped via MIN(date_in) per reservation (mirrors PF's own dedup pattern
      // above) so total_amount (reservation-level) isn't inflated by itinerary-leg fan-out. i.date_in
      // basis (stay date), period-filtered like every other headline revenue figure. Feeds both
      // the KPI cards (summed across months in JS) and the monthly trend chart.
      bookingConfirmedProvisionalByMonth: () => query<{ m: number; confirmed_val: number; provisional_val: number; confirmed_ct: number; provisional_ct: number }>(
        `SELECT MONTH(deduped.first_date_in) AS m,
          SUM(CASE WHEN deduped.status='30' THEN deduped.total_amount ELSE 0 END) AS confirmed_val,
          SUM(CASE WHEN deduped.status='20' THEN deduped.total_amount ELSE 0 END) AS provisional_val,
          COUNT(CASE WHEN deduped.status='30' THEN 1 END) AS confirmed_ct,
          COUNT(CASE WHEN deduped.status='20' THEN 1 END) AS provisional_ct
        FROM (
          SELECT r.reservation_number, r.status,
            CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END AS total_amount,
            MIN(i.date_in) AS first_date_in
          FROM reservations r
          JOIN itineraries i ON r.reservation_number=i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
          GROUP BY r.reservation_number, r.status, dt.currency, r.total_amount
        ) deduped
        GROUP BY MONTH(deduped.first_date_in)
        ORDER BY m`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Booking Status Movement — Cancelled Confirmed business by month. Exact proven
      // Cancellation Drivers methodology (status='90' AND confirmation_date IS NOT NULL, filtered
      // by last_change_date — the validated "when cancelled" field, not date_created/updated_at).
      // No itinerary join needed (last_change_date/total_amount both live on reservations), so no
      // fan-out risk here at all.
      bookingCancelledByMonth: () => query<{ m: number; cancelled_ct: number; cancelled_val: number }>(
        `SELECT MONTH(r.last_change_date) AS m,
          COUNT(DISTINCT r.reservation_number) AS cancelled_ct,
          SUM(CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END) AS cancelled_val
        FROM reservations r
        JOIN agents a ON r.agent_id = a.agent_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL
          AND ${dateInYearMonthRange('r.last_change_date', cy, monthLo, monthHi)}
          AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_A}${AND_P_RESV}
        GROUP BY MONTH(r.last_change_date)
        ORDER BY m`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Booking Status Movement — New Confirmed bookings by month. r.date_created basis (booking
      // intake) — a genuinely different population from the Confirmed bucket above (i.date_in,
      // stay date): this tracks bookings CREATED and already confirmed within the window, not
      // bookings STAYING within the window. No itinerary join needed at all (date_created lives
      // on reservations), same shape as PD's own monthly query above.
      bookingNewConfirmedByMonth: () => query<{ m: number; new_confirmed_ct: number; new_confirmed_val: number }>(
        `SELECT MONTH(r.date_created) AS m,
          COUNT(*) AS new_confirmed_ct,
          SUM(CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END) AS new_confirmed_val
        FROM reservations r
        JOIN agents a ON r.agent_id = a.agent_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.total_amount > 0
          AND ${dateInYearMonthRange('r.date_created', cy, monthLo, monthHi)}
          AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_A}${AND_P_RESV}
        GROUP BY MONTH(r.date_created)
        ORDER BY m`,
        [KES_RATE, NON_REV_IDS, RES_PREFIX]
      ),

      // Booking Status Movement — Provisional -> Confirmed conversion (REDEFINED 2026-07-09 to
      // remove Net Pick-up double-count — see project_booking_status_movement_pause_point memory).
      // Exact Materialisation dedup pattern (status IN ('20','30') OR (status='90' AND prov_date IS
      // NOT NULL), i.date_in basis) reused verbatim for total_ct/rate denominator. BUT confirmed_ct/
      // confirmed_val (the numerator, and the figures Net Pick-up sums) now EXCLUDE bookings whose
      // r.date_created also falls inside this period — those are already counted by New Confirmed
      // (r.date_created basis). Only counts genuine conversions: created before this period, sat as
      // Provisional, confirmed with a stay date inside this period.
      bookingConversionRow: () => queryOne<{ confirmed_ct: number; total_ct: number; confirmed_val: number }>(
        `SELECT
          COUNT(CASE WHEN status='30' AND NOT (created_yr=? AND created_mo BETWEEN ? AND ?) THEN 1 END) AS confirmed_ct,
          COUNT(*) AS total_ct,
          SUM(CASE WHEN status='30' AND NOT (created_yr=? AND created_mo BETWEEN ? AND ?) THEN total_amount ELSE 0 END) AS confirmed_val
        FROM (
          SELECT DISTINCT r.reservation_number, r.status,
            CASE WHEN dt.currency='KES' THEN r.total_amount/? ELSE r.total_amount END AS total_amount,
            YEAR(r.date_created) AS created_yr, MONTH(r.date_created) AS created_mo
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE (r.status IN ('20','30') OR (r.status='90' AND r.prov_date IS NOT NULL))
            AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)}
            AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${AND_A}${AND_P}
        ) deduped`,
        [cy, monthLo, monthHi, cy, monthLo, monthHi, KES_RATE, NON_REV_IDS, RES_PREFIX]
      )
    }

    const mainIds = (Object.keys(allQueries) as DashboardQueryId[]).filter((id) => id !== 'marketSegments')
    const selectedMainIds = mainIds.filter((id) => needed.has(id))
    const mainThunks = selectedMainIds.map((id) => allQueries[id]!)

    const [mainBatchResults, marketSegmentRawRows] = await Promise.all([
      mainThunks.length
        ? runWithConcurrencyLimit(
            mainThunks as unknown as Parameters<typeof runWithConcurrencyLimit>[0],
            12
          )
        : Promise.resolve([] as unknown[]),
      // Market Segment Performance (2026-07-15) — one query per MARKET_SEGMENT_VALUES entry (9
      // total, including Unallocated), moved here so it runs CONCURRENTLY with the main batch
      // above rather than as a separate sequential phase after it (its own previous
      // implementation) — pure add-on latency removed. Market Segment has no DB column — it's a
      // JS-side lookup by agent name (see agentSegments.ts) — so there's no SQL GROUP BY
      // market_segment available; buildAgentFilterSql scopes each query to exactly the agents
      // classified under that one value instead. Period/year-filtered (i.date_in basis,
      // status='30'), same convention as Agent Room Revenue — NOT full-year-2026-fixed like
      // Property Performance, since there's no Budget dependency forcing that basis here (Budget
      // has no segment dimension at all — see MarketSegmentPerformanceItem's own comment,
      // confirmed with the user rather than approximated with a pro-rata proxy). The Topbar's own
      // `channel` filter is respected as an orthogonal, legitimate cross-cut (AND_SEG below is
      // ADDED to it, not a replacement) — but the Topbar's own `market` filter is intentionally
      // NOT applied, since this table's entire purpose is to break results out BY segment; each
      // row overrides it with its own value.
      needed.has('marketSegments')
        ? runWithConcurrencyLimit(
        MARKET_SEGMENT_VALUES.map((segment) => () => {
          const segFilter = buildAgentFilterSql('a', channel, segment)
          const AND_SEG = segFilter ? ` AND ${segFilter}` : ''
          return queryOne<{ rv_cy: number; rv_ly: number; nt_cy: number; nt_ly: number; active_agents: number }>(
            `SELECT rv.rv_cy, rv.rv_ly, nt.nt_cy, nt.nt_ly, ag.active_agents
            FROM (
              SELECT
                SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS rv_cy,
                SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, monthLo, monthHi)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS rv_ly
              FROM reservations r
              JOIN itineraries i ON r.reservation_number = i.reservation_number
              JOIN agents a ON r.agent_id = a.agent_id
              JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
              LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
              WHERE r.status = '30' AND r.agent_id IS NOT NULL AND (${dateInTwoYearMonthRange('i.date_in', cy, ly, monthLo, monthHi)})
                AND r.agent_id NOT IN (?)
                AND a.agent_name NOT IN (?)
                AND r.rate_type NOT IN (?)
                AND r.reservation_number NOT LIKE ?${AND_SEG}${AND_P}
            ) rv
            CROSS JOIN (
              SELECT
                SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', cy, monthLo, monthHi)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nt_cy,
                SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, monthLo, monthHi)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nt_ly
              FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
              JOIN agents a ON r.agent_id = a.agent_id
              WHERE r.status = '30' AND r.agent_id IS NOT NULL AND (${dateInTwoYearMonthRange('i.date_in', cy, ly, monthLo, monthHi)})
                AND r.agent_id NOT IN (?)
                AND a.agent_name NOT IN (?)
                AND r.rate_type NOT IN (?)
                AND r.reservation_number NOT LIKE ?${AND_SEG}${AND_P}
            ) nt
            CROSS JOIN (
              SELECT COUNT(DISTINCT r.agent_id) AS active_agents
              FROM reservations r
              JOIN itineraries i ON r.reservation_number = i.reservation_number
              JOIN agents a ON r.agent_id = a.agent_id
              WHERE r.status IN ('20','30') AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)}
                AND r.agent_id NOT IN (?)
                AND a.agent_name NOT IN (?)
                AND r.rate_type NOT IN (?)
                AND r.reservation_number NOT LIKE ?
                AND r.total_amount > 0${AND_SEG}${AND_P}
            ) ag`,
            [
          KES_RATE,
          KES_RATE,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          NON_REV_IDS,
          RES_PREFIX,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          NON_REV_IDS,
          RES_PREFIX
        ]
          )
        }),
            5
          )
        : Promise.resolve([] as Array<{ rv_cy: number; rv_ly: number; nt_cy: number; nt_ly: number; active_agents: number } | null>),
    ])

    const mainResultById = new Map<string, unknown>()
    selectedMainIds.forEach((id, idx) => {
      mainResultById.set(id, (mainBatchResults as unknown[])[idx])
    })
    const qArr = <T,>(id: DashboardQueryId): T[] => (mainResultById.get(id) as T[] | undefined) ?? []
    const qOne = <T,>(id: DashboardQueryId): T | null => (mainResultById.get(id) as T | null | undefined) ?? null


    const pdRows = qArr<{ m: number; mn: string; actual: number; ly_val: number }>('pdRows')
    const pfRows = qArr<{ mo: string; yr: number; mon: number; cf: number; pv: number; cf_val: number; pv_val: number }>('pfRows')
    const ocPropRows = qArr<{ nm: string; property_id: string; bkgs: number; adr: number }>('ocPropRows')
    const arrRows = qArr<{ m: number; mn: string; act: number; ly_val: number; extras: number; extras_ly: number }>('arrRows')
    const dayUseArrRows = qArr<{ m: number; extras: number; extras_ly: number }>('dayUseArrRows')
    const agRows = qArr<{ ag_id: string; nm: string; rv_raw: number; extras_raw: number; nt: number; adr: number; r_adr: number; agent_physical_country: string | null; agent_postal_country: string | null }>('agRows')
    const dayUseAgentRows = qArr<{ agent_id: string; extras: number }>('dayUseAgentRows')
    const agLyRows = qArr<{ nm: string; rv_raw: number }>('agLyRows')
    const agentTotalsRow = qOne<{ total_revenue: number; total_nights: number; agent_count: number }>('agentTotalsRow')
    const agentTotalsLyRow = qOne<{ total_revenue: number; total_nights: number; agent_count: number }>('agentTotalsLyRow')
    const agentTotalsLyYtdRow = qOne<{ total_revenue: number; total_nights: number; agent_count: number }>('agentTotalsLyYtdRow')
    const agPropRows = qArr<{ pr: string; property_id: string; rv: number; ly_val: number; extras: number; extras_ly: number }>('agPropRows')
    const dayUsePropRows = qArr<{ property_id: string; extras: number; extras_ly: number }>('dayUsePropRows')
    const agMonthRows = qArr<{ m: number; mn: string; act: number; ly_val: number; extras: number; extras_ly: number }>('agMonthRows')
    const dayUseAgentMonthRows = qArr<{ m: number; extras: number; extras_ly: number }>('dayUseAgentMonthRows')
    const occMonthRows = qArr<{ m: number; mn: string; act: number; ly_val: number }>('occMonthRows')
    const adrRows = qArr<{ m: number; mn: string; nr: number; res: number }>('adrRows')
    const chRows = qArr<{ ch: string; cnt: number }>('chRows')
    const plfRow = qOne<Record<string, unknown>>('plfRow')
    const ytdRow = qOne<{ ytd_ct: number; ytd_val: number }>('ytdRow')
    const pltRows = qArr<{ ag: string; agent_id: string; pr: string; property_id: string; ci: Date; nt: number; vl: number; st: string }>('pltRows')
    const cdRows = qArr<{ code: string; display_name: string | null; bk: number; rv: number; extras: number; cv: number }>('cdRows')
    const kpiConfirmed = qOne<{ confirmed_bkgs: number }>('kpiConfirmed')
    const kpiRevNights = qOne<{ rev_raw: number; total_nights: number; adr: number; extras_raw: number; extras_table_revenue: number; day_use_nights: number }>('kpiRevNights')
    const kpiTotalRevFullYear = qOne<{ rev_raw: number; extras_raw: number; extras_table_revenue: number; total_nights: number; day_use_nights: number }>('kpiTotalRevFullYear')
    const kpiBudgetActual = qOne<{ mtd_rev: number; ytd_rev: number }>('kpiBudgetActual')
    const budgetActualByPropRows = qArr<{ property_id: string; rev: number }>('budgetActualByPropRows')
    const kpiAgents = qOne<{ active_agents: number }>('kpiAgents')
    const kpiPipeline = qOne<{ pipeline_raw: number; pipeline_opps: number }>('kpiPipeline')
    const kpiLead = qOne<{ avg_lead: number }>('kpiLead')
    const kpiAgentRev = qOne<{ arev_raw: number; extras_raw: number; extras_table_revenue: number; port_adr: number; avg_stay: number }>('kpiAgentRev')
    const kpiConsult = qOne<{ n_consult: number; total_bkgs: number }>('kpiConsult')
    const kpiLyBkgs = qOne<{ cnt: number }>('kpiLyBkgs')
    const kpiAgentsLy = qOne<{ active_agents: number }>('kpiAgentsLy')
    const kpiAgentRevLy = qOne<{ arev_raw: number; extras_raw: number; extras_table_revenue: number; port_adr: number; avg_stay: number }>('kpiAgentRevLy')
    const kpiRevNightsLy = qOne<{ rev_raw: number; total_nights: number; adr: number; extras_raw: number; extras_table_revenue: number; day_use_nights: number }>('kpiRevNightsLy')
    const kpiRevNightsLyYtd = qOne<{ rev_raw: number; total_nights: number; day_use_nights: number }>('kpiRevNightsLyYtd')
    const kpiLeadLy = qOne<{ avg_lead: number }>('kpiLeadLy')
    const kpiConsultLy = qOne<{ n_consult: number; total_bkgs: number }>('kpiConsultLy')
    const cdLyRows = qArr<{ nm: string; rv: number }>('cdLyRows')
    const kpiConfirmedBounded = qOne<{ confirmed_bkgs: number }>('kpiConfirmedBounded')
    const kpiConfirmedStly = qOne<{ confirmed_bkgs: number }>('kpiConfirmedStly')
    const kpiPipelineStly = qOne<{ pipeline_raw: number; pipeline_opps: number }>('kpiPipelineStly')
    const kpiCancel = qOne<{ cancelled_ct: number; total_ct: number }>('kpiCancel')
    const kpiCancelLy = qOne<{ cancelled_ct: number; total_ct: number }>('kpiCancelLy')
    const kpiForecastTargetRows = qArr<{ yr: number; mo: number; confirmed_nights_raw: number; day_use_nights: number; provisional_nights_raw: number }>('kpiForecastTargetRows')
    const kpiForecastStlyRows = qArr<{ yr: number; mo: number; final_nights_raw: number; final_day_use_nights: number; onbooks_nights_raw: number; onbooks_day_use_nights: number }>('kpiForecastStlyRows')
    const kpiForecastPace = qOne<{ this_year_forward_nights: number; last_year_forward_nights_same_leadtime: number }>('kpiForecastPace')
    const kpiForecastCancelLyFullYear = qOne<{ cancelled_ct: number; total_ct: number }>('kpiForecastCancelLyFullYear')
    const revparNightsRows = qArr<{ property_id: string; sold_nights: number; sold_nights_incl_day_use: number }>('revparNightsRows')
    const agentPaceRows = qArr<{ agent_id: string; agent_name: string; ty_nights: number; ly_nights_same_leadtime: number }>('agentPaceRows')
    const cancelDriverNightsRows = qArr<{ agent_id: string; agent_name: string; cancelled_bookings: number; nights_lost: number }>('cancelDriverNightsRows')
    const cancelDriverRevRows = qArr<{ agent_id: string; room_rev_lost: number }>('cancelDriverRevRows')
    const lowSeasonByAgentRows = qArr<{ agent_id: string; agent_name: string; low_nights: number; low_revenue: number; total_nights: number; total_revenue: number }>('lowSeasonByAgentRows')
    const agentPropCountRows = qArr<{ agent_id: string; prop_count: number }>('agentPropCountRows')
    const agentConversionRows = qArr<{ agent_id: string; confirmed_ct: number; total_ct: number }>('agentConversionRows')
    const extrasByPropRows = qArr<{ property_id: string; extras: number }>('extrasByPropRows')
    const dayUseExtrasByPropRows = qArr<{ property_id: string; extras: number }>('dayUseExtrasByPropRows')
    const bookingConfirmedProvisionalByMonth = qArr<{ m: number; confirmed_val: number; provisional_val: number; confirmed_ct: number; provisional_ct: number }>('bookingConfirmedProvisionalByMonth')
    const bookingCancelledByMonth = qArr<{ m: number; cancelled_val: number; cancelled_ct: number }>('bookingCancelledByMonth')
    const bookingNewConfirmedByMonth = qArr<{ m: number; new_confirmed_val: number; new_confirmed_ct: number }>('bookingNewConfirmedByMonth')
    const bookingConversionRow = qOne<{ confirmed_ct: number; total_ct: number; confirmed_val: number }>('bookingConversionRow')

    const marketSegmentRaw = needed.has('marketSegments')
      ? MARKET_SEGMENT_VALUES.map((segment, idx) => ({ segment, row: (marketSegmentRawRows as Array<{ rv_cy: number; rv_ly: number; nt_cy: number; nt_ly: number; active_agents: number } | null>)[idx] }))
      : []

    // ── Assemble PD ───────────────────────────────────────────────────────────
    const PD = {
      months: pdRows.map((r) => r.mn),
      actual: pdRows.map((r) => Math.round(n(r.actual) * 10) / 10),
      ly: pdRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
    }

    // ── Assemble PF ───────────────────────────────────────────────────────────
    // Bgt % FIX (2026-07-17) — the previous `bg: Math.min(cf + pv, 99)` never touched budget data
    // at all: cf/pv are COUNT(status='30')/COUNT(status='20') as a % of the SAME booking
    // population (status IN ('20','30'), no third option), so cf+pv is mathematically ~100 for
    // any month with bookings — the "budget" line was really just a constant 99, identical every
    // month (confirmed live: 99/99/99/99 across Jul-Oct 2026, cf/pv genuinely varying underneath
    // it the whole time). Real fix: Confirmed+Provisional REVENUE (cf_val+pv_val — the same $
    // figures already shown as labels on these bars, cv/pval below) against that exact month's
    // Budget Room Revenue from budget2026Monthly.json (getPortfolioBudget/getPropertyBudget, the
    // same source every other Budget comparison in this file uses). Revenue, not Room Nights,
    // since cf_val/pv_val are already revenue — comparing nights would need a second, differently-
    // shaped query and leave the bar's own $ labels on a different basis than its budget line.
    // `bg` is now the TRUE percentage (can exceed 100, or be null if that property/month has no
    // budget row — e.g. Afrochic) for the displayed text; `bgLinePos` is a SEPARATE 0-100 clamp
    // used only to place the vertical marker inside the bar without pushing it off-screen when
    // over budget — PaceView.tsx renders the two independently.
    const PF = pfRows.map((r) => {
      const cf = Math.round(n(r.cf))
      const pv = Math.round(n(r.pv))
      const cfVal = n(r.cf_val)
      const pvVal = n(r.pv_val)
      const monthBudget = property !== 'all'
        ? getPropertyBudget(property, r.yr, r.mon, r.mon)
        : getPortfolioBudget(r.yr, r.mon, r.mon)
      const bg = monthBudget.rev > 0 ? Math.round(((cfVal + pvVal) / monthBudget.rev) * 1000) / 10 : null
      return {
        mo: r.mo,
        cf,
        pv,
        wt: Math.max(0, 100 - cf - pv),
        cv: fmtM(cfVal),
        pval: '+' + fmtM(pvVal),
        bg,
        bgLinePos: bg === null ? null : Math.max(0, Math.min(bg, 100)),
      }
    })

    // ── Assemble OD ───────────────────────────────────────────────────────────
    const maxBkgs = Math.max(...ocPropRows.map((r) => i(r.bkgs)), 1)
    const OD = {
      props: ocPropRows.map((r) => ({
        nm: r.nm ?? 'Unknown',
        id: r.property_id ?? null,
        oc: Math.round((i(r.bkgs) / maxBkgs) * 95),
        ar: i(r.adr),
      })),
      arr: (() => {
        const dayUseMap = new Map(dayUseArrRows.map((r) => [r.m, r]))
        return {
          months: arrRows.map((r) => r.mn),
          act: arrRows.map((r) => Math.round(n(r.act) * 10) / 10),
          ly: arrRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
          extras: arrRows.map((r) => Math.round((n(r.extras) + n(dayUseMap.get(r.m)?.extras)) * 10) / 10),
          extrasLy: arrRows.map((r) => Math.round((n(r.extras_ly) + n(dayUseMap.get(r.m)?.extras_ly)) * 10) / 10),
        }
      })(),
    }

    // ── Assemble AD ───────────────────────────────────────────────────────────
    const agLyMap = new Map(agLyRows.map((r) => [r.nm, n(r.rv_raw)]))
    const colors = ['#B7632A', '#4A5A3A', '#9A7A3A', '#C9BEA9', '#6B5F50']
    const chTotal = chRows.reduce((s, r) => s + i(r.cnt), 0) || 1
    const maxOcc = Math.max(...occMonthRows.map((r) => n(r.act)), 1)

    const dayUseAgentMap = new Map(dayUseAgentRows.map((r) => [r.agent_id, n(r.extras)]))
    // Part 2 small items (2026-07-14f): Country/Properties Produced/Materialisation, all merged
    // by agent_id — same Map-lookup pattern as dayUseAgentMap above. See agentPropCountRows/
    // agentConversionRows query comments for basis details.
    const propCountMap = new Map(agentPropCountRows.map((r) => [r.agent_id, i(r.prop_count)]))
    const conversionMap = new Map(agentConversionRows.map((r) => [r.agent_id, safePct(i(r.confirmed_ct), i(r.total_ct))]))
    // Agent Leaderboard payload trim (2026-07-16b) — agRows is already `ORDER BY rv_raw DESC`
    // (see its query above), so the first LEADERBOARD_YEARLY_CAP rows are already the top-N by
    // revenue; no extra query or re-sort needed. Full-field `yearly` only covers those rows now;
    // `yearlyDirectory` below still covers every agent (all ~833), just with the 4 fields
    // SesAgentSearch.tsx's "Find Agent" needs, so search-any-agent keeps working at a fraction of
    // the payload size. Matches SalesExecutiveSummaryDesign.tsx's own LEADERBOARD_CAP (150).
    const LEADERBOARD_YEARLY_CAP = 150
    const AD = {
      // FIX (2026-07-13, Channel/Market Segment): ch was hardcoded 'B2B' for every row — now a
      // real lookup against the segment mapping CSV (src/lib/agentSegments.ts), by agent name.
      // 'Unallocated' surfaces as-is (not hidden, not guessed) when the CSV has no row or a blank
      // cell for this agent.
      yearly: agRows.slice(0, LEADERBOARD_YEARLY_CAP).map((r) => {
        const rv = n(r.rv_raw)
        const lyRv = agLyMap.get(r.nm) ?? 0
        const adr = i(r.adr)
        const segment = lookupAgentSegment(r.nm)
        return {
          id: r.ag_id,
          nm: r.nm,
          rv: Math.round(rv / 1000),
          extras: Math.round((n(r.extras_raw) + (dayUseAgentMap.get(r.ag_id) ?? 0)) / 1000),
          nt: i(r.nt),
          nr_adr: adr,
          r_adr: i(r.r_adr),
          ch: segment.channel,
          mkt: segment.marketSegment,
          up: rv > lyRv,
          cg: signedPct(rv, lyRv),
          // Country (2026-07-14f): same physical-preferred, postal-fallback logic as Agent
          // Profile's header — see src/app/api/agent/[agentId]/route.ts for the precedent.
          country: r.agent_physical_country || r.agent_postal_country || null,
          propertiesProduced: propCountMap.get(r.ag_id) ?? 0,
          conversionRate: conversionMap.get(r.ag_id) ?? 0,
        }
      }),
      // Full agent directory (2026-07-16b) — ALL of agRows (not capped), minimal fields only.
      // Powers SesAgentSearch.tsx's "Find Agent" so it can still search every agent even though
      // `yearly` above is now capped. `mkt` kept for the same segment-badge convention as
      // AgentYearly even though SesAgentSearch doesn't currently filter on it.
      yearlyDirectory: agRows.map((r) => {
        const segment = lookupAgentSegment(r.nm)
        return {
          id: r.ag_id,
          nm: r.nm,
          country: r.agent_physical_country || r.agent_postal_country || null,
          mkt: segment.marketSegment,
        }
      }),
      // Leaderboard footer totals (2026-07-16g) — genuine full-population aggregates from
      // agentTotalsRow/agentTotalsLyRow (see those queries' own comments), NOT derived from
      // `yearly` (which is capped to the top 150) or from the Trade Partners KPI cards (different
      // date basis — see dashboardViews.ts's comment on why those weren't reused). Correctly
      // re-narrows to whatever segment/property/period is currently applied, since
      // agentTotalsRow/agentTotalsLyRow carry the exact same AND_A/AND_P/dateInYearMonthRange
      // scoping as every other filtered query in this file — a segment filter (e.g. "DMC only")
      // changes AND_A, which both queries already include.
      totals: (() => {
        const totalRevenueRaw = n(agentTotalsRow?.total_revenue)
        const totalNights = i(agentTotalsRow?.total_nights)
        const agentCount = i(agentTotalsRow?.agent_count)
        // Same-elapsed-basis LY fix (2026-07-22) — agentTotalsLyRow's own monthLo/monthHi follow
        // the selected period, so for period='a' it hands back all 12 months of fully-elapsed
        // 2025 while agentTotalsRow's r.date_created naturally truncates at "today" for 2026,
        // producing an inflated "-55.0% YoY" artifact (same bug already fixed for the KPI cards'
        // tooltips via kpiRevNightsLyYtd). agentTotalsLyYtdRow is always Jan1-realCurrentMonth, so
        // it's the correct comparator specifically when period==='a'; 'm'/'y' keep using
        // agentTotalsLyRow, which is already elapsed-matched for those periods.
        const totalRevenueLyRaw = n((period === 'a' ? agentTotalsLyYtdRow : agentTotalsLyRow)?.total_revenue)
        return {
          revenue: totalRevenueRaw / 1e6, // $M, matches KP_BASE.agents.arev's convention
          nights: totalNights,
          adr: Math.round(totalRevenueRaw / Math.max(totalNights, 1)),
          agentCount,
          yoyPct: totalRevenueLyRaw > 0 ? ((totalRevenueRaw - totalRevenueLyRaw) / totalRevenueLyRaw) * 100 : null,
        }
      })(),
      byProp: (() => {
        const dayUseMap = new Map(dayUsePropRows.map((r) => [r.property_id, r]))
        return agPropRows.map((r) => {
          const dayUse = dayUseMap.get(r.property_id)
          return {
            pr: r.pr ?? 'Unknown',
            id: r.property_id ?? null,
            rv: Math.round(n(r.rv)),
            ly: Math.round(n(r.ly_val)),
            extras: Math.round(n(r.extras) + n(dayUse?.extras)),
            extrasLy: Math.round(n(r.extras_ly) + n(dayUse?.extras_ly)),
          }
        })
      })(),
      byMonth: (() => {
        const dayUseMap = new Map(dayUseAgentMonthRows.map((r) => [r.m, r]))
        return {
          months: agMonthRows.map((r) => r.mn),
          act: agMonthRows.map((r) => Math.round(n(r.act) * 10) / 10),
          ly: agMonthRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
          extras: agMonthRows.map((r) => Math.round((n(r.extras) + n(dayUseMap.get(r.m)?.extras)) * 10) / 10),
          extrasLy: agMonthRows.map((r) => Math.round((n(r.extras_ly) + n(dayUseMap.get(r.m)?.extras_ly)) * 10) / 10),
        }
      })(),
      occByMonth: {
        months: occMonthRows.map((r) => r.mn),
        act: occMonthRows.map((r) => Math.round((n(r.act) / maxOcc) * 80)),
        ly: occMonthRows.map((r) => Math.round((n(r.ly_val) / maxOcc) * 80)),
      },
      adr: {
        months: adrRows.map((r) => r.mn),
        nr: adrRows.map((r) => i(r.nr)),
        res: adrRows.map((r) => i(r.res)),
      },
      ch: chRows.map((r, idx) => ({
        lb: String(r.ch),
        v: Math.round((i(r.cnt) / chTotal) * 100),
        co: colors[idx % colors.length],
      })),
    }

    // ── Assemble PLF ──────────────────────────────────────────────────────────
    const totalCt = i(plfRow?.total_ct)
    const cfCt = i(plfRow?.cf_ct)
    const pvCt = i(plfRow?.pv_ct)
    const hoCt = i(plfRow?.ho_ct)
    const ytdCt = i(ytdRow?.ytd_ct)

    const PLF = [
      { st: 'Total Fwd Bkgs', ct: totalCt, vl: fmtM(n(plfRow?.total_val)), pc: 100 },
      { st: 'Confirmed', ct: cfCt, vl: fmtM(n(plfRow?.cf_val)), pc: safePct(cfCt, totalCt) },
      { st: 'Provisional', ct: pvCt, vl: fmtM(n(plfRow?.pv_val)), pc: safePct(pvCt, totalCt) },
      // Options Held is a SUBSET of Provisional (status='20' bookings whose hold
      // hasn't expired yet), not a distinct funnel stage — pc is % of Provisional,
      // not % of Total Fwd Bkgs, so it doesn't double-count against the other stages.
      { st: 'Options Held', ct: hoCt, vl: fmtM(n(plfRow?.ho_val)), pc: safePct(hoCt, pvCt) },
    ]

    // YTD Arrivals is intentionally NOT a PLF funnel stage — it's a past-dated
    // population (date_in < CURDATE()) vs. PLF's forward-looking stages
    // (date_in > CURDATE()), so a "% of Total Fwd Bkgs" would compare two
    // disjoint populations. Shown as a standalone stat instead.
    const YTD_ARR = { ct: ytdCt, vl: fmtM(n(ytdRow?.ytd_val)) }

    // ── Assemble PLT ──────────────────────────────────────────────────────────
    const PLT = pltRows.map((r) => {
      const d = r.ci instanceof Date ? r.ci : new Date(r.ci)
      const ci = `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`
      return {
        ag: r.ag ?? 'Unknown',
        agentId: r.agent_id,
        pr: r.pr ?? 'Unknown',
        propertyId: r.property_id ?? null,
        ci,
        nt: i(r.nt),
        vl: `$${n(r.vl).toLocaleString('en', { maximumFractionDigits: 0 })}`,
        st: r.st,
      }
    })

    // ── Assemble CD ───────────────────────────────────────────────────────────
    const cdLyMap = new Map(cdLyRows.map((r) => [r.nm, n(r.rv)]))
    const CD = cdRows.map((r) => {
      const rv = n(r.rv)
      const lyRv = cdLyMap.get(r.code) ?? 0
      return {
        nm: r.display_name || r.code,
        bk: i(r.bk),
        rv: Math.round(rv),
        extras: Math.round(n(r.extras)),
        cv: n(r.cv).toFixed(1) + '%',
        cg: signedPct(rv, lyRv),
        up: rv > lyRv,
      }
    })

    // ── Assemble KP_BASE ──────────────────────────────────────────────────────
    const confirmedBkgs = i(kpiConfirmed?.confirmed_bkgs)
    const revRaw = n(kpiRevNights?.rev_raw)
    const revM = revRaw / 1e6
    // FIX (2026-07-13, Day Use nights gap): Day Use legs carry 0 nights under DATEDIFF
    // (date_in=date_out) despite a room genuinely being sold — Qlik's convention counts Day
    // Rooms in Roomnights. day_use_nights (1 per leg) merged in here, same pattern as
    // extras_raw merging rev.extras_raw + dayuse.extras_table_revenue above. Does NOT affect
    // `adr`, which is computed inside SQL against the pre-fix nights.total_nights only.
    const totalNights = i(kpiRevNights?.total_nights) + i(kpiRevNights?.day_use_nights)
    const adr = i(kpiRevNights?.adr)
    // Room Revenue / Extras split (2026-07-08): extrasM is Total Room Revenue's sibling
    // figure — rate_components rows not classified as Room Revenue (per constants.ts),
    // plus Day Use revenue (ACL/Kilindi), which has no rate_components at all.
    // FIX (2026-07-13, extras-table revenue): extras_table_revenue now also includes
    // confirmed-clean extras categories for every non-Day-Use booking — see constants.ts
    // EXTRAS_TABLE_REVENUE_CATEGORY_IDS.
    const extrasRaw = n(kpiRevNights?.extras_raw) + n(kpiRevNights?.extras_table_revenue)
    const extrasM = extrasRaw / 1e6
    const activeAgents = i(kpiAgents?.active_agents)
    const pipelineRaw = n(kpiPipeline?.pipeline_raw)
    const pipelineM = pipelineRaw / 1e6
    const pipelineOpps = i(kpiPipeline?.pipeline_opps)
    const avgLead = i(kpiLead?.avg_lead) || 120
    const arevRaw = n(kpiAgentRev?.arev_raw)
    const arevM = arevRaw / 1e6
    // Room Revenue / Extras split (2026-07-08b): agentExtrasM is Agent Room Revenue's sibling
    // figure — rate_components rows not classified as Room Revenue (agent-linked), plus Day Use
    // revenue for this agent's bookings at ACL/Kilindi.
    const agentExtrasRaw = n(kpiAgentRev?.extras_raw) + n(kpiAgentRev?.extras_table_revenue)
    const agentExtrasM = agentExtrasRaw / 1e6
    const portAdr = i(kpiAgentRev?.port_adr)
    const avgStay = n(kpiAgentRev?.avg_stay)
    // Real prior-year basis for the Trade Partners KPI cards' YoY % — same-period
    // comparison (monthLo/monthHi held constant, year shifted cy -> ly), reusing the
    // exact query shape already proven for kpiAgents/kpiAgentRev above.
    const activeAgentsLy = i(kpiAgentsLy?.active_agents)
    const arevMLy = n(kpiAgentRevLy?.arev_raw) / 1e6
    const agentExtrasRawLy = n(kpiAgentRevLy?.extras_raw) + n(kpiAgentRevLy?.extras_table_revenue)
    const agentExtrasMLy = agentExtrasRawLy / 1e6
    const portAdrLy = i(kpiAgentRevLy?.port_adr)
    const avgStayLy = n(kpiAgentRevLy?.avg_stay)
    const nConsult = i(kpiConsult?.n_consult)
    const totalBkgsC = i(kpiConsult?.total_bkgs)
    const avgRevK = nConsult > 0 ? Math.round((arevM * 1000) / nConsult) : 0
    // Real prior-year basis for pace.rev/occ.rev/occ.nights/occ.adr, pace.lead, and
    // consult.n/bkgs/avg — same reusable cy -> ly pattern as the Trade Partners fix above.
    const revRawLy = n(kpiRevNightsLy?.rev_raw)
    const revMLy = revRawLy / 1e6
    const totalNightsLy = i(kpiRevNightsLy?.total_nights) + i(kpiRevNightsLy?.day_use_nights)
    const adrLy = i(kpiRevNightsLy?.adr)
    const extrasRawLy = n(kpiRevNightsLy?.extras_raw) + n(kpiRevNightsLy?.extras_table_revenue)
    const extrasMLy = extrasRawLy / 1e6
    // Same-elapsed-basis LY actual (2026-07-22 fix) — see kpiRevNightsLyYtd's own comment. Used
    // ONLY by revTooltipDetail/nightsTooltipDetail's "vs Last Year" comparison row below — never
    // as a replacement for revMLy/totalNightsLy above, which stay period-driven for every other
    // consumer (KpiCard's single-comparison fallback, the Full Year card's dual-comparison row).
    const revActualizedLyM = n(kpiRevNightsLyYtd?.rev_raw) / 1e6
    const nightsActualizedLy = i(kpiRevNightsLyYtd?.total_nights) + i(kpiRevNightsLyYtd?.day_use_nights)
    const avgLeadLy = i(kpiLeadLy?.avg_lead)
    const nConsultLy = i(kpiConsultLy?.n_consult)
    const totalBkgsCLy = i(kpiConsultLy?.total_bkgs)
    const avgRevKLy = nConsultLy > 0 ? Math.round((arevMLy * 1000) / nConsultLy) : undefined
    const lyBkgs = i(kpiLyBkgs?.cnt) || 1
    const paceIdx = Math.round((confirmedBkgs / lyBkgs) * 100 * 10) / 10
    const totalOpps = confirmedBkgs + pipelineOpps
    const convRate = Math.round(safePct(confirmedBkgs, totalOpps) * 10) / 10
    const avgDeal = pipelineOpps > 0 ? Math.round((pipelineM * 1000) / pipelineOpps * 10) / 10 : 0
    // Dedicated full-year denominator (kpiTotalRevFullYear), NOT revM (which is actualized-only
    // for Occupancy) — same-basis comparison against arevM per the Trade Partners fix this session.
    const totalRevFullYearM = n(kpiTotalRevFullYear?.rev_raw) / 1e6
    // OTB (booking-inclusive) Extras — Room Revenue tooltip (2026-07-16g) — same rev/extras
    // split as extrasM (kpiRevNights), but on kpiTotalRevFullYear's booking-inclusive basis.
    const otbExtrasM = (n(kpiTotalRevFullYear?.extras_raw) + n(kpiTotalRevFullYear?.extras_table_revenue)) / 1e6
    // OTB (booking-inclusive) nights — Room Nights Sold tooltip (2026-07-16i) — same total_nights +
    // day_use_nights combination as totalNights (kpiRevNights) below, but on kpiTotalRevFullYear's
    // booking-inclusive basis, so the two are directly comparable (actualized vs on-the-books).
    const otbNights = i(kpiTotalRevFullYear?.total_nights) + i(kpiTotalRevFullYear?.day_use_nights)
    const arevPct = totalRevFullYearM > 0 ? Math.round((arevM / totalRevFullYearM) * 100) : 0
    // Property (decision #3, "no exceptions"): kpiTotalRevFullYear (the denominator) is now
    // AND_P-filtered alongside kpiAgentRev (the numerator, already filtered) — see that query's
    // comment. Label made explicit so "% of total" doesn't silently misread as portfolio-wide once
    // both sides share one property's basis.
    const arevPctLabel = selectedPropertyName
      ? `${arevPct}% of ${selectedPropertyName}'s total`
      : `${arevPct}% of total`

    // STLY (same-time-last-year) basis for the forward-looking, CURDATE()-relative cards
    // (Confirmed Bookings, Pipeline's 4 cards) — these have no year to swap for a standard
    // YoY, so the comparison is re-anchored a year back instead. See kpiConfirmedStly/
    // kpiPipelineStly above for why this differs from the plain cy->ly pattern.
    // Confirmed Bookings KPI card uses its OWN bounded 1-year-window pair (not the shared
    // `confirmedBkgs` above, which stays unbounded for Pace Index/Conversion Rate).
    const confirmedBkgsBounded = i(kpiConfirmedBounded?.confirmed_bkgs)
    const confirmedBkgsStly = i(kpiConfirmedStly?.confirmed_bkgs)
    const pipelineRawStly = n(kpiPipelineStly?.pipeline_raw)
    const pipelineMStly = pipelineRawStly / 1e6
    const pipelineOppsStly = i(kpiPipelineStly?.pipeline_opps)
    const totalOppsStly = confirmedBkgsStly + pipelineOppsStly
    const convRateStly = Math.round(safePct(confirmedBkgsStly, totalOppsStly) * 10) / 10
    const avgDealStly = pipelineOppsStly > 0 ? Math.round((pipelineMStly * 1000) / pipelineOppsStly * 10) / 10 : undefined

    // Cancellation Rate — real query (Faith-confirmed methodology), calendar-period-bound
    // like the mechanical batch, so this gets a standard YoY, not STLY.
    const cancelledCt = i(kpiCancel?.cancelled_ct)
    const cancelTotalCt = i(kpiCancel?.total_ct)
    const cancelRate = safePct(cancelledCt, cancelTotalCt)
    const cancelledCtLy = i(kpiCancelLy?.cancelled_ct)
    const cancelTotalCtLy = i(kpiCancelLy?.total_ct)
    const cancelRateLy = safePct(cancelledCtLy, cancelTotalCtLy)

    const kpi = (
      v: number, fmt: string, lbl: string, d: string,
      thG: number, thY: number, inv?: boolean, ly?: number, stly?: boolean, budget?: boolean, tooltip?: string[]
    ) => ({
      v, fmt, lbl, d, thG, thY,
      ...(inv ? { inv: true } : {}),
      ...(ly !== undefined ? { ly } : {}),
      ...(stly ? { stly: true } : {}),
      ...(budget ? { budget: true } : {}),
      ...(tooltip ? { tooltip } : {}),
    })

    // "Pace vs Budget" (2026-07-13) — additive, does not touch any existing revenue query or
    // KPI. Actual figures come from kpiBudgetActual (portfolio-wide, confirmed, non-actualized —
    // see that query's comment for why). Budget figures come from budget_2026_monthly.csv via
    // src/lib/budget.ts, which returns 0 for any year other than 2026 rather than erroring.
    // Reuses the kpi() helper's `ly` slot to carry the Budget comparison value (same mechanism
    // STLY already uses to carry a non-"real LY" comparison value) — `budget: true` tells KpiRow
    // to label it "BUDGET" instead of "STLY"/YoY.
    const mtdActualRevM = n(kpiBudgetActual?.mtd_rev) / 1e6
    const ytdActualRevM = n(kpiBudgetActual?.ytd_rev) / 1e6
    // Property (decision #3, "no exceptions"): once kpiBudgetActual's actual side is
    // property-filtered (AND_P above), the budget side must narrow to the same property too, or
    // the comparison silently becomes "this property's actual vs the whole portfolio's budget."
    const mtdBudget = property !== 'all' ? getPropertyBudget(property, cy, realCurrentMonth, realCurrentMonth) : getPortfolioBudget(cy, realCurrentMonth, realCurrentMonth)
    const ytdBudget = property !== 'all' ? getPropertyBudget(property, cy, 1, realCurrentMonth) : getPortfolioBudget(cy, 1, realCurrentMonth)
    const mtdBudgetRevM = mtdBudget.rev / 1e6
    const ytdBudgetRevM = ytdBudget.rev / 1e6

    // Full Year vs Budget (2026-07-16 fix) — genuine full-year pair, unlike the MTD/YTD pair
    // above (kpiBudgetActual/mtdBudget/ytdBudget), which is deliberately anchored to
    // realCurrentMonth regardless of the period filter (see kpiBudgetActual's comment) — that's
    // correct for "how are we doing right now" but means Full Year narrative text was silently
    // reusing YTD's actual/budget instead of a real full-year figure (caught 2026-07-16: Exec
    // Summary narrative showed identical Room Revenue/Budget/%-of-Budget under Full Year and YTD).
    // Actual = totalRevFullYearM (kpiTotalRevFullYear), NOT revM — revM is actualized-stays-only
    // (i.date_out <= CURDATE(), see kpiRevNights/OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY), which would
    // silently exclude future confirmed bookings and understate a Full Year "on books" total
    // against Budget (same trap this file's own arevPct comment already flags above). Budget =
    // the full annual target (getPortfolioBudget/getPropertyBudget(cy,1,12)), same basis
    // budgetByProp's budgetFullYear already uses for the Budget Variance table.
    const fullYearBudget = property !== 'all' ? getPropertyBudget(property, cy, 1, 12) : getPortfolioBudget(cy, 1, 12)
    const fullYearBudgetRevM = fullYearBudget.rev / 1e6

    // Moved up from the Budget-variance/RevPAR-by-property blocks below (2026-07-15) so
    // KP_BASE.occ.revpar/occPct can reuse them — both Maps are built from query rows already
    // fetched at the top of the handler, so this move has no effect on the blocks below beyond
    // no longer re-declaring them there.
    const actualByPropMap = new Map(budgetActualByPropRows.map((r) => [r.property_id, n(r.rev)]))
    // revparNightsMap stays DATEDIFF-only (excludes Day Use) — the ADR denominator, unchanged; see
    // revparNightsRows' own comment for why Day Use must NOT be folded into ADR's nights.
    const revparNightsMap = new Map(revparNightsRows.map((r) => [r.property_id, n(r.sold_nights)]))
    // revparNightsInclDayUseMap (2026-07-20) — Day-Use-inclusive, same convention as
    // KP_BASE.occ.nights' totalNights. This is the "Sold Nights" figure actually displayed and the
    // Occupancy % numerator everywhere below — Room Nights Sold/Occupancy %/RevPAR should now all
    // agree on one Room Nights definition (RevPAR's own formula, revenue ÷ available, never
    // consumed sold nights at all, so it needs no formula change — only this shared nights data
    // needs to stop disagreeing with the Room Nights Sold KPI card).
    const revparNightsInclDayUseMap = new Map(revparNightsRows.map((r) => [r.property_id, n(r.sold_nights_incl_day_use)]))

    // Portfolio RevPAR / Occupancy % (2026-07-15, Sales Executive Summary KPI row) — aggregated
    // as sum(roomRevenue)/sum(availableNights) and sum(soldNights)/sum(availableNights)*100
    // across the same 15 "clean" properties as REVPAR.byProperty, NOT an average of per-property
    // RevPAR/Occ% (which would incorrectly equal-weight small and large properties). Excludes
    // LEPC (no property record — cap.propertyId null), NXR/WB146935 (pre-opening), LSC/WB37957
    // (refurb, capacity figure is untouched typical-year, not adjusted for closure) — same
    // exclusions as REVPAR_CAVEATS below, confirmed with the user.
    const PORTFOLIO_AGG_EXCLUDE_IDS = new Set(['WB146935', 'WB37957'])
    let portfolioRevenueSum = 0
    let portfolioAvailableSum = 0
    let portfolioSoldSum = 0
    for (const cap of Object.values(PROPERTY_ROOM_COUNTS)) {
      if (!cap.propertyId || PORTFOLIO_AGG_EXCLUDE_IDS.has(cap.propertyId)) continue
      portfolioRevenueSum += actualByPropMap.get(cap.propertyId) ?? 0
      portfolioAvailableSum += cap.roomnightsAvailable
      portfolioSoldSum += revparNightsInclDayUseMap.get(cap.propertyId) ?? 0
    }
    // Property (2026-07-16, "no exceptions" pass): genuinely recompute scoped to the selected
    // property rather than relabeling the portfolio-wide sum — reuses actualByPropMap/
    // revparNightsInclDayUseMap, the exact same per-property maps Property Performance's RevPAR
    // table already draws from, so this can't disagree with that table's own numbers for the
    // property.
    const selectedCap = property !== 'all'
      ? Object.values(PROPERTY_ROOM_COUNTS).find((cap) => cap.propertyId === property)
      : undefined
    const revenueSum = selectedCap ? (actualByPropMap.get(property) ?? 0) : portfolioRevenueSum
    const availableSum = selectedCap ? selectedCap.roomnightsAvailable : portfolioAvailableSum
    const soldSum = selectedCap ? (revparNightsInclDayUseMap.get(property) ?? 0) : portfolioSoldSum
    const portfolioRevpar = availableSum > 0 ? revenueSum / availableSum : 0
    const portfolioOccPct = availableSum > 0 ? (soldSum / availableSum) * 100 : 0
    const revparOccCaption = selectedPropertyName ?? 'portfolio-wide, 15 properties'

    // Occupancy vs Budget (2026-07-16) — budget_2026_monthly.csv has no dedicated occupancy-target
    // field, but one is directly derivable from two fields it DOES have: budgetRns (target room
    // nights sold) ÷ availableSum (the same Dennis-confirmed annual capacity figure occPct's own
    // Actual side already divides by, above) — not a fabricated metric, the same formula that
    // produces portfolioOccPct itself. Full-year 2026 basis throughout, matching occPct/revpar's
    // own scope (neither respects the Topbar's MTD/YTD toggle — see their comment above), so this
    // stays apples-to-apples rather than comparing a full-year Actual against a partial-year Budget.
    const occBudgetRns = property !== 'all' ? getPropertyBudget(property, cy, 1, 12).rns : getPortfolioBudget(cy, 1, 12).rns
    const portfolioOccPctBudget = availableSum > 0 ? (occBudgetRns / availableSum) * 100 : 0

    // KPI hover-tooltip content (2026-07-16g) — labeled Actualized/OTB/Budget values, no
    // explanatory prose (2026-07-16i simplification pass — the labels speak for themselves).
    // RevPAR/Occupancy % keep fullYearFixedTooltip below (period-invariant, needs the explanation);
    // Occupancy %/ADR otherwise carry no tooltip — both are obviously actual-only values.
    const fmtDollarM = (v: number): string => `$${v.toFixed(1)}M`
    const activeBudgetRevM = period === 'm' ? mtdBudgetRevM : period === 'a' ? fullYearBudgetRevM : ytdBudgetRevM
    const otbVsBudgetPct = activeBudgetRevM > 0 ? (totalRevFullYearM / activeBudgetRevM) * 100 : null
    const revTooltip = [
      `Actualized: ${fmtDollarM(revM)}`,
      `OTB: ${fmtDollarM(totalRevFullYearM)} vs Budget ${fmtDollarM(activeBudgetRevM)}${otbVsBudgetPct !== null ? ` (${otbVsBudgetPct.toFixed(1)}%)` : ''}`,
      `Extras — Actualized: ${fmtDollarM(extrasM)} · OTB: ${fmtDollarM(otbExtrasM)}`,
    ]
    const nightsTooltip = [
      `Actualized: ${totalNights.toLocaleString()}`,
      `OTB: ${otbNights.toLocaleString()}`,
    ]
    const fullYearFixedTooltip = [
      'Always full-year 2026, regardless of the MTD/YTD/Full Year toggle — an intentional, retrospective-occupancy convention (not period-filterable).',
    ]

    // Structured "detail card" tooltip content (2026-07-22) — additive sibling to the plain-string
    // tooltips above (those stay as-is for ExecSummaryView's generic KpiRow). Primary figure +
    // comparison for these three are rendered client-side straight from metric.v/metric.ly — only
    // the header + secondary breakdown rows need new structured data here, sourced from the exact
    // same numbers revTooltip/nightsTooltip already use, just not pre-flattened into strings.
    const revTooltipDetail = {
      header: 'ROOM REVENUE DETAIL',
      breakdown: [
        { label: 'On The Books (OTB)', value: fmtDollarM(totalRevFullYearM) },
        { label: 'OTB vs Budget', value: `${fmtDollarM(activeBudgetRevM)}${otbVsBudgetPct !== null ? ` (${otbVsBudgetPct.toFixed(1)}%)` : ''}` },
        { label: 'Extras Revenue', value: `${fmtDollarM(extrasM)} actualized · ${fmtDollarM(otbExtrasM)} OTB` },
      ],
      actualizedLy: revActualizedLyM,
    }
    const otbNightsVsBudgetPct = occBudgetRns > 0 ? (otbNights / occBudgetRns) * 100 : null
    const nightsTooltipDetail = {
      header: 'ROOM NIGHTS SOLD DETAIL',
      breakdown: [
        { label: 'On The Books (OTB)', value: otbNights.toLocaleString() },
        {
          label: 'OTB vs Budget',
          value: occBudgetRns > 0
            ? `${Math.round(occBudgetRns).toLocaleString()}${otbNightsVsBudgetPct !== null ? ` (${otbNightsVsBudgetPct.toFixed(1)}%)` : ''}`
            : '—',
        },
      ],
      actualizedLy: nightsActualizedLy,
    }
    const occPctTooltipDetail = {
      header: 'OCCUPANCY % DETAIL',
      breakdown: [
        { label: 'Scope', value: revparOccCaption },
        { label: 'Basis', value: 'Full-year 2026, all periods — not period-filterable' },
      ],
    }

    const KP_BASE = {
      pace: {
        // STLY basis, BOUNDED 1-year window on both sides (see kpiConfirmedBounded/
        // kpiConfirmedStly above) — no calendar year to swap for a standard YoY, so this
        // is re-anchored a year back instead, using its own bounded query (not the shared
        // `confirmedBkgs`, which stays unbounded for Pace Index/Conversion Rate below).
        // `d` updated from 'vs last year' to 'vs STLY' so the caption names the basis, on
        // top of KpiRow's STLY badge.
        // 2026-07-17 — confirmed via live investigation that Confirmed Bookings (rolling 12mo
        // window) and Pace Index (fixed calendar-period window, below) can diverge sharply
        // (-56.3% vs -12.9% seen live) purely from comparing different date-window SHAPES, not a
        // bug in either. Explicitly NOT unified — see METRICS.md §10 for why forcing one onto the
        // other's convention would either break Confirmed Bookings' forward-pipeline meaning or
        // reintroduce the exact "measurement artifact" (13,910 vs the real 4,451, a fake -68%
        // delta) an earlier fix already rejected. Caption/tooltip added so this reads as
        // deliberate, not an unexplained mismatch against its neighbor on this same tab.
        bookings: kpi(confirmedBkgsBounded, 'int', 'Confirmed Bookings', 'vs STLY (rolling 12mo)', 5000, 4000, undefined, confirmedBkgsStly, true, undefined, [
          'Forward pipeline: confirmed bookings for stays in the next 12 months, vs the same rolling 12-month window one year ago — not a fixed calendar period.',
          'Deliberately different basis from Pace Index alongside it — that compares fixed calendar months instead. The two can diverge sharply without either being wrong; see METRICS.md.',
        ]),
        rev: kpi(revM, '$M', 'Revenue on Books', `YTD ${cy}`, 70, 55, undefined, revMLy),
        idx: kpi(paceIdx, 'f1', 'Pace Index', '100 = last year (same months)', 103, 98, undefined, undefined, undefined, undefined, [
          'Compares this year\'s bookings against the SAME calendar months last year (e.g. Jan–Jul 2026 vs Jan–Jul 2025) — a fixed period, not a rolling window.',
          'Deliberately different basis from Confirmed Bookings alongside it — that compares a rolling 12-month window instead. The two can diverge sharply without either being wrong; see METRICS.md.',
        ]),
        lead: kpi(avgLead, 'days', 'Avg Lead Time', 'avg lead time', 140, 160, true, avgLeadLy),
        // Pace vs Budget (2026-07-13) — see the kpiBudgetActual query and mtdActualRevM/
        // ytdActualRevM/mtdBudgetRevM/ytdBudgetRevM comments above for basis. Thresholds are
        // budget-relative (100 = on budget), not the round-number style used elsewhere, since
        // "good" here specifically means "at or above 100% of budget."
        budgetMtd: kpi(mtdActualRevM, '$M', 'MTD vs Budget', `${cy} month-to-date`, mtdBudgetRevM, mtdBudgetRevM * 0.85, undefined, mtdBudgetRevM, undefined, true),
        budgetYtd: kpi(ytdActualRevM, '$M', 'YTD vs Budget', `${cy} year-to-date`, ytdBudgetRevM, ytdBudgetRevM * 0.85, undefined, ytdBudgetRevM, undefined, true),
        // Full Year vs Budget (2026-07-16 fix) — see fullYearBudget/fullYearBudgetRevM comment
        // above. totalRevFullYearM is booking-inclusive and period-scoped (monthHi=12 when
        // period==='a'), same basis as Budget itself — unlike budgetMtd/budgetYtd's actual side
        // (kpiBudgetActual, hardcoded to realCurrentMonth) or revM (actualized-only).
        budgetFullYear: kpi(totalRevFullYearM, '$M', 'Full Year vs Budget', `${cy} full year`, fullYearBudgetRevM, fullYearBudgetRevM * 0.85, undefined, fullYearBudgetRevM, undefined, true),
        // Full Year Room Nights vs Budget (2026-07-22) — sibling to budgetFullYear above, same
        // reasoning: otbNights (kpiTotalRevFullYear) is OTB/booking-inclusive, occBudgetRns
        // (getPortfolioBudget/getPropertyBudget(cy,1,12).rns, already computed above for
        // portfolioOccPctBudget) is the matching full-year Budget target on the same basis.
        // Added specifically so Sales Executive Summary's Full Year toggle can show Room Nights
        // Sold vs Budget alongside vs Last Year — see occ.nights below, which stays actualized-only
        // and unaffected by this addition (ExecSummaryView's Occupancy tab keeps reading that as-is).
        budgetFullYearNights: kpi(otbNights, 'int', 'Room Nights Sold vs Budget', `${cy} full year`, occBudgetRns, occBudgetRns * 0.85, undefined, occBudgetRns, undefined, true),
      },
      occ: {
        nights: { ...kpi(totalNights, 'int', 'Room Nights Sold', 'ResRequest', 18000, 14000, undefined, totalNightsLy, undefined, undefined, nightsTooltip), tooltipDetail: nightsTooltipDetail },
        adr: kpi(adr, '$', 'Avg Daily Rate', 'from bookings', 3000, 2500, undefined, adrLy),
        rev: { ...kpi(revM, '$M', 'Total Room Revenue', 'room revenue', 70, 55, undefined, revMLy, undefined, undefined, revTooltip), tooltipDetail: revTooltipDetail },
        // New (2026-07-08, Room Revenue / Extras split): Room Revenue + Extras = Total Revenue,
        // per Faith's room_revenue_components.csv and Qlik's Trade Partner Scorecard convention.
        // Thresholds are placeholder round numbers, not yet calibrated against a full year of
        // live Extras figures — flag to revisit once real values are visible on the dashboard.
        extras: kpi(extrasM, '$M', 'Extras Revenue', 'F&B, activities, transfers etc.', 8, 5, undefined, extrasMLy),
        // Cancellation Rate — real query now (Faith-confirmed methodology), standard YoY
        // (calendar-bound, not STLY — see kpiCancel above for why).
        cancel: kpi(cancelRate, 'pct', 'Cancellation Rate', 'lower is better', 7.5, 10, true, cancelRateLy),
        // Portfolio RevPAR / Occupancy % (2026-07-15, Sales Executive Summary KPI row) — see
        // portfolioRevpar/portfolioOccPct comment above for the 15-property aggregation basis.
        // No `ly` — no prior-year property-level capacity query exists yet, so no YoY badge
        // rather than a fabricated one. Thresholds are first-pass placeholders, not yet
        // calibrated against a full year of this exact aggregate.
        revpar: kpi(portfolioRevpar, '$', 'RevPAR', revparOccCaption, 400, 300, undefined, undefined, undefined, undefined, fullYearFixedTooltip),
        // `ly` slot carries the Budget Occupancy % target (see portfolioOccPctBudget above),
        // `budget: true` so KpiRow/budgetVariance label it "BUDGET" instead of YoY — same
        // convention as pace.budgetMtd/budgetYtd. No tooltip (2026-07-16i) — an obviously
        // actual-only value, doesn't need explanation.
        occPct: { ...kpi(portfolioOccPct, 'pct', 'Occupancy %', revparOccCaption, 55, 45, undefined, portfolioOccPctBudget, undefined, true), tooltipDetail: occPctTooltipDetail },
      },
      agents: {
        active: kpi(activeAgents, 'int', 'Active Trade Partners', 'this period', 700, 500, undefined, activeAgentsLy),
        arev: kpi(arevM, '$M', 'Agent Room Revenue', arevPctLabel, 30, 20, undefined, arevMLy),
        // New (2026-07-08b, Room Revenue / Extras split, Tier 2): sibling to Agent Room Revenue,
        // same reasoning as occ.extras in Tier 1. Thresholds are placeholder round numbers.
        extras: kpi(agentExtrasM, '$M', 'Agent Extras Revenue', 'F&B, activities, transfers etc.', 4, 2.5, undefined, agentExtrasMLy),
        nradr: kpi(portAdr, '$', 'Portfolio ADR', 'avg rate per night', 1200, 900, undefined, portAdrLy),
        radr: kpi(avgStay, 'f1', 'Avg Length of Stay', 'nights per booking', 4, 3, undefined, avgStayLy),
      },
      pipeline: {
        // STLY basis throughout (see kpiPipelineStly above) — same re-anchored-a-year-back
        // reasoning as Confirmed Bookings.
        val: kpi(pipelineM, '$M', 'Pipeline Value', 'total pipeline', 30, 20, undefined, pipelineMStly, true),
        opps: kpi(pipelineOpps, 'int', 'Open Opportunities', 'provisional bookings', 5000, 4000, undefined, pipelineOppsStly, true),
        conv: kpi(convRate, 'pct', 'Conversion Rate', 'enquiry to confirm', 65, 55, undefined, convRateStly, true),
        avg: kpi(avgDeal, '$k', 'Avg Deal Value', 'per booking', 6, 5, undefined, avgDealStly, true),
      },
      consult: {
        n: kpi(nConsult, 'int', 'Active Consultants', 'this period', 10, 8, undefined, nConsultLy),
        bkgs: kpi(totalBkgsC, 'int', 'Total Bookings', 'all consultants', 6000, 5000, undefined, totalBkgsCLy),
        avg: kpi(avgRevK, '$k', 'Avg Rev/Consultant', 'this period', 7000, 6000, undefined, avgRevKLy),
        // Best Conv. Rate reuses Pipeline's convRate wholesale (not a per-consultant
        // figure) — held per standing instruction alongside Pipeline's cards.
        top: kpi(convRate, 'pct', 'Best Conv. Rate', 'top consultant', 13, 10),
      },
    }

    // Property-level Budget variance table (2026-07-13) — ADDITIVE, full-year 2026 fixed (see
    // budgetActualByPropRows query comment above for why). Variance % = Actual ÷ Budget × 100,
    // same "% of Budget" convention as the Pace vs Budget KPI cards. Properties with $0 budget
    // (Afrochic — see src/lib/budget.ts's known-gap note) get variancePct: null rather than a
    // divide-by-zero or a fabricated 0%/Infinity — the UI should show these as "no budget set,"
    // not as a variance figure. actualByPropMap now built earlier, above KP_BASE (2026-07-15,
    // reused by the portfolio RevPAR/Occ% aggregate) — reused here as-is.
    const budgetByProp = getAllBudgetProperties().map(({ propertyId, propertyName }) => {
      const actual = actualByPropMap.get(propertyId) ?? 0
      const budgetFullYear = getPropertyBudget(propertyId, 2026, 1, 12)
      const variancePct = budgetFullYear.rev > 0 ? Math.round((actual / budgetFullYear.rev) * 1000) / 10 : null
      return {
        propertyId,
        property: propertyName,
        actual: Math.round(actual),
        budget: Math.round(budgetFullYear.rev),
        variancePct,
      }
    })

    // Forecast Room Nights (2026-07-14) — Dennis's revenue-manager formula, ADDITIVE, no existing
    // query or KPI touched. Forecast = Confirmed Nights (target month) + Provisional Nights
    // (target month) x 30% + Adjusted Pick-Up (STLY final nights for that month x this-year-vs-
    // last-year pace ratio) - Expected Cancellations (Faith's simplified formula: full-year-LY
    // cancel rate x Confirmed Nights for the target month). Target months = the next 3 months
    // AFTER the current in-progress month (see kpiForecastTargetRows above for why).
    const forecastPaceThisYear = n(kpiForecastPace?.this_year_forward_nights)
    const forecastPaceLastYear = n(kpiForecastPace?.last_year_forward_nights_same_leadtime)
    // Guard: default to 1 (no adjustment) if LY has no comparable population yet.
    const forecastPaceRatio = forecastPaceLastYear > 0 ? forecastPaceThisYear / forecastPaceLastYear : 1

    const forecastCancelledLy = i(kpiForecastCancelLyFullYear?.cancelled_ct)
    const forecastCancelTotalLy = i(kpiForecastCancelLyFullYear?.total_ct)
    const forecastCancelRateLy = forecastCancelTotalLy > 0 ? forecastCancelledLy / forecastCancelTotalLy : 0

    const forecastTargetMonths = [1, 2, 3].map((offset) => {
      const d = new Date(realCurrentYear, realCurrentMonth - 1 + offset, 1)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })

    const forecastByMonth = forecastTargetMonths.map(({ year, month }) => {
      const targetRow = kpiForecastTargetRows.find((r) => r.yr === year && r.mo === month)
      const confirmedNights = n(targetRow?.confirmed_nights_raw) + n(targetRow?.day_use_nights)
      const provisionalNights = n(targetRow?.provisional_nights_raw)
      const provisionalComponent = Math.round(provisionalNights * 0.3)

      // Incremental delta (2026-07-14b fix) — see the kpiForecastStlyRows query comment above.
      const stlyRow = kpiForecastStlyRows.find((r) => r.yr === year - 1 && r.mo === month)
      const stlyFinalNights = n(stlyRow?.final_nights_raw) + n(stlyRow?.final_day_use_nights)
      const stlyOnBooksNights = n(stlyRow?.onbooks_nights_raw) + n(stlyRow?.onbooks_day_use_nights)
      const stlyIncrementalPickup = Math.max(stlyFinalNights - stlyOnBooksNights, 0)
      const adjustedPickup = Math.round(stlyIncrementalPickup * forecastPaceRatio)

      const expectedCancellations = Math.round(forecastCancelRateLy * confirmedNights)

      const forecastNights = confirmedNights + provisionalComponent + adjustedPickup - expectedCancellations

      const monthBudget = property !== 'all' ? getPropertyBudget(property, year, month, month) : getPortfolioBudget(year, month, month)
      const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' }) + ' ' + year

      return {
        year, month, monthLabel,
        confirmedNights, provisionalComponent, adjustedPickup, expectedCancellations,
        forecastNights, budgetNights: Math.round(monthBudget.rns),
      }
    })

    // Sales Executive Summary "Pace row" (2026-07-15) — three portfolio-wide pace ratios
    // (100 = on target), ADDITIVE, feeds KP_BASE.execPace only (does not touch KP_BASE.pace,
    // which stays exactly as the full Pace tab already uses it):
    //   - vsBudget: YTD actual revenue ÷ YTD budget revenue × 100 — same inputs as
    //     pace.budgetYtd, just expressed as a single ratio instead of a $ figure + badge.
    //   - vsForecast: forecastNights ÷ budgetNights summed ONLY across forecastByMonth's actual
    //     months (the rolling 3-month-ahead window, whatever those months are today — NEVER
    //     silently rolled up across all 12 when 9 have no real forecast figure). The `d` caption
    //     below names the exact month range so this reads as a scoped 3-month figure, not an
    //     annual one.
    //   - vsStly: the existing paceIdx value (already a "100 = last year" ratio) relabeled for
    //     this row — same number KP_BASE.pace.idx uses, not a new query.
    const execPaceVsBudgetPct = ytdBudgetRevM > 0 ? (ytdActualRevM / ytdBudgetRevM) * 100 : 0
    const forecastNightsSum = forecastByMonth.reduce((s, m) => s + m.forecastNights, 0)
    const forecastBudgetSum = forecastByMonth.reduce((s, m) => s + m.budgetNights, 0)
    const execPaceVsForecastPct = forecastBudgetSum > 0 ? (forecastNightsSum / forecastBudgetSum) * 100 : 0
    const forecastMonthRange = forecastByMonth.length > 0
      ? `${forecastByMonth[0].monthLabel}–${forecastByMonth[forecastByMonth.length - 1].monthLabel} forecast vs budget`
      : 'forecast vs budget'
    const EXEC_PACE = {
      vsBudget: kpi(execPaceVsBudgetPct, 'pct', 'Pace vs Budget %', `${cy} year-to-date`, 100, 85, undefined, undefined, undefined, true),
      vsForecast: kpi(execPaceVsForecastPct, 'pct', 'Pace vs Forecast %', forecastMonthRange, 100, 85, undefined, undefined, undefined, true),
      vsStly: kpi(paceIdx, 'pct', 'Pace vs STLY %', '100 = last year', 103, 98, undefined, undefined, true),
    }

    // RevPAR by property (2026-07-14d) — ADDITIVE, full-year 2026, confirmed only, Room-Revenue-
    // only basis (NOT blended with Extras). Reuses actualByPropMap (already Room-Revenue-only,
    // built above for the Budget variance table) paired with revparNightsRows (nights-only query,
    // see its comment above for the fan-out bug this avoids) and Dennis's PROPERTY_ROOM_COUNTS
    // capacity figures. 3 properties carry known capacity caveats — surfaced explicitly via
    // `caveat` rather than shown as a clean number or silently hidden:
    //   - Little Elephant Pepper Camp: no propertyId at all (mid-construction, no ResRequest
    //     property record exists yet — see the LEPC investigation this session) -> revpar: null.
    //   - Ngorongoro Explorer: pre-opening (not operational until 1 May 2027) -> genuinely $0/0,
    //     not a data gap.
    //   - Lewa Safari Camp: closed for refurbishment part of 2026 (reopens 1 June) but its
    //     Available Room Nights figure is the untouched typical-year number, NOT adjusted for the
    //     closure — RevPAR/Occ% here are computed but directional only, not precise.
    // revparNightsMap now built earlier, above KP_BASE (2026-07-15) — reused here as-is.
    const revparByProperty = Object.entries(PROPERTY_ROOM_COUNTS).map(([propertyName, cap]) => {
      if (!cap.propertyId) {
        return {
          propertyName, propertyId: null,
          roomRevenue: null, soldNights: null, availableNights: cap.roomnightsAvailable,
          revpar: null, adr: null, occPct: null,
          caveat: 'No property record exists yet in ResRequest (mid-construction) — RevPAR cannot be computed.',
        }
      }
      const roomRevenue = actualByPropMap.get(cap.propertyId) ?? 0
      // adrNights (DATEDIFF-only, excludes Day Use) stays ADR's denominator — Day Use legs carry
      // $0 Room Revenue here, so folding them in would dilute ADR with no matching numerator.
      // soldNights (2026-07-20, Day-Use-inclusive) is the displayed "Sold Nights" figure and
      // Occupancy %'s numerator — see revparNightsRows' own comment for the full reasoning.
      const adrNights = revparNightsMap.get(cap.propertyId) ?? 0
      const soldNights = revparNightsInclDayUseMap.get(cap.propertyId) ?? 0
      const availableNights = cap.roomnightsAvailable
      const revpar = availableNights > 0 ? roomRevenue / availableNights : null
      const adr = adrNights > 0 ? roomRevenue / adrNights : null
      const occPct = availableNights > 0 ? (soldNights / availableNights) * 100 : null
      return {
        propertyName, propertyId: cap.propertyId,
        roomRevenue: Math.round(roomRevenue), soldNights, availableNights,
        revpar: revpar !== null ? Math.round(revpar * 100) / 100 : null,
        adr: adr !== null ? Math.round(adr) : null,
        occPct: occPct !== null ? Math.round(occPct * 10) / 10 : null,
        caveat: PROPERTY_REVPAR_CAVEATS[cap.propertyId] ?? null,
      }
    })

    // Budget Occupancy % / Budget vs Actual Room Revenue by property (2026-07-16) — ADDITIVE, for
    // the Revenue & Occupancy chart. Budget Occupancy % mirrors revparByProperty's Actual Occ %
    // formula exactly: Budget Room Nights (getPropertyBudget's budgetRns) ÷ the same Dennis-
    // confirmed Available Room Nights capacity figure Actual Occ % already divides Sold Nights
    // by — reuses revparByProperty's own availableNights/caveat rather than recomputing them, so
    // the two can't disagree on capacity. Property list is the UNION of PROPERTY_ROOM_COUNTS (18
    // — carries LEPC/NXR/Lewa's capacity caveats, same as revparByProperty) and the budget file's
    // own 17 (carries Afrochic, which has no PROPERTY_ROOM_COUNTS entry at all) — appended below
    // as its own row rather than silently dropped, same "never hide, always flag" convention.
    const AFROCHIC_ID = 'WB639'
    const budgetOccByProperty = [
      ...revparByProperty.map((p) => {
        const budgetRns = p.propertyId ? getPropertyBudget(p.propertyId, 2026, 1, 12).rns : 0
        const budgetRevenue = p.propertyId ? Math.round(getPropertyBudget(p.propertyId, 2026, 1, 12).rev) : null
        const budgetOccPct = p.propertyId && p.availableNights > 0
          ? Math.round((budgetRns / p.availableNights) * 1000) / 10
          : null
        return {
          propertyName: p.propertyName,
          propertyId: p.propertyId,
          budgetRevenue,
          actualRevenue: p.roomRevenue,
          budgetOccPct,
          actualOccPct: p.occPct,
          caveat: p.caveat,
        }
      }),
      (() => {
        const afrochicBudget = getPropertyBudget(AFROCHIC_ID, 2026, 1, 12)
        return {
          propertyName: 'Afrochic',
          propertyId: AFROCHIC_ID,
          budgetRevenue: Math.round(afrochicBudget.rev),
          actualRevenue: Math.round(actualByPropMap.get(AFROCHIC_ID) ?? 0),
          budgetOccPct: null,
          actualOccPct: null,
          caveat: 'Afrochic (WB639) has $0 Budget for every month of 2026 in the source budget file (known gap, not a data error) and has no confirmed Available Room Nights entry in PROPERTY_ROOM_COUNTS — Budget Occupancy % cannot be computed.',
        }
      })(),
    ]

    // Property Performance (2026-07-15) — ADDITIVE, one row per property. Merges figures already
    // computed elsewhere in this file (revparByProperty's Room Revenue/RevPAR/Occ%/ADR/Room Nights
    // Sold/caveat, budgetByProp's Budget Variance %, plus the new extrasByPropRows/
    // dayUseExtrasByPropRows for Extras Revenue) — no new revenue basis introduced. Built off
    // revparByProperty's 18-property PROPERTY_ROOM_COUNTS list (not budgetByProp's own 17 — see
    // budget.ts's Afrochic caveat), so caveat properties (LEPC/NXR/LSC) appear as rows with their
    // existing caveat text, same "never hide, always flag" convention as revparByProperty itself —
    // confirmed with the user rather than silently filtering them out.
    const extrasByPropMap = new Map(extrasByPropRows.map((r) => [r.property_id, n(r.extras)]))
    const dayUseExtrasByPropMap = new Map(dayUseExtrasByPropRows.map((r) => [r.property_id, n(r.extras)]))
    const budgetVarianceByPropMap = new Map(budgetByProp.map((r) => [r.propertyId, r.variancePct]))
    const countryForProperty = (propertyId: string | null, propertyName: string): string => {
      const kenyaIds = KENYA_PROPERTY_IDS as readonly string[]
      const tzIds = TANZANIA_MAINLAND_PROPERTY_IDS as readonly string[]
      const sxrStyleIds = SERENGETI_EXPLORER_STYLE_PROPERTY_IDS as readonly string[]
      if (propertyId && kenyaIds.includes(propertyId)) return 'Kenya'
      if (propertyId && (tzIds.includes(propertyId) || sxrStyleIds.includes(propertyId))) return 'Tanzania'
      // LEPC has no propertyId (mid-construction, no ResRequest record) — see its own Kenya-section
      // grouping in PROPERTY_ROOM_COUNTS above, the only place its country is otherwise recorded.
      if (propertyName === 'Little Elephant Pepper Camp') return 'Kenya'
      return 'Unknown'
    }
    const PROPERTY_PERFORMANCE = revparByProperty.map((p) => {
      const cap = PROPERTY_ROOM_COUNTS[p.propertyName]
      const extrasRevenue = p.propertyId
        ? Math.round((extrasByPropMap.get(p.propertyId) ?? 0) + (dayUseExtrasByPropMap.get(p.propertyId) ?? 0))
        : null
      return {
        propertyId: p.propertyId,
        propertyName: p.propertyName,
        country: countryForProperty(p.propertyId, p.propertyName),
        keys: cap.keys,
        roomRevenue: p.roomRevenue,
        extrasRevenue,
        revpar: p.revpar,
        occPct: p.occPct,
        adr: p.adr,
        soldNights: p.soldNights,
        budgetVariancePct: p.propertyId ? budgetVarianceByPropMap.get(p.propertyId) ?? null : null,
        caveat: p.caveat,
      }
    })

    // Market Segment Performance (2026-07-15) — yoyPct is standard calendar YoY (this period vs
    // the same period last year), matching Agent Room Revenue's own YoY, not the bounded-STLY
    // re-anchor treatment used for Pipeline/Confirmed-Bookings. marketSegmentRaw itself (the raw
    // per-segment query rows) is built above, alongside the main query batch — see that comment
    // for why (runs concurrently with it now, not as a separate sequential phase after).
    const MARKET_SEGMENT_PERFORMANCE = marketSegmentRaw.map(({ segment, row }) => {
      const roomRevenue = Math.round(n(row?.rv_cy))
      const roomNights = i(row?.nt_cy)
      const adr = roomNights > 0 ? Math.round(roomRevenue / roomNights) : null
      const rvLy = n(row?.rv_ly)
      const yoyPct = rvLy > 0 ? Math.round(((roomRevenue - rvLy) / rvLy) * 1000) / 10 : null
      return { segment, roomRevenue, roomNights, adr, yoyPct, activeAgents: i(row?.active_agents) }
    })

    // Booking Status Movement (2026-07-15) — see BookingStatusMovementData's own comment (types/
    // index.ts) for the date-basis-per-metric rationale and the Net Pick-up overlap caveat.
    const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const bsmMonths: number[] = []
    for (let m = monthLo; m <= monthHi; m++) bsmMonths.push(m)
    const cpByMonthMap = new Map(bookingConfirmedProvisionalByMonth.map((r) => [r.m, r]))
    const cancelledByMonthMap = new Map(bookingCancelledByMonth.map((r) => [r.m, r]))
    const newConfirmedByMonthMap = new Map(bookingNewConfirmedByMonth.map((r) => [r.m, r]))
    const bsmConfirmedSeries = bsmMonths.map((m) => n(cpByMonthMap.get(m)?.confirmed_val))
    const bsmProvisionalSeries = bsmMonths.map((m) => n(cpByMonthMap.get(m)?.provisional_val))
    const bsmCancelledSeries = bsmMonths.map((m) => n(cancelledByMonthMap.get(m)?.cancelled_val))
    const bsmNewConfirmedSeries = bsmMonths.map((m) => n(newConfirmedByMonthMap.get(m)?.new_confirmed_val))
    const confirmedTotal = bsmConfirmedSeries.reduce((s, v) => s + v, 0)
    const provisionalTotal = bsmProvisionalSeries.reduce((s, v) => s + v, 0)
    const cancelledTotal = bsmCancelledSeries.reduce((s, v) => s + v, 0)
    const confirmedCtTotal = bsmMonths.reduce((s, m) => s + i(cpByMonthMap.get(m)?.confirmed_ct), 0)
    const provisionalCtTotal = bsmMonths.reduce((s, m) => s + i(cpByMonthMap.get(m)?.provisional_ct), 0)
    const cancelledCtTotal = bsmMonths.reduce((s, m) => s + i(cancelledByMonthMap.get(m)?.cancelled_ct), 0)
    const newConfirmedValTotal = bsmMonths.reduce((s, m) => s + n(newConfirmedByMonthMap.get(m)?.new_confirmed_val), 0)
    const newConfirmedCtTotal = bsmMonths.reduce((s, m) => s + i(newConfirmedByMonthMap.get(m)?.new_confirmed_ct), 0)
    // p2cConfirmedCt/Val (REDEFINED 2026-07-09): already excludes bookings created within this
    // period (those are New Confirmed's population) — see the query's own comment above. totalCt
    // stays the full in-period pipeline pool, so p2cRatePct now reads as "share of the pipeline
    // that converted from a pre-existing Provisional state," not a raw confirmed-count rate.
    const p2cConfirmedCt = i(bookingConversionRow?.confirmed_ct)
    const p2cTotalCt = i(bookingConversionRow?.total_ct)
    const p2cConfirmedVal = n(bookingConversionRow?.confirmed_val)
    const p2cRatePct = p2cTotalCt > 0 ? Math.round((p2cConfirmedCt / p2cTotalCt) * 1000) / 10 : 0
    const BOOKING_STATUS_MOVEMENT = {
      confirmed: { count: confirmedCtTotal, value: Math.round(confirmedTotal) },
      provisional: { count: provisionalCtTotal, value: Math.round(provisionalTotal) },
      cancelled: { count: cancelledCtTotal, value: Math.round(cancelledTotal) },
      newConfirmed: { count: newConfirmedCtTotal, value: Math.round(newConfirmedValTotal) },
      provisionalToConfirmed: { count: p2cConfirmedCt, totalCount: p2cTotalCt, value: Math.round(p2cConfirmedVal), ratePct: p2cRatePct },
      netPickup: Math.round(newConfirmedValTotal + p2cConfirmedVal - cancelledTotal),
      monthlyTrend: {
        months: bsmMonths.map((m) => MONTH_ABBR[m - 1]),
        confirmed: bsmConfirmedSeries.map((v) => Math.round(v)),
        provisional: bsmProvisionalSeries.map((v) => Math.round(v)),
        cancelled: bsmCancelledSeries.map((v) => Math.round(v)),
        newConfirmed: bsmNewConfirmedSeries.map((v) => Math.round(v)),
      },
    }

    // Agent Pace, Winners/Losers (2026-07-14e) — ADDITIVE, Trade Partners tab. See
    // agentPaceRows' query comment for the same-leadtime methodology and why the naive
    // forward-vs-completed-window comparison was rejected. >=20-night meaningful-volume filter
    // applied here in JS (tested live: 143 of 849 agents meet this bar under the corrected basis).
    const agentPaceAll = agentPaceRows
      .map((r) => {
        const ty = n(r.ty_nights)
        const ly = n(r.ly_nights_same_leadtime)
        const absVar = ty - ly
        const pctVar = ly > 0 ? Math.round((absVar / ly) * 1000) / 10 : null
        return { agentId: r.agent_id, agentName: r.agent_name, tyNights: ty, lyNights: ly, absVar, pctVar }
      })
      .filter((r) => r.tyNights >= 20 || r.lyNights >= 20)
    const agentPaceGainers = [...agentPaceAll].sort((a, b) => b.absVar - a.absVar).slice(0, 10)
    const agentPaceDecliners = [...agentPaceAll].sort((a, b) => a.absVar - b.absVar).slice(0, 10)

    // Named Cancellation Drivers (2026-07-14e) — ADDITIVE, Trade Partners tab. Last 30 days by
    // r.last_change_date (validated live as the correct "when cancelled" field — see
    // cancelDriverNightsRows' query comment), Room-Revenue-only $ paired with nights lost,
    // sorted by revenue lost.
    const cancelRevMap = new Map(cancelDriverRevRows.map((r) => [r.agent_id, n(r.room_rev_lost)]))
    const cancellationDrivers = cancelDriverNightsRows
      .map((r) => ({
        agentId: r.agent_id, agentName: r.agent_name,
        cancelledBookings: i(r.cancelled_bookings), nightsLost: n(r.nights_lost),
        revenueLost: Math.round(cancelRevMap.get(r.agent_id) ?? 0),
      }))
      .sort((a, b) => b.revenueLost - a.revenueLost)
      .slice(0, 15)

    // Low-Season Occupancy Lift (2026-07-09) — ADDITIVE, Trade Partners tab (Linda's Dashboard
    // KPI #2). See lowSeasonByAgentRows' own query comment for the Feb-May low-season definition
    // (confirmed live against 2024+2025 seasonality, not assumed). % of Annual Business in Low
    // Season is Revenue-based (not Nights-based) — Revenue is the figure Linda's KPI ultimately
    // cares about.
    // FIX (same day): a 20-night floor let tiny/rarely-active agents (a single booking that
    // happens to fall in Feb-May) show a meaningless 100% and dominate a descending sort, drowning
    // out genuine signal from real accounts. Live-checked the volume distribution: at a 100-night
    // annual floor, zero agents hit exactly 100% and 47 real accounts remain, with a believable
    // 10%-67% spread — that's the actionable pool. (For context: the portfolio's own Feb-May
    // share of annual nights is ~15% — see the seasonality query above — so an agent noticeably
    // above that baseline is genuinely over-indexing on low season, not just proportionate.)
    // Sorted DESCENDING by low-season % — surfaces agents ALREADY comfortable booking low season
    // first (proven, lowest-risk "push them further" candidates per the brief's own framing),
    // rather than starting with 0%-low-season agents (a harder, unproven ask — a fundamentally
    // different kind of outreach, not more of the same lever). Top 20, not the full agent list,
    // to stay a scannable action list rather than a full portfolio dump.
    const lowSeasonAgents = lowSeasonByAgentRows
      .map((r) => {
        const totalNights = i(r.total_nights)
        const totalRevenue = n(r.total_revenue)
        const lowSeasonRevenue = n(r.low_revenue)
        return {
          agentId: r.agent_id,
          agentName: r.agent_name,
          lowSeasonNights: i(r.low_nights),
          lowSeasonRevenue: Math.round(lowSeasonRevenue),
          totalNights,
          totalRevenue: Math.round(totalRevenue),
          lowSeasonPct: totalRevenue > 0 ? Math.round((lowSeasonRevenue / totalRevenue) * 1000) / 10 : 0,
        }
      })
      .filter((r) => r.totalNights >= 100)
      .sort((a, b) => b.lowSeasonPct - a.lowSeasonPct)
      .slice(0, 20)

    const data: DashboardData = {
      PD, PF, OD, AD, PLF, YTD_ARR, PLT, CD,
      KP_BASE: { ...KP_BASE, execPace: EXEC_PACE },
      BUDGET: { byProp: budgetByProp, occByProperty: budgetOccByProperty },
      FORECAST: {
        byMonth: forecastByMonth,
        paceRatio: Math.round(forecastPaceRatio * 1000) / 1000,
        cancelRateLy: Math.round(forecastCancelRateLy * 1000) / 1000,
      },
      REVPAR: { byProperty: revparByProperty },
      PROPERTY_PERFORMANCE,
      MARKET_SEGMENT_PERFORMANCE,
      BOOKING_STATUS_MOVEMENT,
      AGENT_PACE: { gainers: agentPaceGainers, decliners: agentPaceDecliners },
      CANCEL_DRIVERS: cancellationDrivers,
      LOW_SEASON_AGENTS: lowSeasonAgents,
      lastUpdated: todayStr,
    }

    dashboardCache.set(cacheKey, { data, cachedAt: Date.now() })

    // appliedFilters is debug/verification-only (not part of DashboardData) — shows exactly what
    // the backend received and used. year/period are real filters now; channel/market are echoed
    // back but NOT yet applied to query results beyond 'all' — see Part 2 investigation for why.
    return NextResponse.json({
      ...data,
      appliedFilters: { year: cy, period, monthRange: [monthLo, monthHi], channel, market, property, view },
    })
  } catch (err) {
    console.error('[dashboard API]', err)
    return NextResponse.json(
      { error: 'Failed to load dashboard data', detail: String(err) },
      { status: 500 }
    )
  }
}
