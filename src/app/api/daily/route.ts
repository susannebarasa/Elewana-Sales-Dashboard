export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import type { DailyData, DailyArrivalItem, DailyProvisionalItem, DailyConsultant } from '@/types'
import {
  NON_REVENUE_RATE_TYPE_IDS,
  EXCLUDED_AGENT_IDS,
  EXCLUDED_AGENT_NAMES_EXACT,
  EXCLUDED_AGENT_NAME_PATTERN,
  AGENT_NAME_PATTERN_CARVEOUT_SQL,
  EXCLUDED_RESERVATION_PREFIX,
  KES_USD_RATE,
  BOOKING_STATUS,
  PROPERTY_ROOM_COUNTS,
} from '@/lib/constants'

// Property (2026-07-16, "no exceptions" property-filter pass) — same known-good propertyId set
// as dashboard/route.ts's VALID_PROPERTY_IDS, so an invalid/stale value from the client can't
// reach a query. Daily was the last view left unfiltered — see project memory.
const VALID_PROPERTY_IDS = new Set(
  Object.values(PROPERTY_ROOM_COUNTS).map((p) => p.propertyId).filter((id): id is string => id !== null)
)

// ── helpers ──────────────────────────────────────────────────────────────────
const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}
const i = (v: unknown, def = 0): number => Math.round(n(v, def))

