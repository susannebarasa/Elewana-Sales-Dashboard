/**
 * Sargable date predicates (2026-07-09) — replace YEAR(col)/MONTH(col) wraps that
 * prevent MySQL from using indexes on date_in / date_created.
 *
 * Inclusive monthLo..monthHi within a calendar year maps to:
 *   col >= '{year}-{monthLo}-01' AND col < first day of month after monthHi
 * (or Jan 1 of year+1 when monthHi === 12).
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** First day of the month after `month` (1–12) in `year`, as YYYY-MM-DD. */
export function firstDayAfterMonth(year: number, month: number): string {
  if (month >= 12) return `${year + 1}-01-01`
  return `${year}-${pad2(month + 1)}-01`
}

/** First day of `month` (1–12) in `year`, as YYYY-MM-DD. */
export function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`
}

/**
 * SQL fragment: `col >= 'Y-M-01' AND col < 'Y-M+1-01'` for months monthLo..monthHi
 * in a single calendar year. `col` is trusted internal SQL (e.g. `i.date_in`).
 */
export function dateInYearMonthRange(col: string, year: number, monthLo: number, monthHi: number): string {
  const lo = firstDayOfMonth(year, monthLo)
  const hi = firstDayAfterMonth(year, monthHi)
  return `${col} >= '${lo}' AND ${col} < '${hi}'`
}

/**
 * SQL fragment covering two calendar years with the same monthLo..monthHi window
 * (typical CY + LY filter). Prefer this over `YEAR(col) IN (cy,ly) AND MONTH BETWEEN`.
 */
export function dateInTwoYearMonthRange(
  col: string,
  yearA: number,
  yearB: number,
  monthLo: number,
  monthHi: number
): string {
  return `((${dateInYearMonthRange(col, yearA, monthLo, monthHi)}) OR (${dateInYearMonthRange(col, yearB, monthLo, monthHi)}))`
}

/**
 * CASE WHEN arm for "row falls in year Y, months monthLo..monthHi" without YEAR()/MONTH().
 * Use inside SUM(CASE WHEN … THEN … END) where the old code had YEAR(col)=? AND MONTH….
 */
export function caseInYearMonthRange(col: string, year: number, monthLo: number, monthHi: number): string {
  return `(${dateInYearMonthRange(col, year, monthLo, monthHi)})`
}

/**
 * Full calendar year: col >= Y-01-01 AND col < (Y+1)-01-01.
 */
export function dateInFullYear(col: string, year: number): string {
  return `${col} >= '${year}-01-01' AND ${col} < '${year + 1}-01-01'`
}

/**
 * Months 1..monthHi in a year (legacy `YEAR=? AND MONTH<=?` pattern).
 */
export function dateInYearThroughMonth(col: string, year: number, monthHi: number): string {
  return dateInYearMonthRange(col, year, 1, monthHi)
}

/**
 * Two years, months 1..monthHi each (legacy `YEAR IN (?,?) AND MONTH<=?`).
 */
export function dateInTwoYearsThroughMonth(col: string, yearA: number, yearB: number, monthHi: number): string {
  return dateInTwoYearMonthRange(col, yearA, yearB, 1, monthHi)
}
