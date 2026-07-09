export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { dateInFullYear } from '@/lib/dateRange'
import type { AgentProfile, AgentPropertyBreakdown, AgentConfirmedArrival, AgentProvisionalBooking, AgentSummaryKpis, AgentCancellationItem } from '@/types'
import {
  NON_REVENUE_RATE_TYPE_IDS,
  EXCLUDED_RESERVATION_PREFIX,
  KES_USD_RATE,
} from '@/lib/constants'
import { ROOM_REVENUE_SUM_SQL, EXTRAS_SUM_SQL, ROOM_REVENUE_CASE, EXCLUDED_FEE_CASE, extrasTableRevenueCase, extrasTableRevenueSumSql } from '@/lib/roomRevenue'
import { lookupAgentSegment } from '@/lib/agentSegments'

// ── helpers ──────────────────────────────────────────────────────────────────
const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}
const i = (v: unknown, def = 0): number => Math.round(n(v, def))
const safePct = (num: number, den: number): number =>
  den > 0 ? Math.round((num / den) * 100) : 0

const fmtDate = (v: unknown): string => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(String(v))
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`
}

// Same as fmtDate, plus year — for fields that can be years in the past (First
// Booking), where omitting the year would be genuinely ambiguous/misleading,
// unlike arrival/expiry dates which are always near-term.
const fmtDateWithYear = (v: unknown): string => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(String(v))
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
}

// ── route ────────────────────────────────────────────────────────────────────
// Agent Profile panel data. Follows the same conventions used everywhere else in this
// app: status IN ('20','30') for active/pipeline business, date_created basis for
// booking-intake-style aggregates (monthly revenue — matches AD.byMonth in
// dashboard/route.ts), i.date_in for stay-based aggregates (property breakdown, active
// bookings), KES/129 currency conversion, NON_REVENUE_RATE_TYPE_IDS + PA% exclusions.
// No agent-name/id exclusion filter here — the agent was already selected via the
// Find Agent search or a rendered table row, both of which already exclude test/direct
// agents upstream, so re-filtering here would be redundant.
export async function GET(
  req: NextRequest,
  { params }: { params: { agentId: string } }
): Promise<NextResponse> {
  try {
    const agentId = params.agentId
    const today = new Date()
    const yearParam = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10)
    const cy = Number.isFinite(yearParam) ? yearParam : today.getFullYear()
    const ly = cy - 1

    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX
    const KES_RATE = KES_USD_RATE

    const [
      agentRow, monthlyRows, dayUseMonthlyRows, propRows, dayUsePropRows, confirmedArrivalRows, provisionalRows, poolRow, poolLyRow, nightsRow,
      snapshotRow, historyRow, confirmedArrivalsCountRow, provisionalCountRow,
      cancellationHistoryRows, cancellationHistoryRevRows, cancellationSummaryRow, cancellationSummaryRevRow,
    ] = await Promise.all([
      queryOne<{ agent_name: string; agent_physical_country: string | null; agent_postal_country: string | null }>(
        `SELECT agent_name, agent_physical_country, agent_postal_country FROM agents WHERE agent_id = ?`,
        [agentId]
      ),

      // Monthly revenue, current vs LY — mirrors AD.byMonth in dashboard/route.ts,
      // scoped to this one agent.
      // FIX (2026-07-07, revenue status-mixing audit): status IN ('20','30') -> status='30',
      // matching dashboard/route.ts's AD.byMonth fix.
      // FIX (2026-07-09, Tier 3): act/ly_val were r.total_amount (everything blended) — now a
      // rate_components-based Room/Extras split (new extras/extras_ly), no nights aggregate in
      // this query so no fan-out risk from the added join. Day Use merged in from a separate
      // by-month query below, in JS.
      query<{ m: number; mn: string; act: number; ly_val: number; extras: number; extras_ly: number }>(
        `SELECT MONTH(r.date_created) AS m, LEFT(MONTHNAME(r.date_created),3) AS mn,
          SUM(CASE WHEN ${dateInFullYear('r.date_created', cy)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS act,
          SUM(CASE WHEN ${dateInFullYear('r.date_created', ly)} AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS ly_val,
          SUM(CASE WHEN ${dateInFullYear('r.date_created', cy)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${dateInFullYear('r.date_created', ly)} AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)/1000 AS extras_ly
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND r.agent_id = ?
          AND ((${dateInFullYear('r.date_created', cy)}) OR (${dateInFullYear('r.date_created', ly)}))
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY MONTH(r.date_created), LEFT(MONTHNAME(r.date_created),3) ORDER BY m`,
        [KES_RATE, KES_RATE, KES_RATE, KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Extras-table revenue (Day Use, any category + confirmed-clean categories everywhere
      // else — see constants.ts EXTRAS_TABLE_REVENUE_CATEGORY_IDS), scoped to this agent, by
      // booking month — merged into monthlyRows' extras/extras_ly in JS.
      // FIX (2026-07-13, extras-table revenue): broadened beyond Day Use.
      query<{ m: number; extras: number; extras_ly: number }>(
        `SELECT MONTH(r.date_created) AS m,
          SUM(CASE WHEN ${dateInFullYear('r.date_created', cy)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras,
          SUM(CASE WHEN ${dateInFullYear('r.date_created', ly)} AND ${extrasTableRevenueCase('i', 'e')} THEN (CASE WHEN dt.currency='KES' THEN e.amount/? ELSE e.amount END) ELSE 0 END)/1000 AS extras_ly
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.agent_id = ? AND ((${dateInFullYear('r.date_created', cy)}) OR (${dateInFullYear('r.date_created', ly)}))
        GROUP BY MONTH(r.date_created)`,
        [KES_RATE, KES_RATE, agentId]
      ),

      // Property breakdown — mirrors AD.byProp (itinerary-level total_gross_amount,
      // grouped by property, no dedup needed), scoped to this one agent, current year.
      // FIX (2026-07-07, revenue status-mixing audit): rv was summed off the same outer WHERE
      // as `bookings` (COUNT DISTINCT), so it inherited status IN ('20','30'). `bookings` is a
      // booking-activity count (correctly IN ('20','30') per the active/pipeline convention)
      // and was left untouched; rv is now individually gated to status='30' via CASE, same
      // pattern used for cdRows above.
      // FIX (2026-07-08, Room Revenue / Extras split): rv was i.total_gross_amount (everything
      // blended) — now Room-Revenue-only, per constants.ts's per-property classification, with a
      // new `extras` column. Day Use revenue (ACL/Kilindi) merged in from the separate
      // dayUsePropRows query below, in JS — see dashboard/route.ts's AD.byProp for the same
      // pattern.
      query<{ pr: string; property_id: string; rv: number; extras: number; bookings: number }>(
        `SELECT COALESCE(p.name, i.property) AS pr, i.property AS property_id,
          SUM(CASE WHEN r.status='30' AND ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS rv,
          SUM(CASE WHEN r.status='30' AND NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS extras,
          COUNT(DISTINCT r.reservation_number) AS bookings
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN properties p ON i.property=p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status IN ('20','30') AND r.agent_id = ? AND ${dateInFullYear('r.date_created', cy)}
          AND i.property IS NOT NULL
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY i.property, COALESCE(p.name, i.property) ORDER BY rv DESC LIMIT 10`,
        [KES_RATE, KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Extras-table revenue (Day Use, any category + confirmed-clean categories everywhere
      // else), scoped to this agent — merged into propRows' extras in JS. See dashboard/
      // route.ts's AD.byProp query for the same pattern.
      // FIX (2026-07-13, extras-table revenue): broadened beyond Day Use.
      query<{ property_id: string; extras: number }>(
        `SELECT i.property AS property_id,
          ${extrasTableRevenueSumSql('i', 'e', 'dt')} AS extras
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.agent_id = ? AND ${dateInFullYear('r.date_created', cy)}
        GROUP BY i.property`,
        [KES_RATE, agentId]
      ),

      // Confirmed arrivals — status='30' only, arrival (i.date_in) within the next 30
      // days. Rolled up to one row per reservation_number + property (same room-split
      // idiom as the Daily tab's Confirmed Arrivals table) — a multi-room booking shows
      // as one row with a room count, not N rows. NOT using the prov_date-inclusive
      // widening from the Conversion Rate fix — that was for a ratio denominator, not
      // "which rows to display"; a currently-Confirmed booking's provisional history is
      // irrelevant to whether it belongs in this list.
      query<{
        rn: string; property: string; arrival_date: Date; value: number; room_count: number
      }>(
        `SELECT r.reservation_number AS rn,
          COALESCE(p.name, i.property) AS property,
          MIN(i.date_in) AS arrival_date,
          SUM(CASE WHEN dt.currency='KES' THEN IFNULL(i.total_gross_amount, r.total_amount)/? ELSE IFNULL(i.total_gross_amount, r.total_amount) END) AS value,
          COUNT(*) AS room_count
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        LEFT JOIN properties p ON i.property=p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND r.agent_id = ?
          AND i.date_in >= CURDATE() AND i.date_in <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY r.reservation_number, i.property, p.name
        ORDER BY arrival_date ASC
        LIMIT 20`,
        [KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Provisional bookings pending — status='20' only, stay not yet fully completed
      // (date_out >= today, same "not yet completed" basis the combined query used
      // before the split). provision_expiry_date is the confirmed real field for
      // Expiry (same one already proven reliable in the Daily tab).
      query<{
        rn: string; property: string; arrival_date: Date; expiry_date: Date | null
        days_to_expiry: number | null; value: number; room_count: number
      }>(
        `SELECT r.reservation_number AS rn,
          COALESCE(p.name, i.property) AS property,
          MIN(i.date_in) AS arrival_date,
          r.provision_expiry_date AS expiry_date,
          DATEDIFF(r.provision_expiry_date, CURDATE()) AS days_to_expiry,
          SUM(CASE WHEN dt.currency='KES' THEN IFNULL(i.total_gross_amount, r.total_amount)/? ELSE IFNULL(i.total_gross_amount, r.total_amount) END) AS value,
          COUNT(*) AS room_count
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        LEFT JOIN properties p ON i.property=p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='20' AND r.agent_id = ? AND i.date_out >= CURDATE()
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY r.reservation_number, i.property, p.name, r.provision_expiry_date
        ORDER BY arrival_date ASC
        LIMIT 20`,
        [KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Summary KPI pool — shared basis for Revenue YTD, Confirmed Bookings, Conversion
      // Rate, and Average Booking Value. i.date_in basis (not date_created), agent-scoped.
      // Revenue/Confirmed Bookings count status='30' only (per the app-wide "revenue =
      // confirmed only" rule) — unaffected by the note below.
      // FIX: Conversion Rate denominator was status IN ('20','30') only — this silently
      // EXCLUDED bookings that were held Provisional and later CANCELLED (status='90'),
      // undercounting the denominator and inflating the rate. Verified live against Qlik
      // for Asilia Africa Limited (WA54, 2026): old query gave 95%; Qlik's "Material %
      // (space held)" showed 24.4%. r.prov_date (set whenever a reservation entered
      // Provisional, regardless of what it became later) is non-null on 1,838 of WA54's
      // 1,900 cancelled 2026 reservations alone — recomputing with those included in the
      // denominator gives 25.9%, landing next to Qlik's figure. Denominator now:
      // status IN ('20','30') OR (status='90' AND prov_date IS NOT NULL) — i.e. currently
      // active/confirmed, OR cancelled-but-was-provisional-at-some-point. Cancelled
      // bookings that were NEVER provisional (no prov_date — e.g. cancelled straight from
      // a quote) are correctly still excluded, matching Faith's "held on provisional at
      // some point" wording precisely.
      // FIX (2026-07-08b, Room Revenue / Extras split, Tier 2): confirmed_rev was a
      // DISTINCT-then-SUM subquery over r.total_amount — that dedup existed only to avoid
      // double-counting total_amount across itinerary legs. counts (confirmed_ct/total_ct)
      // still need that reservation-level DISTINCT dedup (they're genuinely counting distinct
      // reservations across a WIDER population than just status='30'), so they stay in their
      // own subquery unchanged. Revenue is now a separate rate_components-based subquery,
      // scoped to status='30' directly (the only status this figure was ever computed for) —
      // no dedup needed, same reasoning as dashboard/route.ts's Agent Room Revenue restructure.
      queryOne<{ confirmed_ct: number; total_ct: number; confirmed_rev: number; extras_rev: number; day_use_extras: number }>(
        `SELECT counts.confirmed_ct, counts.total_ct, rev.confirmed_rev, rev.extras_rev, dayuse.day_use_extras
        FROM (
          SELECT
            COUNT(CASE WHEN status='30' THEN 1 END) AS confirmed_ct,
            COUNT(*) AS total_ct
          FROM (
            SELECT DISTINCT r.reservation_number, r.status
            FROM reservations r
            JOIN itineraries i ON r.reservation_number = i.reservation_number
            WHERE r.agent_id = ?
              AND (r.status IN ('20','30') OR (r.status='90' AND r.prov_date IS NOT NULL))
              AND ${dateInFullYear('i.date_in', cy)}
              AND r.rate_type NOT IN (?)
              AND r.reservation_number NOT LIKE ?
          ) deduped
        ) counts
        CROSS JOIN (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS confirmed_rev, ${EXTRAS_SUM_SQL} AS extras_rev
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.agent_id = ? AND r.status='30' AND ${dateInFullYear('i.date_in', cy)}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
        ) rev
        CROSS JOIN (
          SELECT SUM(CASE WHEN dt2.currency='KES' THEN e.amount/? ELSE e.amount END) AS day_use_extras
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.agent_id = ? AND r2.status='30' AND ${dateInFullYear('i2.date_in', cy)}
            AND ((i2.property='WB2909' AND i2.accommodation_type='WB17') OR (i2.property='RS8' AND i2.accommodation_type='WB22'))
        ) dayuse`,
        [
          agentId,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          KES_RATE,
          agentId,
          NON_REV_IDS,
          RES_PREFIX,
          KES_RATE,
          agentId
        ]
      ),

      // Same pool, prior year — real YoY basis for Revenue YTD only (the other 3
      // summary cards sharing this pool weren't asked to carry a YoY %).
      // FIX (2026-07-08b, Tier 2): same DISTINCT-dedup-removal restructure as above.
      queryOne<{ confirmed_rev: number; extras_rev: number; day_use_extras: number }>(
        `SELECT rev.confirmed_rev, rev.extras_rev, dayuse.day_use_extras
        FROM (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS confirmed_rev, ${EXTRAS_SUM_SQL} AS extras_rev
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.agent_id = ? AND r.status='30' AND ${dateInFullYear('i.date_in', ly)}
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
        ) rev
        CROSS JOIN (
          SELECT SUM(CASE WHEN dt2.currency='KES' THEN e.amount/? ELSE e.amount END) AS day_use_extras
          FROM itineraries i2
          JOIN reservations r2 ON i2.reservation_number = r2.reservation_number
          JOIN extras e ON e.reservation_number = i2.reservation_number AND e.internal_property = i2.property
          LEFT JOIN rate_types dt2 ON r2.rate_type = dt2.rate_type_id
          WHERE r2.agent_id = ? AND r2.status='30' AND ${dateInFullYear('i2.date_in', ly)}
            AND ((i2.property='WB2909' AND i2.accommodation_type='WB17') OR (i2.property='RS8' AND i2.accommodation_type='WB22'))
        ) dayuse`,
        [KES_RATE, KES_RATE, agentId, NON_REV_IDS, RES_PREFIX, KES_RATE, agentId]
      ),

      // Room Nights + ADR — mirrors dashboard/route.ts's kpiRevNights exactly (status='30'
      // only, i.date_in basis, i.date_out <= CURDATE() actualized-stays cutoff per
      // OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY in constants.ts), agent-scoped. Deliberately
      // NOT the date_created-based nights/ADR pattern also present in this codebase
      // (kpiAgentRev's `lg` subquery, used for the dashboard-level Portfolio ADR/Avg
      // Length of Stay cards) — matching "date_in basis" as instructed means this one.
      // FIX (2026-07-08, Room Revenue / Extras split): adr numerator was i.total_gross_amount
      // (everything blended) — now Room-Revenue-only, per hospitality convention. Nights kept in
      // its own subquery so joining rate_components for the numerator doesn't multiply nights by
      // component count per itinerary — same restructure as dashboard/route.ts's kpiRevNights.
      queryOne<{ total_nights: number; adr: number }>(
        `SELECT nights.total_nights, ROUND(rev.room_rev/GREATEST(nights.total_nights,1)) AS adr
        FROM (
          SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          WHERE r.agent_id = ? AND r.status='30' AND ${dateInFullYear('i.date_in', cy)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
        ) nights
        CROSS JOIN (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS room_rev
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.agent_id = ? AND r.status='30' AND ${dateInFullYear('i.date_in', cy)} AND i.date_out <= CURDATE() AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
        ) rev`,
        [agentId, NON_REV_IDS, RES_PREFIX, KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Header commission + Footer consultant — most recent reservation snapshot
      // (by date_created), same PA%/rate_type exclusions as everywhere else so a
      // placeholder record can't be picked as "the" current relationship snapshot.
      // consultant_first_name/consultant_last_name give a real name, not just the
      // WBxxxx code stored in `consultant`.
      queryOne<{
        rv_commission_perc: number | null
        consultant_first_name: string | null
        consultant_last_name: string | null
      }>(
        `SELECT rv_commission_perc, consultant_first_name, consultant_last_name
        FROM reservations
        WHERE agent_id = ? AND rate_type NOT IN (?) AND reservation_number NOT LIKE ?
          AND consultant IS NOT NULL AND consultant != ''
        ORDER BY date_created DESC
        LIMIT 1`,
        [agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Footer — first booking date + total bookings all-time. No status filter (the
      // relationship history includes quotes/cancellations, not just confirmed business
      // — Confirmed Bookings is already a separate KPI above), no year bound.
      queryOne<{ first_booking: Date | null; total_bookings: number }>(
        `SELECT MIN(date_created) AS first_booking, COUNT(*) AS total_bookings
        FROM reservations
        WHERE agent_id = ? AND rate_type NOT IN (?) AND reservation_number NOT LIKE ?`,
        [agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // True counts (no LIMIT) for the "+N more" indicators — same WHERE clauses as the
      // confirmedArrivalRows/provisionalRows queries above, minus the LIMIT/GROUP BY.
      queryOne<{ ct: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS ct
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='30' AND r.agent_id = ?
          AND i.date_in >= CURDATE() AND i.date_in <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?`,
        [agentId, NON_REV_IDS, RES_PREFIX]
      ),
      queryOne<{ ct: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS ct
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='20' AND r.agent_id = ? AND i.date_out >= CURDATE()
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?`,
        [agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Cancellation History (2026-07-14g, REVISED 2026-07-14h): ADDITIVE, feeds the new Agent
      // Performance drill-down panel. All-time (no window — this is a per-agent history view,
      // not a portfolio ranking, so a 30-day cutoff like the portfolio-wide Cancellation Drivers
      // table would show nothing for most agents). FIX (2026-07-14h): caught during Step 2
      // verification — without a confirmation_date filter, RS23 alone showed 10,263 "cancelled
      // bookings" / 48,465 "nights lost" all-time. Applying confirmation_date IS NOT NULL
      // (tonight's validated fix for the cancellation-RATE denominator, same root cause) drops
      // that to 223 bookings / 1,196 nights — a 97.8% reduction. The vast majority of status='90'
      // records were never genuinely confirmed bookings, just lapsed quotes/inquiries archived to
      // status 90 — counting them as "cancelled business lost" is the same error the 59.9%
      // cancellation rate had. Nights-only, no rate_components join here (avoids fan-out) — same
      // dedup idiom as confirmedArrivalRows/provisionalRows above (one row per
      // reservation+property; a multi-property cancelled booking shows as multiple rows).
      query<{ rn: string; property: string; arrival_date: Date; cancelled_date: Date | null; nights: number; room_count: number }>(
        `SELECT r.reservation_number AS rn,
          COALESCE(p.name, i.property) AS property,
          MIN(i.date_in) AS arrival_date,
          MAX(r.last_change_date) AS cancelled_date,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nights,
          COUNT(*) AS room_count
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        LEFT JOIN properties p ON i.property=p.property_id
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL AND r.agent_id = ?
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY r.reservation_number, i.property, p.name
        ORDER BY cancelled_date DESC
        LIMIT 20`,
        [agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Cancellation History's $ side — Room-Revenue-only, per reservation_number, merged into
      // the list above in JS (same split-query-then-merge pattern as the portfolio-wide
      // Cancellation Drivers table, for the same fan-out-avoidance reason).
      query<{ rn: string; room_rev: number }>(
        `SELECT r.reservation_number AS rn,
          SUM(CASE WHEN ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS room_rev
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL AND r.agent_id = ?
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?
        GROUP BY r.reservation_number`,
        [KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),

      // Cancellation History summary totals (all-time, no LIMIT) — feeds the "+N more" style
      // header stat on the drill-down panel, same reasoning as confirmedArrivalsCountRow above.
      queryOne<{ cancelled_ct: number; nights_lost: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS cancelled_ct,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nights_lost
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL AND r.agent_id = ?
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?`,
        [agentId, NON_REV_IDS, RES_PREFIX]
      ),
      queryOne<{ revenue_lost: number }>(
        `SELECT SUM(CASE WHEN ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END) AS revenue_lost
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='90' AND r.confirmation_date IS NOT NULL AND r.agent_id = ?
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?`,
        [KES_RATE, agentId, NON_REV_IDS, RES_PREFIX]
      ),
    ])

    if (!agentRow) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Header: country. agent_physical_country and agent_postal_country can genuinely
    // differ (confirmed live — e.g. one agent showed physical=South Africa, postal=
    // Mauritius). Using physical as the primary "where they're based" signal.
    const country = agentRow.agent_physical_country || agentRow.agent_postal_country || null

    // Header: commission. rv_commission_perc is real (never NULL) but is exactly 0.00
    // on 99.76% of ALL reservations app-wide (99,713 of 99,956, verified live) — so a
    // 0% here is far more likely "not used for this record" than a genuine zero
    // commission rate. Shown with an honest note when 0, not presented as a confident
    // fact. Non-zero values are mapped to a known tier name where they match exactly;
    // otherwise shown as a raw %.
    const COMMISSION_TIERS: Record<number, string> = { 35: 'PR', 30: 'SP', 40: 'MP', 20: 'ST', 15: 'RA', 25: 'CO' }
    const commPerc = n(snapshotRow?.rv_commission_perc)
    const commRounded = Math.round(commPerc)
    const tierName = COMMISSION_TIERS[commRounded]
    const commission = {
      label: tierName ? `${tierName} - ${commRounded}%` : `${commPerc.toFixed(0)}%`,
      note: commPerc === 0
        ? 'rv_commission_perc is 0% for 99.76% of all reservations app-wide — likely not populated for this relationship, not necessarily a real zero rate'
        : null,
    }

    // Footer: consultant (most recent, real name), first booking date, total bookings.
    const consultantName = snapshotRow?.consultant_first_name || snapshotRow?.consultant_last_name
      ? `${snapshotRow?.consultant_first_name ?? ''} ${snapshotRow?.consultant_last_name ?? ''}`.trim()
      : 'Unknown'
    const footer = {
      consultant: consultantName,
      firstBookingDate: historyRow?.first_booking ? fmtDateWithYear(historyRow.first_booking) : '—',
      totalBookingsAllTime: i(historyRow?.total_bookings),
    }

    const dayUsePropMap = new Map(dayUsePropRows.map((r) => [r.property_id, n(r.extras)]))
    const propertyBreakdown: AgentPropertyBreakdown[] = propRows.map((r) => ({
      property: r.pr ?? 'Unknown',
      revenue: Math.round(n(r.rv)),
      extras: Math.round(n(r.extras) + (dayUsePropMap.get(r.property_id) ?? 0)),
      bookings: i(r.bookings),
    }))

    const confirmedArrivals: AgentConfirmedArrival[] = confirmedArrivalRows.map((r) => ({
      reservationNumber: r.rn,
      property: r.property ?? 'Unknown',
      arrivalDate: fmtDate(r.arrival_date),
      roomCount: i(r.room_count),
      value: Math.round(n(r.value)),
    }))

    const provisionalBookings: AgentProvisionalBooking[] = provisionalRows.map((r) => ({
      reservationNumber: r.rn,
      property: r.property ?? 'Unknown',
      arrivalDate: fmtDate(r.arrival_date),
      expiryDate: r.expiry_date ? fmtDate(r.expiry_date) : '—',
      daysToExpiry: r.days_to_expiry === null ? null : i(r.days_to_expiry),
      roomCount: i(r.room_count),
      value: Math.round(n(r.value)),
    }))

    // Cancellation History (2026-07-14g) — ADDITIVE, feeds the new Agent Performance drill-down
    // panel. Room-Revenue-only $ merged in from a separate query (see cancellationHistoryRevRows'
    // comment above for why) via Map keyed by reservation_number, same pattern used throughout
    // this session for avoiding rate_components fan-out.
    const cancelRevByRes = new Map(cancellationHistoryRevRows.map((r) => [r.rn, n(r.room_rev)]))
    const cancellationHistory: AgentCancellationItem[] = cancellationHistoryRows.map((r) => ({
      reservationNumber: r.rn,
      property: r.property ?? 'Unknown',
      arrivalDate: fmtDate(r.arrival_date),
      cancelledDate: r.cancelled_date ? fmtDate(r.cancelled_date) : '—',
      nightsLost: i(r.nights),
      revenueLost: Math.round(cancelRevByRes.get(r.rn) ?? 0),
      roomCount: i(r.room_count),
    }))
    const cancellationSummary = {
      totalCancelledBookings: i(cancellationSummaryRow?.cancelled_ct),
      totalNightsLost: i(cancellationSummaryRow?.nights_lost),
      totalRevenueLost: Math.round(n(cancellationSummaryRevRow?.revenue_lost)),
    }

    const confirmedCt = i(poolRow?.confirmed_ct)
    const totalCt = i(poolRow?.total_ct)
    // Room Revenue / Extras split (2026-07-08b): confirmedRev is now Room-Revenue-only.
    // extrasRev is its sibling (rate_components Extras + Day Use). avgBookingValue keeps its
    // original meaning — average TOTAL value of a confirmed booking — so it uses Room+Extras
    // combined, not Room alone, unlike revenueYtd which is deliberately Room-only.
    const confirmedRev = n(poolRow?.confirmed_rev)
    const extrasRev = n(poolRow?.extras_rev) + n(poolRow?.day_use_extras)
    const summary: AgentSummaryKpis = {
      revenueYtd: Math.round(confirmedRev),
      revenueYtdLy: Math.round(n(poolLyRow?.confirmed_rev)),
      extrasYtd: Math.round(extrasRev),
      extrasYtdLy: Math.round(n(poolLyRow?.extras_rev) + n(poolLyRow?.day_use_extras)),
      confirmedBookings: confirmedCt,
      roomNights: i(nightsRow?.total_nights),
      adr: i(nightsRow?.adr),
      conversionRate: safePct(confirmedCt, totalCt),
      avgBookingValue: confirmedCt > 0 ? Math.round((confirmedRev + extrasRev) / confirmedCt) : 0,
    }

    // FIX (2026-07-13, Channel/Market Segment): real lookup against the segment mapping CSV
    // (src/lib/agentSegments.ts), by agent name. 'Unallocated' surfaces as-is when the CSV has
    // no row or a blank cell for this agent.
    const segment = lookupAgentSegment(agentRow.agent_name)

    const profile: AgentProfile = {
      agentId,
      agentName: agentRow.agent_name,
      year: cy,
      country,
      channel: segment.channel,
      marketSegment: segment.marketSegment,
      commission,
      footer,
      monthlyRevenue: (() => {
        const dayUseMap = new Map(dayUseMonthlyRows.map((r) => [r.m, r]))
        return {
          months: monthlyRows.map((r) => r.mn),
          act: monthlyRows.map((r) => Math.round(n(r.act) * 10) / 10),
          ly: monthlyRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
          extras: monthlyRows.map((r) => Math.round((n(r.extras) + n(dayUseMap.get(r.m)?.extras)) * 10) / 10),
          extrasLy: monthlyRows.map((r) => Math.round((n(r.extras_ly) + n(dayUseMap.get(r.m)?.extras_ly)) * 10) / 10),
        }
      })(),
      summary,
      propertyBreakdown,
      confirmedArrivals,
      confirmedArrivalsTotalCt: i(confirmedArrivalsCountRow?.ct),
      provisionalBookings,
      provisionalTotalCt: i(provisionalCountRow?.ct),
      cancellationHistory,
      cancellationSummary,
    }

    return NextResponse.json(profile)
  } catch (err) {
    console.error('[agent profile route]', err)
    return NextResponse.json({ error: 'Failed to load agent profile', detail: String(err) }, { status: 500 })
  }
}
