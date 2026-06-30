import type { KpiMetric } from '@/types'

function fmtK(v: number, fmt: string): string {
  if (fmt === 'int')  return v >= 10000 ? Math.round(v / 1000) + 'k' : Math.round(v).toLocaleString()
  if (fmt === '$M')   return v >= 1 ? '$' + v.toFixed(1) + 'M' : '$' + (v * 1000).toFixed(0) + 'k'
  if (fmt === '$')    return '$' + Math.round(v).toLocaleString()
  if (fmt === '$k')   return '$' + v.toFixed(1) + 'k'
  if (fmt === 'pct')  return v.toFixed(1) + '%'
  if (fmt === 'days') return Math.round(v) + ' days'
  if (fmt === 'f1')   return v.toFixed(1)
  return String(v)
}

function rag(m: KpiMetric, sv: number): 'g' | 'a' | 'r' {
  const good = m.inv ? sv <= m.thG : sv >= m.thG
  const ok   = m.inv ? sv <= m.thY : sv >= m.thY
  return good ? 'g' : ok ? 'a' : 'r'
}

type Props = {
  metrics: KpiMetric[]
  propMult?: number
  periodMult?: number
}

export default function KpiRow({ metrics, propMult = 1, periodMult = 1 }: Props) {
  return (
    <div className="kpi-row">
      {metrics.map((m) => {
        const isRate = m.fmt === 'pct' || m.fmt === 'f1' || m.fmt === 'days'
        const isADR  = m.fmt === '$'
        const ps = isRate || isADR ? 1 + (propMult - 1) * 0.22 : propMult
        const ts = isRate || isADR ? 1 + (periodMult - 1) * 0.015 : periodMult
        const sv  = m.v * ps * ts
        const lv  = sv * 0.912
        const r   = rag(m, sv)
        const chg = ((sv - lv) / lv) * 100
        const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%'
        const ragClass = r === 'g' ? 'kg' : r === 'a' ? 'ka' : 'kr'
        const ragColor = r === 'g' ? 'var(--rg)' : r === 'r' ? 'var(--rr)' : '#854D0E'
        return (
          <div key={m.lbl} className={`kpi ${ragClass}`}>
            <div className="kpi-l">{m.lbl}</div>
            <div className="kpi-v">{fmtK(sv, m.fmt)}</div>
            <div className="kpi-d">
              {m.d} &middot; <b style={{ color: ragColor }}>{chgStr}</b>
            </div>
            <div className="kpi-st" />
          </div>
        )
      })}
    </div>
  )
}
