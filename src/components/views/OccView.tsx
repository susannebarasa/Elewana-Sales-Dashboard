'use client'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData } from '@/types'
import KpiRow from '@/components/KpiRow'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip)

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters }

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
  },
}

export default function OccView({ data, filters }: Props) {
  const kp = data.KP_BASE.occ

  const revByPropData = {
    labels: data.OD.props.map((p) => p.nm),
    datasets: [{
      data: data.OD.props.map((p) => p.ar),
      backgroundColor: 'rgba(74,90,58,0.7)',
      borderRadius: 3,
    }],
  }

  const arrTrendData = {
    labels: data.OD.arr.months,
    datasets: [
      { label: filters.year, data: data.OD.arr.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.OD.arr.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
    ],
  }

  return (
    <div className="fu">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: 'var(--ocl)', border: '0.5px solid var(--oc)', borderRadius: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--ocd)' }}>ℹ</span>
        <span style={{ fontSize: 11, color: 'var(--ocd)' }}>
          Room nights &amp; rate data sourced from <strong>ResRequest</strong>. Occupancy %, RevPAR &amp; budget comparisons available in the <strong>MIS view</strong>.
        </span>
      </div>

      <KpiRow metrics={[kp.nights, kp.adr, kp.rev, kp.cancel]} />

      <div className="g2">
        <div className="cc">
          <div className="cc-t">Revenue by Property</div>
          <div className="cc-s">ADR from ResRequest bookings — last 90 days</div>
          <div className="ca">
            <Bar data={revByPropData} options={{ ...CHART_OPTS, indexAxis: 'y' as const }} />
          </div>
        </div>
        <div className="cc">
          <div className="cc-t">Arrival Revenue Trend</div>
          <div className="cc-s">{filters.year} vs LY — itinerary gross revenue</div>
          <div className="ca"><Line data={arrTrendData} options={CHART_OPTS} /></div>
        </div>
      </div>

      <div className="cc" style={{ marginTop: 14 }}>
        <div className="cc-t">Occupancy by Property</div>
        <div className="cc-s">Relative bookings — last 90 days</div>
        <div style={{ marginTop: 10 }}>
          {data.OD.props.map((p) => (
            <div key={p.nm} className="oc-row">
              <div className="oc-nm">{p.nm}</div>
              <div className="oc-track">
                <div className="oc-fill" style={{ width: `${p.oc}%` }} />
              </div>
              <div className="oc-pct">{p.oc}%</div>
              <div className="oc-adr">${p.ar.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
