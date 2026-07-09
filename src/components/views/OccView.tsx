'use client'
import {
  Box, Grid, Card, CardContent, Typography, Alert, LinearProgress,
  Table, TableHead, TableBody, TableRow, TableCell, Tooltip as MuiTooltip, Chip,
} from '@mui/material'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import KpiRow from '@/components/KpiRow'
import { propertyBarClickOptions } from '@/lib/chartClicks'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip)

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters; onSelectProperty: (context: EntityClickContext) => void }

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
  },
}

export default function OccView({ data, filters, onSelectProperty }: Props) {
  const kp = data.KP_BASE.occ

  const revByPropData = {
    labels: data.OD.props.map((p) => p.nm),
    datasets: [{
      data: data.OD.props.map((p) => p.ar),
      backgroundColor: 'rgba(183,99,42,0.7)',
      borderRadius: 3,
    }],
  }

  // RevPAR by property (2026-07-14d) — sorted by RevPAR descending; properties with no computable
  // RevPAR (LEPC — no property record) sort to the bottom, same convention as Budget's "no
  // budget set" properties.
  const revparByProperty = [...data.REVPAR.byProperty].sort((a, b) => {
    if (a.revpar === null && b.revpar === null) return 0
    if (a.revpar === null) return 1
    if (b.revpar === null) return -1
    return b.revpar - a.revpar
  })

  const arrTrendData = {
    labels: data.OD.arr.months,
    datasets: [
      { label: filters.year, data: data.OD.arr.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.OD.arr.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
      { label: 'Extras', data: data.OD.arr.extras, borderColor: '#4A5A3A', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [2, 2] },
    ],
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Alert
        severity="info"
        sx={{
          bgcolor: '#FAEEDA', color: '#854F0B',
          border: '0.5px solid #B7632A',
          '& .MuiAlert-icon': { color: '#B7632A' },
          py: 0.5, fontSize: '0.75rem',
        }}
      >
        Room night &amp; rate data sourced from ResRequest PMS itinerary records.
      </Alert>

      {/* 4-card standard (2026-07-09) — Cancellation Rate dropped from this row; it's now a
          headline card on Booking Status Movement (Cancelled), so it's not losing visibility,
          just not duplicated here. Extras kept, per explicit call to keep it visible. */}
      <KpiRow metrics={[kp.nights, kp.adr, kp.rev, kp.extras]} />

      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Revenue by Property</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>ADR from ResRequest bookings — last 90 days</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Bar data={revByPropData} options={{ ...CHART_OPTS, indexAxis: 'y' as const, ...propertyBarClickOptions(data.OD.props, onSelectProperty, 'occ') }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Arrival Revenue Trend</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{filters.year} vs LY — Room Revenue, with Extras shown separately</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Line data={arrTrendData} options={{ ...CHART_OPTS, plugins: { legend: { display: true, labels: { font: { size: 9 } } } } }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Occupancy by Property</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>Relative bookings — last 90 days · ADR</Typography>
          {data.OD.props.map((p) => (
            <Box key={p.nm} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Typography
                onClick={() => p.id && onSelectProperty({ type: 'property', id: p.id, sourceView: 'occ' })}
                sx={{
                  fontSize: 11, minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: p.id ? 'primary.main' : 'text.primary',
                  cursor: p.id ? 'pointer' : 'default',
                  '&:hover': p.id ? { textDecoration: 'underline' } : undefined,
                }}
              >
                {p.nm}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={p.oc}
                sx={{ flex: 1, height: 8, borderRadius: 1, bgcolor: '#F5F0E8', '& .MuiLinearProgress-bar': { bgcolor: '#B7632A' } }}
              />
              <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'text.secondary', minWidth: 32, textAlign: 'right' }}>
                {p.oc}%
              </Typography>
              <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'text.primary', minWidth: 60, textAlign: 'right' }}>
                ${p.ar.toLocaleString()}
              </Typography>
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* RevPAR by property (2026-07-14d) */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>RevPAR by Property</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            Full-year 2026 · confirmed only · Room Revenue ÷ Available Room Nights (Dennis&apos;s capacity data) — Room Revenue basis, not blended with Extras
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Property</TableCell>
                  <TableCell align="right">Room Revenue</TableCell>
                  <TableCell align="right">Sold Nights</TableCell>
                  <TableCell align="right">Available Nights</TableCell>
                  <TableCell align="right">RevPAR</TableCell>
                  <TableCell align="right">ADR</TableCell>
                  <TableCell align="right">Occ%</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {revparByProperty.map((r) => (
                  <TableRow key={r.propertyName} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell
                      onClick={() => r.propertyId && onSelectProperty({ type: 'property', id: r.propertyId, sourceView: 'occ' })}
                      sx={{
                        fontFamily: 'Inter, sans-serif', fontWeight: 500,
                        color: r.propertyId ? 'primary.main' : 'text.primary',
                        cursor: r.propertyId ? 'pointer' : 'default',
                        '&:hover': r.propertyId ? { textDecoration: 'underline' } : undefined,
                      }}
                    >
                      {r.propertyName}
                      {r.caveat && (
                        <MuiTooltip title={r.caveat} arrow>
                          <Chip
                            label="caveat"
                            size="small"
                            sx={{ ml: 0.75, height: 16, fontSize: '0.625rem', fontWeight: 700, bgcolor: '#FDF8EE', color: '#854F0B', border: '0.5px solid #B7632A' }}
                          />
                        </MuiTooltip>
                      )}
                    </TableCell>
                    {r.roomRevenue === null ? (
                      <TableCell colSpan={6} align="center">
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {r.caveat ?? 'no data'}
                        </Typography>
                      </TableCell>
                    ) : (
                      <>
                        <TableCell align="right">${r.roomRevenue.toLocaleString()}</TableCell>
                        <TableCell align="right">{r.soldNights?.toLocaleString()}</TableCell>
                        <TableCell align="right">{r.availableNights.toLocaleString()}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>${r.revpar?.toFixed(2)}</TableCell>
                        <TableCell align="right">${r.adr?.toLocaleString()}</TableCell>
                        <TableCell align="right">{r.occPct}%</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
