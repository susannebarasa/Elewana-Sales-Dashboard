// Fixed-concurrency worker pool (2026-07-15) — runs `thunks` with at most `limit` in flight at
// once, preserving result order like Promise.all. Built to throttle how many queries hit the DB
// simultaneously: profiling showed that firing 50+ analytical queries at once (even with plenty
// of app-side connection-pool headroom) causes severe DB-side contention — an isolated 1-3s query
// takes 20-30s when 50+ siblings run against the same instance at the same time. Limiting to
// ~10-15 concurrent lets the DB actually finish each group before starting the next, without the
// app-side connection pool ever being the constraint (see dashboard/route.ts's own comment).
// Tuple-preserving generic (mirrors Promise.all's own typing) — when called with an array
// literal of heterogeneous thunks (the main dashboard batch, 60+ distinct row types), each
// destructured result keeps its own precise type instead of collapsing to a union. When called
// with a same-typed array (e.g. Market Segment's 9 identical per-segment thunks), it still
// resolves correctly to that single type's array.
export async function runWithConcurrencyLimit<T extends readonly (() => Promise<unknown>)[]>(
  thunks: readonly [...T],
  limit: number
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = new Array(thunks.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < thunks.length) {
      const current = nextIndex++
      results[current] = await thunks[current]()
    }
  }
  const workerCount = Math.min(limit, thunks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> }
}
