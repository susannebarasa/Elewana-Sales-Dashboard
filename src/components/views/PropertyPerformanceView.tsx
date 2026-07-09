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
import Tooltip from '@mui/material/Tooltip'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  BarElement, Tooltip as ChartTooltip,
} from 'chart.js'
import type { ChartOptions } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import { propertyBarClickOptions } from '@/lib/chartClicks'

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip)

type Props = {
  data: DashboardData
  onSelectProperty: (context: EntityClickContext) => void
}

const fmtDollar = (v: number | null): string =>
  v === null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`
const fmtPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`)

// 4-card standard (2026-07-09) — simple label/value cards, no threshold/RAG coloring (unlike
// KpiRow) since there's no established green/amber/red basis for these portfolio-wide summary
// figures yet — same lightweight pattern Booking Status Movement's own Stat already uses.
function SummaryStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Grid size={3}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="overline" sx={{ display: 'block' }}>{label}</Typography>
          <Typography
            variant="h4"
            sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontSize: 28, lineHeight: 1, color: 'text.primary', my: 0.5 }}
          >
            {value}
          </Typography>
          {note && (
            <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary', fontStyle: 'italic', display: 'block' }}>
              {note}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  )
}

// Same green/red "up/down" convention used everywhere else (Market Segment Performance's own
// chart, Booking Status Movement, Agent Pace).
const VARIANCE_OVER = '#3B6D11'
const VARIANCE_UNDER = '#C0392B'

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
  },
} as const

