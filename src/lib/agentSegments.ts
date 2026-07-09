// Agent Channel / Market Segment lookup — generated from Faith's segment mapping CSV
// ("Market Segment and Source Codes - EC AGENT SOURCE CODE.csv"), confirmed 13 July 2026:
// - Market Segment classification uses the CSV's "New Market Segment" column (INT. AGENT, DMC,
//   DMC (International Presence), INT. DIRECT, LOCAL DIRECT, CLOSED USER GROUPS, DIGITAL,
//   STAFF STAYS), NOT the more verbose "Market Segment" column.
// - Channel classification uses the CSV's "Channel" column (B2B / B2C / NON REVENUE SEGMENTS).
// - Blank cells in either column are mapped to the literal string 'Unallocated' at generation
//   time (see the generator script) — this is a real, known gap in Faith's classification
//   (~30% of agents also have Commission Level = Unallocated), not a data error. 'Unallocated'
//   is a first-class value here, never hidden or defaulted to something else.
//
// src/data/agentSegments.json is a static, checked-in snapshot (3,703 entries, one per CSV row,
// zero parse failures with a proper quote-aware CSV parser — the naive comma-split used during
// earlier ad-hoc investigation had missed some malformed rows). Keyed by lowercased, trimmed
// agent name, since the CSV has no agent_id column — ResRequest's `agents.agent_name` is the only
// join key available. Re-generate by re-running the parser against a refreshed CSV export.
import segmentsData from '@/data/agentSegments.json'

export interface AgentSegment {
  agentName: string
  marketSegment: string
  channel: string
}

const segments = segmentsData as Record<string, AgentSegment>

export const UNALLOCATED = 'Unallocated'

// Case-insensitive, trimmed lookup by agent name. Returns Unallocated/Unallocated for any name
// not present in the CSV (e.g. a genuinely new agent Faith hasn't classified yet) — same
// "don't hide, don't guess" treatment as an explicit Unallocated row in the CSV itself.
export function lookupAgentSegment(agentName: string | null | undefined): AgentSegment {
  const key = (agentName ?? '').trim().toLowerCase()
  return segments[key] ?? { agentName: agentName ?? '', marketSegment: UNALLOCATED, channel: UNALLOCATED }
}

export const MARKET_SEGMENT_VALUES = [
  'INT. AGENT',
  'DMC',
  'DMC (International Presence)',
  'INT. DIRECT',
  'LOCAL DIRECT',
  'CLOSED USER GROUPS',
  'DIGITAL',
  'STAFF STAYS',
  UNALLOCATED,
] as const

export const CHANNEL_VALUES = ['B2B', 'B2C', 'NON REVENUE SEGMENTS', UNALLOCATED] as const

const sqlList = (vals: readonly string[]): string =>
  vals.length > 0 ? vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(',') : `''`

const allEntries: AgentSegment[] = Object.values(segments)

// Boolean SQL condition for ONE field (channel or marketSegment) against ONE selected value.
// 'all' => no condition (null). A real value (e.g. 'B2B', 'DMC') => IN (names classified as that
// value). 'Unallocated' => NOT IN (every name that IS explicitly classified for this field) —
// this is the key trick: it correctly matches BOTH agents with an explicit blank cell in the CSV
// AND agents entirely absent from the CSV (same lookupAgentSegment fallback used for display),
// without needing to enumerate live agent_ids we don't have in this static file. Internal,
// generated data only (never user input) — safe to inline as SQL literals, same reasoning as
// AGENT_NAME_PATTERN_CARVEOUT_SQL and the sqlList() helpers in roomRevenue.ts.
function fieldCondition(alias: string, field: 'channel' | 'marketSegment', value: string): string | null {
  if (value === 'all') return null
  if (value === UNALLOCATED) {
    const classifiedNames = allEntries.filter((s) => s[field] !== UNALLOCATED).map((s) => s.agentName)
    return `${alias}.agent_name NOT IN (${sqlList(classifiedNames)})`
  }
  const matchingNames = allEntries.filter((s) => s[field] === value).map((s) => s.agentName)
  return `${alias}.agent_name IN (${sqlList(matchingNames)})`
}

// Combined Channel + Market Segment filter as a single AND'd SQL boolean fragment, or null when
// both are 'all' (no filtering needed — callers should skip adding this to WHERE entirely in
// that case, not append "AND (null)"). `alias` must be the agents-table alias already joined in
// the caller's query (e.g. 'a', 'a2').
export function buildAgentFilterSql(alias: string, channel: string, market: string): string | null {
  const conditions = [fieldCondition(alias, 'channel', channel), fieldCondition(alias, 'marketSegment', market)].filter(
    (c): c is string => c !== null
  )
  return conditions.length > 0 ? conditions.join(' AND ') : null
}
