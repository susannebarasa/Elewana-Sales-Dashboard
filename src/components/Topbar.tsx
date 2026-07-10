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
import IconButton from '@mui/material/IconButton'
import MenuIcon from '@mui/icons-material/Menu'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import FindAgentSearch from '@/components/FindAgentSearch'
import type { AgentSearchResult } from '@/types'
import { PROPERTY_ROOM_COUNTS } from '@/lib/constants'

interface Filters {
  period: 'm' | 'y' | 'a'
  year: string
  channel: string
  market: string
  property: string
}

type Props = {
  view: string
  sub: string
  onSub: (s: string) => void
  filters: Filters
  onFilters: (f: Filters) => void
  lastUpdated: string
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onSelectAgent: (agentId: string) => void
  agentDefaultOptions: AgentSearchResult[]
}

const VIEW_TITLES: Record<string, string> = {
  sales: 'Sales',
  marketing: 'Marketing',
  ops: 'Operations',
  gex: 'Guest Experience',
  finance: 'Finance',
  mis: 'MIS',
}

// Nav consolidation (2026-07-09) — all 10 previously-scattered views (4 former standalone
// Sidebar entries + the existing 6 Sales sub-tabs) now live here as one ordered list, per the
// user's explicit order. Daily moved to the end (deprioritized, not removed).
const SUBS = [
  { id: 'exec-summary', label: 'Sales Executive Summary' },
  { id: 'property-performance', label: 'Property Performance' },
  { id: 'market-segment-performance', label: 'Market Segment Performance' },
  { id: 'booking-status-movement', label: 'Booking Status Movement' },
  { id: 'tp', label: 'Trade Partners' },
  { id: 'pace', label: 'Pace' },
  { id: 'occ', label: 'Occupancy' },
  { id: 'pl', label: 'Pipeline' },
  { id: 'cn', label: 'Consultants' },
  { id: 'daily', label: 'Daily' },
]

const YEARS = ['2022', '2023', '2024', '2025', '2026', '2027', '2028']

// Values match src/lib/agentSegments.ts's CHANNEL_VALUES exactly (Faith's segment mapping CSV's
// "Channel" column: B2B / B2C / NON REVENUE SEGMENTS, plus Unallocated for agents with no CSV
// row or a blank cell — a real, known classification gap, always shown as its own option, never
// hidden or defaulted away).
const CHANNELS = [
  { value: 'all', label: 'All Channels' },
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'NON REVENUE SEGMENTS', label: 'Non-Revenue' },
  { value: 'Unallocated', label: 'Unallocated' },
]

// Values match src/lib/agentSegments.ts's MARKET_SEGMENT_VALUES exactly (the CSV's "New Market
// Segment" column, confirmed 13 July 2026 — NOT the more verbose "Market Segment" column).
const MARKET_SEGMENTS = [
  { value: 'all', label: 'All Segments' },
  { value: 'INT. AGENT', label: 'Int. Agent' },
  { value: 'DMC', label: 'DMC' },
  { value: 'DMC (International Presence)', label: 'DMC (Int’l Presence)' },
  { value: 'INT. DIRECT', label: 'Int. Direct' },
  { value: 'LOCAL DIRECT', label: 'Local Direct' },
  { value: 'CLOSED USER GROUPS', label: 'Closed User Groups' },
  { value: 'DIGITAL', label: 'Digital' },
  { value: 'STAFF STAYS', label: 'Staff Stays' },
  { value: 'Unallocated', label: 'Unallocated' },
]

// Property (2026-07-09) — same PROPERTY_ROOM_COUNTS source of truth as the Property Performance
// table/RevPAR-by-property. Little Elephant Pepper Camp excluded (propertyId null, mid-
// construction, no ResRequest record to filter by yet — same caveat as everywhere else it appears).
const PROPERTIES = [
  { value: 'all', label: 'All Properties' },
  ...Object.entries(PROPERTY_ROOM_COUNTS)
    .filter(([, cap]) => cap.propertyId !== null)
    .map(([name, cap]) => ({ value: cap.propertyId as string, label: name })),
]

const selectSx = {
  fontSize: '0.6875rem',
  height: 30,
  '.MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
  '.MuiSelect-select': { py: '4px', px: '8px' },
}

export default function Topbar({ view, sub, onSub, filters, onFilters, lastUpdated, sidebarOpen, onToggleSidebar, onSelectAgent, agentDefaultOptions }: Props) {
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
          {/* Sidebar toggle */}
          <IconButton
            onClick={onToggleSidebar}
            size="small"
            sx={{ color: 'text.secondary', mr: 0.5, '&:hover': { color: 'text.primary' } }}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? <MenuOpenIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
          </IconButton>

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

          {/* Filter cluster is Sales-only — Finance (now its own top-level view) has no
              year/period/channel/market/property dimension at all (its own internal
              MTD/YTD/Annualised toggle instead), and the other stub views don't need it either. */}
          {view === 'sales' && (
            <>
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

              {/* Market Segment */}
              <Select
                value={filters.market}
                onChange={(e) => set('market', e.target.value)}
                size="small"
                variant="outlined"
                sx={selectSx}
              >
                {MARKET_SEGMENTS.map((m) => (
                  <MenuItem key={m.value} value={m.value} sx={{ fontSize: '0.6875rem' }}>{m.label}</MenuItem>
                ))}
              </Select>

              {/* Property */}
              <Select
                value={filters.property}
                onChange={(e) => set('property', e.target.value)}
                size="small"
                variant="outlined"
                sx={selectSx}
              >
                {PROPERTIES.map((p) => (
                  <MenuItem key={p.value} value={p.value} sx={{ fontSize: '0.6875rem' }}>{p.label}</MenuItem>
                ))}
              </Select>
            </>
          )}

          <Box sx={{ flex: 1 }} />

          {/* Find Agent — Sales only, room to the left of the timestamp so it never
              overlaps the content area's KPI row below */}
          {view === 'sales' && (
            <FindAgentSearch onSelectAgent={onSelectAgent} defaultOptions={agentDefaultOptions} />
          )}

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

      {/* Sub-nav tabs (Sales only) — subtle 3D/elevated treatment (2026-07-16 design pass), same
          "lifts slightly" principle as ExecutiveStoryPanel's shadow, scaled down for a small,
          constantly-clicked nav element. The active tab lifts + gets a soft shadow + a raised
          background so it clearly reads as "pressed forward"; inactive tabs stay flat/muted and
          only nudge up a hair on hover, enough to confirm clickability without competing with the
          active tab for attention. */}
      {view === 'sales' && (
        <Tabs
          value={sub}
          onChange={(_, v) => onSub(v)}
          slotProps={{ indicator: { style: { backgroundColor: '#B7632A', height: 2 } } }}
          sx={{
            bgcolor: 'background.default',
            borderBottom: '0.5px solid',
            borderColor: 'divider',
            minHeight: 38,
            px: 2,
            pt: '4px',
            '& .MuiTabs-flexContainer': { gap: '2px' },
            '& .MuiTab-root': {
              color: 'text.secondary',
              bgcolor: 'transparent',
              borderRadius: '8px 8px 0 0',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
              '&:hover': {
                bgcolor: 'rgba(183,99,42,0.06)',
                transform: 'translateY(-1px)',
              },
              '&.Mui-selected': {
                color: 'primary.main',
                fontWeight: 600,
                bgcolor: 'background.paper',
                boxShadow: '0 -2px 8px rgba(31,26,20,0.08)',
                transform: 'translateY(-2px)',
              },
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
