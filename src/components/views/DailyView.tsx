'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import type { DailyData, EntityClickContext } from '@/types'
import { KpiCardShell } from '@/components/KpiRow'
import { KpiCardSkeletonRow, TableSkeletonBlock } from '@/components/DashboardSkeleton'

const WINDOWS = [3, 7, 14, 21] as const

// Property (2026-07-16, "no exceptions" property-filter pass) — Daily was the last view left
// unfiltered. Only `property` is used here; the other Topbar filters (year/period/channel/
// market) don't apply to Daily's own T-minus-window model.
interface Filters { property: string }

type Props = {
  filters: Filters
  onSelectAgent: (agentId: string) => void
  onSelectProperty: (context: EntityClickContext) => void
}

const agentCellSx = {
  maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
} as const

const propertyCellSx = (clickable: boolean) => ({
  maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  color: clickable ? 'primary.main' : 'text.secondary',
  cursor: clickable ? 'pointer' : 'default',
  '&:hover': clickable ? { textDecoration: 'underline' } : undefined,
} as const)

export default function DailyView({ filters, onSelectAgent, onSelectProperty }: Props) {
  const [window_, setWindow] = useState<number>(3)
  const [consultant, setConsultant] = useState<string>('')
  const [data, setData] = useState<DailyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ window: String(window_) })
    if (consultant) params.set('consultant', consultant)
    if (filters.property && filters.property !== 'all') params.set('property', filters.property)
    fetch(`/api/daily?${params.toString()}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: DailyData) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [window_, consultant, filters.property])

  if (loading && !data) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <KpiCardSkeletonRow />
        <TableSkeletonBlock rows={6} />
        <TableSkeletonBlock rows={4} />
      </Box>
    )
  }
  if (error) {
    return <Alert severity="error" sx={{ mt: 2 }}>Failed to load daily data: {error}</Alert>
  }
  if (!data) return null

  const { kpi } = data
  // 4-card standard (2026-07-09) — genuine 4th headline number, not padding: the Expiring
  // Provisionals card only showed a count before; this surfaces the $ actually at risk from
  // those expiring holds, summed from the same rows the table below already lists.
  const expiringProvisionalsValue = data.expiringProvisionals.reduce((s, p) => s + p.value, 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Section 1 — KPI cards */}
      <Grid container spacing={1.5}>
        <KpiCardShell label="Arrivals Next 3 Days" value={kpi.arrivalsNext3d.toLocaleString()} caption="— need action (pending data source)" labelInfo={kpi.arrivalsNeedActionNote} />
        <KpiCardShell label="Provisionals Expiring This Week" value={kpi.provisionalsExpiring7d.toLocaleString()} />
        <KpiCardShell label="Expiring Provisionals Value" value={`$${expiringProvisionalsValue.toLocaleString()}`} labelInfo="Total booking value at risk from holds expiring this week" />
        {/* accent=amber preserves the original always-on caution flag — this card carries a data-quality caveat (see cashOutstandingNote), not a performance verdict */}
        <KpiCardShell label={`Booking Value — Upcoming Arrivals (T-${window_})`} value={`$${kpi.cashOutstanding.toLocaleString()}`} labelInfo={kpi.cashOutstandingNote} accent="amber" />
      </Grid>

      {/* Window toggle + Consultant filter */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Arrival window:</Typography>
        <ToggleButtonGroup
          value={window_}
          exclusive
          onChange={(_, v) => v && setWindow(v)}
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
              '&.Mui-selected': { bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.primary' } },
            },
          }}
        >
          {WINDOWS.map((w) => (
            <ToggleButton key={w} value={w} sx={{ lineHeight: 1, fontSize: '0.6875rem', px: 1.25 }}>T-{w}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>Consultant:</Typography>
        <Select
          value={consultant}
          onChange={(e) => setConsultant(e.target.value)}
          size="small"
          variant="outlined"
          displayEmpty
          sx={{
            fontSize: '0.6875rem',
            height: 30,
            minWidth: 160,
            '.MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
            '.MuiSelect-select': { py: '4px', px: '8px' },
          }}
        >
          <MenuItem value="" sx={{ fontSize: '0.6875rem' }}>All Consultants</MenuItem>
          {data.consultants.map((c) => (
            <MenuItem key={c.id} value={c.id} sx={{ fontSize: '0.6875rem' }}>{c.name}</MenuItem>
          ))}
        </Select>

        {loading && <CircularProgress size={14} sx={{ color: 'primary.main' }} />}
      </Box>

      {/* Section 2 — T-minus arrivals table */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.5 }}>Confirmed Arrivals — Next {window_} Days</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            Sorted by days to arrival · one row per arrival at each property
          </Typography>
          <Box sx={{ overflow: 'auto', maxHeight: 230 }}>
            <Table size="small" stickyHeader sx={{ '& .MuiTableCell-stickyHeader': { bgcolor: 'background.paper' } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Reservation</TableCell>
                  <TableCell>Guest</TableCell>
                  <TableCell>Agent</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell align="center">Arrival</TableCell>
                  <TableCell align="right">Days to Arrival</TableCell>
                  <TableCell align="right">Rooms</TableCell>
                  <TableCell align="right">Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.arrivals.map((a, idx) => (
                  <TableRow key={`${a.reservationNumber}-${idx}`} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11 }}>{a.reservationNumber}</TableCell>
                    <TableCell sx={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.guest}</TableCell>
                    <TableCell onClick={() => onSelectAgent(a.agentId)} sx={agentCellSx}>{a.agent}</TableCell>
                    <TableCell
                      onClick={() => a.propertyId && onSelectProperty({ type: 'property', id: a.propertyId, sourceView: 'daily' })}
                      sx={propertyCellSx(!!a.propertyId)}
                    >
                      {a.property}
                    </TableCell>
                    <TableCell align="center">{a.arrivalDate}</TableCell>
                    <TableCell align="right">{a.daysToArrival}</TableCell>
                    <TableCell align="right">{a.roomCount ?? 1}</TableCell>
                    <TableCell align="right">${a.balance.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {data.arrivals.length === 0 && (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', border: 0 }}>No confirmed arrivals in this window</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* Section 3 — Expiring provisionals table */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.5 }}>Expiring Provisionals — Next 7 Days</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            One row per reservation · sorted by arrival date · top 20
          </Typography>
          <Box sx={{ overflow: 'auto', maxHeight: 230 }}>
            <Table size="small" stickyHeader sx={{ '& .MuiTableCell-stickyHeader': { bgcolor: 'background.paper' } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Reservation</TableCell>
                  <TableCell>Agent</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell align="center">Arrival</TableCell>
                  <TableCell align="center">Option Expiry</TableCell>
                  <TableCell align="right">Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.expiringProvisionals.map((p, idx) => (
                  <TableRow key={`${p.reservationNumber}-${idx}`} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11 }}>{p.reservationNumber}</TableCell>
                    <TableCell onClick={() => onSelectAgent(p.agentId)} sx={agentCellSx}>{p.agent}</TableCell>
                    <TableCell
                      onClick={() => p.propertyId && onSelectProperty({ type: 'property', id: p.propertyId, sourceView: 'daily' })}
                      sx={propertyCellSx(!!p.propertyId)}
                    >
                      {p.property}
                    </TableCell>
                    <TableCell align="center">{p.arrivalDate}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={`${p.expiryDate} (${p.daysToExpiry}d)`}
                        size="small"
                        sx={{ bgcolor: p.daysToExpiry <= 2 ? '#FEF2F2' : '#FAEEDA', color: p.daysToExpiry <= 2 ? '#C0392B' : '#854F0B', height: 18, fontSize: '0.6rem', fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell align="right">${p.value.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {data.expiringProvisionals.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', border: 0 }}>No provisionals expiring this week</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* Section 4 — Booking value (upcoming arrivals) table */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Typography variant="h6" sx={{ fontSize: 15 }}>Booking Value — Next {window_} Days</Typography>
            <Tooltip title={kpi.cashOutstandingNote} arrow>
              <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            </Tooltip>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            Confirmed bookings with value &gt; 0, sorted by arrival date — booking value shown as a proxy, not a confirmed balance
          </Typography>
          <Box sx={{ overflow: 'auto', maxHeight: 230 }}>
            <Table size="small" stickyHeader sx={{ '& .MuiTableCell-stickyHeader': { bgcolor: 'background.paper' } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Reservation</TableCell>
                  <TableCell>Guest</TableCell>
                  <TableCell>Agent</TableCell>
                  <TableCell>Property</TableCell>
                  <TableCell align="center">Arrival</TableCell>
                  <TableCell align="right">Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.cashOutstanding.map((c, idx) => (
                  <TableRow key={`${c.reservationNumber}-${idx}`} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11 }}>{c.reservationNumber}</TableCell>
                    <TableCell sx={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.guest}</TableCell>
                    <TableCell onClick={() => onSelectAgent(c.agentId)} sx={agentCellSx}>{c.agent}</TableCell>
                    <TableCell
                      onClick={() => c.propertyId && onSelectProperty({ type: 'property', id: c.propertyId, sourceView: 'daily' })}
                      sx={propertyCellSx(!!c.propertyId)}
                    >
                      {c.property}
                    </TableCell>
                    <TableCell align="center">{c.arrivalDate}</TableCell>
                    <TableCell align="right">${c.balance.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {data.cashOutstanding.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', border: 0 }}>No outstanding bookings in this window</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
