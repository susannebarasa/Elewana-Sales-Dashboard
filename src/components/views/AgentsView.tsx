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

export default function AgentsView({ data, filters }: Props) {
  const kp = data.KP_BASE.agents

  const byMonthData = {
    labels: data.AD.byMonth.months,
    datasets: [
      { label: filters.year, data: data.AD.byMonth.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.AD.byMonth.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
    ],
  }

  const byPropData = {
    labels: data.AD.byProp.slice(0, 10).map((p) => p.pr),
    datasets: [
      { label: filters.year, data: data.AD.byProp.slice(0, 10).map((p) => p.rv), backgroundColor: 'rgba(183,99,42,0.7)', borderRadius: 3 },
      { label: 'LY', data: data.AD.byProp.slice(0, 10).map((p) => p.ly), backgroundColor: 'rgba(107,95,80,0.35)', borderRadius: 3 },
    ],
  }

  return (
    <div className="fu">
      <KpiRow metrics={[kp.active, kp.arev, kp.nradr, kp.radr]} />

      <div className="g2">
        <div className="cc">
          <div className="cc-t">Agent Revenue by Month</div>
          <div className="cc-s">{filters.year} vs LY — agent-linked bookings</div>
          <div className="ca"><Line data={byMonthData} options={CHART_OPTS} /></div>
        </div>
        <div className="cc">
          <div className="cc-t">Revenue by Property</div>
          <div className="cc-s">{filters.year} vs LY — top 10 properties</div>
          <div className="ca">
            <Bar data={byPropData} options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, x: { ...CHART_OPTS.scales.x, stacked: false }, y: { ...CHART_OPTS.scales.y, stacked: false } } }} />
          </div>
        </div>
      </div>

      <div className="cc" style={{ marginTop: 14 }}>
        <div className="cc-t">Top Trade Partners</div>
        <div className="cc-s">YTD {filters.year} — ranked by revenue</div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="mt">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Agent</th>
                <th>Revenue ($k)</th>
                <th>Nights</th>
                <th>ADR</th>
                <th>Channel</th>
                <th>YoY</th>
              </tr>
            </thead>
            <tbody>
              {data.AD.yearly.slice(0, 10).map((r) => (
                <tr key={r.nm}>
                  <td style={{ textAlign: 'left', fontWeight: 500 }}>{r.nm}</td>
                  <td>{r.rv.toLocaleString()}</td>
                  <td>{r.nt.toLocaleString()}</td>
                  <td>${r.nr_adr.toLocaleString()}</td>
                  <td>{r.ch}</td>
                  <td className={r.up ? 'cg-up' : 'cg-dn'}>{r.cg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
