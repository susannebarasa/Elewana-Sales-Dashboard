import duckdb from 'duckdb'

let _db: duckdb.Database | null = null

function getDb(): duckdb.Database {
  if (_db) return _db
  const token = process.env.MOTHERDUCK_TOKEN
  if (!token) throw new Error('MOTHERDUCK_TOKEN is not set')
  _db = new duckdb.Database(`md:ResRequest`, { motherduck_token: token })
  return _db
}

export function mdQuery(sql: string): Promise<duckdb.RowData[]> {
  return new Promise((resolve, reject) => {
    const db = getDb()
    db.all(sql, (err, rows) => {
      if (err) reject(err)
      else resolve(rows ?? [])
    })
  })
}
