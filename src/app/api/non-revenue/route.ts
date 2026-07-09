export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import {
  dateInYearMonthRange,
  dateInTwoYearMonthRange,
  dateInYearThroughMonth,
  dateInTwoYearsThroughMonth,
  dateInFullYear,
  caseInYearMonthRange,
} from '@/lib/dateRange'
import {
  KES_USD_RATE,
  EXCLUDED_RESERVATION_PREFIX,
  NON_REVENUE_RATE_TYPE_IDS,
  CONSERVATION_FEE_COMPONENTS,
  PARK_FEES_COMPONENTS,
  INFRASTRUCTURE_TAX_COMPONENTS,
  CONCESSION_FEE_COMPONENTS,
  WAITLIST_COMPONENTS,
  COMPLIMENTARY_RATE_TYPE_IDS,
  FAM_STAY_RATE_TYPE_IDS,
  STAFF_RATE_RATE_TYPE_IDS,
  TNC_STAFF_RATE_TYPE_IDS,
} from '@/lib/constants'
import type { NonRevenueData } from '@/types'

const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}

// ── route ────────────────────────────────────────────────────────────────────
// Non-Revenue audit figures — pass-through fees and FAM/Complimentary/Staff
// business, computed and exposed here deliberately SEPARATE from
// /api/dashboard. Approved 2026-07-08: both categories are real, calculated
// figures, but must NOT be added to Room Revenue, Extras, or any Total shown
// on the main Sales/Trade Partners/Occupancy views. This endpoint exists so
// the numbers are available to anyone who specifically needs them (finance/
// audit) without touching the leadership-facing headline figures.
//
// Basis: status='30' only (confirmed, per the app-wide revenue convention),
// i.date_in (stay date, matches the Room Revenue convention), all channels
// (no agent filter — this is a portfolio-wide audit figure). NON_REV_IDS'
// four categories may not follow the same confirm/cancel lifecycle as
// commercial bookings — status='30' is a reasonable default but worth a
// sanity check against the data if these figures look unexpectedly small.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const today = new Date()
    const realCurrentYear = today.getFullYear()
    const realCurrentMonth = today.getMonth() + 1
    const yearParam = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10)
    const cy = Number.isFinite(yearParam) ? yearParam : realCurrentYear
    const isCurrentYear = cy === realCurrentYear
    const period = (req.nextUrl.searchParams.get('period') ?? 'y') as 'm' | 'y' | 'a'
    const monthLo = period === 'm' && isCurrentYear ? realCurrentMonth : 1
    const monthHi = period === 'a' ? 12 : isCurrentYear ? realCurrentMonth : 12

    const KES_RATE = KES_USD_RATE
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX
    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)

    const feeGroups: { name: string; components: readonly string[] }[] = [
      { name: 'Conservation Fee', components: CONSERVATION_FEE_COMPONENTS },
      { name: 'Park Fees', components: PARK_FEES_COMPONENTS },
      { name: 'Infrastructure Tax', components: INFRASTRUCTURE_TAX_COMPONENTS },
      { name: 'Concession Fee', components: CONCESSION_FEE_COMPONENTS },
      { name: 'Waitlist', components: WAITLIST_COMPONENTS },
    ]

    const categoryGroups: { name: string; rateTypes: readonly string[] }[] = [
      { name: 'Complimentary', rateTypes: COMPLIMENTARY_RATE_TYPE_IDS },
      { name: 'FAM Stay', rateTypes: FAM_STAY_RATE_TYPE_IDS },
      { name: 'Staff Rate', rateTypes: STAFF_RATE_RATE_TYPE_IDS },
      { name: 'TNC Staff', rateTypes: TNC_STAFF_RATE_TYPE_IDS },
    ]

    const [feeRows, categoryRows] = await Promise.all([
      Promise.all(feeGroups.map((g) =>
        queryOne<{ amount: number }>(
          // rate_type NOT IN NON_REV_IDS matches Tier 1/2's Room Revenue/Extras scope exactly —
          // without it, a fee charged on a FAM/Comp/Staff booking would double-count here AND in
          // nonRevenueBusiness below (which sums that booking's ENTIRE total_gross_amount,
          // fees included). This keeps the two categories non-overlapping.
          `SELECT SUM(CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) AS amount
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND i.date_out > i.date_in
            AND r.rate_type NOT IN (?)
            AND r.reservation_number NOT LIKE ?
            AND rc.component_description IN (?)`,
          [KES_RATE, NON_REV_IDS, RES_PREFIX, g.components]
        )
      )),
      Promise.all(categoryGroups.map((g) =>
        queryOne<{ amount: number }>(
          `SELECT SUM(IFNULL(CASE WHEN dt.currency='KES' THEN i.total_gross_amount/? ELSE i.total_gross_amount END,0)) AS amount
          FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = '30' AND ${dateInYearMonthRange('i.date_in', cy, monthLo, monthHi)} AND i.date_out > i.date_in
            AND r.reservation_number NOT LIKE ?
            AND r.rate_type IN (?)`,
          [KES_RATE, RES_PREFIX, g.rateTypes]
        )
      )),
    ])

    const byFee = feeGroups.map((g, idx) => ({ name: g.name, amount: Math.round(n(feeRows[idx]?.amount)) }))
    const passThroughTotal = byFee.reduce((s, f) => s + f.amount, 0)

    const byCategory = categoryGroups.map((g, idx) => ({ category: g.name, amount: Math.round(n(categoryRows[idx]?.amount)) }))
    const nonRevenueBusinessTotal = byCategory.reduce((s, c) => s + c.amount, 0)

    const data: NonRevenueData = {
      passThroughFees: { total: passThroughTotal, byFee },
      nonRevenueBusiness: { total: nonRevenueBusinessTotal, byCategory },
      grandTotal: passThroughTotal + nonRevenueBusinessTotal,
      appliedFilters: { year: cy, period, monthRange: [monthLo, monthHi] },
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[non-revenue route]', err)
    return NextResponse.json({ error: 'Failed to load non-revenue data', detail: String(err) }, { status: 500 })
  }
}
