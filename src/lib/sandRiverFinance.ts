// Sand River Finance View (2026-07-16) — manually-imported MIS data, same pattern as
// src/lib/budget.ts (static JSON, no DB query, no merge with ResRequest — the RECON
// reconciliation panel comparing this against ResRequest was explicitly excluded from scope).
// Every figure is currently null/'ndl' — real Sand River figures are blocked on the "actuals
// showing as zero" issue with the live MIS sheet; this file defines the shape so a future JSON
// replacement (still hand-pasted each month, per the user's explicit "simple manual refresh,
// no auto-pick-current-month" decision) drops in without a code change.
import data from '@/data/sandRiverFinance.json'

export type DataStatus = 'ok' | 'tbc' | 'ndl'
export type Rag = 'green' | 'amber' | 'red' | 'deepRed'
export type FinancePeriod = 'm' | 'y' | 'a'

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
  budget: number | null
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

export interface SandRiverFinanceData {
  property: { name: string; propertyId: string; operatorLabel: string }
  reportPeriod: { label: string; month: number; year: number } | null
  kpis: Record<FinancePeriod, FinancePeriodKpis>
  narrative: FinanceNarrative | null
  charts: {
    cumulativeRevenuePace: DataStatus
    monthlyCostStack: DataStatus
    netProfitWaterfall: DataStatus
  }
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