const fmtDate = (v: unknown): string => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(String(v))
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`
}

const ALLOWED_WINDOWS = [3, 7, 14, 21]

// ── route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const requestedWindow = i(req.nextUrl.searchParams.get('window'), 3)
    const windowDays = ALLOWED_WINDOWS.includes(requestedWindow) ? requestedWindow : 3
    const consultantId = req.nextUrl.searchParams.get('consultant') || ''
    const requestedProperty = req.nextUrl.searchParams.get('property') || ''
    const property = requestedProperty !== 'all' && VALID_PROPERTY_IDS.has(requestedProperty) ? requestedProperty : ''

    // Build exclusion arrays once — mysql2 expands array params into IN(?,?,...) automatically
    const NON_REV_IDS = Array.from(NON_REVENUE_RATE_TYPE_IDS)
    const EX_AGENT_IDS = Array.from(EXCLUDED_AGENT_IDS)
    const EX_AGENT_NAMES = Array.from(EXCLUDED_AGENT_NAMES_EXACT)
    const AGENT_NAME_LIKE = EXCLUDED_AGENT_NAME_PATTERN // '%direct%'
    const RES_PREFIX = EXCLUDED_RESERVATION_PREFIX // 'PA%'
    const CONFIRMED_STATUS = BOOKING_STATUS.CONFIRMED // '30'
    const PROVISIONAL_STATUS = BOOKING_STATUS.PROVISIONAL // '20'
    const KES_RATE = KES_USD_RATE // 129

    // Reusable exclusion clause for queries joined to `a` (agents)
    const AGENT_EXCLUSION_SQL = `
      AND r.rate_type NOT IN (?)
      AND r.reservation_number NOT LIKE ?
      AND a.agent_id NOT IN (?)
      AND a.agent_name NOT IN (?)
      AND (LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))`
    const agentExclusionParams = [NON_REV_IDS, RES_PREFIX, EX_AGENT_IDS, EX_AGENT_NAMES, AGENT_NAME_LIKE]

    // Consultant filter — scopes the whole tab (KPIs + all three tables) when set.
    const CONSULTANT_SQL = consultantId ? 'AND r.consultant = ?' : ''
    const consultantParam = consultantId ? [consultantId] : []

    // Property filter — scopes the whole tab the same way. All 6 queries below either already
    // join `itineraries i` or get one added here (provisionalsExpiringRow) specifically so this
    // one fragment applies uniformly — see that query's own comment for why adding the join
    // there is safe (COUNT(DISTINCT r.reservation_number) is immune to itinerary-leg fan-out).
    const PROPERTY_SQL = property ? 'AND i.property = ?' : ''
    const propertyParam = property ? [property] : []

    const [
      arrivals3dRow,
      provisionalsExpiringRow,
      cashOutstandingRow,
      arrivalsRows,
      expiringProvisionalRows,
      cashOutstandingRows,
      consultantRows,
    ] = await Promise.all([
      // KPI 1 — Arrivals next 3 days (fixed window, independent of the T-minus table toggle)
      queryOne<{ cnt: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS cnt
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status = ?
          AND i.date_in BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
          ${AGENT_EXCLUSION_SQL}
          ${CONSULTANT_SQL}
          ${PROPERTY_SQL}`,
        [CONFIRMED_STATUS, ...agentExclusionParams, ...consultantParam, ...propertyParam]
      ),

      // KPI 2 — Provisionals expiring this week (fixed 7-day window; provision_expiry_date
      // confirmed as the real field — 0 NULLs across current status=20 rows). Originally had no
      // itinerary join (provision_expiry_date lives on reservations) — one added here (2026-07-16,
      // "no exceptions" property-filter pass) solely to reach i.property; COUNT(DISTINCT
      // r.reservation_number) is immune to the resulting per-leg fan-out, so no dedup needed.
      queryOne<{ cnt: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS cnt
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status = ?
          AND r.provision_expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          ${AGENT_EXCLUSION_SQL}
          ${CONSULTANT_SQL}
          ${PROPERTY_SQL}`,
        [PROVISIONAL_STATUS, ...agentExclusionParams, ...consultantParam, ...propertyParam]
      ),

      // KPI 3 — Cash outstanding: booking-value proxy for confirmed arrivals within the
      // selected T-minus window (no payment-ledger table exists in ResRequest — see note
      // returned alongside this figure). Deduped to one row per reservation before summing
      // (a reservation can have multiple itinerary legs — see JOIN_SAFETY_NOTE in constants.ts).
      queryOne<{ total: number }>(
        `SELECT SUM(total_amount) AS total FROM (
          SELECT DISTINCT r.reservation_number,
            CASE WHEN dt.currency = 'KES' THEN r.total_amount / ? ELSE r.total_amount END AS total_amount
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = ?
            AND r.total_amount > 0
            AND i.date_in BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
            ${AGENT_EXCLUSION_SQL}
            ${CONSULTANT_SQL}
            ${PROPERTY_SQL}
        ) deduped`,
        [KES_RATE, CONFIRMED_STATUS, windowDays, ...agentExclusionParams, ...consultantParam, ...propertyParam]
      ),

      // Section 2 — Confirmed Arrivals table. Rolled up to one row per reservation_number +
      // property: a genuine multi-property circuit (e.g. WB319445: WB2909 then WB2910) still
      // shows as separate rows per property-stay, but multiple rooms booked at the SAME
      // property on the SAME arrival (e.g. WB314772: 5 rooms, 1 property, 1 date) collapse
      // into one row with a room count — those were never separate check-ins, just separate
      // itinerary rows for separate rooms (confirmed via accommodation_type differing across
      // the rows while property/date_in/date_out were identical).
      query<{
        rn: string; guest: string; agent: string; agent_id: string; property: string; property_id: string
        arrival_date: Date; days: number; balance: number; room_count: number; status: string
      }>(
        `SELECT r.reservation_number AS rn, r.reservation_name AS guest, a.agent_name AS agent,
          a.agent_id AS agent_id,
          COALESCE(p.name, i.property) AS property, i.property AS property_id,
          MIN(i.date_in) AS arrival_date,
          DATEDIFF(MIN(i.date_in), CURDATE()) AS days,
          SUM(CASE WHEN dt.currency = 'KES' THEN IFNULL(i.total_gross_amount, r.total_amount) / ?
                   ELSE IFNULL(i.total_gross_amount, r.total_amount) END) AS balance,
          COUNT(*) AS room_count,
          CASE r.status WHEN '30' THEN 'Confirmed' WHEN '20' THEN 'Provisional' ELSE r.status END AS status
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        LEFT JOIN properties p ON i.property = p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = ?
          AND i.date_in BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
          ${AGENT_EXCLUSION_SQL}
          ${CONSULTANT_SQL}
          ${PROPERTY_SQL}
        GROUP BY r.reservation_number, r.reservation_name, r.status, a.agent_name, a.agent_id, i.property, p.name
        ORDER BY arrival_date ASC`,
        [KES_RATE, CONFIRMED_STATUS, windowDays, ...agentExclusionParams, ...consultantParam, ...propertyParam]
      ),

      // Section 3 — Expiring Provisionals. One row per reservation (the hold expiring is a
      // reservation-level event, not a per-leg one) — dedupe to the earliest itinerary leg
      // via ROW_NUMBER (MySQL 8.0 window functions confirmed available on this server).
      query<{
        rn: string; agent: string; agent_id: string; property: string; property_id: string
        arrival_date: Date; days_to_arrival: number
        expiry_date: Date; days_to_expiry: number; value: number
      }>(
        `SELECT reservation_number AS rn, agent, agent_id, property, property_id, arrival_date, days_to_arrival,
          expiry_date, days_to_expiry, value
        FROM (
          SELECT r.reservation_number, a.agent_name AS agent, a.agent_id AS agent_id,
            COALESCE(p.name, i.property) AS property, i.property AS property_id,
            i.date_in AS arrival_date,
            DATEDIFF(i.date_in, CURDATE()) AS days_to_arrival,
            r.provision_expiry_date AS expiry_date,
            DATEDIFF(r.provision_expiry_date, CURDATE()) AS days_to_expiry,
            CASE WHEN dt.currency = 'KES' THEN IFNULL(i.total_gross_amount, r.total_amount) / ?
                 ELSE IFNULL(i.total_gross_amount, r.total_amount) END AS value,
            ROW_NUMBER() OVER (PARTITION BY r.reservation_number ORDER BY i.date_in ASC, i.itinerary_id ASC) AS rn_leg
          FROM reservations r
          JOIN itineraries i ON r.reservation_number = i.reservation_number
          JOIN agents a ON r.agent_id = a.agent_id
          LEFT JOIN properties p ON i.property = p.property_id
          LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
          WHERE r.status = ?
            AND r.provision_expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            ${AGENT_EXCLUSION_SQL}
            ${CONSULTANT_SQL}
            ${PROPERTY_SQL}
        ) legs
        WHERE rn_leg = 1
        ORDER BY arrival_date ASC
        LIMIT 20`,
        [KES_RATE, PROVISIONAL_STATUS, ...agentExclusionParams, ...consultantParam, ...propertyParam]
      ),

      // Section 4 — Cash Outstanding table. Same shape/scope as Section 2 PRE-fix (still
      // per-leg, not rolled up) — the room-split fix requested this session was scoped to the
      // Confirmed Arrivals table only. This table has the identical root-cause construction
      // (a multi-room reservation will show one row per room here too) — flagged, not changed.
      query<{
        rn: string; guest: string; agent: string; agent_id: string; property: string; property_id: string
        arrival_date: Date; days: number; balance: number; status: string
      }>(
        `SELECT r.reservation_number AS rn, r.reservation_name AS guest, a.agent_name AS agent,
          a.agent_id AS agent_id,
          COALESCE(p.name, i.property) AS property, i.property AS property_id,
          i.date_in AS arrival_date,
          DATEDIFF(i.date_in, CURDATE()) AS days,
          CASE WHEN dt.currency = 'KES' THEN IFNULL(i.total_gross_amount, r.total_amount) / ?
               ELSE IFNULL(i.total_gross_amount, r.total_amount) END AS balance,
          CASE r.status WHEN '30' THEN 'Confirmed' WHEN '20' THEN 'Provisional' ELSE r.status END AS status
        FROM reservations r
        JOIN itineraries i ON r.reservation_number = i.reservation_number
        JOIN agents a ON r.agent_id = a.agent_id
        LEFT JOIN properties p ON i.property = p.property_id
        LEFT JOIN rate_types dt ON r.rate_type = dt.rate_type_id
        WHERE r.status = ?
          AND r.total_amount > 0
          AND i.date_in BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
          ${AGENT_EXCLUSION_SQL}
          ${CONSULTANT_SQL}
          ${PROPERTY_SQL}
        ORDER BY i.date_in ASC`,
        [KES_RATE, CONFIRMED_STATUS, windowDays, ...agentExclusionParams, ...consultantParam, ...propertyParam]
      ),

      // Consultant filter options — named consultants only (consultant_first_name/last_name
      // populated for ~72% of active reservations; the raw `consultant` column is an ID code,
      // e.g. "WB104749", not a display name — join to the name columns for the dropdown label).
      query<{ id: string; name: string }>(
        `SELECT DISTINCT r.consultant AS id, CONCAT(r.consultant_first_name, ' ', r.consultant_last_name) AS name
        FROM reservations r
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE r.status IN (?, ?)
          AND r.consultant IS NOT NULL AND r.consultant != ''
          AND r.consultant_first_name IS NOT NULL AND r.consultant_first_name != ''
          ${AGENT_EXCLUSION_SQL}
        ORDER BY name ASC`,
        [PROVISIONAL_STATUS, CONFIRMED_STATUS, ...agentExclusionParams]
      ),
    ])

    const toArrivalItem = (r: {
      rn: string; guest: string; agent: string; agent_id: string; property: string; property_id?: string
      arrival_date: Date; days: number; balance: number; status: string; room_count?: number
    }): DailyArrivalItem => ({
      reservationNumber: r.rn,
      guest: r.guest || 'Unknown',
      agent: r.agent ?? 'Unknown',
      agentId: r.agent_id,
      property: r.property ?? 'Unknown',
      propertyId: r.property_id ?? null,
      arrivalDate: fmtDate(r.arrival_date),
      daysToArrival: i(r.days),
      balance: Math.round(n(r.balance)),
      roomCount: r.room_count != null ? i(r.room_count) : undefined,
      status: r.status,
    })

    const toProvisionalItem = (r: {
      rn: string; agent: string; agent_id: string; property: string; property_id?: string
      arrival_date: Date; days_to_arrival: number
      expiry_date: Date; days_to_expiry: number; value: number
    }): DailyProvisionalItem => ({
      reservationNumber: r.rn,
      agent: r.agent ?? 'Unknown',
      agentId: r.agent_id,
      property: r.property ?? 'Unknown',
      propertyId: r.property_id ?? null,
      arrivalDate: fmtDate(r.arrival_date),
      daysToArrival: i(r.days_to_arrival),
      expiryDate: fmtDate(r.expiry_date),
      daysToExpiry: i(r.days_to_expiry),
      value: Math.round(n(r.value)),
    })

    const consultants: DailyConsultant[] = consultantRows.map((c) => ({ id: c.id, name: c.name }))

    const data: DailyData = {
      window: windowDays,
      consultant: consultantId || null,
      consultants,
      kpi: {
        arrivalsNext3d: i(arrivals3dRow?.cnt),
        // "Needs action" would require balance-outstanding / voucher-status fields that do
        // not exist anywhere in ResRequest (confirmed via full schema search) — not faked.
        arrivalsNeedAction: null,
        arrivalsNeedActionNote: 'pending data source — no balance/voucher fields in ResRequest',
        provisionalsExpiring7d: i(provisionalsExpiringRow?.cnt),
        cashOutstanding: Math.round(n(cashOutstandingRow?.total)),
        cashOutstandingNote: 'Booking value (reservations.total_amount) for confirmed arrivals in the selected window — ResRequest holds no payment-ledger data, so this is a proxy, not a confirmed outstanding balance. Actual payments are tracked in Opera.',
      },
      arrivals: arrivalsRows.map(toArrivalItem),
      expiringProvisionals: expiringProvisionalRows.map(toProvisionalItem),
      cashOutstanding: cashOutstandingRows.map(toArrivalItem),
      lastUpdated: new Date().toISOString(),
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('daily route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
