import mysql from 'mysql2/promise'

function buildUri(): string {
  const raw = process.env.DATABASE_URL ?? ''
  // Strip SQLAlchemy driver prefix. Also tolerate a duplicated `DATABASE_URL=`
  // pasted into the value (common .env copy/paste mistake → ERR_INVALID_URL).
  const uri = raw
    .replace(/^DATABASE_URL=/, '')
    .replace(/^mysql\+mysqlconnector:\/\//, 'mysql://')
    .replace(/^mysql\+pymysql:\/\//, 'mysql://')
    // Strip charset query param — passed via options below
    .replace(/[?&]charset=[^&]*/g, '')
    .replace(/\?$/, '')
  return uri
}

// connectionLimit (2026-07-15) — raised from 5 to 18. The RDS instance's own max_connections is
// 637 (confirmed live via SHOW VARIABLES), with typically ~12 connections in use — 5 was a
// self-imposed bottleneck, not a server-side constraint. dashboard/route.ts alone fires 60+
// queries per request in large Promise.all batches; at connectionLimit 5 those serialize into
// ~11 waves. 18 stays well under 5% of the server's real ceiling while letting most of a batch
// run genuinely in parallel. If other processes share this DB credential, monitor
// Threads_connected/Max_used_connections after raising further.
//
// dateStrings: true (2026-07-17 fix) — without this, mysql2 converts DATE/DATETIME columns into
// JS Date objects anchored to the Node process's OS timezone. A pure calendar DATE (e.g.
// itineraries.date_in) has no time-of-day, so that conversion invents one (local midnight) and
// then re-expresses it in UTC — on any server whose local zone is ahead of UTC (confirmed live
// on this machine: Africa/Nairobi, UTC+3), local midnight of day D lands on day D-1 in UTC. Every
// piece of code that then reads the calendar day via getUTCDate()/toLocaleString(...,{timeZone:
// 'UTC'}) (dashboard/route.ts's PLT `ci`, daily/route.ts's fmtDate, agent/[agentId]/route.ts's
// fmtDate/fmtDateWithYear) displayed a date one day early — confirmed live across all 6 Upcoming
// Arrivals rows on 2026-07-17. Returning dates as plain 'YYYY-MM-DD'/'YYYY-MM-DD HH:mm:ss'
// strings removes the implicit timezone conversion entirely; downstream `new Date(dateString)` on
// a bare date-only string is UTC per spec, so the existing UTC-extraction formatting code is
// correct as-is once it receives a string instead of a pre-shifted Date object. Verified this only
// affects display formatting, not calculations — every "days until X" figure in the app
// (daysToArrival, daysToExpiry, nights, etc.) is computed in SQL via DATEDIFF(), never in JS.
export const pool = mysql.createPool({
  uri: buildUri(),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 18,
  queueLimit: 0,
  dateStrings: true,
})

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}
