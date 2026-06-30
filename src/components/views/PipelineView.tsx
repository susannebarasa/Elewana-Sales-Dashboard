import type { DashboardData } from '@/types'
import KpiRow from '@/components/KpiRow'

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters }

export default function PipelineView({ data, filters }: Props) {
  const kp = data.KP_BASE.pipeline
  return (
    <div className="fu">
      <KpiRow metrics={[kp.val, kp.opps, kp.conv, kp.avg]} />

      <div className="g2">
        <div className="cc">
          <div className="cc-t">Pipeline Funnel</div>
          <div className="cc-s">All forward bookings · {filters.year}</div>
          <div style={{ marginTop: 10 }}>
            {data.PLF.map((row) => (
              <div key={row.st} className="plf-item">
                <div className="plf-label">{row.st}</div>
                <div className="plf-track">
                  <div className="plf-fill" style={{ width: `${row.pc}%` }} />
                </div>
                <div className="plf-meta">
                  <span className="plf-ct">{row.ct.toLocaleString()}</span>
                  <span className="plf-vl">{row.vl}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="cc">
          <div className="cc-t">Upcoming Arrivals</div>
          <div className="cc-s">Next confirmed &amp; provisional check-ins</div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="mt">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Agent</th>
                  <th style={{ textAlign: 'left' }}>Property</th>
                  <th>Check-in</th>
                  <th>Nts</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.PLT.map((row, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'left', fontWeight: 500 }}>{row.ag}</td>
                    <td style={{ textAlign: 'left' }}>{row.pr}</td>
                    <td>{row.ci}</td>
                    <td>{row.nt}</td>
                    <td>{row.vl}</td>
                    <td>
                      <span className={row.st.toLowerCase() === 'confirmed' ? 'plt-st-confirmed' : 'plt-st-provisional'}>
                        {row.st}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
