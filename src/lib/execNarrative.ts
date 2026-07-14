import type { DashboardData } from '@/types'

// Executive Story Panel (2026-07-09, cut to 2 sentences same day per explicit request) —
// deterministic, template-based narrative for Sales Executive Summary. NO LLM: every sentence is
// assembled from fields already computed elsewhere on this dashboard (KP_BASE, AGENT_PACE) — this
// is presentation logic only, picking top/bottom N and formatting, never a new query or a new
// number.
//
// Both sentences are CONFIDENT tone — Room Revenue vs Budget and Agent Pace movers are the two
// items that have been independently re-derived and confirmed clean. The RevPAR sentence and the
// combined Forecast + Cancellation Drivers sentence were dropped entirely (not just softened) —
// both were hedged/unverified and hadn't been confirmed against real business expectations. RevPAR
// itself is unaffected outside the narrative — it still has its own KPI pill on this page
// (SalesExecutiveSummaryDesign.tsx's NarrativePill), sourced directly from KP_BASE, not from here.

const fmtM = (v: number): string => `$${v.toFixed(1)}M`

// Threshold scale — approved 2026-07-09. Anchored to the same 100/95/85 breakpoints already
// used for RAG coloring elsewhere (KpiRow's thG/thY), so "slightly behind" here means the same
// thing it means on every KPI card.
function paceDescriptor(vsBudgetPct: number): string {
  if (vsBudgetPct >= 100) return 'tracking ahead of plan'
  if (vsBudgetPct >= 95) return 'tracking close to plan'
  if (vsBudgetPct >= 85) return 'running slightly behind plan'
  return 'running well behind plan'
}

// Sentence 1 (CONFIDENT) — Room Revenue vs Budget, now period-aware (2026-07-14 fix). MTD uses
// the real MTD actual/budget pair (KP_BASE.pace.budgetMtd); YTD uses the same pair the
// "Pace vs Budget %" KPI card (KP_BASE.execPace.vsBudget) and YTD-vs-Budget mini-stat already show.
// Full Year reuses the YTD pair — not a fabrication: the live API has no distinct full-year budget
// target (pace.budgetYtd/execPace.vsBudget are identical regardless of any period param), and the
// Full Year KPI card itself already mirrors YTD's revenue for the same reason (future months
// haven't happened yet).
function sentence1(data: DashboardData, period: 'm' | 'y' | 'a'): string {
  const periodWord = period === 'm' ? 'MTD' : period === 'a' ? 'Full Year' : 'YTD'
  const metric = period === 'm' ? data.KP_BASE.pace.budgetMtd : data.KP_BASE.pace.budgetYtd
  const actual = metric.v
  const budget = metric.ly ?? 0
  const pct = period === 'm' ? (budget > 0 ? (actual / budget) * 100 : 0) : data.KP_BASE.execPace.vsBudget.v
  return `Room Revenue ${periodWord} is ${fmtM(actual)} against a ${fmtM(budget)} budget (${pct.toFixed(1)}% of budget), ${paceDescriptor(pct)}.`
}

// Sentence 2 (CONFIDENT) — Agent Pace movers only. AGENT_PACE.gainers/decliners are already
// sorted by absVar (see route.ts) — just take the top 2 of each. No Forecast or Cancellation
// Drivers content here (dropped per explicit request, not merged in).
function sentence2(data: DashboardData): string {
  const gainers = data.AGENT_PACE.gainers.slice(0, 2)
  const decliners = data.AGENT_PACE.decliners.slice(0, 2)
  if (gainers.length === 0 && decliners.length === 0) {
    return 'No agents meet the minimum-volume threshold this period to call out gainers or decliners.'
  }
  const gainStr = gainers.map((a) => `${a.agentName} (+${a.absVar.toLocaleString()} nights)`).join(' and ')
  const declineStr = decliners.map((a) => `${a.agentName} (${a.absVar.toLocaleString()} nights)`).join(' and ')
  return `Agent Pace-wise, ${gainStr} are growing fastest while ${declineStr} are softening.`
}

export function buildExecutiveNarrative(data: DashboardData, period: 'm' | 'y' | 'a' = 'y'): string[] {
  return [sentence1(data, period), sentence2(data)]
}
