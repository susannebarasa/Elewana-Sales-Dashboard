// Pre-validated query templates for the AI Query Box (2026-07-17).
//
// WHY THIS FILE EXISTS: the original implementation let Claude Haiku write free-form SQL against
// a bare schema description with none of this app's real business rules (status codes, currency
// conversion, exclusions, Room-vs-Extras split — see METRICS.md §1). Verified live: "What is the
// total revenue for this year?" returned $107M against a correct figure of ~$17-20.6M because the
// generated SQL summed unfiltered reservations.total_amount by date_created (booking date, not
// stay date), with no currency conversion and no exclusions.
//
// Each template below is hand-written, parameterized SQL built from the SAME audited fragments
// dashboard/route.ts itself uses (ROOM_REVENUE_SUM_SQL, exclusion lists, sargable date-range
// helpers) — not model output. Claude's job (see route.ts) is only to pick WHICH template answers
// a question and extract its parameters (year/property/date-basis) via a forced tool call — it
// never writes SQL for these. Free-form SQL generation still exists as a fallback for questions
// no template covers, but that path is validated by sqlSafety.ts (read-only + table allowlist +
// timeout) — see that file's own comment for what it does and doesn't guarantee.
import { ROOM_REVENUE_SUM_SQL, EXTRAS_SUM_SQL, ROOM_REVENUE_CASE, dayUseLegCase, extrasTableRevenueSumSql } from '@/lib/roomRevenue'
import {
  NON_REVENUE_RATE_TYPE_IDS, EXCLUDED_RESERVATION_PREFIX, EXCLUDED_AGENT_IDS, EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN, AGENT_NAME_PATTERN_CARVEOUT_SQL, KES_USD_RATE, PROPERTY_ROOM_COUNTS,
} from '@/lib/constants'
import { dateInFullYear, dateInTwoYearsThroughMonth, caseInYearMonthRange } from '@/lib/dateRange'
import { buildAgentFilterSql, MARKET_SEGMENT_VALUES, CHANNEL_VALUES } from '@/lib/agentSegments'
import { getPropertyBudget, getPortfolioBudget } from '@/lib/budget'
import { query } from '@/lib/db'

const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX
const KES_RATE = KES_USD_RATE
const AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
const AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN

// Same 2-property exclusion dashboard/route.ts's own portfolio aggregate uses (Ngorongoro
// Explorer — pre-opening; Lewa Safari Camp — mid-refurb, capacity figure not adjusted). Kept as a
// local literal, same "small enough to duplicate with a citing comment" precedent already used
// elsewhere in this codebase (e.g. SalesExecutiveSummaryDesign.tsx's isRevOccNoDataRow) rather than
// exported from route.ts, which has no shared-constants boundary of its own.
const PORTFOLIO_AGG_EXCLUDE_IDS = new Set(['WB146935', 'WB37957'])

// 'actualized' = completed stays only (i.date_out <= today). 'ytd' = on-the-books but capped at
// today (i.date_in <= today) — "how are we doing so far this year," the dashboard's own YTD
// framing. 'otb' = the full calendar year, no cap — includes bookings for stays later in the year
// that haven't happened yet. Added 'ytd' (2026-07-17) after live-testing "total revenue this year"
// with only actualized/otb available returned the full-year $39M figure (a legitimate but
// surprising answer to a question most people mean as "so far") — see route.ts's system prompt
// for when each is picked.
export type DateBasis = 'actualized' | 'ytd' | 'otb'

export interface PropertyMatch {
  propertyId: string | null
  propertyName: string | null
  /** True if the caller supplied a name and it did NOT resolve — the answer should say so. */
  unresolved: boolean
}

// Loose, case-insensitive resolver — Claude passes back whatever property phrase the user typed
// (e.g. "arusha", "Arusha Coffee Lodge", "ACL"); this matches against the 18 known property names,
// falling back to "unresolved" (portfolio-wide, with a caveat) rather than guessing wrong.
export function resolvePropertyName(name?: string | null): PropertyMatch {
  if (!name || !name.trim()) return { propertyId: null, propertyName: null, unresolved: false }
  const needle = name.trim().toLowerCase()
  for (const [propertyName, cap] of Object.entries(PROPERTY_ROOM_COUNTS)) {
    if (propertyName.toLowerCase() === needle) return { propertyId: cap.propertyId, propertyName, unresolved: false }
  }
  for (const [propertyName, cap] of Object.entries(PROPERTY_ROOM_COUNTS)) {
    if (propertyName.toLowerCase().includes(needle) || needle.includes(propertyName.toLowerCase())) {
      return { propertyId: cap.propertyId, propertyName, unresolved: false }
    }
  }
  return { propertyId: null, propertyName: name, unresolved: true }
}

export interface AgentMatch {
  agentId: string | null
  agentName: string | null
  /** True if the caller supplied a name and it did NOT resolve — the answer should say so. */
  unresolved: boolean
  /** True when the name matched more than one live agent — the caller picked the closest one. */
  ambiguous: boolean
}

