// SQL safety guard for the AI Query Box's fallback free-form SQL path (2026-07-17).
//
// CONTEXT: the previous implementation (see git history, src/app/api/copilotkit/route.ts before
// this date) handed Claude a bare table/column description and executed whatever SQL came back
// with zero validation — no read-only check, no table allowlist, no timeout. This module is the
// safety boundary for the fallback path specifically (the pre-built query templates in
// templates.ts never touch this file — they're already-audited, parameterized SQL strings this
// route constructs itself, not model output).
//
// HONEST LIMITATION: `assertTablesAllowed` is a regex-based best-effort check, not a real SQL
// parser — it cannot catch every obfuscation (e.g. a table name hidden behind a CTE alias chain).
// It is a second layer behind `assertReadOnlySelect` (which blocks the actually-dangerous
// statement types) and the DB-level user permissions, not the sole line of defense. If this
// route's DB credential is ever changed, it should be a read-only grant at the MySQL level too —
// that is the real backstop; this module reduces the blast radius of accidents/prompt injection,
// it does not replace least-privilege DB access.
export class UnsafeQueryError extends Error {}

const WRITE_OR_DDL_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'RENAME',
  'GRANT', 'REVOKE', 'REPLACE', 'MERGE', 'CALL', 'EXEC', 'EXECUTE', 'LOCK', 'UNLOCK',
  'SET', 'LOAD', 'HANDLER', 'INTO OUTFILE', 'INTO DUMPFILE',
]

// Tables the fallback path is allowed to touch. Deliberately the same small set the rest of this
// app's audited queries use (roomRevenue.ts, dashboard/route.ts) — nothing here should ever need a
// table outside this list; if a real question does, that's a signal to add a new template, not to
// widen this allowlist casually.
export const ALLOWED_TABLES = [
  'reservations', 'itineraries', 'agents', 'properties', 'rate_components', 'rate_types', 'extras',
] as const

// Strips quoted string literals before keyword-scanning — this app's own segment/channel queries
// (buildSegmentOrChannelQuery) embed thousands of literal agent names as quoted SQL string values
// (no agent_id column in the source CSV, see agentSegments.ts), and real agency names legitimately
// contain keyword-like substrings (e.g. an agent literally named "...SET Travel...") that would
// otherwise false-positive against WRITE_OR_DDL_KEYWORDS. Handles '' as an escaped quote inside a
// '...'-delimited literal (standard SQL escaping) for both quote styles.
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""')
}

export function assertReadOnlySelect(sql: string): void {
  const trimmed = sql.trim().replace(/;+\s*$/, '') // tolerate one trailing semicolon
  if (trimmed.includes(';')) {
    throw new UnsafeQueryError('Query contains multiple statements — only a single SELECT is allowed.')
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    throw new UnsafeQueryError('Only SELECT queries are allowed.')
  }
  const upper = stripStringLiterals(trimmed).toUpperCase()
  for (const kw of WRITE_OR_DDL_KEYWORDS) {
    // Word-boundary match so e.g. a column literally named "assets" doesn't false-positive on "SET".
    const re = new RegExp(`(^|[^A-Z_])${kw}([^A-Z_]|$)`)
    if (re.test(upper)) {
      throw new UnsafeQueryError(`Query contains a disallowed keyword: ${kw}.`)
    }
  }
}

// Best-effort table-name extraction from FROM/JOIN clauses, checked against ALLOWED_TABLES. See
// the module comment above for why this is a second layer, not the sole guard. Same
// stripStringLiterals treatment as assertReadOnlySelect and for the same reason — this app's own
// segment/channel queries embed thousands of literal agent names, and a plain-text "from"/"join"
// substring inside one of those (e.g. an agency literally named "... Tours from Africa Ltd")
// would otherwise false-positive-capture the next word as a fake "table name". Caught live: a
// real agent name produced exactly this false positive ("Africa" flagged as a disallowed table).
export function assertTablesAllowed(sql: string, allowedTables: readonly string[] = ALLOWED_TABLES): void {
  const allowedSet = new Set(allowedTables.map((t) => t.toLowerCase()))
  const re = /\b(?:FROM|JOIN)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/gi
  let match: RegExpExecArray | null
  const found: string[] = []
  const stripped = stripStringLiterals(sql)
  while ((match = re.exec(stripped)) !== null) {
    found.push(match[1])
  }
  for (const table of found) {
    if (!allowedSet.has(table.toLowerCase())) {
      throw new UnsafeQueryError(`Query references a table outside the allowed set: ${table}.`)
    }
  }
}

export class QueryTimeoutError extends Error {}

// Runs a query with a hard timeout (mysql2's own `timeout` option, which cancels client-side and
// closes the connection rather than letting a runaway query hang the request indefinitely).
// Callers should catch QueryTimeoutError specifically and degrade gracefully — never let it bubble
// as a raw 500.
export async function runSafeQuery<T = Record<string, unknown>>(
  pool: import('mysql2/promise').Pool,
  sql: string,
  params: unknown[],
  timeoutMs: number
): Promise<T[]> {
  assertReadOnlySelect(sql)
  assertTablesAllowed(sql)
  try {
    const [rows] = await pool.query({ sql, timeout: timeoutMs }, params)
    return rows as T[]
  } catch (err) {
    const code = (err as { code?: string; errno?: number } | undefined)?.code
    if (code === 'PROTOCOL_SEQUENCE_TIMEOUT' || code === 'ETIMEDOUT') {
      throw new QueryTimeoutError('Query exceeded the time limit.')
    }
    throw err
  }
}
