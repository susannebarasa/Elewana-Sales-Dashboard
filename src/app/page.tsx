'use client'
import { useState, useEffect } from 'react'
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
    if (loading) return <div className="loading">Loading dashboard data…</div>
    if (error)   return <div className="err">Error: {error}</div>
    if (!data)   return <div className="loading">No data</div>

    if (view !== 'sales') {
      return <div className="loading" style={{ color: 'var(--mu)' }}>{view} — coming soon</div>
    }

    switch (sub) {
      case 'pace':   return <PaceView data={data} filters={filters} />
      case 'occ':    return <OccView data={data} filters={filters} />
      case 'tp':     return <AgentsView data={data} filters={filters} />
      case 'pl':     return <PipelineView data={data} filters={filters} />
      case 'cn':     return <ConsultView data={data} filters={filters} />
      default:       return <PaceView data={data} filters={filters} />
    }
  }

  return (
    <div className="app">
      <Sidebar view={view} onView={(v) => { setView(v); setSub('pace') }} />
      <div className="main">
        <Topbar
          view={view}
          sub={sub}
          onSub={setSub}
          filters={filters}
          onFilters={setFilters}
          lastUpdated={data?.lastUpdated ?? ''}
        />
        <div className="content">{renderContent()}</div>
      </div>
    </div>
  )
}