// Agent names have no static list to match against the way the 18 properties do (thousands of
// agents, live in the DB only) — so this queries `agents` directly, same table/exclusions Find
// Agent search (agents/search/route.ts) already uses, rather than the static agentSegments.json
// snapshot (that file is agent-name-keyed for Channel/Market Segment lookup only, and per the
// 2026-07-20 investigation into Faith's segment file, is known to drift from live agent names).
// Tries an exact case-insensitive match first; falls back to substring LIKE. When more than one
// live agent shares the substring (confirmed live: "Asilia" matches "Asilia Africa Limited",
// "ASILIA KENYA LIMITED", and "Asilia Lodges & Camps Ltd"), pick the one with the most confirmed
// bookings ever, NOT the shortest name — an earlier version used name-length as the tie-break and
// it picked "ASILIA KENYA LIMITED" (2 all-time cancelled bookings, effectively a dead duplicate)
// over "Asilia Africa Limited" (the real, ~$2.9M/year trade partner), silently returning $0.
// Flags `ambiguous: true` so the caller can say which one it picked rather than guessing silently.
export async function resolveAgentName(name?: string | null): Promise<AgentMatch> {
  if (!name || !name.trim()) return { agentId: null, agentName: null, unresolved: false, ambiguous: false }
  const needle = name.trim().toLowerCase()

  const exactRows = await query<{ agent_id: string; agent_name: string }>(
    `SELECT agent_id, agent_name FROM agents
     WHERE LOWER(TRIM(agent_name)) = ?
       AND agent_id NOT IN (?) AND agent_name NOT IN (?)
       AND (LOWER(agent_name) NOT LIKE ? OR agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
     LIMIT 1`,
    [needle, AGENT_IDS, AGENT_NAMES, AGENT_NAME_LIKE]
  )
  if (exactRows[0]) return { agentId: exactRows[0].agent_id, agentName: exactRows[0].agent_name, unresolved: false, ambiguous: false }

  const likeRows = await query<{ agent_id: string; agent_name: string; activity_ct: number }>(
    `SELECT a.agent_id, a.agent_name, COUNT(r.reservation_number) AS activity_ct
     FROM agents a
     LEFT JOIN reservations r ON r.agent_id = a.agent_id AND r.status = '30'
     WHERE a.agent_name LIKE ?
       AND a.agent_id NOT IN (?) AND a.agent_name NOT IN (?)
       AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
     GROUP BY a.agent_id, a.agent_name
     ORDER BY activity_ct DESC
     LIMIT 5`,
    [`%${name.trim()}%`, AGENT_IDS, AGENT_NAMES, AGENT_NAME_LIKE]
  )
  if (likeRows.length === 0) return { agentId: null, agentName: name, unresolved: true, ambiguous: false }
  const best = likeRows[0]
  return { agentId: best.agent_id, agentName: best.agent_name, unresolved: false, ambiguous: likeRows.length > 1 }
}

function propertyNameById(propertyId: string): string | null {
  for (const [name, cap] of Object.entries(PROPERTY_ROOM_COUNTS)) {
    if (cap.propertyId === propertyId) return name
  }
  return null
}

export interface BuiltQuery {
  sql: string
  params: unknown[]
  /** Surfaced verbatim in the final answer's system prompt — this is how caveats stay attached to a metric rather than living only in a comment nobody reads at answer time. */
  caveat: string
}

// 'actualized' caps on date_out (stay must have finished); 'ytd' caps on date_in (booking must
// start by today, but may still be in progress or check in later this same day) — the dashboard's
// own YTD framing is month-boundary-based (through the current calendar month); this is day-
// granular, which is a reasonable, slightly more precise equivalent for a conversational answer.
// 'otb' has no cap at all.
function dateBasisCap(dateBasis: DateBasis, alias: string = 'i'): string {
  if (dateBasis === 'actualized') return ` AND ${alias}.date_out <= CURDATE()`
  if (dateBasis === 'ytd') return ` AND ${alias}.date_in <= CURDATE()`
  return ''
}
function dateBasisCaveat(dateBasis: DateBasis, budgetNote: boolean): string {
  if (dateBasis === 'actualized') return 'Actualized basis — counts only stays that have already completed (i.date_out <= today), not future confirmed bookings.'
  if (dateBasis === 'ytd') return 'Year-to-date basis — all confirmed bookings from Jan 1 through today, including ones that haven\'t checked in yet, but not bookings for later this year.'
  return `On-the-books basis — includes every confirmed stay for the whole year, including ones that haven't happened yet${budgetNote ? ' (matches how this figure compares against Budget elsewhere on the dashboard)' : ''}.`
}

