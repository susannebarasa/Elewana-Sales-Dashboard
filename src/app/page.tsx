'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import type { DashboardData } from '@/types'
import Sidebar from '@/components/Sidebar'
import Topbar from '@/components/Topbar'
import PaceView from '@/components/views/PaceView'
import OccView from '@/components/views/OccView'
import AgentsView from '@/components/views/AgentsView'
import PipelineView from '@/components/views/PipelineView'
import ConsultView from '@/components/views/ConsultView'

interface Filters {
  period: 'm' | 'y' | 'a'
  year: string
  channel: string
  market: string
}

const CY = String(new Date().getFullYear())

export default function Page() {
  const [view, setView] = useState('sales')
  const [sub, setSub] = useState('pace')
  const [filters, setFilters] = useState<Filters>({
    period: 'y',
    year: CY,
    channel: 'all',
    market: 'all',
  })
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/dashboard')
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: DashboardData) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

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

    switch (sub) {
      case 'pace': return <PaceView data={data} filters={filters} />
      case 'occ':  return <OccView data={data} filters={filters} />
      case 'tp':   return <AgentsView data={data} filters={filters} />
      case 'pl':   return <PipelineView data={data} filters={filters} />
      case 'cn':   return <ConsultView data={data} filters={filters} />
      default:     return <PaceView data={data} filters={filters} />
    }
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Sidebar view={view} onView={(v) => { setView(v); setSub('pace') }} />
      <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Topbar
          view={view}
          sub={sub}
          onSub={setSub}
          filters={filters}
          onFilters={setFilters}
          lastUpdated={data?.lastUpdated ?? ''}
        />
        <Box sx={{ flex: 1, overflowY: 'auto', p: '18px 20px' }}>
          {renderContent()}
        </Box>
      </Box>
    </Box>
  )
}
