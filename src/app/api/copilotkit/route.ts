export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { pool } from '@/lib/db'
import { runSafeQuery, assertReadOnlySelect, assertTablesAllowed, UnsafeQueryError, QueryTimeoutError } from '@/lib/aiQuery/sqlSafety'
import {
  buildTotalRoomRevenue, buildTotalExtrasRevenue, buildRoomNightsSold, buildRevenueByProperty,
  buildOccupancyAdrRevpar, buildAgentAdr, buildSegmentOrChannelQuery, availableNightsFor, resolvePropertyName,
  resolveAgentName, propertyNameById, SEGMENT_VALUES, CHANNEL_VALUES_LIST, buildNightsByProperty,
  occupancyPctByProperty, type DateBasis,
} from '@/lib/aiQuery/templates'
import { assembleDiagnoseChangeBundle, buildDiagnoseChangeSystemPrompt } from '@/lib/aiQuery/diagnoseChange'

// 2026-07-17 rewrite — see METRICS.md and the investigation that prompted this: the previous
// version handed Claude Haiku a bare table description and executed whatever free-form SQL it
// wrote with zero validation. Verified live: "What is the total revenue for this year?" returned
// $107M against a correct figure of ~$17-20.6M, because the generated query summed unfiltered
// reservations.total_amount by date_created (booking date, not stay date) — no status filter beyond
// a correct '30', no currency conversion, no PA%/rate-type exclusions.
//
// New architecture: Claude picks WHICH pre-built, already-audited query template answers the
// question (a forced tool call, never free SQL) — see templates.ts for what each one encodes.
// Free-form SQL only exists as a last-resort fallback tool, and that path is validated by
// sqlSafety.ts (read-only + table allowlist) and time-boxed — see that file for exactly what it
// does and doesn't guarantee.

const QUERY_TIMEOUT_MS = 10_000
// Recent-history window for the template-selection call — enough for "and last year?" / "what
// about Arusha?" follow-ups to resolve against the prior turn, without ballooning the prompt.
const HISTORY_WINDOW = 6

interface ChatMessage { role: string; content: string }
interface AiQueryContext {
  view?: string
  filters?: { year?: string; period?: string; property?: string }
  kpBase?: { revM: number | null; occPct: number | null; adr: number | null; revpar: number | null; nights: number | null } | null
}

const dateBasisEnum = { type: 'string' as const, enum: ['actualized', 'ytd', 'otb'] as const, description: "'actualized' = only stays that have already completed. 'ytd' = all confirmed bookings from Jan 1 through today (\"how are we doing so far this year\") — use this as the DEFAULT for a plain, unqualified question like \"what's our revenue this year\". 'otb' = the ENTIRE calendar year including bookings for stays later in the year that haven't happened yet — only use this when the question clearly asks about the whole/full year, not just \"this year\" casually." }
const yearParam = { type: 'integer' as const, description: 'Calendar year, e.g. 2026. Default to the current year if unspecified.' }
const propertyParam = { type: 'string' as const, description: 'Property name as mentioned by the user, if any (e.g. "Arusha Coffee Lodge", "Tortilis"). Omit for portfolio-wide.' }
const agentParam = { type: 'string' as const, description: 'Agent/trade-partner name as mentioned by the user, if any (e.g. "Asilia", "Cheli & Peacock"). Omit for portfolio-wide. Mutually exclusive with propertyName in practice — a question is either about one property or one agent, not both.' }
const limitParam = { type: 'integer' as const, description: 'How many rows to return, default 5.' }