// Room Revenue (per METRICS.md §1.2/§2 "Total Room Revenue" / "Total Rev Full Year") — Room-Revenue
// only (never blended with Extras), component-level classification, KES conversion, standard
// exclusions. dateBasis 'actualized' caps at i.date_out <= CURDATE() (stays already completed,
// same convention as the dashboard's own "Room Revenue (Actualized)" KPI); 'otb' is booking-
// inclusive (matches Budget comparisons — same basis as kpiTotalRevFullYear).
// agentId (2026-07-20) — resolved via resolveAgentName, already excludes test/placeholder/direct
// accounts at resolution time, so no extra agent-level exclusion is needed here on top of it.
// propertyId can also be a string[] (2026-07-20) — used by buildOccupancyAdrRevpar's portfolio-
// wide branch to scope to the same "15 clean properties" list as availableNightsFor/the
// dashboard's own portfolio aggregate, instead of every property in the database.
export function buildTotalRoomRevenue(year: number, dateBasis: DateBasis, propertyId: string | string[] | null, agentId: string | null = null): BuiltQuery {
  const propertyFilter = propertyId ? (Array.isArray(propertyId) ? ' AND i.property IN (?)' : ' AND i.property = ?') : ''
  const agentFilter = agentId ? ' AND r.agent_id = ?' : ''
  const sql = `SELECT ${ROOM_REVENUE_SUM_SQL} AS revenue
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
    LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
    WHERE r.status = '30' AND ${dateInFullYear('i.date_in', year)} AND i.date_out > i.date_in
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${dateBasisCap(dateBasis)}${propertyFilter}${agentFilter}`
  const params: unknown[] = [KES_RATE, NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  if (agentId) params.push(agentId)
  return { sql, params, caveat: dateBasisCaveat(dateBasis, true) }
}

// Extras Revenue — rate_components-classified portion CROSS JOINed with the extras-table portion
// (Day Use, any category + EXTRAS_TABLE_REVENUE_CATEGORY_IDS' confirmed-clean categories
// everywhere else — see constants.ts), matching dashboard/route.ts's own kpiRevNights/
// kpiTotalRevFullYear/kpiAgentRev basis exactly (same extrasTableRevenueSumSql helper). Previously
// this tool ONLY summed the rate_components portion — confirmed live 2026-07-20 while reconciling
// against Qlik's $6,277,027 2026 Extras Revenue figure that this was silently under-counting by
// the full extras-table amount (the caveat said so, but "the AI Query Box's Extras Revenue" and
// "the dashboard's Extras Revenue KPI" were really two different metrics under one name). Fixed to
// match the dashboard's basis so the two never disagree again for the same question.
// agentId (2026-07-20) — same resolveAgentName-based scoping as buildTotalRoomRevenue above; see
// that function's comment for why no extra agent-exclusion filter is needed here.
export function buildTotalExtrasRevenue(year: number, dateBasis: DateBasis, propertyId: string | null, agentId: string | null = null): BuiltQuery {
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  const agentFilter = agentId ? ' AND r.agent_id = ?' : ''
  const propertyFilter2 = propertyId ? ' AND i2.property = ?' : ''
  const agentFilter2 = agentId ? ' AND r2.agent_id = ?' : ''
  const sql = `SELECT (IFNULL(rc.extras,0) + IFNULL(et.extras_table,0)) AS extras
    FROM (
      SELECT ${EXTRAS_SUM_SQL} AS extras
      FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
      JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
      LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
      WHERE r.status = '30' AND ${dateInFullYear('i.date_in', year)} AND i.date_out > i.date_in
        AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${dateBasisCap(dateBasis)}${propertyFilter}${agentFilter}
    ) rc
    CROSS JOIN (
      SELECT ${extrasTableRevenueSumSql('i2', 'e', 'dt2')} AS extras_table
      FROM itineraries i2
      JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
      LEFT JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
      LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
      WHERE r2.status='30' AND ${dateInFullYear('i2.date_in', year)}${dateBasisCap(dateBasis, 'i2')}${propertyFilter2}${agentFilter2}
    ) et`
  const params: unknown[] = [KES_RATE, NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  if (agentId) params.push(agentId)
  params.push(KES_RATE)
  if (propertyId) params.push(propertyId)
  if (agentId) params.push(agentId)
  return {
    sql, params,
    caveat: `${dateBasisCaveat(dateBasis, false)} Covers both rate-components-classified Extras and the extras table's confirmed-clean categories (F&B, activities, transfers, spa, Day Use) — Cost of Flight/Heli charter revenue is still excluded pending Finance confirmation, so this remains a floor, not the true total.`,
  }
}

// Agent ADR (2026-07-20) — deliberately mirrors the Agent Leaderboard's own `nr_adr` field
// (dashboard/route.ts's agRows `lg` subquery) EXACTLY, rather than reusing buildTotalRoomRevenue's
// i.date_in/status='30'-only/DateBasis convention every other template in this file uses. Two real
// differences from that convention, both intentional, both matching what the Leaderboard already
// shows on screen for this same agent: (1) date field is r.date_created (booking creation date),
// not i.date_in (stay date); (2) status is IN ('20','30') (Provisional + Confirmed), not '30' only.
// No DateBasis/actualized-vs-otb concept here either — this is a full-calendar-year figure, same
// as the Leaderboard's own default. Reusing the SAME formula matters: an ADR computed on a
// different date field/status filter would silently disagree with the number already on screen for
// the same agent, which is exactly the kind of drift this app's AI Query Box exists to avoid (see
// the context short-circuit elsewhere in copilotkit/route.ts for the same principle).
// No capacity/Occupancy%/RevPAR equivalent exists here — Available Room Nights (the denominator
// those two need) is a per-PROPERTY externally-sourced figure with no per-agent breakdown, so this
// intentionally returns ADR only, never bundled with Occupancy/RevPAR the way
// buildOccupancyAdrRevpar is for properties/portfolio.
export function buildAgentAdr(year: number, agentId: string): BuiltQuery {
  const sql = `SELECT ROUND(roomrev.room_rev / GREATEST(nt.nt, 1)) AS adr
    FROM (
      SELECT SUM(GREATEST(DATEDIFF(i.date_out, i.date_in), 0)) AS nt
      FROM reservations r JOIN itineraries i ON r.reservation_number = i.reservation_number
      WHERE r.status IN ('20','30') AND ${dateInFullYear('r.date_created', year)}
        AND r.agent_id = ? AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?
    ) nt
    JOIN (
      SELECT ${ROOM_REVENUE_SUM_SQL} AS room_rev
      FROM reservations r JOIN itineraries i ON r.reservation_number = i.reservation_number
      JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
      LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
      WHERE r.status IN ('20','30') AND ${dateInFullYear('r.date_created', year)}
        AND r.agent_id = ? AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?
    ) roomrev`
  return {
    sql,
    params: [agentId, NON_REV_IDS, RES_PREFIX, KES_RATE, agentId, NON_REV_IDS, RES_PREFIX],
    caveat: 'Full calendar year, Provisional + Confirmed bookings by booking-creation date (same basis as the Agent Leaderboard\'s own ADR column) — not the actualized/YTD/on-the-books basis used elsewhere in this assistant. Occupancy % and RevPAR have no per-agent equivalent (Available Room Nights is a property-level figure only), so only ADR is reported here.',
  }
}

// DATEDIFF-only, excludes Day Use — kept internal (not exported directly as a tool builder) since
// it's now purely the ADR denominator inside buildOccupancyAdrRevpar below. Day Use legs carry $0
// Room Revenue, so folding them into ADR's denominator would dilute ADR with no matching numerator
// — same reasoning dashboard/route.ts's KP_BASE.occ.adr and revparByProperty's own adr field
// already follow (both computed against DATEDIFF-only nights, never the Day-Use-inclusive figure).
function roomNightsSql(year: number, dateBasis: DateBasis, propertyId: string | string[] | null): BuiltQuery {
  const propertyFilter = propertyId ? (Array.isArray(propertyId) ? ' AND i.property IN (?)' : ' AND i.property = ?') : ''
  const sql = `SELECT SUM(GREATEST(DATEDIFF(i.date_out, i.date_in), 0)) AS nights
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    WHERE r.status = '30' AND ${dateInFullYear('i.date_in', year)} AND i.date_out > i.date_in
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${dateBasisCap(dateBasis)}${propertyFilter}`
  const params: unknown[] = [NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  return { sql, params, caveat: dateBasisCaveat(dateBasis, false) }
}

// Day-Use-inclusive Room Nights Sold (2026-07-20) — Qlik's own convention counts Day Rooms in Room
// Nights; this was the standalone "Room Nights Sold" tool's own gap (same fix already applied to
// KP_BASE.occ.nights' totalNights, 2026-07-13, and dashboard/route.ts's revparNightsRows this
// session). Day Use legs carry date_out=date_in (0 under DATEDIFF) despite a room genuinely being
// sold, so `OR dayUseLegCase` has to widen the WHERE clause too, not just the SELECT's CASE — the
// plain `i.date_out > i.date_in` filter would otherwise exclude them before the CASE ever sees them.
// This is the ONLY nights figure the standalone room_nights_sold tool reports — deliberately
// separate from roomNightsSql above, which stays DATEDIFF-only for buildOccupancyAdrRevpar's ADR.
function roomNightsInclDayUseSql(year: number, dateBasis: DateBasis, propertyId: string | string[] | null): BuiltQuery {
  const propertyFilter = propertyId ? (Array.isArray(propertyId) ? ' AND i.property IN (?)' : ' AND i.property = ?') : ''
  const sql = `SELECT SUM(CASE WHEN ${dayUseLegCase('i')} THEN 1 ELSE GREATEST(DATEDIFF(i.date_out, i.date_in), 0) END) AS nights
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    WHERE r.status = '30' AND ${dateInFullYear('i.date_in', year)} AND (i.date_out > i.date_in OR ${dayUseLegCase('i')})
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${dateBasisCap(dateBasis)}${propertyFilter}`
  const params: unknown[] = [NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  return {
    sql, params,
    caveat: `${dateBasisCaveat(dateBasis, false)} Includes Day Use ("Day Rooms") legs, one night each, per Qlik's own Room Nights convention.`,
  }
}
export const buildRoomNightsSold = roomNightsInclDayUseSql

// Occupancy % / ADR / RevPAR (per METRICS.md §3) are period-invariant on this dashboard — always
// full-year-2026, regardless of what year is asked — because Available Room Nights (the
// denominator, Dennis's externally-sourced annual capacity figure) has no other year's figure to
// divide by. A different year returns the same caveat-flagged answer rather than a silently wrong
// number. Portfolio-wide figures exclude Ngorongoro Explorer (pre-opening) and Lewa Safari Camp
// (mid-refurb, capacity not adjusted) — same PORTFOLIO_AGG_EXCLUDE_IDS as the dashboard's own
// aggregate; a single-property question includes that property's own (possibly caveated) figure.
const CAPACITY_YEAR = 2026
// CLEAN_PROPERTY_IDS (2026-07-20) — the same "15 clean properties" the dashboard's own portfolio
// Occupancy %/RevPAR aggregate scopes to (dashboard/route.ts's PORTFOLIO_AGG_EXCLUDE_IDS pass over
// PROPERTY_ROOM_COUNTS): excludes LEPC (no propertyId at all — mid-construction) and NXR/Lewa
// (PORTFOLIO_AGG_EXCLUDE_IDS — pre-opening / mid-refurb, capacity not adjusted). Previously,
// buildOccupancyAdrRevpar's portfolio-wide (propertyId=null) branch queried ALL reservations with
// no property restriction at all — a different, unrestricted scope from the dashboard's own KPI,
// so the two could disagree even on the same underlying data. Only used for the null-propertyId
// (portfolio) branch below; a single named property still scopes to just that property, unchanged.
const CLEAN_PROPERTY_IDS: string[] = Object.values(PROPERTY_ROOM_COUNTS)
  .map((cap) => cap.propertyId)
  .filter((id): id is string => !!id && !PORTFOLIO_AGG_EXCLUDE_IDS.has(id))
// nightsInclDayUse (2026-07-20) — Occupancy % must now include Day Use nights (same convention as
// buildRoomNightsSold/revparNightsRows), but ADR must NOT (Day Use has $0 Room Revenue). Returns
// both side by side so route.ts can divide revenue by the DATEDIFF-only `nights` for ADR and by
// `nightsInclDayUse` for Occupancy % — RevPAR's own formula (revenue ÷ available) never consumed
// sold nights at all, so it needs no change, just consistent underlying data.
// ADR basis fix (2026-07-20) — the dashboard's own ADR (KP_BASE.occ.adr, kpiRevNights) is
// Actualized-only (completed stays, i.date_out <= today), while this tool's ADR was On-the-books
// (booking-inclusive, same as Occupancy %/RevPAR) — confirmed live the two disagreed ($996 vs
// $1,174 for the same portfolio/period) purely from this basis mismatch, not a real business
// difference. Added a SEPARATE Actualized revenue+nights pair (revenueActualized/nightsActualized)
// used ONLY for ADR; Occupancy %/RevPAR stay On-the-books/full-year 2026, unchanged — those two are
// deliberately period-invariant per METRICS.md §3, ADR is not.
export function buildOccupancyAdrRevpar(propertyId: string | null): { sql: string; params: unknown[]; caveat: string } {
  const scope: string | string[] | null = propertyId ?? CLEAN_PROPERTY_IDS
  const revenueQuery = buildTotalRoomRevenue(CAPACITY_YEAR, 'otb', scope)
  const nightsInclDayUseQuery = roomNightsInclDayUseSql(CAPACITY_YEAR, 'otb', scope)
  const revenueActualizedQuery = buildTotalRoomRevenue(CAPACITY_YEAR, 'actualized', scope)
  const nightsActualizedQuery = roomNightsSql(CAPACITY_YEAR, 'actualized', scope)
  const sql = `SELECT rev.revenue, ntd.nights AS nights_incl_day_use, reva.revenue AS revenue_actualized, nta.nights AS nights_actualized
    FROM (${revenueQuery.sql}) rev
    CROSS JOIN (${nightsInclDayUseQuery.sql}) ntd
    CROSS JOIN (${revenueActualizedQuery.sql}) reva
    CROSS JOIN (${nightsActualizedQuery.sql}) nta`
  const params = [...revenueQuery.params, ...nightsInclDayUseQuery.params, ...revenueActualizedQuery.params, ...nightsActualizedQuery.params]
  const caveat = 'Occupancy %/RevPAR are always full-year 2026 On-the-books on this dashboard, regardless of what period is asked — the capacity figure they divide by has no other year to compare against. ADR is Actualized-only (completed stays), matching the dashboard\'s own ADR KPI. Portfolio-wide figures scope to the same 15 "clean" properties as the dashboard\'s own KPI (excluding Ngorongoro Explorer/Lewa Safari Camp/LEPC). Occupancy % includes Day Use ("Day Rooms") nights per Qlik convention; ADR excludes them (Day Use carries $0 Room Revenue, so including it would dilute ADR with no matching numerator).'
  return { sql, params, caveat }
}
export function availableNightsFor(propertyId: string | null): number {
  if (propertyId) {
    for (const cap of Object.values(PROPERTY_ROOM_COUNTS)) {
      if (cap.propertyId === propertyId) return cap.roomnightsAvailable
    }
    return 0
  }
  let sum = 0
  for (const cap of Object.values(PROPERTY_ROOM_COUNTS)) {
    if (!cap.propertyId || PORTFOLIO_AGG_EXCLUDE_IDS.has(cap.propertyId)) continue
    sum += cap.roomnightsAvailable
  }
  return sum
}

export interface PropertyRevenueRow { propertyId: string; propertyName: string | null; revenue: number }
export function buildRevenueByProperty(year: number, dateBasis: DateBasis, limit: number): BuiltQuery {
  const safeLimit = Math.max(1, Math.min(18, Math.round(limit)))
  const sql = `SELECT i.property AS property_id, ${ROOM_REVENUE_SUM_SQL} AS revenue
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
    LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
    WHERE r.status = '30' AND ${dateInFullYear('i.date_in', year)} AND i.date_out > i.date_in
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${dateBasisCap(dateBasis)}
    GROUP BY i.property
    ORDER BY revenue DESC
    LIMIT ${safeLimit}`
  return { sql, params: [KES_RATE, NON_REV_IDS, RES_PREFIX], caveat: dateBasisCaveat(dateBasis, false) }
}
export { propertyNameById }

// Property-level Room Revenue YoY (2026-07-17, diagnose_change gap-fill) — the one genuine
// missing piece for diagnose_change; every other input it needs already exists (buildRevenueByProperty,
// buildTotalRoomRevenue, occupancy/segment/channel breakdowns). Same basis as buildRevenueByProperty
// above (Room Revenue only, same exclusions) — NOT dashboard/route.ts's monthLo/monthHi CASE WHEN
// convention. Mirrors this file's OWN precedent instead: the existing yoy_growth tool (route.ts)
// already does "same template, called once for year and once for year-1, merged in JS" for the
// portfolio-wide figure — this is that same pattern, one level down, per property. Requests all 18
// properties from each side (buildRevenueByProperty's own limit cap) rather than pre-limiting per
// year, so a property strong in one year but silent in the other still merges correctly instead of
// falling off one side's top-N independently.
export function buildRevenueByPropertyYoY(year: number, dateBasis: DateBasis): { cy: BuiltQuery; ly: BuiltQuery } {
  return {
    cy: buildRevenueByProperty(year, dateBasis, 18),
    ly: buildRevenueByProperty(year - 1, dateBasis, 18),
  }
}

export interface PropertyRevenueYoYRow {
  propertyId: string
  propertyName: string | null
  revenue: number
  revenueLy: number
  /** null when there's no LY base to divide by (property had $0 revenue last year). */
  yoyPct: number | null
}

// Merges the cy/ly row sets from buildRevenueByPropertyYoY into one per-property YoY row, sorted
// by current-year revenue (highest first) — diagnose_change's own ranking of "who moved" is a
// separate, later concern (e.g. sorting by |yoyPct| or absolute $ delta instead); this function
// only merges, it doesn't decide how the caller wants to rank change.
export function mergePropertyRevenueYoY(
  cyRows: { property_id: string; revenue: number }[],
  lyRows: { property_id: string; revenue: number }[]
): PropertyRevenueYoYRow[] {
  const lyMap = new Map(lyRows.map((r) => [r.property_id, Number(r.revenue)]))
  const seen = new Set<string>()
  const out: PropertyRevenueYoYRow[] = []
  for (const r of cyRows) {
    seen.add(r.property_id)
    const revenue = Number(r.revenue)
    const revenueLy = lyMap.get(r.property_id) ?? 0
    out.push({
      propertyId: r.property_id,
      propertyName: propertyNameById(r.property_id),
      revenue,
      revenueLy,
      yoyPct: revenueLy > 0 ? ((revenue - revenueLy) / revenueLy) * 100 : null,
    })
  }
  // A property with LY revenue but nothing this year (e.g. closed, or simply no bookings yet)
  // still belongs in a change-diagnosis view — "dropped to zero" IS the change, not a row to omit.
  lyMap.forEach((revenueLy, propertyId) => {
    if (seen.has(propertyId)) return
    out.push({ propertyId, propertyName: propertyNameById(propertyId), revenue: 0, revenueLy, yoyPct: -100 })
  })
  return out.sort((a, b) => b.revenue - a.revenue)
}

// ─────────────────────────────────────────────────────────────────────────
// diagnose_change bundle pieces (2026-07-17) — remaining gaps beyond property revenue YoY above.
// Each mirrors an already-audited query from dashboard/route.ts as closely as possible (same
// exclusions, same status codes, same methodology) rather than inventing a new approach, with an
// optional propertyId added since diagnose_change can be scoped to one property ("why is Arusha
// down") or portfolio-wide ("why is revenue down").
// ─────────────────────────────────────────────────────────────────────────

// Monthly Room Revenue trend, this year vs last year, full 12 months (mirrors dashboard/route.ts's
// arrRows, portfolio-or-property scoped instead of agent-scoped).
export function buildMonthlyRevenueTrend(year: number, propertyId: string | null): BuiltQuery {
  const ly = year - 1
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  const sql = `SELECT MONTH(i.date_in) AS m,
      SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', year, 1, 12)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS revenue,
      SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, 12)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS revenue_ly
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
    LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
    WHERE r.status = '30' AND (${dateInTwoYearsThroughMonth('i.date_in', year, ly, 12)}) AND i.date_out > i.date_in
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${propertyFilter}
    GROUP BY MONTH(i.date_in)
    ORDER BY m`
  const params: unknown[] = [KES_RATE, KES_RATE, NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  return { sql, params, caveat: 'Room Revenue only (never Extras), grouped by stay month, this year vs last year.' }
}

// Agent movers by forward-pipeline nights — mirrors dashboard/route.ts's agentPaceRows exactly
// (the existing "Agent Pace, Winners/Losers" methodology: next-12-months nights on the books vs
// the same lead-time window last year). Deliberately NOT a realized/actualized YoY — this is the
// established "agent movers" precedent already audited and shown on the Trade Partners tab.
export function buildAgentMoversByNights(propertyId: string | null): BuiltQuery {
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  const sql = `SELECT a.agent_id, a.agent_name,
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
      AND r.reservation_number NOT LIKE ?${propertyFilter}
    GROUP BY a.agent_id, a.agent_name
    HAVING ty_nights > 0 OR ly_nights_same_leadtime > 0`
  const params: unknown[] = [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  return {
    sql, params,
    caveat: 'Forward-looking pipeline nights (next 12 months on the books) vs the same lead-time window last year — not realized/actualized nights, and not a true demand forecast.',
  }
}
const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)

export interface MarketSegmentYoYQuery { segment: string; query: BuiltQuery }
// Per-segment Room Revenue, this year vs last year, full year both sides — mirrors dashboard/
// route.ts's marketSegmentRawRows/MARKET_SEGMENT_PERFORMANCE (one query per segment value, same
// exclusions), scoped to full-year instead of the dashboard's monthLo/monthHi period toggle since
// diagnose_change has no period concept, only a year.
export function buildMarketSegmentYoYQueries(year: number, propertyId: string | null): MarketSegmentYoYQuery[] {
  const ly = year - 1
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  return MARKET_SEGMENT_VALUES.map((segment) => {
    const segFilter = buildAgentFilterSql('a', 'all', segment)
    const andSeg = segFilter ? ` AND ${segFilter}` : ''
    const sql = `SELECT
        SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', year, 1, 12)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS revenue,
        SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, 12)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS revenue_ly
      FROM reservations r
      JOIN itineraries i ON r.reservation_number = i.reservation_number
      JOIN agents a ON r.agent_id = a.agent_id
      JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
      LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
      WHERE r.status = '30' AND r.agent_id IS NOT NULL AND (${dateInTwoYearsThroughMonth('i.date_in', year, ly, 12)})
        AND r.agent_id NOT IN (?)
        AND a.agent_name NOT IN (?)
        AND r.rate_type NOT IN (?)
        AND r.reservation_number NOT LIKE ?${andSeg}${propertyFilter}`
    const params: unknown[] = [KES_RATE, KES_RATE, AGENT_IDS, AGENT_NAMES, NON_REV_IDS, RES_PREFIX]
    if (propertyId) params.push(propertyId)
    return { segment, query: { sql, params, caveat: 'On-the-books basis both years, full calendar year.' } }
  })
}

// Per-segment Room Nights, this year vs last year (ADR diagnose_change gap-fill, 2026-07-18) —
// nights-only analog of buildMarketSegmentYoYQueries above (same segment filter/exclusions/date
// range), needed alongside segment revenue so segment-level ADR (= revenue/nights) and each
// segment's nights SHARE of the total can both be computed — the nights-share delta is what
// distinguishes a genuine rate change at a segment from a portfolio-level mix shift toward/away
// from that segment.
export function buildMarketSegmentNightsYoYQueries(year: number, propertyId: string | null): MarketSegmentYoYQuery[] {
  const ly = year - 1
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  return MARKET_SEGMENT_VALUES.map((segment) => {
    const segFilter = buildAgentFilterSql('a', 'all', segment)
    const andSeg = segFilter ? ` AND ${segFilter}` : ''
    const sql = `SELECT
        SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', year, 1, 12)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nights,
        SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, 12)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nights_ly
      FROM reservations r
      JOIN itineraries i ON r.reservation_number = i.reservation_number
      JOIN agents a ON r.agent_id = a.agent_id
      WHERE r.status = '30' AND r.agent_id IS NOT NULL AND (${dateInTwoYearsThroughMonth('i.date_in', year, ly, 12)})
        AND r.agent_id NOT IN (?)
        AND a.agent_name NOT IN (?)
        AND r.rate_type NOT IN (?)
        AND r.reservation_number NOT LIKE ?${andSeg}${propertyFilter}`
    const params: unknown[] = [AGENT_IDS, AGENT_NAMES, NON_REV_IDS, RES_PREFIX]
    if (propertyId) params.push(propertyId)
    return { segment, query: { sql, params, caveat: 'On-the-books basis both years, full calendar year.' } }
  })
}

// Named Cancellation Drivers — mirrors dashboard/route.ts's cancelDriverNightsRows +
// cancelDriverRevRows exactly (status='90', confirmation_date IS NOT NULL so lapsed quotes never
// masquerade as real cancellations, last_change_date within 30 days — the validated "when
// cancelled" field, see that query's own comment in dashboard/route.ts). Always a rolling 30-day
// window regardless of the year diagnose_change is asked about — there's no year-scoped
// equivalent of "cancelled recently" that would make sense here.
export function buildCancellationDriverQueries(propertyId: string | null): { nights: BuiltQuery; revenue: BuiltQuery } {
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  const nightsSql = `SELECT a.agent_id, a.agent_name,
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
      AND r.reservation_number NOT LIKE ?${propertyFilter}
    GROUP BY a.agent_id, a.agent_name`
  const nightsParams: unknown[] = [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
  if (propertyId) nightsParams.push(propertyId)

  const revSql = `SELECT a.agent_id,
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
      AND r.reservation_number NOT LIKE ?${propertyFilter}
    GROUP BY a.agent_id`
  const revParams: unknown[] = [KES_RATE, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]
  if (propertyId) revParams.push(propertyId)

  return {
    nights: { sql: nightsSql, params: nightsParams, caveat: 'Rolling last 30 days, regardless of the year asked.' },
    revenue: { sql: revSql, params: revParams, caveat: 'Rolling last 30 days, regardless of the year asked.' },
  }
}

// Forecast pace ratio — mirrors dashboard/route.ts's kpiForecastPace exactly (this year's forward
// pipeline nights vs last year's equivalent at the same lead time). A ratio > 1 means the forward
// book is building faster than the same point last year.
export function buildForecastPaceRatio(propertyId: string | null): BuiltQuery {
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  const sql = `SELECT
      SUM(CASE WHEN i.date_in > CURDATE() THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS this_year_forward_nights,
      SUM(CASE WHEN i.date_in > DATE_SUB(CURDATE(), INTERVAL 1 YEAR) AND i.date_in <= CURDATE()
                 AND r.date_created <= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
            THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS last_year_forward_nights_same_leadtime
    FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
    WHERE r.status='30' AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${propertyFilter}`
  const params: unknown[] = [NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  return {
    sql, params,
    caveat: 'Forward pipeline pace — this year\'s next-12-months nights on the books vs last year\'s equivalent at the same lead time, not a true demand forecast.',
  }
}

// Occupancy % by property — full-year-2026-fixed, same convention as occupancy_adr_revpar above.
// Nights grouped by property (own subquery, no rate_components join — avoids the fan-out bug noted
// throughout dashboard/route.ts, where joining rate_components alongside a nights SUM multiplies
// nights by however many revenue-component rows each leg has), divided in JS by each property's own
// PROPERTY_ROOM_COUNTS capacity. Excludes properties with no available-nights capacity or with no
// propertyId (LEPC) — same "never fabricate a denominator" rule as the rest of this file.
function nightsByPropertySql(year: number): BuiltQuery {
  const sql = `SELECT i.property AS property_id, SUM(GREATEST(DATEDIFF(i.date_out, i.date_in), 0)) AS nights
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    WHERE r.status = '30' AND ${dateInFullYear('i.date_in', year)} AND i.date_out > i.date_in
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?
    GROUP BY i.property`
  return { sql, params: [NON_REV_IDS, RES_PREFIX], caveat: 'Room Nights Sold by property, on-the-books basis, full calendar year.' }
}
export function buildNightsByProperty(): BuiltQuery {
  const q = nightsByPropertySql(CAPACITY_YEAR)
  return { ...q, caveat: 'Occupancy % is always full-year 2026 on this dashboard, regardless of what period is asked.' }
}
// Nights by property, this year vs last year (ADR diagnose_change gap-fill, 2026-07-18) — unlike
// Occupancy %/RevPAR, ADR (= Revenue/Nights) has no capacity-denominator dependency, so it CAN be
// genuinely compared year over year using whatever `year` is asked, not fixed to CAPACITY_YEAR.
// Mirrors buildRevenueByPropertyYoY's own cy/ly pattern one level down (nights instead of revenue).
export function buildNightsByPropertyYoY(year: number): { cy: BuiltQuery; ly: BuiltQuery } {
  return { cy: nightsByPropertySql(year), ly: nightsByPropertySql(year - 1) }
}
export function occupancyPctByProperty(nightsRows: { property_id: string; nights: number }[]): { propertyName: string; occPct: number }[] {
  const nightsMap = new Map(nightsRows.map((r) => [r.property_id, Number(r.nights)]))
  const out: { propertyName: string; occPct: number }[] = []
  for (const [propertyName, cap] of Object.entries(PROPERTY_ROOM_COUNTS)) {
    if (!cap.propertyId || PORTFOLIO_AGG_EXCLUDE_IDS.has(cap.propertyId) || cap.roomnightsAvailable <= 0) continue
    const nights = nightsMap.get(cap.propertyId) ?? 0
    out.push({ propertyName, occPct: (nights / cap.roomnightsAvailable) * 100 })
  }
  return out.sort((a, b) => b.occPct - a.occPct)
}

export interface PropertyOccupancyVarianceRow {
  propertyName: string
  occPct: number
  budgetOccPct: number | null
  varianceAbs: number | null // percentage points, occPct - budgetOccPct (negative = under budget)
}
// Property-level Occupancy % vs Budget (diagnose_change occupancy metric, 2026-07-17) — mirrors
// dashboard/route.ts's budgetOccByProperty formula exactly: Budget Occ% = Budget Room Nights
// (getPropertyBudget's budgetRns) / the same Dennis-confirmed Available Room Nights capacity
// figure Actual Occ% already divides Sold Nights by, so the two can never disagree on capacity.
// Always full-year 2026 (CAPACITY_YEAR), same as occupancyPctByProperty above and for the same
// reason — Available Room Nights has no other year to divide by.
export function propertyOccupancyVsBudget(nightsRows: { property_id: string; nights: number }[]): PropertyOccupancyVarianceRow[] {
  const nightsMap = new Map(nightsRows.map((r) => [r.property_id, Number(r.nights)]))
  const out: PropertyOccupancyVarianceRow[] = []
  for (const [propertyName, cap] of Object.entries(PROPERTY_ROOM_COUNTS)) {
    if (!cap.propertyId || PORTFOLIO_AGG_EXCLUDE_IDS.has(cap.propertyId) || cap.roomnightsAvailable <= 0) continue
    const nights = nightsMap.get(cap.propertyId) ?? 0
    const occPct = (nights / cap.roomnightsAvailable) * 100
    const budgetRns = getPropertyBudget(cap.propertyId, CAPACITY_YEAR, 1, 12).rns
    const budgetOccPct = budgetRns > 0 ? (budgetRns / cap.roomnightsAvailable) * 100 : null
    out.push({ propertyName, occPct, budgetOccPct, varianceAbs: budgetOccPct !== null ? occPct - budgetOccPct : null })
  }
  // Most-under-budget first (nulls last) — the properties diagnose_change should surface first
  // when explaining an occupancy shortfall.
  return out.sort((a, b) => (a.varianceAbs ?? Infinity) - (b.varianceAbs ?? Infinity))
}
// Occupancy % vs Budget, portfolio-wide (propertyId null) or one property — same capacity/Budget
// Room Nights basis as propertyOccupancyVsBudget above, sharing availableNightsFor's denominator
// (which already excludes the pre-opening/mid-refurb properties for the portfolio-wide case) so
// actual and budget can never disagree on capacity.
export function occupancyVsBudget(propertyId: string | null, soldNights: number): { occPct: number; budgetOccPct: number | null; varianceAbs: number | null } {
  const available = availableNightsFor(propertyId)
  const occPct = available > 0 ? (soldNights / available) * 100 : 0
  const budgetRns = propertyId ? getPropertyBudget(propertyId, CAPACITY_YEAR, 1, 12).rns : getPortfolioBudget(CAPACITY_YEAR, 1, 12).rns
  const budgetOccPct = available > 0 && budgetRns > 0 ? (budgetRns / available) * 100 : null
  return { occPct, budgetOccPct, varianceAbs: budgetOccPct !== null ? occPct - budgetOccPct : null }
}

// Market Segment / Channel have no DB column (agent-name lookup against a static CSV snapshot,
// see agentSegments.ts) — one query per segment value via buildAgentFilterSql, mirroring
// dashboard/route.ts's own marketSegmentRaw exactly (same exclusions: rate_type, PA%, plus the
// agent-level EXCLUDED_AGENT_IDS/EXCLUDED_AGENT_NAMES_EXACT lists that per-agent breakdowns need
// but the plain revenue templates above don't, since those aren't agent-scoped).
export function buildSegmentOrChannelQuery(kind: 'segment' | 'channel', value: string, year: number): BuiltQuery {
  const segFilter = buildAgentFilterSql('a', kind === 'channel' ? value : 'all', kind === 'segment' ? value : 'all')
  const andSeg = segFilter ? ` AND ${segFilter}` : ''
  const sql = `SELECT ${ROOM_REVENUE_SUM_SQL} AS revenue
    FROM reservations r
    JOIN itineraries i ON r.reservation_number = i.reservation_number
    JOIN agents a ON r.agent_id = a.agent_id
    JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
    LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
    WHERE r.status = '30' AND r.agent_id IS NOT NULL AND ${dateInFullYear('i.date_in', year)} AND i.date_out > i.date_in
      AND r.agent_id NOT IN (?) AND a.agent_name NOT IN (?)
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${andSeg}`
  return {
    sql,
    params: [KES_RATE, AGENT_IDS, AGENT_NAMES, NON_REV_IDS, RES_PREFIX],
    caveat: 'On-the-books basis (all confirmed bookings for the year, not just completed stays).',
  }
}
export const SEGMENT_VALUES: readonly string[] = MARKET_SEGMENT_VALUES
export const CHANNEL_VALUES_LIST: readonly string[] = CHANNEL_VALUES

// Monthly Room Nights Sold trend, this year vs last year (diagnose_change occupancy metric,
// 2026-07-17) — nights-only analog of buildMonthlyRevenueTrend, no currency conversion needed.
// Unlike Occupancy %/ADR/RevPAR, real nights sold CAN be compared YoY (no capacity-denominator
// problem), so this genuinely uses whatever `year` is asked, not fixed to CAPACITY_YEAR.
export function buildMonthlyNightsTrend(year: number, propertyId: string | null): BuiltQuery {
  const ly = year - 1
  const propertyFilter = propertyId ? ' AND i.property = ?' : ''
  const sql = `SELECT MONTH(i.date_in) AS m,
      SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', year, 1, 12)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nights,
      SUM(CASE WHEN ${caseInYearMonthRange('i.date_in', ly, 1, 12)} THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS nights_ly
    FROM itineraries i JOIN reservations r ON i.reservation_number = r.reservation_number
    WHERE r.status = '30' AND (${dateInTwoYearsThroughMonth('i.date_in', year, ly, 12)}) AND i.date_out > i.date_in
      AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?${propertyFilter}
    GROUP BY MONTH(i.date_in)
    ORDER BY m`
  const params: unknown[] = [NON_REV_IDS, RES_PREFIX]
  if (propertyId) params.push(propertyId)
  return { sql, params, caveat: 'Room Nights Sold, grouped by stay month, this year vs last year.' }
}
