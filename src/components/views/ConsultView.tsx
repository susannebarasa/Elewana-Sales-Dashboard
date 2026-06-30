import type { DashboardData } from '@/types'
import KpiRow from '@/components/KpiRow'

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters }

export default function ConsultView({ data, filters }: Props) {
  const kp = data.KP_BASE.consult
  return (
    <div className="fu">
      <KpiRow metrics={[kp.n, kp.bkgs, kp.avg, kp.top]} />

      <div className="cc" style={{ marginTop: 14 }}>
        <div className="cc-t">Consultant Performance</div>
        <div className="cc-s">YTD {filters.year} — ranked by bookings</div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="mt">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Consultant</th>
                <th>Bookings</th>
                <th>Revenue ($k)</th>
                <th>Share</th>
                <th>YoY</th>
              </tr>
            </thead>
            <tbody>
              {data.CD.map((r) => (
                <tr key={r.nm}>
                  <td style={{ textAlign: 'left', fontWeight: 500 }}>{r.nm}</td>
                  <td>{r.bk.toLocaleString()}</td>
                  <td>{r.rv.toLocaleString()}</td>
                  <td>{r.cv}</td>
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
