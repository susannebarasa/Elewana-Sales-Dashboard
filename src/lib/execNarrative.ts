import type { DashboardData } from '@/types'

// Executive Story Panel (2026-07-09, shortened 2026-07-16) — deterministic, template-based
// narrative for Sales Executive Summary. NO LLM: every sentence is assembled from fields already
// computed elsewhere on this dashboard (KP_BASE, REVPAR, AGENT_PACE, CANCEL_DRIVERS) — this is
// presentation logic only, picking top/bottom N and formatting, never a new query or a new number.
//
// Tone is tied to DATA SOURCE, not toggled per sentence by hand:
//   - CONFIDENT (sentence 1): Room Revenue vs Budget — repeatedly verified today.
//   - HEDGED (sentences 2-3): RevPAR, then Agent Pace + Forecast + Cancellation Drivers combined
//     into one sentence — built/corrected today, less battle-tested. Each hedge phrase names WHY
//     it's hedged (newly-corrected methodology / worth a follow-up review / not yet independently
//     reviewed) rather than a generic "may be inaccurate" — the reader should know what's actually
//     uncertain. Condensed from 4 sentences to 3 (2026-07-16 design pass) by merging the two most
//     forward-looking/least-critical items (Agent Pace, Forecast+Cancellations) — no content
//     dropped, just combined and tightened.

const fmtM = (v: number): string => `$${v.toFixed(1)}M`
const fmtWhole = (v: number): string => `$${Math.round(v).toLocaleString()}`
const fmtK1 = (v: number): string => `$${(v / 1000).toFixed(1)}k`

// Threshold scale — approved 2026-07-09. Anchored to the same 100/95/85 breakpoints already
// used for RAG coloring elsewhere (KpiRow's thG/thY), so "slightly behind" here means the same
// thing it means on every KPI card.
function paceDescriptor(vsBudgetPct: number): string {
  if (vsBudgetPct >= 100) return 'tracking ahead of plan'
  if (vsBudgetPct >= 95) return 'tracking close to plan'
  if (vsBudgetPct >= 85) return 'running slightly behind plan'
  return 'running well behind plan'
}

// Sentence 1 (CONFIDENT) — Room Revenue vs Budget, YTD. Uses the exact same actual/budget pair
// as the "Pace vs Budget %" KPI card (KP_BASE.execPace.vsBudget) and the YTD-vs-Budget mini-stat,
// so this sentence never disagrees with a number already visible elsewhere on the page.
function sentence1(data: DashboardData): string {
  const actual = data.KP_BASE.pace.budgetYtd.v
  const budget = data.KP_BASE.pace.budgetYtd.ly ?? 0
  const pct = data.KP_BASE.execPace.vsBudget.v
  return `Room Revenue YTD is ${fmtM(actual)} against a ${fmtM(budget)} budget (${pct.toFixed(1)}% of budget), ${paceDescriptor(pct)}.`
}

// Sentence 2 (HEDGED) — RevPAR, top 2 + softest. Caveated properties (pre-opening, mid-
// refurbishment) are excluded from the ranking entirely — a construction gap or closure isn't a
// performance signal, and calling out "softest" on one would be misleading, not just imprecise.
function sentence2(data: DashboardData): string {
  const clean = data.REVPAR.byProperty.filter((r) => r.revpar !== null && r.caveat === null)
  const sorted = [...clean].sort((a, b) => (b.revpar as number) - (a.revpar as number))
  if (sorted.length < 3) {
    return 'Early RevPAR signals — based on newly-corrected methodology — are not yet distinct enough across properties to call out leaders or laggards.'
  }
  const top2 = sorted.slice(0, 2)
  const softest = sorted[sorted.length - 1]
  const top2Str = top2.map((r) => `${r.propertyName} (${fmtWhole(r.revpar as number)})`).join(' and ')

  // "despite being one of the higher-revenue properties" — only said if genuinely true, checked
  // against this same property's actual Room Revenue rank, not assumed.
  const byRevenue = [...data.REVPAR.byProperty]
    .filter((r) => r.roomRevenue !== null)
    .sort((a, b) => (b.roomRevenue as number) - (a.roomRevenue as number))
  const revenueRank = byRevenue.findIndex((r) => r.propertyName === softest.propertyName)
  const suffix = revenueRank !== -1 && revenueRank < 3 ? ' despite being one of the higher-revenue properties by volume' : ''

  return `Early RevPAR figures (newly-corrected methodology) point to ${top2Str} leading the portfolio, while ${softest.propertyName} (${fmtWhole(softest.revpar as number)}) is the softest performer${suffix}.`
}

// Sentence 3 (HEDGED, combined 2026-07-16) — Agent Pace movers + Forecast + top Cancellation
// Driver in one sentence: the two most forward-looking, least-battle-tested items, merged to get
// the panel to 3 sentences without dropping content. AGENT_PACE.gainers/decliners are already
// sorted by absVar (see route.ts) — just take the top 2 of each. execPace.vsForecast's own `d`
// field already carries the exact month range this ratio covers — reused verbatim.
function sentence3(data: DashboardData): string {
  const gainers = data.AGENT_PACE.gainers.slice(0, 2)
  const decliners = data.AGENT_PACE.decliners.slice(0, 2)
  const paceClause = gainers.length === 0 && decliners.length === 0
    ? 'no agents meet the minimum-volume threshold this period to call out gainers or decliners'
    : `${gainers.map((a) => `${a.agentName} (+${a.absVar.toLocaleString()} nights)`).join(' and ')} are growing fastest while ${decliners.map((a) => `${a.agentName} (${a.absVar.toLocaleString()} nights)`).join(' and ')} are softening`

  const fc = data.KP_BASE.execPace.vsForecast
  const monthRange = fc.d.replace(' forecast vs budget', '')
  const top = data.CANCEL_DRIVERS[0]
  const cancelClause = top
    ? `${top.agentName} leads cancellations over the last 30 days (${fmtK1(top.revenueLost)} across ${top.cancelledBookings.toLocaleString()} bookings)`
    : 'no material cancellation drivers stand out over the last 30 days'

  return `Agent Pace-wise, ${paceClause} — worth a follow-up review; the forward forecast for ${monthRange} is tracking at ${fc.v.toFixed(1)}% of budget, and ${cancelClause}, both based on methodology finalized today and not yet independently reviewed.`
}

export function buildExecutiveNarrative(data: DashboardData): string[] {
  return [sentence1(data), sentence2(data), sentence3(data)]
}
