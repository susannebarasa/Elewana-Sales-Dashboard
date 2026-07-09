'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'

// Compact secondary-stats strip (2026-07-09, 4-card standardization pass; restyled same day
// after review) — for metrics that used to be full KPI cards but got moved out to keep each
// view's headline row at exactly 4. A slim bordered/backgrounded strip with light dividers
// between stats, matching the app's card language (border + background) at lower visual weight
// (smaller padding/font) rather than bare inline text, so it reads as a contained secondary row,
// not floating detail. Variance uses the same green/red convention as the main KPI cards
// (success.main/error.main) — see KpiRow's budgetVariance() helper for the shared calc.
export type MiniStatItem = {
  label: string
  value: string
  variance?: { text: string; positive: boolean } | null
  tooltip?: string
}

export default function MiniStatRow({ items }: { items: MiniStatItem[] }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        mb: 1.5,
        bgcolor: 'background.paper',
        border: '0.5px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        overflow: 'hidden',
      }}
    >
      {items.map((it, idx) => {
        const stat = (
          <Box
            key={it.label}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.125,
              px: 1.5,
              py: 0.75,
              flex: '1 1 auto',
              minWidth: 130,
              borderRight: idx < items.length - 1 ? '0.5px solid' : 'none',
              borderColor: 'divider',
            }}
          >
            <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {it.label}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.625 }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: 'text.primary', fontFamily: '"JetBrains Mono", monospace' }}>
                {it.value}
              </Typography>
              {it.variance && (
                <Typography
                  sx={{ fontSize: '0.6875rem', fontWeight: 700, color: it.variance.positive ? 'success.main' : 'error.main' }}
                >
                  {it.variance.text}
                </Typography>
              )}
            </Box>
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
