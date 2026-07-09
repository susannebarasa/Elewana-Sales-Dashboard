export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { dateInFullYear } from '@/lib/dateRange'
import type { PropertyProfile, PropertyTopAgent } from '@/types'
import {
  NON_REVENUE_RATE_TYPE_IDS,
  EXCLUDED_RESERVATION_PREFIX,
  EXCLUDED_AGENT_IDS,
  EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN,
  AGENT_NAME_PATTERN_CARVEOUT_SQL,
  KES_USD_RATE,
  PROPERTY_ROOM_COUNTS,
  PROPERTY_REVPAR_CAVEATS,
  KENYA_PROPERTY_IDS,
  TANZANIA_MAINLAND_PROPERTY_IDS,
  SERENGETI_EXPLORER_STYLE_PROPERTY_IDS,
} from '@/lib/constants'
import { ROOM_REVENUE_SUM_SQL, EXTRAS_SUM_SQL, extrasTableRevenueSumSql } from '@/lib/roomRevenue'
import { getPropertyBudget } from '@/lib/budget'

const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}

// Same classification as dashboard/route.ts's PROPERTY_PERFORMANCE — LEPC has no propertyId so it
// never reaches this route (nothing to click), but kept consistent in case that changes.
function countryForProperty(propertyId: string, propertyName: string): string {
  const kenyaIds = KENYA_PROPERTY_IDS as readonly string[]
  const tzIds = TANZANIA_MAINLAND_PROPERTY_IDS as readonly string[]
  const sxrStyleIds = SERENGETI_EXPLORER_STYLE_PROPERTY_IDS as readonly string[]
  if (kenyaIds.includes(propertyId)) return 'Kenya'
  if (tzIds.includes(propertyId) || sxrStyleIds.includes(propertyId)) return 'Tanzania'
  if (propertyName === 'Little Elephant Pepper Camp') return 'Kenya'
  return 'Unknown'
}