const TOOLS: Tool[] = [
  {
    name: 'total_room_revenue',
    description: 'Total Room Revenue (never includes Extras) for a year, optionally one property OR one agent/trade partner (e.g. "Asilia\'s Room Revenue").',
    input_schema: { type: 'object', properties: { year: yearParam, dateBasis: dateBasisEnum, propertyName: propertyParam, agentName: agentParam }, required: ['year', 'dateBasis'] },
  },
  {
    name: 'total_extras_revenue',
    description: 'Total Extras Revenue (ancillary — F&B, activities, transfers; never Room Revenue) for a year, optionally one property OR one agent/trade partner (e.g. "Asilia\'s Extras Revenue").',
    input_schema: { type: 'object', properties: { year: yearParam, dateBasis: dateBasisEnum, propertyName: propertyParam, agentName: agentParam }, required: ['year', 'dateBasis'] },
  },
  {
    name: 'room_nights_sold',
    description: 'Total confirmed room nights sold for a year, optionally one property.',
    input_schema: { type: 'object', properties: { year: yearParam, dateBasis: dateBasisEnum, propertyName: propertyParam }, required: ['year', 'dateBasis'] },
  },
  {
    name: 'occupancy_adr_revpar',
    description: 'Occupancy %, ADR, and/or RevPAR — always full-year 2026 on this dashboard regardless of what year is asked (capacity has no other year to compare against). Portfolio-wide, one property, OR one agent/trade partner (e.g. "Asilia\'s ADR") — an agent-scoped question only ever returns ADR, never Occupancy %/RevPAR (those need a per-property capacity figure that has no per-agent equivalent).',
    input_schema: { type: 'object', properties: { propertyName: propertyParam, agentName: agentParam } , required: [] },
  },
  {
    name: 'yoy_growth',
    description: 'Year-on-year Room Revenue growth: this year vs the prior year, on-the-books basis.',
    input_schema: { type: 'object', properties: { year: yearParam, propertyName: propertyParam }, required: ['year'] },
  },
  {
    name: 'revenue_by_property',
    description: 'Room Revenue broken out by property, ranked highest first — e.g. "which property has the highest revenue".',
    input_schema: { type: 'object', properties: { year: yearParam, dateBasis: dateBasisEnum, limit: limitParam }, required: ['year', 'dateBasis'] },
  },
  {
    name: 'occupancy_by_property',
    description: 'Occupancy % broken out by property, ranked highest first — e.g. "which property has the highest occupancy". Always full-year 2026.',
    input_schema: { type: 'object', properties: { limit: limitParam }, required: [] },
  },
  {
    name: 'revenue_by_segment',
    description: 'Room Revenue broken out by Market Segment (DMC, INT. Agent, Digital, etc.), ranked highest first — e.g. "which market segment books the most".',
    input_schema: { type: 'object', properties: { year: yearParam, limit: limitParam }, required: ['year'] },
  },
  {
    name: 'revenue_by_channel',
    description: 'Room Revenue broken out by Channel (B2B, B2C, Non Revenue Segments), ranked highest first.',
    input_schema: { type: 'object', properties: { year: yearParam, limit: limitParam }, required: ['year'] },
  },
  {
    name: 'diagnose_change',
    description: 'Explain WHY Room Revenue, Occupancy %, or ADR changed — not just report the number, but rank the real, biggest contributors (property/segment/agent/cancellations for revenue; property/nights-trend/agent for occupancy; property/segment ADR-and-mix-shift/agent for ADR). Use this for "why" questions, e.g. "why is revenue down", "why is occupancy down at Arusha", "why is ADR down". Supports revenue, occupancy, and ADR metrics only — for anything else (bookings, etc.) use cannot_answer.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'occupancy', 'adr'], description: "Which metric the 'why' question is about." },
        year: yearParam,
        propertyName: propertyParam,
      },
      required: ['metric', 'year'],
    },
  },
  {
    name: 'fallback_query',
    description: `LAST RESORT only, when none of the other tools can answer the question. Write a single read-only MySQL SELECT. Real columns (using the wrong name is the most common failure here — stick to exactly these):
- reservations(reservation_number, status ['30'=Confirmed,'20'=Provisional,'90'=Cancelled], agent_id, rate_type, date_created, total_amount)
- itineraries(itinerary_id, reservation_number, property, date_in, date_out, total_gross_amount)
- agents(agent_id, agent_name)
- properties(property_id, name)
- rate_components(itinerary_id, component_description, amount_gross)
- rate_types(rate_type_id, currency)
Join itineraries.reservation_number = reservations.reservation_number, itineraries.property = properties.property_id, reservations.agent_id = agents.agent_id, reservations.rate_type = rate_types.rate_type_id, rate_components.itinerary_id = itineraries.itinerary_id. Nights = DATEDIFF(date_out, date_in). Keep it simple, return at most 20 rows.`,
    input_schema: { type: 'object', properties: { sql: { type: 'string' }, explanation: { type: 'string', description: 'One sentence on what this query computes.' } }, required: ['sql', 'explanation'] },
  },
  {
    name: 'cannot_answer',
    description: 'The question genuinely cannot be answered by this tool (out of scope, e.g. asks to compare against MIS/RECON figures, or needs data this app does not track).',
    input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
]

