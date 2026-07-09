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
export const pool = mysql.createPool({
  uri: buildUri(),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 18,
  queueLimit: 0,
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
