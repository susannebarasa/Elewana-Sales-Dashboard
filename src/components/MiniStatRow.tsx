'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'

// Compact secondary-stats strip (2026-07-09, 4-card standardization pass) — for metrics that
// used to be full KPI cards but got moved out to keep each view's headline row at exactly 4.
// Deliberately much lower visual weight than a Card (no border/background), so it reads as
// supporting detail near a chart/table, not a second tier of headline numbers.
export type MiniStatItem = { label: string; value: string; tooltip?: string }

export default function MiniStatRow({ items }: { items: MiniStatItem[] }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1.5, px: 0.25 }}>
      {items.map((it) => {
        const stat = (
          <Box key={it.label} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>{it.label}</Typography>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.primary' }}>{it.value}</Typography>
          </Box>
        )
        return it.tooltip ? (
          <Tooltip key={it.label} title={it.tooltip} placement="top" arrow>
            {stat}
          </Tooltip>
        ) : stat
      })}
    </Box>
  )
}
