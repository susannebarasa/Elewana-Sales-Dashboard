type Props = { view: string; onView: (v: string) => void }

const NAV = [
  { group: 'ANALYTICS', items: [
    { id: 'sales', label: 'Sales' },
    { id: 'marketing', label: 'Marketing' },
    { id: 'ops', label: 'Operations' },
  ]},
  { group: 'EXPERIENCE', items: [
    { id: 'gex', label: 'Guest Experience' },
    { id: 'finance', label: 'Finance' },
    { id: 'mis', label: 'MIS' },
  ]},
]

export default function Sidebar({ view, onView }: Props) {
  return (
    <nav className="sb">
      <div className="sb-brand">
        <div className="sb-logo">Elewana</div>
        <div className="sb-sub">Collection</div>
      </div>
      {NAV.map(({ group, items }) => (
        <div key={group}>
          <div className="nav-lbl">{group}</div>
          {items.map(({ id, label }) => (
            <button
              key={id}
              className={`ni${view === id ? ' on' : ''}`}
              onClick={() => onView(id)}
            >
              <span className="ni-dot" />
              {label}
            </button>
          ))}
        </div>
      ))}
      <div className="sb-foot">ResRequest Sync · live</div>
    </nav>
  )
}
