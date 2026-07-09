export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import type { MarketSegmentProfile, MarketSegmentPropertyBreakdown, MarketSegmentAgentBreakdown } from '@/types'
import {
  NON_REVENUE_RATE_TYPE_IDS,
  EXCLUDED_RESERVATION_PREFIX,
  EXCLUDED_AGENT_IDS,
  EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN,
  AGENT_NAME_PATTERN_CARVEOUT_SQL,
  KES_USD_RATE,
} from '@/lib/constants'
import { ROOM_REVENUE_SUM_SQL } from '@/lib/roomRevenue'
import { buildAgentFilterSql, MARKET_SEGMENT_VALUES } from '@/lib/agentSegments'

const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}
const i = (v: unknown, def = 0): number => Math.round(n(v, def))

// Market Segment Profile (2026-07-15) — opened only from Market Segment Performance. Per the
// context-aware drill-down standing instruction, this panel shows exactly Market Segment
// Performance's own KPI set (Room Revenue, Room Nights, ADR, YoY %, Active Agents) plus a
// Property breakdown and a Top-10 Agent breakdown (with a total count for the "+N more"
// indicator). Accepts year/period/channel query params, same contract as /api/dashboard, and
// applies the SAME i.date_in-basis month bounding — this is deliberately NOT hardcoded to the
// current year (unlike /api/property/[propertyId], which is fixed to full-year-2026 because of
// its Budget dependency): Market Segment Performance's own table respects the dashboard's
// year/period/channel filters, so this drill-down must use the exact same filters the table used,
// or the two would show contradictory numbers for the same segment.
export async function GET(
  req: NextRequest,
  { params }: { params: { segment: string } }
): Promise<NextResponse> {
  try {
    const segment = decodeURIComponent(params.segment)
    if (!(MARKET_SEGMENT_VALUES as readonly string[]).includes(segment)) {
      return NextResponse.json({ error: 'Unknown market segment' }, { status: 400 })
    }

    const today = new Date()
    const realCurrentYear = today.getFullYear()
    const yearParam = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10)
    const cy = Number.isFinite(yearParam) ? yearParam : realCurrentYear
    const isCurrentYear = cy === realCurrentYear
    const realCurrentMonth = today.getMonth() + 1
    const period = (req.nextUrl.searchParams.get('period') ?? 'y') as 'm' | 'y' | 'a'
    const monthLo = period === 'm' && isCurrentYear ? realCurrentMonth : 1
    const monthHi = period === 'a' ? 12 : isCurrentYear ? realCurrentMonth : 12
    const channel = req.nextUrl.searchParams.get('channel') ?? 'all'

    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX
    const KES_RATE = KES_USD_RATE
    const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
    const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
    const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN

    const segFilter = buildAgentFilterSql('a', channel, segment)
    const AND_SEG = segFilter ? ` AND ${segFilter}` : ''

    const AGENT_EXCLUSIONS = `
      AND r.agent_id NOT IN (?)
      AND a.agent_name NOT IN (?)
      AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
      AND r.rate_type NOT IN (?)
      AND r.reservation_number NOT LIKE ?`
    const AGENT_EXCLUSION_PARAMS = [EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE, NON_REV_IDS, RES_PREFIX]

    const [overviewRow, propertyRows, agentRows, agentTotalRow] = await Promise.all([
      // Overview — same shape as dashboard/route.ts's per-segment query, one segment, no LY side
      // (YoY needs a real prior-year query; ADDED below via a second small query, kept separate
      // for clarity since this route has no other use for a "both years in one query" pattern).
      queryOne<{ rv: number; nt: number; active_agents: number }>(
        `SELECT rv.rv, nt.nt, ag.active_agents
        FROM (
          SELECT ${ROOM_REVENUE_SUM_SQL} AS rv
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}
        ) rv
        CROSS JOIN (
          SELECT SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}
        ) nt
        CROSS JOIN (
          SELECT COUNT(DISTINCT r.agent_id) AS active_agents
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          WHERE r.status IN ('20','30') AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}
            AND r.total_amount > 0${AND_SEG}
        ) ag`,
        [
          KES_RATE, cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
          cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
          cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
        ]
      ),

      // Property breakdown — every property this segment's confirmed business touches (naturally
      // small, <=18 properties portfolio-wide, so no "top N" cap needed here unlike the agent
      // breakdown below).
      query<{ property_id: string; property_name: string; rv: number; nt: number }>(
        `SELECT rv.property_id, COALESCE(p.name, rv.property_id) AS property_name, rv.rv, nt.nt
        FROM (
          SELECT i.property AS property_id, ${ROOM_REVENUE_SUM_SQL} AS rv
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL AND i.property IS NOT NULL
            AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}
          GROUP BY i.property
        ) rv
        JOIN (
          SELECT i.property AS property_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL AND i.property IS NOT NULL
            AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}
          GROUP BY i.property
        ) nt ON rv.property_id = nt.property_id
        LEFT JOIN properties p ON rv.property_id = p.property_id
        ORDER BY rv.rv DESC`,
        [
          KES_RATE, cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
          cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
        ]
      ),

      // Agent breakdown — top 10 by Room Revenue. Same two-subquery join pattern as Property
      // Performance's Top Agents query (rv via a rate_components-joined subquery, nt via a
      // separate non-rate_components-joined subquery, avoiding the itinerary-join fan-out bug).
      query<{ agent_id: string; agent_name: string; rv: number; nt: number }>(
        `SELECT rv.agent_id, rv.agent_name, rv.rv, nt.nt
        FROM (
          SELECT r.agent_id, a.agent_name, ${ROOM_REVENUE_SUM_SQL} AS rv
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          JOIN agents a ON r.agent_id = a.agent_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL
            AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}
          GROUP BY r.agent_id, a.agent_name
        ) rv
        JOIN (
          SELECT r.agent_id, SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt
          FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          WHERE r.status = '30' AND r.agent_id IS NOT NULL
            AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}
          GROUP BY r.agent_id
        ) nt ON rv.agent_id = nt.agent_id
        ORDER BY rv.rv DESC LIMIT 10`,
        [
          KES_RATE, cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
          cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS,
        ]
      ),

      // Total distinct-agent count for this segment (same population as the agent breakdown's rv
      // subquery, unbounded) — feeds the "+N more" indicator, same pattern as Agent Profile's
      // Active Bookings tables.
      queryOne<{ total_ct: number }>(
        `SELECT COUNT(DISTINCT r.agent_id) AS total_ct
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status = '30' AND r.agent_id IS NOT NULL
          AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}`,
        [cy, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS]
      ),
    ])

    // YoY — separate small query, last year, same month window, same population.
    const lyRow = await queryOne<{ rv: number }>(
      `SELECT ${ROOM_REVENUE_SUM_SQL} AS rv
      FROM reservations r
      JOIN itineraries i ON r.reservation_number = i.reservation_number
      JOIN agents a ON r.agent_id = a.agent_id
      JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
      LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
      WHERE r.status = '30' AND r.agent_id IS NOT NULL AND YEAR(i.date_in)=? AND MONTH(i.date_in) BETWEEN ? AND ?${AGENT_EXCLUSIONS}${AND_SEG}`,
      [KES_RATE, cy - 1, monthLo, monthHi, ...AGENT_EXCLUSION_PARAMS]
    )

    const roomRevenue = Math.round(n(overviewRow?.rv))
    const roomNights = i(overviewRow?.nt)
    const adr = roomNights > 0 ? Math.round(roomRevenue / roomNights) : null
    const rvLy = n(lyRow?.rv)
    const yoyPct = rvLy > 0 ? Math.round(((roomRevenue - rvLy) / rvLy) * 1000) / 10 : null

    const propertyBreakdown: MarketSegmentPropertyBreakdown[] = propertyRows.map((r) => ({
      propertyId: r.property_id,
      propertyName: r.property_name,
      roomRevenue: Math.round(n(r.rv)),
      roomNights: i(r.nt),
    }))

    const agentBreakdown: MarketSegmentAgentBreakdown[] = agentRows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      roomRevenue: Math.round(n(r.rv)),
      roomNights: i(r.nt),
    }))

    const profile: MarketSegmentProfile = {
      segment,
      roomRevenue,
      roomNights,
      adr,
      yoyPct,
      activeAgents: i(overviewRow?.active_agents),
      propertyBreakdown,
      agentBreakdown,
      agentBreakdownTotalCount: i(agentTotalRow?.total_ct),
    }

    return NextResponse.json(profile)
  } catch (err) {
    console.error('Market Segment Profile error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
