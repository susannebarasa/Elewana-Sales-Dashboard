interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }

type Props = {
  view: string
  sub: string
  onSub: (s: string) => void
  filters: Filters
  onFilters: (f: Filters) => void
  lastUpdated: string
}

const VIEW_TITLES: Record<string, string> = {
  sales: 'Sales', marketing: 'Marketing', ops: 'Operations',
  gex: 'Guest Experience', finance: 'Finance', mis: 'MIS',
}

const SUBS = [
  { id: 'pace', label: 'Pace' },
  { id: 'occ', label: 'Occupancy' },
  { id: 'tp', label: 'Trade Partners' },
  { id: 'pl', label: 'Pipeline' },
  { id: 'cn', label: 'Consultants' },
]

const YEARS = ['2022', '2023', '2024', '2025', '2026', '2027', '2028']
const CHANNELS = [
  { value: 'all', label: 'All Channels' },
  { value: 'b2b', label: 'B2B' },
  { value: 'b2c', label: 'B2C' },
  { value: 'nonrev', label: 'Non-Rev' },
  { value: 'unalloc', label: 'Unallocated' },
]

export default function Topbar({ view, sub, onSub, filters, onFilters, lastUpdated }: Props) {
  const set = (k: keyof Filters, v: string) => onFilters({ ...filters, [k]: v })

  return (
    <>
      <div className="tb">
        <span className="tb-title">{VIEW_TITLES[view] ?? view}</span>
        <div className="tb-divider" />
        <div className="tb-controls">
          <div className="tset">
            {(['m', 'y', 'a'] as const).map((p) => (
              <button
                key={p}
                className={`tbtn${filters.period === p ? ' on' : ''}`}
                onClick={() => set('period', p)}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <select className="ps" value={filters.year} onChange={(e) => set('year', e.target.value)}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
          <select className="ps" value={filters.channel} onChange={(e) => set('channel', e.target.value)}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="tb-sp" />
        {lastUpdated && (
          <div className="tb-ts-wrap">
            <span className="tb-ts-lbl">Data as at</span>
            <span className="tb-ts-val">{lastUpdated}</span>
          </div>
        )}
      </div>
      {view === 'sales' && (
        <div className="sub-nav">
          {SUBS.map((s) => (
            <button
              key={s.id}
              className={`sn-btn${sub === s.id ? ' on' : ''}`}
              onClick={() => onSub(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