// Property Profile Panel (2026-07-15) — opened only from Property Performance today. Per the
// context-aware drill-down standing instruction, this panel shows exactly Property Performance's
// own KPI set (Room Revenue, Extras Revenue, RevPAR, Occupancy %, ADR, Room Nights Sold, Budget
// Variance %) plus Top Agents contributing to this property — deliberately tight, no monthly
// trend chart, no arrivals/cancellation history (that richer shape belongs to Agent Profile /
// Agent Performance's own drill-downs, not this one). Same full-year-2026-fixed basis as
// dashboard/route.ts's PROPERTY_PERFORMANCE so the table and the panel never disagree.
export async function GET(
  req: NextRequest,
  { params }: { params: { propertyId: string } }
): Promise<NextResponse> {
  try {
    const propertyId = params.propertyId

    const entry = Object.entries(PROPERTY_ROOM_COUNTS).find(([, cap]) => cap.propertyId === propertyId)
    if (!entry) {
      return NextResponse.json({ error: 'Unknown property' }, { status: 404 })
    }
    const [propertyName, cap] = entry

    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX
    const KES_RATE = KES_USD_RATE
    const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
    const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
    const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN

    const [roomRevRow, extrasRow, dayUseExtrasRow, nightsRow, topAgentRows] = await Promise.all([
      // Room Revenue — same basis as dashboard/route.ts's budgetActualByPropRows, one property.
      queryOne<{ rev: number }>(
        `SELECT ${ROOM_REVENUE_SUM_SQL} AS rev
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND i.property = ? AND ${dateInFullYear('i.date_in', 2026)} AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?`,
        [KES_RATE, propertyId, NON_REV_IDS, RES_PREFIX]
      ),

      // Extras Revenue (rate_components-based) — same basis as dashboard/route.ts's extrasByPropRows.
      queryOne<{ extras: number }>(
        `SELECT ${EXTRAS_SUM_SQL} AS extras
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = '30' AND i.property = ? AND ${dateInFullYear('i.date_in', 2026)} AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?)
          AND r.reservation_number NOT LIKE ?`,
        [KES_RATE, propertyId, NON_REV_IDS, RES_PREFIX]
      ),

      // Day Use / extras-table revenue — same basis as dashboard/route.ts's dayUseExtrasByPropRows.
      queryOne<{ extras: number }>(
        `SELECT ${extrasTableRevenueSumSql('i', 'e', 'dt')} AS extras
        FROM itineraries i
        JOIN reservations r ON i.reservation_number = r.reservation_number
        JOIN extras e ON e.reservation_number = i.reservation_number AND e.internal_property = i.property
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status='30' AND i.property = ? AND ${dateInFullYear('i.date_in', 2026)}`,
        [KES_RATE, propertyId]
      ),

      // Sold Nights — nights-only, no rate_components join (avoids the fan-out bug where joining
      // rate_components multiplies nights by however many revenue components each leg has), same
      // basis as dashboard/route.ts's revparNightsRows.
      queryOne<{ sold_nights: number }>(
        `SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS sold_nights
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status = '30' AND i.property = ? AND ${dateInFullYear('i.date_in', 2026)} AND i.date_out > i.date_in
          AND r.rate_type NOT IN (?) AND r.reservation_number NOT LIKE ?`,
        [propertyId, NON_REV_IDS, RES_PREFIX]
      ),

      // Top Agents contributing to this property (2026-07-15) — the inverse of Agent Profile's
      // propertyBreakdown (agent -> their properties): here, property -> its top agents. Applies
      // the same junk/test/Direct-Booking exclusions as dashboard/route.ts's Top Trade Partners
      // table, since this is a ranking across MANY agents (unlike agent/[agentId]/route.ts, which
      // skips that filter because its one agent was already selected upstream). Two-subquery join
      // (rv via a rate_components-joined subquery, nt via a separate non-rate_components-joined
      // subquery) avoids the same itinerary-join fan-out bug noted above.
      query<{ agent_id: string; agent_name: string; rv: number; nt: number }>(
        `SELECT rv.agent_id, rv.agent_name, rv.rv, nt.nt
        FROM (
          SELECT r.agent_id, a.agent_name, ${ROOM_REVENUE_SUM_SQL} AS rv
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          JOIN agents a ON r.agent_id = a.agent_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND i.property = ? AND ${dateInFullYear('i.date_in', 2026)}
            AND r.agent_id NOT IN (?)
            AND a.agent_name NOT IN (?)
            AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
          GROUP BY r.agent_id, a.agent_name
        ) rv
        JOIN (
          SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          WHERE r.status = '30' AND i.property = ? AND ${dateInFullYear('i.date_in', 2026)}
            AND r.agent_id NOT IN (?)
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
          GROUP BY r.agent_id
        ) nt ON rv.agent_id = nt.agent_id
        ORDER BY rv.rv DESC LIMIT 10`,
        [
          KES_RATE,
          propertyId,
          EX_AGENT_IDS,
          EX_AGENT_NAMES,
          AGENT_NAME_LIKE,
          NON_REV_IDS,
          RES_PREFIX,
          propertyId,
          EX_AGENT_IDS,
          NON_REV_IDS,
          RES_PREFIX
        ]
      ),
    ])

    const roomRevenue = n(roomRevRow?.rev)
    const extrasRevenue = Math.round(n(extrasRow?.extras) + n(dayUseExtrasRow?.extras))
    const soldNights = n(nightsRow?.sold_nights)
    const availableNights = cap.roomnightsAvailable
    const revpar = availableNights > 0 ? Math.round((roomRevenue / availableNights) * 100) / 100 : null
    const adr = soldNights > 0 ? Math.round(roomRevenue / soldNights) : null
    const occPct = availableNights > 0 ? Math.round((soldNights / availableNights) * 1000) / 10 : null

    const budget = getPropertyBudget(propertyId, 2026, 1, 12)
    const budgetVariancePct = budget.rev > 0 ? Math.round((roomRevenue / budget.rev) * 1000) / 10 : null

    const topAgents: PropertyTopAgent[] = topAgentRows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      roomRevenue: Math.round(n(r.rv)),
      roomNights: n(r.nt),
      pctOfPropertyTotal: roomRevenue > 0 ? Math.round((n(r.rv) / roomRevenue) * 1000) / 10 : 0,
    }))

    const profile: PropertyProfile = {
      propertyId,
      propertyName,
      country: countryForProperty(propertyId, propertyName),
      keys: cap.keys,
      roomRevenue: Math.round(roomRevenue),
      extrasRevenue,
      revpar,
      occPct,
      adr,
      soldNights,
      budgetVariancePct,
      caveat: PROPERTY_REVPAR_CAVEATS[propertyId] ?? null,
      topAgents,
    }

    return NextResponse.json(profile)
  } catch (err) {
    console.error('Property Profile error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
