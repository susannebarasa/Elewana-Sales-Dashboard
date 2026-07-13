export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import type { AgentSearchResult } from '@/types'
import {
  NON_REVENUE_RATE_TYPE_IDS,
  EXCLUDED_AGENT_IDS,
  EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN,
  AGENT_NAME_PATTERN_CARVEOUT_SQL,
  EXCLUDED_RESERVATION_PREFIX,
  KES_USD_RATE,
  PROPERTY_ROOM_COUNTS,
} from '@/lib/constants'
import { ROOM_REVENUE_SUM_SQL } from '@/lib/roomRevenue'
import { buildAgentFilterSql } from '@/lib/agentSegments'
import { dateInYearMonthRange } from '@/lib/dateRange'

// ── route ────────────────────────────────────────────────────────────────────
// "Find Agent" default suggestions — Topbar-global, NOT view-scoped (2026-07-10 fix). Was
// previously read off data.AD.yearly, which only exists when the Trade Partners view's dashboard
// batch has been fetched — so the dropdown showed "No data for this period" on every other tab
// until the user happened to visit Trade Partners first. Find Agent lives in the Topbar on every
// view, so its data can't depend on which view-scoped batch last ran.
// This is a deliberately trimmed copy of dashboard/route.ts's `agRows` query — same revenue
// definition (Room Revenue only, status='30', same exclusions), same top-12-by-revenue ordering,
// but WITHOUT agRows' nights/ADR sub-joins (nt/adr/r_adr) since the dropdown only needs id+name.
// Single join chain (reservations→itineraries→rate_components), same cost class as the cheapest
// part of agRows — not the full 3-way-joined query, so safe to fetch on every page load without
// reintroducing the DB contention the view-scoped batching was built to avoid.

const VALID_PROPERTY_IDS = new Set(
  Object.values(PROPERTY_ROOM_COUNTS).map((p) => p.propertyId).filter((id): id is string => id !== null)
)

// Short TTL, same rationale as dashboard/route.ts's cache — repeat loads with the same filters
// (the overwhelmingly common case) become a DB-free hit instead of re-running this on every nav.
const TOP_AGENTS_CACHE_TTL_MS = 5 * 60 * 1000
const topAgentsCache = new Map<string, { results: AgentSearchResult[]; cachedAt: number }>()

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
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
    const market = req.nextUrl.searchParams.get('market') ?? 'all'
    const propertyParam = req.nextUrl.searchParams.get('property') ?? 'all'
    const property = propertyParam !== 'all' && VALID_PROPERTY_IDS.has(propertyParam) ? propertyParam : 'all'

    const cacheKey = `${cy}|${period}|${channel}|${market}|${property}`
    const cached = topAgentsCache.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < TOP_AGENTS_CACHE_TTL_MS) {
      return NextResponse.json({ results: cached.results })
    }

    const propertyEscaped = property.replace(/'/g, "''")
    const AND_P = property !== 'all' ? ` AND i.property = '${propertyEscaped}'` : ''
    const agentFilterA = buildAgentFilterSql('a', channel, market)
    const AND_A = agentFilterA ? ` AND ${agentFilterA}` : ''

    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
    const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
    const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
    const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX
    const KES_RATE = KES_USD_RATE

    const rows = await query<{ ag_id: string; nm: string }>(
      `SELECT rv.agent_id AS ag_id, a.agent_name AS nm
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
      JOIN agents a ON rv.agent_id = a.agent_id
      WHERE a.agent_name NOT IN (?)
        AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))${AND_A}
      ORDER BY rv_raw DESC
      LIMIT 12`,
      [KES_RATE, EX_AGENT_IDS, NON_REV_IDS, RES_PREFIX, EX_AGENT_NAMES, AGENT_NAME_LIKE]
    )

    const results: AgentSearchResult[] = rows.map((r) => ({ id: r.ag_id, name: r.nm }))
    topAgentsCache.set(cacheKey, { results, cachedAt: Date.now() })
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[agents/top route]', err)
    return NextResponse.json({ error: 'Failed to load top agents', detail: String(err) }, { status: 500 })
  }
}