const TEMPLATE_SYSTEM_PROMPT = `You are a BI assistant for Elewana Collection, a luxury safari and lodge company, helping staff query a live sales dashboard in plain English.

You do not write SQL yourself for known metrics — you select the ONE tool that answers the user's question and extract its parameters. Business rules that matter for picking parameters correctly:
- Room Revenue and Extras Revenue are always reported separately, never summed together.
- "This year" with no other qualifier means the current calendar year (${new Date().getFullYear()}).
- Date basis: default to 'ytd' for a plain "this year" question. Use 'actualized' only if the question specifically means completed/past stays. Use 'otb' only if the question clearly means the whole/full year, including future bookings.
- Occupancy %/ADR/RevPAR are always full-year 2026 on this dashboard regardless of what's asked — use occupancy_adr_revpar and let its own caveat explain this.
- total_room_revenue, total_extras_revenue, and occupancy_adr_revpar all accept EITHER propertyName OR agentName (not both) — if the question names a trade partner/agent (e.g. "Asilia's Extras Revenue", "Cheli & Peacock's ADR"), pass it as agentName, not propertyName. An agent-scoped occupancy_adr_revpar question only ever gets ADR back (no Occupancy %/RevPAR at agent level) — that's expected, not a failure.
- Use conversation history to resolve "that", "it", "the same property", etc. from the prior turn.
- For a "why" question about revenue, occupancy, OR ADR (e.g. "why is revenue down", "why is occupancy down", "why is Arusha's occupancy down", "why is ADR down") — use diagnose_change with the matching metric, not total_room_revenue/yoy_growth/occupancy_adr_revpar. Those only report the number; diagnose_change explains what drove it. diagnose_change only supports metric='revenue', 'occupancy', or 'adr' — if asked "why" about bookings or anything else, use cannot_answer instead of forcing diagnose_change onto a metric it doesn't support.
- Only use fallback_query if truly nothing else fits — most real questions map to one of the named tools.
- Use cannot_answer for anything genuinely out of scope (e.g. comparing against an external MIS/finance system).`

function toAnthropicMessages(history: ChatMessage[]): Anthropic.MessageParam[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}

