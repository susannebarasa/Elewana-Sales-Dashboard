'use client'
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import type { DashboardData, EntityClickContext } from '@/types'
import SalesExecutiveSummaryDesign from '@/components/views/SalesExecutiveSummaryDesign'
import SalesExecAgentPanel from '@/components/SalesExecAgentPanel'
import PropertyProfilePanel from '@/components/PropertyProfilePanel'
import MarketSegmentProfilePanel from '@/components/MarketSegmentProfilePanel'

export interface SesFilters { period: 'm' | 'y' | 'a'; year: string; market: string; property: string }

const CY = String(new Date().getFullYear())

// Progressive-loading split (2026-07-16c) — the backend now serves this page as 3 independent
// views on /api/dashboard (?view=sales-exec-summary-kpis / -charts / -leaderboard), each returning
// only the DashboardData slice it actually queries (see src/lib/dashboardViews.ts's
// VIEW_DATA_KEYS). Rather than waiting for all 3 and rendering once (the old single-fetch flow),
// each section fetches, caches, and renders independently so KPIs/narrative can appear as soon as
// the fastest query resolves without blocking on the slower Agent Leaderboard query (~833 agents).
type SesSection = 'kpis' | 'charts' | 'leaderboard'
const SECTION_VIEW: Record<SesSection, string> = {
  kpis: 'sales-exec-summary-kpis',
  charts: 'sales-exec-summary-charts',
  leaderboard: 'sales-exec-summary-leaderboard',
}

interface SectionState {
  data: DashboardData | null
  loading: boolean
  error: string | null
}
const INITIAL_SECTION_STATE: SectionState = { data: null, loading: true, error: null }

// Sales Executive Summary — standalone single-tab dashboard (2026-07-16), ported from the Claude
// Design "Elewana Sales Executive Summary" export. Deliberately a SEPARATE Next.js route, not a
// mode-flag inside src/app/page.tsx's SPA shell — no Sidebar/Topbar are rendered here at all, and
// every existing view at '/' is completely untouched and still reachable. Reversible by simply
// removing this route folder.
//
// Segment filter uses the real 9-value Market Segment taxonomy (src/lib/agentSegments.ts), not the
// Claude Design mockup's fictional Wholesale/Retail/DMC/OTA 4-pill set — confirmed with the user.
// No Channel filter — dropped per explicit instruction; this page maps only to Segment.
export default function SalesExecutiveSummaryPage() {
  const [filters, setFilters] = useState<SesFilters>({ period: 'y', year: CY, market: 'all', property: 'all' })
  const [kpis, setKpis] = useState<SectionState>(INITIAL_SECTION_STATE)
  const [charts, setCharts] = useState<SectionState>(INITIAL_SECTION_STATE)
  const [leaderboard, setLeaderboard] = useState<SectionState>(INITIAL_SECTION_STATE)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null)
  // Cache keyed by `${section}|${filterCacheKey}` — extends the previous single-section cacheRef
  // pattern to 3 sections sharing one Map, so switching back to a previously-seen filter combo
  // still skips the network for every section independently.
  const cacheRef = useRef<Map<string, DashboardData>>(new Map())

  useEffect(() => {
    const filterKey = `${filters.year}|${filters.period}|${filters.market}|${filters.property}`
    // Built once per filter change, cloned per section below (only `view` differs) — guarantees
    // all 3 requests carry identical year/period/channel/market/property, so the 3 sections can
    // never desync on filters even though they resolve at different times.
    const baseParams = new URLSearchParams({
      year: filters.year,
      period: filters.period,
      channel: 'all',
      market: filters.market,
      property: filters.property,
    })

    let cancelled = false
    const setters: Record<SesSection, (s: SectionState) => void> = {
      kpis: setKpis,
      charts: setCharts,
      leaderboard: setLeaderboard,
    }

    ;(['kpis', 'charts', 'leaderboard'] as SesSection[]).forEach((section) => {
      const cacheKey = `${section}|${filterKey}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        setters[section]({ data: cached, loading: false, error: null })
        return
      }

      setters[section]({ data: null, loading: true, error: null })
      const params = new URLSearchParams(baseParams)
      params.set('view', SECTION_VIEW[section])
      fetch(`/api/dashboard?${params.toString()}`)
        .then((r) => {
          if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
          return r.json()
        })
        .then((d: DashboardData) => {
          if (cancelled) return
          cacheRef.current.set(cacheKey, d)
          setters[section]({ data: d, loading: false, error: null })
        })
        .catch((e) => {
          if (cancelled) return
          setters[section]({ data: null, loading: false, error: String(e) })
        })
    })

    return () => { cancelled = true }
  }, [filters.year, filters.period, filters.market, filters.property])

  const handleSelectProperty = (ctx: EntityClickContext) => {
    if (ctx.type === 'property') setSelectedPropertyId(ctx.id)
  }
  const handleSelectSegment = (ctx: EntityClickContext) => {
    if (ctx.type === 'segment') setSelectedSegment(ctx.id)
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#EDEEE6' }}>
      <SalesExecutiveSummaryDesign
        kpisData={kpis.data}
        kpisLoading={kpis.loading}
        kpisError={kpis.error}
        chartsData={charts.data}
        chartsLoading={charts.loading}
        chartsError={charts.error}
        leaderboardData={leaderboard.data}
        leaderboardLoading={leaderboard.loading}
        leaderboardError={leaderboard.error}
        filters={filters}
        onFilters={setFilters}
        onSelectAgent={setSelectedAgentId}
        onSelectProperty={handleSelectProperty}
        onSelectSegment={handleSelectSegment}
      />
      <SalesExecAgentPanel agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      <PropertyProfilePanel propertyId={selectedPropertyId} onClose={() => setSelectedPropertyId(null)} />
      {/* channel: 'all' hardcoded (2026-07-17) — this page has no Channel filter (dropped per
          explicit instruction, see the module comment above); matches the 'all' already hardcoded
          into this page's own /api/dashboard fetch params. */}
      <MarketSegmentProfilePanel
        segment={selectedSegment}
        filters={{ ...filters, channel: 'all' }}
        onClose={() => setSelectedSegment(null)}
        onSelectProperty={handleSelectProperty}
        onSelectAgent={setSelectedAgentId}
      />
    </Box>
  )
}
