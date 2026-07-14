'use client'
import { useState, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import DashboardSkeleton from '@/components/DashboardSkeleton'
import type { DashboardData, EntityClickContext } from '@/types'
import SalesExecutiveSummaryDesign from '@/components/views/SalesExecutiveSummaryDesign'
import SalesExecAgentPanel from '@/components/SalesExecAgentPanel'
import PropertyProfilePanel from '@/components/PropertyProfilePanel'

export interface SesFilters { period: 'm' | 'y' | 'a'; year: string; market: string; property: string }

const CY = String(new Date().getFullYear())

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
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  // Measured Header + filter-bar height (2026-07-16, Agent Panel height fix) — the Agent Panel
  // drawer starts below this instead of overlaying the whole viewport. 118 is a sensible fallback
  // for the very first paint before SalesExecutiveSummaryDesign's ResizeObserver reports the real
  // value; it's overwritten immediately on mount.
  const [headerHeight, setHeaderHeight] = useState(118)
  const cacheRef = useRef<Map<string, DashboardData>>(new Map())

  useEffect(() => {
    const cacheKey = `${filters.year}|${filters.period}|${filters.market}|${filters.property}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setData(cached)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      year: filters.year,
      period: filters.period,
      channel: 'all',
      market: filters.market,
      property: filters.property,
      view: 'sales-exec-summary',
    })
    fetch(`/api/dashboard?${params.toString()}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: DashboardData) => {
        if (cancelled) return
        cacheRef.current.set(cacheKey, d)
        setData(d)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [filters.year, filters.period, filters.market, filters.property])

  const handleSelectProperty = (ctx: EntityClickContext) => {
    if (ctx.type === 'property') setSelectedPropertyId(ctx.id)
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#EDEEE6' }}>
      {loading && <DashboardSkeleton />}
      {error && <Alert severity="error" sx={{ m: 3 }}>Failed to load dashboard data: {error}</Alert>}
      {!loading && !error && data && (
        <SalesExecutiveSummaryDesign
          data={data}
          filters={filters}
          onFilters={setFilters}
          onSelectAgent={setSelectedAgentId}
          onSelectProperty={handleSelectProperty}
          onHeaderHeight={setHeaderHeight}
        />
      )}
      <SalesExecAgentPanel agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} topOffset={headerHeight} />
      <PropertyProfilePanel propertyId={selectedPropertyId} onClose={() => setSelectedPropertyId(null)} />
    </Box>
  )
}
