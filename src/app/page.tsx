'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import type { DashboardData, EntityClickContext } from '@/types'
import Sidebar, { DRAWER_WIDTH } from '@/components/Sidebar'
import Topbar from '@/components/Topbar'
import DailyView from '@/components/views/DailyView'
import ExecSummaryView from '@/components/views/ExecSummaryView'
import PropertyPerformanceView from '@/components/views/PropertyPerformanceView'
import MarketSegmentPerformanceView from '@/components/views/MarketSegmentPerformanceView'
import BookingStatusMovementView from '@/components/views/BookingStatusMovementView'
import PaceView from '@/components/views/PaceView'
import OccView from '@/components/views/OccView'
import AgentsView from '@/components/views/AgentsView'
import PipelineView from '@/components/views/PipelineView'
import ConsultView from '@/components/views/ConsultView'
import AiQueryBox from '@/components/AiQueryBox'
import AgentProfilePanel from '@/components/AgentProfilePanel'
import AgentPerformanceDrillPanel from '@/components/AgentPerformanceDrillPanel'
import PropertyProfilePanel from '@/components/PropertyProfilePanel'
import MarketSegmentProfilePanel from '@/components/MarketSegmentProfilePanel'

interface Filters {
  period: 'm' | 'y' | 'a'
  year: string
  channel: string
  market: string
  property: string
}

const CY = String(new Date().getFullYear())

export default function Page() {
  const [view, setView] = useState('sales')
  // Nav consolidation (2026-07-09) — default landing sub-tab is now Sales Executive Summary,
  // matching its position 1 of 10 in the consolidated order.
  const [sub, setSub] = useState('exec-summary')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [filters, setFilters] = useState<Filters>({
    period: 'y',
    year: CY,
    channel: 'all',
    market: 'all',
    property: 'all',
  })
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  // Agent Performance drill-down (2026-07-14g) — deliberately SEPARATE from selectedAgentId.
  // Agent clicks from AgentsView (Trade Partners/Agent Performance) open this view-specific
  // panel; agent clicks from every other view (Consultants, Pipeline, Daily) still open the
  // existing generic AgentProfilePanel via selectedAgentId, unchanged.
  const [selectedPerformanceAgentId, setSelectedPerformanceAgentId] = useState<string | null>(null)
  // Entity click context (2026-07-15 standing instruction) — ONE shared state for every
  // {type,id,sourceView} click, not a new useState per view. Each panel below reads it and only
  // renders when context.type matches its own entity type. Property Performance and Market
  // Segment Performance both produce one today.
  const [entityClick, setEntityClick] = useState<EntityClickContext | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      year: filters.year,
      period: filters.period,
      channel: filters.channel,
      market: filters.market,
      property: filters.property,
    })
    fetch(`/api/dashboard?${params.toString()}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: DashboardData) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [filters.year, filters.period, filters.channel, filters.market, filters.property])

  const renderContent = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
          <CircularProgress size={28} sx={{ color: 'primary.main' }} />
        </Box>
      )
    }
    if (error) {
      return <Alert severity="error" sx={{ mt: 2 }}>Failed to load dashboard data: {error}</Alert>
    }
    if (!data) return null

    if (view !== 'sales') {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, color: 'text.secondary', fontSize: 13 }}>
          {view} — coming soon
        </Box>
      )
    }

    // Nav consolidation (2026-07-09) — all 10 views are now sub-tabs of Sales, in one switch.
    // The 4 that used to be separate Sidebar entries (exec-summary/property-performance/
    // market-segment-performance/booking-status-movement) are unchanged in content — only their
    // navigation position moved.
    switch (sub) {
      case 'exec-summary':               return <ExecSummaryView data={data} filters={filters} onSelectProperty={setEntityClick} />
      case 'property-performance':       return <PropertyPerformanceView data={data} onSelectProperty={setEntityClick} />
      case 'market-segment-performance': return <MarketSegmentPerformanceView data={data} filters={filters} onSelectSegment={setEntityClick} />
      case 'booking-status-movement':    return <BookingStatusMovementView data={data} filters={filters} />
      case 'tp':   return <AgentsView data={data} filters={filters} onSelectAgentPerformance={setSelectedPerformanceAgentId} onSelectProperty={setEntityClick} />
      case 'pace': return <PaceView data={data} filters={filters} onSelectProperty={setEntityClick} />
      case 'occ':  return <OccView data={data} filters={filters} onSelectProperty={setEntityClick} />
      case 'pl':   return <PipelineView data={data} filters={filters} onSelectAgent={setSelectedAgentId} onSelectProperty={setEntityClick} />
      case 'cn':   return <ConsultView data={data} filters={filters} />
      case 'daily': return <DailyView onSelectAgent={setSelectedAgentId} onSelectProperty={setEntityClick} />
      default:     return <ExecSummaryView data={data} filters={filters} onSelectProperty={setEntityClick} />
    }
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Sidebar
        open={sidebarOpen}
        view={view}
        onView={(v) => { setView(v); setSub('exec-summary') }}
      />
      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          ml: sidebarOpen ? `${DRAWER_WIDTH}px` : 0,
          transition: 'margin 0.22s ease',
        }}
      >
        <Topbar
          view={view}
          sub={sub}
          onSub={setSub}
          filters={filters}
          onFilters={setFilters}
          lastUpdated={data?.lastUpdated ?? ''}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onSelectAgent={setSelectedAgentId}
          agentDefaultOptions={data?.AD.yearly.map((a) => ({ id: a.id, name: a.nm })) ?? []}
        />
        <Box sx={{ flex: 1, overflowY: 'auto', p: '18px 20px' }}>
          {renderContent()}
        </Box>
      </Box>
      <AiQueryBox />
      <AgentProfilePanel agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
      <AgentPerformanceDrillPanel agentId={selectedPerformanceAgentId} onClose={() => setSelectedPerformanceAgentId(null)} />
      <PropertyProfilePanel propertyId={entityClick?.type === 'property' ? entityClick.id : null} onClose={() => setEntityClick(null)} />
      <MarketSegmentProfilePanel
        segment={entityClick?.type === 'segment' ? entityClick.id : null}
        filters={filters}
        onClose={() => setEntityClick(null)}
        onSelectProperty={setEntityClick}
        onSelectAgent={setSelectedAgentId}
      />
    </Box>
  )
}
