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

export default function PaceView({ data, filters }: Props) {
  const kp = data.KP_BASE.pace

  const paceChartData = {
    labels: data.PD.months,
    datasets: [
      { label: filters.year, data: data.PD.actual, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.PD.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
    ],
  }

  const propChartData = {
    labels: data.OD.props.map((p) => p.nm),
    datasets: [{
      data: data.OD.props.map((p) => p.oc),
      backgroundColor: 'rgba(183,99,42,0.7)',
      borderRadius: 3,
    }],
  }

  return (
    <div className="fu">
      <KpiRow metrics={[kp.bookings, kp.rev, kp.idx, kp.lead]} />

      {/* Pipeline future bars */}
      <div className="cc" style={{ marginBottom: 14 }}>
        <div className="cc-t">Forward Booking Pace</div>
        <div className="cc-s">Confirmed · provisional · waitlist vs budget line</div>
        <div style={{ marginTop: 8 }}>
          {data.PF.map((m) => {
            const wl = m.cf + m.pv
            return (
              <div key={m.mo} className="pf-row">
                <div className="pf-grid">
                  <div className="pf-mo">{m.mo}</div>
                  <div className="pf-bar">
                    <div style={{ position: 'absolute', left: `${m.bg}%`, top: -2, bottom: -2, width: 1.5, background: 'var(--br)', zIndex: 4 }} />
                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${m.cf}%`, background: '#3B6D11', borderRadius: '3px 0 0 3px', display: 'flex', alignItems: 'center', paddingLeft: 8, zIndex: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>{m.cf}% · {m.cv}</span>
                    </div>
                    <div style={{ position: 'absolute', left: `${m.cf}%`, top: 0, height: '100%', width: `${m.pv}%`, background: 'rgba(74,90,58,0.28)', border: '1px solid #4A5A3A', boxSizing: 'border-box', display: 'flex', alignItems: 'center', paddingLeft: 4, zIndex: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--ink)', fontWeight: 500, whiteSpace: 'nowrap' }}>{m.pval}</span>
                    </div>
                    <div style={{ position: 'absolute', left: `${wl}%`, top: 0, height: '100%', width: `${m.wt}%`, background: 'rgba(183,99,42,0.55)', border: '1px solid rgba(183,99,42,.8)', borderLeft: 'none', borderRadius: '0 3px 3px 0', zIndex: 1 }} />
                  </div>
                  <div style={{ fontFamily: 'var(--mo)', fontSize: 10, color: 'var(--mu)', textAlign: 'right' }}>Bgt {m.bg}%</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="g2">
        <div className="cc">
          <div className="cc-t">Monthly Booking Pace</div>
          <div className="cc-s">{filters.year} vs LY confirmed bookings</div>
          <div className="ca"><Line data={paceChartData} options={CHART_OPTS} /></div>
        </div>
        <div className="cc">
          <div className="cc-t">Bookings by Property</div>
          <div className="cc-s">Relative occupancy — last 90 days</div>
          <div className="ca">
            <Bar data={propChartData} options={{ ...CHART_OPTS, indexAxis: 'y' as const }} />
          </div>
        </div>
      </div>
    </div>
  )
}
