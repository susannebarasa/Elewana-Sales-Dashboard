// Sand River Finance View — manually-imported MIS data, same pattern as src/lib/budget.ts
// (static JSON, no DB query, no merge with ResRequest — the RECON reconciliation panel comparing
// this against ResRequest was explicitly excluded from scope).
//
// DATA STATUS (re-extracted 2026-07-10 from SRM_Full_Workbook_Real_Data.xlsx's 'SRM' tab, a
// 45-tab workbook — read the tab BY NAME, never by index, per the source SKILL.md's own warning):
// the prior "No Selection" month-selector bug is fixed. Actual (2026A), Budget (2026B), and Last
// Year (2025A) are all real and populated for MTD/YTD/Annualised. Source month selector (cell D3)
// = 2026-06-01, i.e. this snapshot's "current" month is June 2026 — see reportPeriod below.
// Row/column mapping (verify per property tab if re-extracting another property):
//   MTD: D=2026A(Actual) F=2026B(Budget) G=2025A(LastYear) — YTD: P/Q/R — Annualised: Y(2026A+F,
//   blended actual-to-date+forecast, since the year isn't over) / AA(2026B) / AB(2025A).
//   Monthly series (calendar Jan-Dec 2026): Budget BK-BV, Actual CM-CX (real Jan-Jun, the elapsed
//   months; Jul-Dec are null — not yet happened, never fabricated as $0).
//   KPI rows: netRevenue=111, contributionToHO=15(==262), ebitda=18(==271), netProfit=23(==283).
//   plLines rows: see the extraction script that generated this JSON for the full 16-row map.
// Re-extract the same way each month (still a hand-pasted JSON replacement, no auto-pick-current-
// month logic, per the user's explicit "simple manual refresh" call) — this file's shape doesn't
// need to change again unless the sheet's own structure changes.
import data from '@/data/sandRiverFinance.json'

export type DataStatus = 'ok' | 'tbc' | 'ndl'
export type Rag = 'green' | 'amber' | 'red' | 'deepRed'
export type FinancePeriod = 'm' | 'y' | 'a'
export type ChartStatus = 'ok' | 'budget-only' | 'ndl'

export interface FinanceMetric {
  status: DataStatus
  value: number | null
  budget: number | null
  // Last Year (2025A) reference — not shown on the KPI card face (SKILL.md's card spec has no LY
  // slot), but required to compute the 4-tier RAG (green/amber/red/deepRed depends on Actual vs
  // LY, not just vs Budget) and used directly in the Executive Narrative's YoY commentary.
  lastYear: number | null
  varianceAbs: number | null
  variancePct: number | null
  rag: Rag | null
}

export interface FinancePeriodKpis {
  netRevenue: FinanceMetric
  contributionToHO: FinanceMetric
  ebitda: FinanceMetric
  netProfit: FinanceMetric
}

export type PLSection = 'revenue' | 'costs' | 'summary' | 'drivers'

export interface FinancePLLine {
  key: string
  label: string
  section: PLSection
  detailOnly: boolean
  status: DataStatus
  // Per-period, same shape as budget (was a flat `number | null` before real Actual data existed
  // — harmless while Actual was always null, but wrong once real figures flow through: the P&L
  // table must show the Actual/Variance for whichever period tab is selected, not one fixed value
  // regardless of the MTD/YTD/Annualised toggle).
  value: Record<FinancePeriod, number> | null
  budget: Record<FinancePeriod, number> | null
  variance: Record<FinancePeriod, number> | null
}

export interface NarrativePill {
  label: string
  value: string
}

export interface FinanceNarrative {
  headline: string
  body: string
  pills: NarrativePill[]
}

export interface MonthlyBudgetSeries {
  months: string[]
  revenue: number[]
  managedCosts: number[]
  imposedCosts: number[]
}

// Actual mirror of MonthlyBudgetSeries — nullable per-entry because not every month has happened
// yet (a future month is unknown, not $0); Chart.js renders a null point as a gap, which is the
// correct visual for "not yet actualized" rather than a fabricated dip to zero.
export interface MonthlyActualSeries {
  months: string[]
  revenue: (number | null)[]
  managedCosts: (number | null)[]
  imposedCosts: (number | null)[]
}

export interface SandRiverFinanceData {
  property: { name: string; propertyId: string; operatorLabel: string }
  reportPeriod: { label: string; month: number; year: number } | null
  kpis: Record<FinancePeriod, FinancePeriodKpis>
  narrative: FinanceNarrative | null
  charts: {
    cumulativeRevenuePace: ChartStatus
    monthlyCostStack: ChartStatus
    netProfitWaterfall: ChartStatus
  }
  monthlyBudget: MonthlyBudgetSeries
  monthlyActual: MonthlyActualSeries | null
  plLines: FinancePLLine[]
}

export function getSandRiverFinance(): SandRiverFinanceData {
  return data as SandRiverFinanceData
}

export const PERIOD_LABELS: Record<FinancePeriod, string> = {
  m: 'MTD',
  y: 'YTD',
  a: 'Annualised',
}
