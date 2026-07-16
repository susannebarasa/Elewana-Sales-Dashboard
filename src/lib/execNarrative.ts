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

// Sentence 1 (CONFIDENT) — Room Revenue vs Budget, period-aware. MTD uses the real MTD
// actual/budget pair (KP_BASE.pace.budgetMtd); YTD uses the same pair the "Pace vs Budget %" KPI
// card (KP_BASE.execPace.vsBudget) and YTD-vs-Budget mini-stat already show.
// FIX (2026-07-16e): Full Year previously reused the YTD pair outright (budgetYtd, itself anchored
// to realCurrentMonth regardless of period — see kpiBudgetActual's comment in route.ts) — caught
// live: Room Revenue/Budget/%-of-Budget were byte-identical between the Full Year and YTD toggles.
// Full Year now uses KP_BASE.pace.budgetFullYear, a genuinely full-year pair (Actual = revM, which
// IS period-scoped — monthHi=12 when period==='a'; Budget = the full annual target), and computes
// its own pct directly rather than borrowing execPace.vsBudget (which is also YTD-anchored).
// NOT changed here: Occupancy vs Budget (occAdrSentence below) is deliberately full-year-fixed
// for ALL periods, per its own route.ts comment and an earlier confirmed decision — that's a
// separate, larger change (would need new monthLo/monthHi-bound Occupancy queries) and wasn't
// part of this fix.
// Property-aware subject (2026-07-16d) — when a single property is selected (propertyName passed
// in, e.g. "Arusha Coffee Lodge"), name it explicitly instead of the generic "Room Revenue" that
// only reads naturally for the portfolio-wide "All Properties" view.
function sentence1(data: DashboardData, period: 'm' | 'y' | 'a', propertyName?: string | null): string {
  const periodWord = period === 'm' ? 'MTD' : period === 'a' ? 'Full Year' : 'YTD'
  const metric = period === 'm' ? data.KP_BASE.pace.budgetMtd : period === 'a' ? data.KP_BASE.pace.budgetFullYear : data.KP_BASE.pace.budgetYtd
  const actual = metric.v
  const budget = metric.ly ?? 0
  const pct = period === 'y' ? data.KP_BASE.execPace.vsBudget.v : (budget > 0 ? (actual / budget) * 100 : 0)
  const subject = propertyName ? `${propertyName}'s Room Revenue` : 'Room Revenue'
  return `${subject} ${periodWord} is ${fmtM(actual)} against a ${fmtM(budget)} budget (${pct.toFixed(1)}% of budget), ${paceDescriptor(pct)}.`
}

// Same variance formula as KpiRow.tsx's budgetVariance / SalesExecutiveSummaryDesign.tsx's
// yoyPct (both already independently derive this from `{v, ly}` — this is a third instance of the
// same well-established derivation, not a new number). Returns null when there's no real
// comparator (ly missing/zero), same "never fabricate" guard as those two.
function variancePct(m: { v: number; ly?: number }): number | null {
  if (typeof m.ly !== 'number' || m.ly <= 0) return null
  return ((m.v - m.ly) / m.ly) * 100
}

const signed = (pct: number): string => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}`

// Budget-relative descriptor for Occupancy % — mirrors paceDescriptor's tone/bucket count but on
// a delta-from-target scale (0 = on budget) rather than paceDescriptor's ratio-to-100 scale.
function occDescriptor(pct: number): string {
  if (pct >= 15) return 'running well ahead of budget'
  if (pct >= 5) return 'tracking ahead of budget'
  if (pct >= -5) return 'tracking close to budget'
  if (pct >= -15) return 'running slightly behind budget'
  return 'running well behind budget'
}

// Threshold (2026-07-16d, confirmed with user) for what counts as Occupancy % being
// "significantly" off budget — separate from the opposite-directions trigger below.
const OCC_ADR_SIGNIFICANT_PCT = 10

// Sentence 1b (CONDITIONAL, CONFIDENT) — Occupancy % (vs Budget) and ADR (vs LY), surfaced only
// when they're telling different stories: moving in opposite directions (one masking/amplifying
// the other's revenue effect), or Occupancy is significantly off budget (>= 10 points either way)
// even if ADR is moving the same way. Routine small variances stay silent — this is meant to call
// out a specific dynamic, not restate every KPI card. Omitted entirely (not partially shown) if
// either comparator has no real baseline, per this file's "never a fabricated number" rule.
function occAdrSentence(data: DashboardData): string | null {
  const occPct = variancePct(data.KP_BASE.occ.occPct)
  const adrPct = variancePct(data.KP_BASE.occ.adr)
  if (occPct === null || adrPct === null) return null

  const occUp = occPct >= 0
  const adrUp = adrPct >= 0
  const adrMoving = Math.abs(adrPct) >= 1
  const opposite = adrMoving && occUp !== adrUp
  const significant = Math.abs(occPct) >= OCC_ADR_SIGNIFICANT_PCT
  if (!opposite && !significant) return null

  if (opposite) {
    const tail = occUp ? 'tempering the outperformance' : 'partially offsetting the revenue impact'
    return `Occupancy is ${occDescriptor(occPct)} (${signed(occPct)}%), though ADR is ${adrUp ? 'up' : 'down'} ${signed(adrPct)}% YoY, ${tail}.`
  }
  if (adrMoving) {
    // Same direction, both meaningfully off — compounding rather than offsetting.
    const planWord = occUp ? 'ahead of plan' : 'behind plan'
    const tail = occUp ? 'reinforcing the outperformance' : 'compounding the revenue shortfall'
    return `Occupancy and ADR are both ${planWord} (${signed(occPct)}% and ${signed(adrPct)}% respectively), ${tail}.`
  }
  // Occupancy alone is significant; ADR is roughly flat — don't overstate ADR's direction.
  return `Occupancy is ${occDescriptor(occPct)} (${signed(occPct)}%), with ADR roughly flat YoY (${signed(adrPct)}%).`
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

// Order (2026-07-16d, confirmed with user): property-specific Revenue-vs-Budget context first,
// then the conditional Occupancy/ADR dynamic (when present) — both establish the property-level
// KPI picture — and only then the existing Agent Pace-wise sentence, unchanged.
export function buildExecutiveNarrative(data: DashboardData, period: 'm' | 'y' | 'a' = 'y', propertyName?: string | null): string[] {
  const sentences = [sentence1(data, period, propertyName)]
  const occAdr = occAdrSentence(data)
  if (occAdr) sentences.push(occAdr)
  sentences.push(sentence2(data))
  return sentences
}
