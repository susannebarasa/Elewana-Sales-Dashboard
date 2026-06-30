import mysql from 'mysql2/promise'

function buildUri(): string {
  const raw = process.env.DATABASE_URL ?? ''
  // Strip SQLAlchemy driver prefix
  const uri = raw
    .replace(/^mysql\+mysqlconnector:\/\//, 'mysql://')
    .replace(/^mysql\+pymysql:\/\//, 'mysql://')
    // Strip charset query param — passed via options below
    .replace(/[?&]charset=[^&]*/g, '')
    .replace(/\?$/, '')
  return uri
}

export const pool = mysql.createPool({
  uri: buildUri(),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,
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