// Property Performance (2026-07-15) — one row per property, portfolio-wide table + the Property
// Profile Panel drill-down (reused as the SOLE property drill-down mechanism, per the standing
// instruction — no second, separate panel). Sorted by Room Revenue descending — a ranking table,
// so the biggest performers surface first; caveat properties (LEPC/NXR/LSC) sort naturally low
// given their $0/near-$0 figures, still shown as rows with their caveat flagged, never hidden.
export default function PropertyPerformanceView({ data, onSelectProperty }: Props) {
  const rows = [...data.PROPERTY_PERFORMANCE].sort((a, b) => (b.roomRevenue ?? -1) - (a.roomRevenue ?? -1))

  // 4-card summary (2026-07-09) — totalRoomRevenue sums this page's own rows (same full-year-2026
  // basis as the chart/table below); avgOccPct reuses KP_BASE.occ.occPct, the already-correct
  // nights-weighted portfolio figure computed server-side, rather than a naive re-average here.
  // Budget counts exclude no-budget properties (Afrochic etc.), same as the variance chart.
  const totalRoomRevenue = rows.reduce((s, r) => s + (r.roomRevenue ?? 0), 0)
  const overBudgetCount = rows.filter((r) => r.budgetVariancePct !== null && r.budgetVariancePct >= 100).length
  const underBudgetCount = rows.filter((r) => r.budgetVariancePct !== null && r.budgetVariancePct < 100).length

  // Revenue chart — same rows/order as the table below, so the two never disagree on ranking.
  const revenueChartData = {
    labels: rows.map((r) => r.propertyName),
    datasets: [{
      data: rows.map((r) => r.roomRevenue ?? 0),
      backgroundColor: 'rgba(183,99,42,0.7)',
      borderRadius: 3,
    }],
  }
  const revenueChartOptions: ChartOptions<'bar'> = {
    ...CHART_OPTS,
    ...propertyBarClickOptions(rows.map((r) => ({ id: r.propertyId })), onSelectProperty, 'property-performance'),
  }

  // Variance chart — only properties with a budget set (Afrochic etc. have none — see
  // budget.ts's own caveat — excluded here rather than shown as a misleading 0%; the table below
  // still lists them with "no budget" spelled out, nothing is hidden, just not charted).
  const varianceRows = rows.filter((r) => r.budgetVariancePct !== null)
  const varianceChartData = {
    labels: varianceRows.map((r) => r.propertyName),
    datasets: [{
      data: varianceRows.map((r) => r.budgetVariancePct as number),
      backgroundColor: varianceRows.map((r) => ((r.budgetVariancePct as number) >= 100 ? VARIANCE_OVER : VARIANCE_UNDER)),
      borderRadius: 3,
    }],
  }
  const varianceChartOptions: ChartOptions<'bar'> = {
    ...CHART_OPTS,
    ...propertyBarClickOptions(varianceRows.map((r) => ({ id: r.propertyId })), onSelectProperty, 'property-performance'),
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Grid container spacing={1.5}>
        <SummaryStat label="Total Room Revenue" value={fmtDollar(totalRoomRevenue)} note="Full-year 2026, all properties" />
        <SummaryStat label="Avg Occupancy %" value={fmtPct(data.KP_BASE.occ.occPct.v)} note="Portfolio-wide, nights-weighted" />
        <SummaryStat label="Properties At/Over Budget" value={String(overBudgetCount)} note={`of ${overBudgetCount + underBudgetCount} with a budget set`} />
        <SummaryStat label="Properties Under Budget" value={String(underBudgetCount)} note={`of ${overBudgetCount + underBudgetCount} with a budget set`} />
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Room Revenue by Property</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Full-year 2026 — sorted descending · click a bar for detail
          </Typography>
          <Box sx={{ height: Math.max(180, rows.length * 24), position: 'relative' }}>
            <Bar data={revenueChartData} options={revenueChartOptions} />
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Budget Variance % by Property</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Full-year 2026 · green = at/over budget (≥100%), red = under budget · properties with no budget set are excluded here, still listed below · click a bar for detail
          </Typography>
          <Box sx={{ height: Math.max(180, varianceRows.length * 24), position: 'relative' }}>
            <Bar data={varianceChartData} options={varianceChartOptions} />
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Property Performance</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Full-year 2026 — click a property for Top Agents and detail
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Property</TableCell>
                  <TableCell align="right">Room Revenue</TableCell>
                  <TableCell align="right">Extras Revenue</TableCell>
                  <TableCell align="right">RevPAR</TableCell>
                  <TableCell align="right">Occupancy %</TableCell>
                  <TableCell align="right">ADR</TableCell>
                  <TableCell align="right">Room Nights Sold</TableCell>
                  <TableCell align="right">Budget Variance %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const over = r.budgetVariancePct !== null && r.budgetVariancePct >= 100
                  return (
                    <TableRow key={r.propertyName} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell
                        onClick={() => r.propertyId && onSelectProperty({ type: 'property', id: r.propertyId, sourceView: 'property-performance' })}
                        sx={{
                          fontFamily: 'Inter, sans-serif', fontWeight: 500,
                          color: r.propertyId ? 'primary.main' : 'text.secondary',
                          maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          cursor: r.propertyId ? 'pointer' : 'default',
                          '&:hover': r.propertyId ? { textDecoration: 'underline' } : undefined,
                        }}
                      >
                        {r.propertyName}
                        {r.caveat && (
                          <Tooltip title={r.caveat} placement="top" arrow>
                            <Chip label="caveat" size="small" sx={{ ml: 0.75, height: 15, fontSize: '0.5625rem', bgcolor: '#FDF8EE', color: '#8A6D1D' }} />
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="right">{fmtDollar(r.roomRevenue)}</TableCell>
                      <TableCell align="right">{fmtDollar(r.extrasRevenue)}</TableCell>
                      <TableCell align="right">{fmtDollar(r.revpar)}</TableCell>
                      <TableCell align="right">{fmtPct(r.occPct)}</TableCell>
                      <TableCell align="right">{fmtDollar(r.adr)}</TableCell>
                      <TableCell align="right">{r.soldNights !== null ? r.soldNights.toLocaleString() : '—'}</TableCell>
                      <TableCell align="right">
                        {r.budgetVariancePct === null ? (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>no budget</Typography>
                        ) : (
                          <Chip
                            label={`${r.budgetVariancePct.toFixed(1)}%`}
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
    </Box>
  )
}
