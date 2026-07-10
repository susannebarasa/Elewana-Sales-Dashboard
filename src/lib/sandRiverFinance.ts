// Sand River Finance View (2026-07-16) — manually-imported MIS data, same pattern as
// src/lib/budget.ts (static JSON, no DB query, no merge with ResRequest — the RECON
// reconciliation panel comparing this against ResRequest was explicitly excluded from scope).
//
// DATA STATUS (confirmed live against SRM_Financial_Data.xlsx, 2026-07-16): the "2026A" (Actual)
// and "2025A" (Last Year) columns are 0 across literally every row in the sheet — a broken
// "No Selection" month-selector cell (D3), not real zeros. Actual/LastYear/variance therefore
// stay NDL everywhere in this file. The "2026B" (Budget) columns ARE clean and fully populated
// (internally consistent — e.g. Annualised Budget sums exactly to the 12 monthly Budget cells) —
// those are real numbers, shown as the reference figure even while Actual is NDL, per explicit
// user confirmation. Re-extract with the same column mapping (F/Q/AA = MTD/YTD/Annualised
// Budget, BK-BV = 12-month Budget series) once Actual is fixed upstream — still a hand-pasted
// JSON replacement each month, no auto-pick-current-month logic, per the user's explicit call.
import data from '@/data/sandRiverFinance.json'

export type DataStatus = 'ok' | 'tbc' | 'ndl'
export type Rag = 'green' | 'amber' | 'red' | 'deepRed'
export type FinancePeriod = 'm' | 'y' | 'a'
export type ChartStatus = 'ok' | 'budget-only' | 'ndl'

export interface FinanceMetric {
  status: DataStatus
  value: number | null
  budget: number | null
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
  value: number | null
  budget: Record<FinancePeriod, number> | null
  variance: number | null
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
  // Actual mirror of monthlyBudget, same 3 series/12-month shape — null while the sheet's "No
  // Selection" issue keeps Actual at NDL (see charts.cumulativeRevenuePace/monthlyCostStack).
  // Populate this alongside flipping those to 'ok' once Actual is fixed upstream; FinanceView
  // reads this field directly, no other code change needed to light up the real series.
  monthlyActual: MonthlyBudgetSeries | null
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