function fmtDollar(v: number | null): string {
  if (v === null || Number.isNaN(v)) return 'unavailable'
  return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`
}

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const body = await req.json() as { messages: ChatMessage[]; context?: AiQueryContext }
    const messages = body.messages ?? []
    const context = body.context

    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'user') {
      return NextResponse.json({ reply: 'No question received.' })
    }
    const question = lastMessage.content
    const recentHistory = toAnthropicMessages(messages.slice(-HISTORY_WINDOW))

    // Step 1: Claude picks a template (or fallback/cannot-answer) — never writes SQL for a known metric.
    const toolResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: TEMPLATE_SYSTEM_PROMPT,
      messages: recentHistory,
      tools: TOOLS,
      tool_choice: { type: 'any' },
    })
    const toolUse = toolResponse.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (!toolUse) {
      return NextResponse.json({ reply: "I couldn't work out how to answer that — could you rephrase?" })
    }
    const input = toolUse.input as Record<string, unknown>

    if (toolUse.name === 'cannot_answer') {
      return NextResponse.json({ reply: String(input.reason ?? "I can't answer that from this dashboard's data.") })
    }

    let resultSummary: string
    let caveat = ''

    if (toolUse.name === 'fallback_query') {
      const sql = String(input.sql ?? '')
      try {
        assertReadOnlySelect(sql)
        assertTablesAllowed(sql)
        const rows = await runSafeQuery(pool, sql, [], QUERY_TIMEOUT_MS)
        resultSummary = JSON.stringify(rows).slice(0, 4000)
        caveat = 'Computed with a generated one-off query, not a pre-validated metric — treat with a bit more caution than the dashboard\'s own figures.'
      } catch (err) {
        if (err instanceof QueryTimeoutError) {
          return NextResponse.json({ reply: 'That would take too long to compute live right now — try narrowing it to one property or one year, or check the relevant tab on the dashboard directly.' })
        }
        if (err instanceof UnsafeQueryError) {
          console.error('[copilotkit] blocked unsafe fallback query', err.message, sql)
          return NextResponse.json({ reply: "I can't run that query — could you ask about revenue, occupancy, ADR, or a similar metric instead?" })
        }
        // Any other DB error (bad column/table name, syntax error) — the model's generated SQL
        // was wrong, not dangerous. Fail gracefully rather than a raw 500; this is the fallback
        // path's actual failure mode in practice more often than a genuine safety violation.
        console.error('[copilotkit] fallback query failed', err, sql)
        return NextResponse.json({ reply: "I couldn't quite compute that one — could you rephrase, or ask about revenue, occupancy, ADR, or a similar metric instead?" })
      }
    } else {
      const propertyName = typeof input.propertyName === 'string' ? input.propertyName : undefined
      const agentName = typeof input.agentName === 'string' ? input.agentName : undefined
      // agentName (2026-07-20) — total_room_revenue/total_extras_revenue/occupancy_adr_revpar all
      // accept it; an agent scope always wins over a property scope if the model somehow passed
      // both, since a question naming a trade partner is more specific than a portfolio/property one.
      const isAgentScoped = (toolUse.name === 'total_room_revenue' || toolUse.name === 'total_extras_revenue' || toolUse.name === 'occupancy_adr_revpar') && !!agentName
      const match = isAgentScoped ? { propertyId: null, propertyName: null, unresolved: false } : resolvePropertyName(propertyName)
      const agentMatch = isAgentScoped ? await resolveAgentName(agentName) : null
      const year = typeof input.year === 'number' ? input.year : new Date().getFullYear()
      const dateBasis = (input.dateBasis === 'actualized' || input.dateBasis === 'otb' ? input.dateBasis : 'ytd') as DateBasis
      const propertyCaveat = match.unresolved ? ` (couldn't match "${propertyName}" to a known property — showing portfolio-wide instead)` : ''
      const agentCaveat = !agentMatch ? ''
        : agentMatch.unresolved ? ` (couldn't match "${agentName}" to a known agent — showing portfolio-wide instead)`
        : agentMatch.ambiguous ? ` (multiple agents matched "${agentName}" — showing the closest match, ${agentMatch.agentName})`
        : ` — agent: ${agentMatch.agentName}`

      // Context short-circuit — only when the currently loaded page already has this EXACT figure,
      // so we never guess at a narrower/wider basis than what's actually on screen. Covers the
      // common "what am I looking at right now" follow-up without a redundant DB round-trip.
      // Never applies when agent-scoped — KP_BASE context is portfolio/property-level only, never
      // agent-level, so contextPropertyMatches is forced false rather than risking a false match.
      const contextProperty = context?.filters?.property
      const contextPropertyMatches = !isAgentScoped
        && ((!match.propertyId && (!contextProperty || contextProperty === 'all')) || (!!match.propertyId && match.propertyId === contextProperty))
      // KP_BASE.occ.rev/nights are always actualized-basis regardless of the MTD/YTD/Full-Year
      // toggle — actualized stays can't exceed "today" no matter the period's nominal upper bound,
      // so 'y' (YTD) and 'a' (Full Year) both reduce to the same actualized total our own
      // 'actualized' template computes. MTD ('m') is a genuinely narrower window, so it's excluded.
      const contextYearMatches = String(context?.filters?.year ?? '') === String(year)
      const actualizedContextMatches = dateBasis === 'actualized' && contextYearMatches && contextPropertyMatches
        && (context?.filters?.period === 'y' || context?.filters?.period === 'a')
      // Occupancy %/ADR/RevPAR are period-invariant (always full-year 2026) — match regardless of
      // which period toggle is selected, only the property scope and the fixed 2026 year matter.
      const occContextMatches = contextPropertyMatches && (context?.filters?.year ?? '2026') === '2026'

      if (toolUse.name === 'total_room_revenue' && actualizedContextMatches && context?.kpBase?.revM != null) {
        resultSummary = `Room Revenue: ${fmtDollar(context.kpBase.revM * 1e6)}`
        caveat = 'Actualized basis (completed stays only).' + propertyCaveat
      } else if (toolUse.name === 'occupancy_adr_revpar' && occContextMatches && context?.kpBase) {
        const { occPct, adr, revpar } = context.kpBase
        resultSummary = `Occupancy: ${occPct ?? 'n/a'}%, ADR: $${adr ?? 'n/a'}, RevPAR: $${revpar ?? 'n/a'}`
        caveat = 'Always full-year 2026 on this dashboard, regardless of period selected.' + propertyCaveat
      } else if (toolUse.name === 'room_nights_sold' && actualizedContextMatches && context?.kpBase?.nights != null) {
        resultSummary = `Room Nights Sold: ${context.kpBase.nights.toLocaleString()}`
        caveat = 'Actualized basis (completed stays only).' + propertyCaveat
      } else {
        switch (toolUse.name) {
          case 'total_room_revenue': {
            const q = buildTotalRoomRevenue(year, dateBasis, match.propertyId, agentMatch?.agentId ?? null)
            const row = await runSafeQuery<{ revenue: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
            resultSummary = `Room Revenue: ${fmtDollar(Number(row[0]?.revenue ?? 0))}`
            caveat = q.caveat + propertyCaveat + agentCaveat
            break
          }
          case 'total_extras_revenue': {
            const q = buildTotalExtrasRevenue(year, dateBasis, match.propertyId, agentMatch?.agentId ?? null)
            const row = await runSafeQuery<{ extras: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
            resultSummary = `Extras Revenue: ${fmtDollar(Number(row[0]?.extras ?? 0))}`
            caveat = q.caveat + propertyCaveat + agentCaveat
            break
          }
          case 'room_nights_sold': {
            const q = buildRoomNightsSold(year, dateBasis, match.propertyId)
            const row = await runSafeQuery<{ nights: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
            resultSummary = `Room Nights Sold: ${Number(row[0]?.nights ?? 0).toLocaleString()}`
            caveat = q.caveat + propertyCaveat
            break
          }
          case 'occupancy_adr_revpar': {
            if (agentMatch?.agentId) {
              // Agent-scoped: ADR only, via the Leaderboard-matching formula — no per-agent
              // capacity figure exists for Occupancy %/RevPAR (see buildAgentAdr's own comment).
              const q = buildAgentAdr(year, agentMatch.agentId)
              const row = await runSafeQuery<{ adr: number | null }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
              const adr = row[0]?.adr != null ? Number(row[0].adr) : null
              resultSummary = `ADR: ${adr !== null ? '$' + adr.toLocaleString() : 'n/a (no room nights in this period)'}`
              caveat = q.caveat + agentCaveat
            } else {
              const q = buildOccupancyAdrRevpar(match.propertyId)
              const row = await runSafeQuery<{ revenue: number; nights: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
              const available = availableNightsFor(match.propertyId)
              const revenue = Number(row[0]?.revenue ?? 0)
              const nights = Number(row[0]?.nights ?? 0)
              const occPct = available > 0 ? (nights / available) * 100 : null
              const revpar = available > 0 ? revenue / available : null
              const adr = nights > 0 ? revenue / nights : null
              resultSummary = `Occupancy: ${occPct !== null ? occPct.toFixed(1) + '%' : 'n/a'}, ADR: ${adr !== null ? '$' + Math.round(adr).toLocaleString() : 'n/a'}, RevPAR: ${revpar !== null ? '$' + revpar.toFixed(2) : 'n/a'}`
              caveat = q.caveat + propertyCaveat + agentCaveat
            }
            break
          }
          case 'yoy_growth': {
            const thisYear = buildTotalRoomRevenue(year, 'otb', match.propertyId)
            const lastYear = buildTotalRoomRevenue(year - 1, 'otb', match.propertyId)
            const [thisRow, lastRow] = await Promise.all([
              runSafeQuery<{ revenue: number }>(pool, thisYear.sql, thisYear.params, QUERY_TIMEOUT_MS),
              runSafeQuery<{ revenue: number }>(pool, lastYear.sql, lastYear.params, QUERY_TIMEOUT_MS),
            ])
            const cy = Number(thisRow[0]?.revenue ?? 0)
            const ly = Number(lastRow[0]?.revenue ?? 0)
            const pct = ly > 0 ? ((cy - ly) / ly) * 100 : null
            resultSummary = `${year} Room Revenue: ${fmtDollar(cy)}; ${year - 1}: ${fmtDollar(ly)}; change: ${pct !== null ? pct.toFixed(1) + '%' : 'n/a (no prior-year base)'}`
            caveat = 'On-the-books basis both years.' + propertyCaveat
            break
          }
          case 'revenue_by_property': {
            const limit = typeof input.limit === 'number' ? input.limit : 5
            const q = buildRevenueByProperty(year, dateBasis, limit)
            const rows = await runSafeQuery<{ property_id: string; revenue: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
            resultSummary = rows.map((r, i) => `${i + 1}. ${propertyNameById(r.property_id) ?? r.property_id}: ${fmtDollar(Number(r.revenue))}`).join('; ')
            caveat = q.caveat
            break
          }
          case 'occupancy_by_property': {
            const limit = typeof input.limit === 'number' ? input.limit : 5
            const q = buildNightsByProperty()
            const rows = await runSafeQuery<{ property_id: string; nights: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
            const ranked = occupancyPctByProperty(rows).slice(0, limit)
            resultSummary = ranked.map((r, i) => `${i + 1}. ${r.propertyName}: ${r.occPct.toFixed(1)}%`).join('; ')
            caveat = q.caveat
            break
          }
          case 'diagnose_change': {
            const metric = input.metric === 'occupancy' ? 'occupancy' : input.metric === 'adr' ? 'adr' : input.metric === 'revenue' ? 'revenue' : null
            if (!metric) {
              resultSummary = "diagnose_change only supports the revenue, occupancy, and ADR metrics — can't diagnose that yet."
              caveat = ''
              break
            }
            const bundle = await assembleDiagnoseChangeBundle(pool, metric, year, match.propertyId, QUERY_TIMEOUT_MS)
            const reasoningResponse = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              // 800, not 500 (2026-07-18) — live-observed a 500-token response truncate mid-sentence
              // ("...though this gain was insufficient to") despite the prompt asking for 2-4
              // sentences; the model sometimes produces a longer structured breakdown (headers,
              // numbered drivers) than instructed. Truncating real content mid-thought is worse
              // than a response running longer than the style guideline asks for.
              max_tokens: 800,
              system: buildDiagnoseChangeSystemPrompt(bundle),
              messages: [{ role: 'user', content: `Data bundle (all figures real, already computed — do not recompute):\n${JSON.stringify(bundle)}` }],
            })
            const reasoningText = reasoningResponse.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
            resultSummary = reasoningText?.text.trim() ?? 'Could not analyze this change from the available data.'
            caveat = propertyCaveat
            break
          }
          case 'revenue_by_segment':
          case 'revenue_by_channel': {
            const kind = toolUse.name === 'revenue_by_segment' ? 'segment' : 'channel'
            const values = kind === 'segment' ? SEGMENT_VALUES : CHANNEL_VALUES_LIST
            const limit = typeof input.limit === 'number' ? input.limit : 5
            const rowsPerValue = await Promise.all(values.map(async (value) => {
              const q = buildSegmentOrChannelQuery(kind, value, year)
              const row = await runSafeQuery<{ revenue: number }>(pool, q.sql, q.params, QUERY_TIMEOUT_MS)
              return { value, revenue: Number(row[0]?.revenue ?? 0) }
            }))
            const ranked = rowsPerValue.sort((a, b) => b.revenue - a.revenue).slice(0, limit)
            resultSummary = ranked.map((r, i) => `${i + 1}. ${r.value}: ${fmtDollar(r.revenue)}`).join('; ')
            caveat = 'On-the-books basis (includes future confirmed stays).'
            break
          }
          default:
            return NextResponse.json({ reply: "I couldn't work out how to answer that — could you rephrase?" })
        }
      }
    }

    // Step 2: format a plain-English answer, surfacing the caveat naturally when it matters.
    // diagnose_change gets a stricter variant of this same step — the reasoning call above already
    // decided the drivers and their causal framing; this pass must only polish prose, never
    // re-derive, add, or drop a claim, and must never let a named driver's inline $/% figure get
    // smoothed away into vaguer language (the exact failure mode a generic "concise" instruction
    // risks for a numbers-heavy answer like this one).
    const isDiagnoseChange = toolUse.name === 'diagnose_change'
    const answerResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      // diagnose_change's resultSummary can run up to 800 tokens (see the reasoning call above) —
      // 400 here would truncate it again even after fixing the reasoning call's own limit.
      max_tokens: isDiagnoseChange ? 800 : 400,
      system: isDiagnoseChange
        ? `You are lightly copy-editing a BI analyst's answer for Elewana Collection for tone/flow only. The "Data" below is already the complete, correct, final analysis — do not add, remove, reorder, or reinterpret any claim in it, and do not add any new cause or number. Preserve every named driver's exact $ and % figures inline, exactly as given — never paraphrase a specific figure into vaguer language (e.g. never turn "Kilindi -$871k (-29.5%)" into "one property saw a notable decline"). If it already reads well, return it essentially unchanged.`
        : `You are a helpful BI assistant for Elewana Collection. Write a clear, concise, exec-facing answer in 1-3 sentences using the data given. If a caveat is provided and it would change how someone should read the number, mention it naturally in a phrase — don't bolt it on as a disclaimer paragraph. Never invent numbers beyond what's given.`,
      messages: [
        ...recentHistory.slice(0, -1),
        { role: 'user', content: `Question: ${question}\n\nData: ${resultSummary}${caveat ? `\n\nCaveat to weave in naturally if relevant: ${caveat}` : ''}` },
      ],
    })
    const answerText = answerResponse.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    const reply = answerText?.text.trim() ?? resultSummary

    return NextResponse.json({ reply })

  } catch (err) {
    console.error('[copilotkit route]', err)
    return NextResponse.json(
      { reply: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
