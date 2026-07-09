// 2026 monthly Budget (Room Nights Sold / Revenue / ADR) per property — loaded from
// budget_2026_monthly.csv, confirmed 13 July 2026 against the source file's own EC Group
// (excl. Serengeti Explorer) totals: $39,926,885 Budget Room Revenue, 40,021 Budget Room Nights
// (our re-derived totals: $39,926,885.01 / 40,020.72 — a rounding-only difference).
//
// KNOWN GAP, not resolved here: the source file's "Afrochic" rows are $0/0 for all 12 months —
// this contradicts an earlier expectation that Afrochic "has real budget data." Reported as-is;
// worth confirming with Dennis/Faith whether Afrochic is genuinely excluded from the 2026 budget
// or the file itself has a gap. Afrochic (WB639) is still included in the data below so a future
// corrected file drops in without a mapping change.
//
// 2026 ONLY — the source file has no other year. Every lookup function below takes a `year`
// param and returns null/zero for anything else, rather than silently reusing 2026 figures for
// a different year.
import budgetData from '@/data/budget2026Monthly.json'

export interface MonthlyBudget {
  propertyName: string
  propertyId: string
  month: number // 1-12
  noOfRooms: number | null
  daysInMonth: number
  availableRooms: number
  budgetRns: number
  budgetRev: number
  budgetAdr: number
}

const BUDGET_YEAR = 2026
const budget = budgetData as Record<string, MonthlyBudget>

// One property, one month.
export function getBudget(propertyId: string, year: number, month: number): MonthlyBudget | null {
  if (year !== BUDGET_YEAR) return null
  return budget[`${propertyId}_${month}`] ?? null
}

// Portfolio-wide (every property in the file, including Afrochic's $0 rows), summed across an
// inclusive month range. Used for the Pace vs Budget KPI — monthLo/monthHi mirror the same
// monthLo/monthHi already computed in dashboard/route.ts for the selected period.
export function getPortfolioBudget(year: number, monthLo: number, monthHi: number): { rns: number; rev: number } {
  if (year !== BUDGET_YEAR) return { rns: 0, rev: 0 }
  let rns = 0
  let rev = 0
  for (const entry of Object.values(budget)) {
    if (entry.month >= monthLo && entry.month <= monthHi) {
      rns += entry.budgetRns
      rev += entry.budgetRev
    }
  }
  return { rns: Math.round(rns * 100) / 100, rev: Math.round(rev * 100) / 100 }
}

// One property, summed across an inclusive month range. Used for the property-level Budget
// variance table (2026-07-13).
export function getPropertyBudget(propertyId: string, year: number, monthLo: number, monthHi: number): { rns: number; rev: number } {
  if (year !== BUDGET_YEAR) return { rns: 0, rev: 0 }
  let rns = 0
  let rev = 0
  for (const entry of Object.values(budget)) {
    if (entry.propertyId === propertyId && entry.month >= monthLo && entry.month <= monthHi) {
      rns += entry.budgetRns
      rev += entry.budgetRev
    }
  }
  return { rns: Math.round(rns * 100) / 100, rev: Math.round(rev * 100) / 100 }
}

// Every distinct property in the budget file (17 properties — see the module comment for the
// Afrochic caveat). Used to drive the property-level Budget variance table without needing a
// separate hardcoded property list.
export function getAllBudgetProperties(): { propertyId: string; propertyName: string }[] {
  const seen = new Map<string, string>()
  for (const entry of Object.values(budget)) {
    if (!seen.has(entry.propertyId)) seen.set(entry.propertyId, entry.propertyName)
  }
  return Array.from(seen.entries()).map(([propertyId, propertyName]) => ({ propertyId, propertyName }))
}
