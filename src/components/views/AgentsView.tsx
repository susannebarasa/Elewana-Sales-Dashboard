'use client'
import {
  Box, Grid, Card, CardContent, Typography,
  Table, TableHead, TableBody, TableRow, TableCell, Chip,
} from '@mui/material'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import KpiRow, { fmtK } from '@/components/KpiRow'
import MiniStatRow from '@/components/MiniStatRow'
import { propertyBarClickOptions } from '@/lib/chartClicks'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip)

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = {
  data: DashboardData
  filters: Filters
  onSelectAgentPerformance: (agentId: string) => void
  onSelectProperty: (context: EntityClickContext) => void
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
  },
}

export default function AgentsView({ data, filters, onSelectAgentPerformance, onSelectProperty }: Props) {
  const kp = data.KP_BASE.agents

  const byMonthData = {
    labels: data.AD.byMonth.months,
    datasets: [
      { label: filters.year, data: data.AD.byMonth.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.AD.byMonth.ly, borderColor: 'rgba(138,123,101,0.8)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
      { label: 'Extras', data: data.AD.byMonth.extras, borderColor: '#4A5A3A', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [2, 2] },
    ],
  }

  const top10ByProp = data.AD.byProp.slice(0, 10)
  const byPropData = {
    labels: top10ByProp.map((p) => p.pr),
    datasets: [
      { label: filters.year, data: top10ByProp.map((p) => p.rv), backgroundColor: 'rgba(183,99,42,0.7)', borderRadius: 3 },
      { label: 'LY', data: top10ByProp.map((p) => p.ly), backgroundColor: 'rgba(138,123,101,0.45)', borderRadius: 3 },
      { label: 'Extras', data: top10ByProp.map((p) => p.extras), backgroundColor: 'rgba(74,90,58,0.6)', borderRadius: 3 },
    ],
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* 4-card standard (2026-07-09) — Avg Length of Stay (kp.radr) moved to the caption near
          Top Trade Partners below, rather than dropped. */}
      <KpiRow metrics={[kp.active, kp.arev, kp.extras, kp.nradr]} />

      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Agent Revenue by Month</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{filters.year} vs LY — Room Revenue, Extras shown separately</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Line data={byMonthData} options={{ ...CHART_OPTS, plugins: { legend: { display: true, labels: { font: { size: 9 } } } } }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Revenue by Property</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{filters.year} vs LY — Room Revenue, Extras shown separately — top 10 properties</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Bar
                  data={byPropData}
                  options={{
                    ...CHART_OPTS,
                    plugins: { legend: { display: true, labels: { font: { size: 9 } } } },
                    ...propertyBarClickOptions(top10ByProp, onSelectProperty, 'tp'),
                  }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Top Trade Partners</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>YTD {filters.year} — ranked by revenue</Typography>
          <MiniStatRow items={[{ label: 'Portfolio Avg Length of Stay', value: `${fmtK(kp.radr.v, kp.radr.fmt)} nights/booking`, tooltip: kp.radr.d }]} />
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Agent</TableCell>
                  <TableCell sx={{ textAlign: 'left' }}>Channel</TableCell>
                  <TableCell sx={{ textAlign: 'left' }}>Country</TableCell>
                  <TableCell align="right">Room Revenue ($k)</TableCell>
                  <TableCell align="right">Extras ($k)</TableCell>
                  <TableCell align="right">Nights</TableCell>
                  <TableCell align="right">ADR</TableCell>
                  <TableCell align="right">Properties</TableCell>
                  <TableCell align="right">Conversion</TableCell>
                  <TableCell align="right">YoY</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.AD.yearly.slice(0, 10).map((r) => (
                  <TableRow key={r.id} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell
                      onClick={() => onSelectAgentPerformance(r.id)}
                      sx={{
                        fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {r.nm}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 170 }}>
                      <Chip
                        label={r.ch}
                        size="small"
                        sx={{
                          bgcolor: r.ch === 'Unallocated' ? '#F5F0E8' : '#EDEBE6', color: 'text.secondary',
                          height: 18, fontSize: '0.6rem', mb: 0.25,
                        }}
                      />
                      <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.mkt}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.7rem', color: r.country ? 'text.primary' : 'text.secondary', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.country ?? '—'}
                    </TableCell>
                    <TableCell align="right">${r.rv.toLocaleString()}k</TableCell>
                    <TableCell align="right">${r.extras.toLocaleString()}k</TableCell>
                    <TableCell align="right">{r.nt.toLocaleString()}</TableCell>
                    <TableCell align="right">${r.nr_adr.toLocaleString()}</TableCell>
                    <TableCell align="right">{r.propertiesProduced}</TableCell>
                    <TableCell align="right">{r.conversionRate.toFixed(1)}%</TableCell>
                    <TableCell align="right">
                      <Chip
                        label={r.cg}
                        size="small"
                        sx={{ bgcolor: r.up ? '#EAF3DE' : '#FEF2F2', color: r.up ? '#27500A' : '#C0392B', height: 18, fontSize: '0.6rem' }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* Agent Pace, Winners/Losers (2026-07-14e) — same-leadtime STLY basis, >=20 nights either
          side. See src/types/index.ts's AgentPaceItem for why this differs from a naive STLY
          comparison. */}
      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Agent Pace — Gainers</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                Forward-window Room Nights vs same lead time last year — biggest gainers
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ textAlign: 'left' }}>Agent</TableCell>
                      <TableCell align="right">This Year</TableCell>
                      <TableCell align="right">LY (same lead time)</TableCell>
                      <TableCell align="right">Var</TableCell>
                      <TableCell align="right">%</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.AGENT_PACE.gainers.map((r) => (
                      <TableRow key={r.agentId} sx={{ '&:last-child td': { border: 0 } }}>
                        <TableCell
                          onClick={() => onSelectAgentPerformance(r.agentId)}
                          sx={{
                            fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                            maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {r.agentName}
                        </TableCell>
                        <TableCell align="right">{r.tyNights.toLocaleString()}</TableCell>
                        <TableCell align="right">{r.lyNights.toLocaleString()}</TableCell>
                        <TableCell align="right" sx={{ color: 'success.main', fontWeight: 700 }}>+{r.absVar.toLocaleString()}</TableCell>
                        <TableCell align="right">
                          <Chip
                            label={r.pctVar !== null ? `+${r.pctVar.toFixed(1)}%` : 'n/a'}
                            size="small"
                            sx={{ bgcolor: '#EAF3DE', color: '#27500A', height: 18, fontSize: '0.6875rem', fontWeight: 700 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Agent Pace — Decliners</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                Forward-window Room Nights vs same lead time last year — biggest decliners
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ textAlign: 'left' }}>Agent</TableCell>
                      <TableCell align="right">This Year</TableCell>
                      <TableCell align="right">LY (same lead time)</TableCell>
                      <TableCell align="right">Var</TableCell>
                      <TableCell align="right">%</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.AGENT_PACE.decliners.map((r) => (
                      <TableRow key={r.agentId} sx={{ '&:last-child td': { border: 0 } }}>
                        <TableCell
                          onClick={() => onSelectAgentPerformance(r.agentId)}
                          sx={{
                            fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                            maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {r.agentName}
                        </TableCell>
                        <TableCell align="right">{r.tyNights.toLocaleString()}</TableCell>
                        <TableCell align="right">{r.lyNights.toLocaleString()}</TableCell>
                        <TableCell align="right" sx={{ color: 'error.main', fontWeight: 700 }}>{r.absVar.toLocaleString()}</TableCell>
                        <TableCell align="right">
                          <Chip
                            label={r.pctVar !== null ? `${r.pctVar.toFixed(1)}%` : 'n/a'}
                            size="small"
                            sx={{ bgcolor: '#FEF2F2', color: '#C0392B', height: 18, fontSize: '0.6875rem', fontWeight: 700 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Named Cancellation Drivers (2026-07-14e) — last 30 days by last_change_date,
          Room-Revenue-only $, sorted by revenue lost. */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Named Cancellation Drivers</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Last 30 days — Room Revenue lost, not blended with Extras
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Agent</TableCell>
                  <TableCell align="right">Cancelled Bookings</TableCell>
                  <TableCell align="right">Nights Lost</TableCell>
                  <TableCell align="right">Revenue Lost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.CANCEL_DRIVERS.map((r) => (
                  <TableRow key={r.agentId} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell
                      onClick={() => onSelectAgentPerformance(r.agentId)}
                      sx={{
                        fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {r.agentName}
                    </TableCell>
                    <TableCell align="right">{r.cancelledBookings.toLocaleString()}</TableCell>
                    <TableCell align="right">{r.nightsLost.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>${r.revenueLost.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
      {/* Low-Season Occupancy Lift (2026-07-09, Linda's Dashboard KPI #2) — see route.ts's
          lowSeasonByAgentRows query comment for the Feb-May low-season definition (confirmed live
          against 2024+2025 seasonality data, not assumed). Sorted descending by % of Annual
          Business in Low Season: agents already comfortable booking low season surface first, as
          the lowest-risk "push them further" candidates — agents near 0% need a different,
          harder conversation, not more of the same lever, so they aren't the leading rows here. */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Low-Season Occupancy Lift</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Low season = Feb–May (confirmed against 2024+2025 booking data — the only months below average, April deepest) · full-year {filters.year} · Room Revenue basis · min. 100 annual room nights (excludes agents whose 100% is just 1 lucky booking) · sorted by % of business already in low season
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Agent</TableCell>
                  <TableCell align="right">Low-Season Room Nights</TableCell>
                  <TableCell align="right">Low-Season Revenue</TableCell>
                  <TableCell align="right">% of Annual Business in Low Season</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.LOW_SEASON_AGENTS.map((r) => (
                  <TableRow key={r.agentId} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell
                      onClick={() => onSelectAgentPerformance(r.agentId)}
                      sx={{
                        fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {r.agentName}
                    </TableCell>
                    <TableCell align="right">{r.lowSeasonNights.toLocaleString()}</TableCell>
                    <TableCell align="right">${r.lowSeasonRevenue.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{r.lowSeasonPct.toFixed(1)}%</TableCell>
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
