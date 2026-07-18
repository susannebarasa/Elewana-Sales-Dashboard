'use client'
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
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import KpiRow, { fmtK, budgetVariance } from '@/components/KpiRow'
import MiniStatRow from '@/components/MiniStatRow'
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
} as const

export default function PaceView({ data, filters, onSelectProperty }: Props) {
  const kp = data.KP_BASE.pace

  const paceChartData = {
    labels: data.PD.months,
    datasets: [
      {
        label: filters.year,
        data: data.PD.actual,
        borderColor: '#B7632A',
        backgroundColor: 'rgba(183,99,42,0.1)',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: 'LY',
        data: data.PD.ly,
        borderColor: 'rgba(138,123,101,0.8)',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 2,
        borderDash: [4, 3],
      },
    ],
  }

  const propChartData = {
    labels: data.OD.props.map((p) => p.nm),
    datasets: [{
      data: data.OD.props.map((p) => p.oc),
      backgroundColor: 'rgba(183,99,42,0.7)',
      borderRadius: 3,
    }],
  }

  // Budget vs Actual by property, full-year 2026 (2026-07-13) — sorted so the biggest
  // variances (over OR under budget) surface first. Properties with no budget set
  // (variancePct: null — e.g. Afrochic, see src/lib/budget.ts) sort to the bottom, since
  // "no budget" isn't a variance to rank against the rest.
  const budgetByProp = [...data.BUDGET.byProp].sort((a, b) => {
    if (a.variancePct === null && b.variancePct === null) return 0
    if (a.variancePct === null) return 1
    if (b.variancePct === null) return -1
    return Math.abs(b.variancePct - 100) - Math.abs(a.variancePct - 100)
  })

  const forecast = data.FORECAST

  return (
    <Box>
      {/* 4-card standard (2026-07-09) — MTD/YTD vs Budget moved to the MiniStatRow below, next
          to the Forecast table where "vs budget" is already covered in full monthly detail. */}
      <KpiRow metrics={[kp.bookings, kp.rev, kp.idx, kp.lead]} />

      {/* Forecast Room Nights vs Actual vs Budget — 2026-07-14 */}
      <Card sx={{ mb: 1.5 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Forecast Room Nights vs Budget</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Confirmed + (Provisional × 30%) + Adjusted Pick-Up − Expected Cancellations · pace ratio {forecast.paceRatio.toFixed(2)}× · LY cancel rate {(forecast.cancelRateLy * 100).toFixed(1)}%
          </Typography>
          <MiniStatRow
            items={[
              { label: 'MTD vs Budget', value: fmtK(kp.budgetMtd.v, kp.budgetMtd.fmt), variance: budgetVariance(kp.budgetMtd), tooltip: kp.budgetMtd.d },
              { label: 'YTD vs Budget', value: fmtK(kp.budgetYtd.v, kp.budgetYtd.fmt), variance: budgetVariance(kp.budgetYtd), tooltip: kp.budgetYtd.d },
            ]}
          />
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Month</TableCell>
                  <TableCell align="right">Confirmed</TableCell>
                  <TableCell align="right">+ Provisional×30%</TableCell>
                  <TableCell align="right">+ Adj. Pick-Up</TableCell>
                  <TableCell align="right">− Exp. Cancellations</TableCell>
                  <TableCell align="right">= Forecast</TableCell>
                  <TableCell align="right">Budget</TableCell>
                  <TableCell align="right">% of Budget</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {forecast.byMonth.map((m) => {
                  const pctOfBudget = m.budgetNights > 0 ? Math.round((m.forecastNights / m.budgetNights) * 1000) / 10 : null
                  const over = pctOfBudget !== null && pctOfBudget >= 100
                  return (
                    <TableRow key={`${m.year}-${m.month}`} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{m.monthLabel}</TableCell>
                      <TableCell align="right">{m.confirmedNights.toLocaleString()}</TableCell>
                      <TableCell align="right">+{m.provisionalComponent.toLocaleString()}</TableCell>
                      <TableCell align="right">+{m.adjustedPickup.toLocaleString()}</TableCell>
                      <TableCell align="right">−{m.expectedCancellations.toLocaleString()}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{m.forecastNights.toLocaleString()}</TableCell>
                      <TableCell align="right">{m.budgetNights.toLocaleString()}</TableCell>
                      <TableCell align="right">
                        {pctOfBudget === null ? (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>no budget</Typography>
                        ) : (
                          <Chip
                            label={`${pctOfBudget.toFixed(1)}%`}
                            size="small"
                            sx={{
                              bgcolor: over ? '#EAF3DE' : '#FEF2F2',
                              color: over ? '#27500A' : '#C0392B',
                              height: 18, fontSize: '0.6875rem', fontWeight: 700,
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* Budget vs Actual by property — full-year 2026 */}
      <Card sx={{ mb: 1.5 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Budget vs Actual by Property</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Full-year 2026 — sorted by biggest variance (over or under)
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Property</TableCell>
                  <TableCell align="right">Actual</TableCell>
                  <TableCell align="right">Budget</TableCell>
                  <TableCell align="right">Variance %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {budgetByProp.map((r) => {
                  const over = r.variancePct !== null && r.variancePct >= 100
                  return (
                    <TableRow key={r.propertyId} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell
                        onClick={() => onSelectProperty({ type: 'property', id: r.propertyId, sourceView: 'pace' })}
                        sx={{
                          fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                          cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {r.property}
                      </TableCell>
                      <TableCell align="right">${r.actual.toLocaleString()}</TableCell>
                      <TableCell align="right">${r.budget.toLocaleString()}</TableCell>
                      <TableCell align="right">
                        {r.variancePct === null ? (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>no budget</Typography>
                        ) : (
                          <Chip
                            label={`${r.variancePct.toFixed(1)}%`}
                            size="small"
                            sx={{
                              bgcolor: over ? '#EAF3DE' : '#FEF2F2',
                              color: over ? '#27500A' : '#C0392B',
                              height: 18, fontSize: '0.6875rem', fontWeight: 700,
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* Forward pipeline bars */}
      <Card sx={{ mb: 1.5 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Forward Booking Pace</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Confirmed · provisional vs budget
          </Typography>
          {data.PF.map((m) => (
            <Box key={m.mo} sx={{ py: 0.75, borderTop: '0.5px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '84px 1fr 70px', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" sx={{ fontSize: 15 }}>{m.mo}</Typography>
                <Box sx={{ position: 'relative', height: 22, bgcolor: 'background.default', borderRadius: 1, overflow: 'visible' }}>
                  {/* budget line — position clamped to 0-100 (bgLinePos) so an over-budget month
                      doesn't push the marker off the bar; the label below shows the real,
                      unclamped % (see dashboard/route.ts's PF assembly comment). Omitted entirely
                      when this property/month has no budget row at all (bgLinePos null). */}
                  {m.bgLinePos !== null && (
                    <Box sx={{ position: 'absolute', left: `${m.bgLinePos}%`, top: -2, bottom: -2, width: 1.5, bgcolor: 'divider', zIndex: 4 }} />
                  )}
                  {/* confirmed bar */}
                  <Box sx={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${m.cf}%`, bgcolor: '#3B6D11',
                    borderRadius: '4px 0 0 4px',
                    display: 'flex', alignItems: 'center', pl: 1, zIndex: 3,
                  }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
                      {m.cf}% · {m.cv}
                    </Typography>
                  </Box>
                  {/* provisional bar */}
                  <Box sx={{
                    position: 'absolute', left: `${m.cf}%`, top: 0, height: '100%',
                    width: `${m.pv}%`, bgcolor: 'rgba(74,90,58,0.28)',
                    border: '1px solid #4A5A3A',
                    display: 'flex', alignItems: 'center', pl: 0.5, zIndex: 2,
                  }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'text.primary', whiteSpace: 'nowrap' }}>
                      {m.pval}
                    </Typography>
                  </Box>
                </Box>
                <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: 'text.secondary', textAlign: 'right' }}>
                  {m.bg === null ? 'Bgt —' : `Bgt ${m.bg}%`}
                </Typography>
              </Box>
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* Charts row */}
      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Monthly Booking Pace</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                {filters.year} vs LY — confirmed Room Revenue ($k)
              </Typography>
              <Box sx={{ height: 180, position: 'relative' }}>
                <Line data={paceChartData} options={CHART_OPTS} />
              </Box>
              <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 12, height: 3, bgcolor: '#B7632A', borderRadius: 1 }} />
                  <Typography variant="caption">{filters.year}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 12, height: 2, bgcolor: 'rgba(138,123,101,0.8)', borderRadius: 1 }} />
                  <Typography variant="caption">LY</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Bookings by Property</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                Relative occupancy — last 90 days
              </Typography>
              <Box sx={{ height: 180, position: 'relative' }}>
                <Bar
                  data={propChartData}
                  options={{ ...CHART_OPTS, indexAxis: 'y' as const, ...propertyBarClickOptions(data.OD.props, onSelectProperty, 'pace') }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
