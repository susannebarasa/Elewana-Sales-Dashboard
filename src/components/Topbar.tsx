'use client'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'

interface Filters {
  period: 'm' | 'y' | 'a'
  year: string
  channel: string
  market: string
}

type Props = {
  view: string
  sub: string
  onSub: (s: string) => void
  filters: Filters
  onFilters: (f: Filters) => void
  lastUpdated: string
}

const VIEW_TITLES: Record<string, string> = {
  sales: 'Sales',
  marketing: 'Marketing',
  ops: 'Operations',
  gex: 'Guest Experience',
  finance: 'Finance',
  mis: 'MIS',
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

const selectSx = {
  fontSize: '0.6875rem',
  height: 30,
  '.MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
  '.MuiSelect-select': { py: '4px', px: '8px' },
}

export default function Topbar({ view, sub, onSub, filters, onFilters, lastUpdated }: Props) {
  const set = (k: keyof Filters, v: string) => onFilters({ ...filters, [k]: v })

  return (
    <>
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: 'background.paper',
          borderBottom: '0.5px solid',
          borderColor: 'divider',
          color: 'text.primary',
          zIndex: 1,
        }}
      >
        <Toolbar
          sx={{
            minHeight: '54px !important',
            px: '18px !important',
            gap: 1.5,
          }}
        >
          {/* View title */}
          <Typography
            variant="h5"
            sx={{
              fontFamily: '"Cormorant Garamond", Georgia, serif',
              fontSize: 26,
              fontWeight: 500,
              flexShrink: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {VIEW_TITLES[view] ?? view}
          </Typography>

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          {/* Period toggle */}
          <ToggleButtonGroup
            value={filters.period}
            exclusive
            onChange={(_, v) => v && set('period', v)}
            size="small"
            sx={{
              bgcolor: 'background.default',
              border: '0.5px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: '2px',
              gap: 0,
              '& .MuiToggleButtonGroup-grouped': {
                border: 'none',
                '&.Mui-selected': {
                  bgcolor: 'text.primary',
                  color: 'background.paper',
                  '&:hover': { bgcolor: 'text.primary' },
                },
              },
            }}
          >
            {(['m', 'y', 'a'] as const).map((p) => (
              <ToggleButton key={p} value={p} sx={{ lineHeight: 1 }}>
                {p.toUpperCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {/* Year */}
          <Select
            value={filters.year}
            onChange={(e) => set('year', e.target.value)}
            size="small"
            variant="outlined"
            sx={selectSx}
          >
            {YEARS.map((y) => (
              <MenuItem key={y} value={y} sx={{ fontSize: '0.6875rem' }}>{y}</MenuItem>
            ))}
          </Select>

          {/* Channel */}
          <Select
            value={filters.channel}
            onChange={(e) => set('channel', e.target.value)}
            size="small"
            variant="outlined"
            sx={selectSx}
          >
            {CHANNELS.map((c) => (
              <MenuItem key={c.value} value={c.value} sx={{ fontSize: '0.6875rem' }}>{c.label}</MenuItem>
            ))}
          </Select>

          <Box sx={{ flex: 1 }} />

          {/* Timestamp */}
          {lastUpdated && (
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.5rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                  lineHeight: 1,
                  mb: 0.25,
                }}
              >
                Data as at
              </Typography>
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '0.625rem',
                  color: 'text.primary',
                  lineHeight: 1,
                }}
              >
                {lastUpdated}
              </Typography>
            </Box>
          )}
        </Toolbar>
      </AppBar>

      {/* Sub-nav tabs (Sales only) */}
      {view === 'sales' && (
        <Tabs
          value={sub}
          onChange={(_, v) => onSub(v)}
          slotProps={{ indicator: { style: { backgroundColor: '#B7632A' } } }}
          sx={{
            bgcolor: 'background.paper',
            borderBottom: '0.5px solid',
            borderColor: 'divider',
            minHeight: 38,
            px: 2,
            '& .MuiTab-root': {
              color: 'text.secondary',
              '&.Mui-selected': { color: 'primary.main' },
            },
          }}
        >
          {SUBS.map((s) => (
            <Tab key={s.id} value={s.id} label={s.label} />
          ))}
        </Tabs>
      )}
    </>
  )
}
