export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import type { AgentSearchResult } from '@/types'
import {
  EXCLUDED_AGENT_IDS,
  EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN,
  AGENT_NAME_PATTERN_CARVEOUT_SQL,
} from '@/lib/constants'

// ── route ────────────────────────────────────────────────────────────────────
// "Find Agent" search — Trade Partners tab only. Excludes the same test/placeholder/
// direct-booking agents excluded everywhere else in the app (constants.ts), so search
// results only ever surface real trade partners.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
    const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
    const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN

    const rows = await query<{ agent_id: string; agent_name: string }>(
      `SELECT agent_id, agent_name
      FROM agents
      WHERE agent_name LIKE ?
        AND agent_id NOT IN (?)
        AND agent_name NOT IN (?)
        AND (LOWER(agent_name) NOT LIKE ? OR agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))
      ORDER BY agent_name ASC
      LIMIT 20`,
      [`%${q}%`, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE]
    )

    const results: AgentSearchResult[] = rows.map((r) => ({ id: r.agent_id, name: r.agent_name }))
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[agents/search route]', err)
    return NextResponse.json({ error: 'Failed to search agents', detail: String(err) }, { status: 500 })
  }
}
