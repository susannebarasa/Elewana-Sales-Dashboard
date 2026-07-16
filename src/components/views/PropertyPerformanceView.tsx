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
  BarElement, PointElement, LineElement, Tooltip as ChartTooltip, Legend as ChartLegend,
} from 'chart.js'
import type { ChartData, ChartOptions } from 'chart.js'
import { Bar, Chart } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import { propertyBarClickOptions } from '@/lib/chartClicks'
import { KpiCardShell } from '@/components/KpiRow'
import EmptyState from '@/components/EmptyState'
import { PROPERTY_HIGHLIGHT } from '@/lib/designTokens'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ChartTooltip, ChartLegend)

type Props = {
  data: DashboardData
  filters: { property: string }
  onSelectProperty: (context: EntityClickContext) => void
}

// Highlight colors (2026-07-16, "no exceptions" property-filter pass) — the Properties filter
// now visibly applies here too, but as a spotlight on the selected row/bar rather than filtering
// the table/charts down to one row, which would break their whole comparative purpose (see
// project memory on this reversal). Kept visually distinct from the existing over/under-budget
// RAG colors so the two meanings (severity vs "this is the one you picked") don't collide.
// Shared with Sales Executive Summary's "Bookings by Property" chart — see PROPERTY_HIGHLIGHT.
const HIGHLIGHT_BAR = PROPERTY_HIGHLIGHT.bar
const DIM_BAR = PROPERTY_HIGHLIGHT.dim
const HIGHLIGHT_BORDER = PROPERTY_HIGHLIGHT.border

const fmtDollar = (v: number | null): string =>
  v === null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`
const fmtPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`)

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
export default function PropertyPerformanceView({ data, filters, onSelectProperty }: Props) {
  const rows = [...data.PROPERTY_PERFORMANCE].sort((a, b) => (b.roomRevenue ?? -1) - (a.roomRevenue ?? -1))
  const selectedPropertyId = filters.property !== 'all' ? filters.property : null

  // 4-card summary (2026-07-09) — totalRoomRevenue sums this page's own rows (same full-year-2026
  // basis as the chart/table below); avgOccPct reuses KP_BASE.occ.occPct, the already-correct
  // nights-weighted portfolio figure computed server-side, rather than a naive re-average here.
  // Budget counts exclude no-budget properties (Afrochic etc.), same as the variance chart.
  const totalRoomRevenue = rows.reduce((s, r) => s + (r.roomRevenue ?? 0), 0)
  const overBudgetCount = rows.filter((r) => r.budgetVariancePct !== null && r.budgetVariancePct >= 100).length
  const underBudgetCount = rows.filter((r) => r.budgetVariancePct !== null && r.budgetVariancePct < 100).length
  const selectedRow = selectedPropertyId ? rows.find((r) => r.propertyId === selectedPropertyId) : undefined

  // Revenue chart — same rows/order as the table below, so the two never disagree on ranking.
  // Selected property (if any) is spotlighted (solid color) while the rest dim, rather than being
  // filtered out — keeps the full comparative ranking intact per the "no exceptions" reversal.
  const revenueChartData = {
    labels: rows.map((r) => r.propertyName),
    datasets: [{
      data: rows.map((r) => r.roomRevenue ?? 0),
      backgroundColor: rows.map((r) => (selectedPropertyId && r.propertyId === selectedPropertyId ? HIGHLIGHT_BAR : selectedPropertyId ? DIM_BAR : 'rgba(183,99,42,0.7)')),
      borderColor: rows.map((r) => (selectedPropertyId && r.propertyId === selectedPropertyId ? HIGHLIGHT_BORDER : 'transparent')),
      borderWidth: rows.map((r) => (selectedPropertyId && r.propertyId === selectedPropertyId ? 1.5 : 0)),
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
  // Same spotlight idea as the revenue chart, but the over/under RAG color is the primary signal
  // here — so the selected property keeps its real color and gets a dark border instead of being
  // recolored, rather than a highlight color that would clash with or override that verdict.
  const varianceChartData = {
    labels: varianceRows.map((r) => r.propertyName),
    datasets: [{
      data: varianceRows.map((r) => r.budgetVariancePct as number),
      backgroundColor: varianceRows.map((r) => ((r.budgetVariancePct as number) >= 100 ? VARIANCE_OVER : VARIANCE_UNDER)),
      borderColor: varianceRows.map((r) => (selectedPropertyId && r.propertyId === selectedPropertyId ? HIGHLIGHT_BORDER : 'transparent')),
      borderWidth: varianceRows.map((r) => (selectedPropertyId && r.propertyId === selectedPropertyId ? 1.5 : 0)),
      borderRadius: 3,
    }],
  }
  const varianceChartOptions: ChartOptions<'bar'> = {
    ...CHART_OPTS,
    ...propertyBarClickOptions(varianceRows.map((r) => ({ id: r.propertyId })), onSelectProperty, 'property-performance'),
  }

  // Revenue & Occupancy chart (2026-07-16f) — Budget vs Actual Room Revenue grouped bars per
  // property, with an Occupancy % dot overlay (green = at/above that property's own Budget
  // Occupancy %, red = below). Uses data.BUDGET.occByProperty, NOT PROPERTY_PERFORMANCE/
  // revenueChartData's 18-property list — occByProperty is the union of PROPERTY_ROOM_COUNTS (18,
  // carries LEPC/NXR/Lewa's capacity caveats) plus Afrochic (budget file only, no room-count entry)
  // so all four caveat properties appear here rather than Afrochic being silently absent the way
  // it already is from PROPERTY_PERFORMANCE. Sorted by Budget Room Revenue descending (this
  // chart's own primary axis), independent of the Room Revenue-sorted table/charts above.
  const revOccRows = [...data.BUDGET.occByProperty].sort((a, b) => (b.budgetRevenue ?? -1) - (a.budgetRevenue ?? -1))
  // Mixed bar+dot chart — react-chartjs-2/chart.js's ChartData<TType> generic doesn't have a
  // clean built-in shape for "bar chart with one line-type overlay dataset," so this is typed
  // loosely and cast at the call site; Chart.js's runtime handles per-dataset `type` overrides
  // (the actual mixed-chart mechanism) regardless of the TS shape.
  const revOccChartData = {
    labels: revOccRows.map((r) => r.propertyName),
    datasets: [
      {
        type: 'bar' as const,
        label: 'Budget Room Revenue',
        data: revOccRows.map((r) => r.budgetRevenue ?? 0),
        backgroundColor: 'rgba(183,99,42,0.35)',
        borderRadius: 3,
        yAxisID: 'y',
      },
      {
        type: 'bar' as const,
        label: 'Actual Room Revenue',
        data: revOccRows.map((r) => r.actualRevenue ?? 0),
        backgroundColor: 'rgba(183,99,42,0.85)',
        borderRadius: 3,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: 'Occupancy % (vs Budget)',
        data: revOccRows.map((r) => r.actualOccPct),
        showLine: false,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBorderWidth: 0,
        pointBackgroundColor: revOccRows.map((r) => (
          r.actualOccPct === null || r.budgetOccPct === null
            ? 'rgba(107,95,80,0.4)'
            : r.actualOccPct >= r.budgetOccPct ? VARIANCE_OVER : VARIANCE_UNDER
        )),
        yAxisID: 'y1',
      },
    ],
  }
  const revOccChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top', labels: { font: { size: 10 }, boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const row = revOccRows[ctx.dataIndex]
            if (ctx.dataset.label === 'Occupancy % (vs Budget)') {
              return row.actualOccPct === null
                ? `Occupancy %: no data (${row.caveat ?? 'see caveat'})`
                : `Occupancy %: ${row.actualOccPct.toFixed(1)}% (Budget: ${row.budgetOccPct !== null ? row.budgetOccPct.toFixed(1) + '%' : '—'})`
            }
            return `${ctx.dataset.label}: ${fmtDollar((ctx.raw as number) ?? 0)}`
          },
          afterBody: (items) => {
            const row = revOccRows[items[0]?.dataIndex ?? 0]
            return row?.caveat ? [`⚠ ${row.caveat}`] : []
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
      y: {
        position: 'left',
        grid: { color: 'rgba(201,190,169,0.4)' },
        ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)', callback: (v) => fmtDollar(Number(v)) },
      },
      y1: {
        position: 'right',
        min: 0,
        grid: { drawOnChartArea: false },
        ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)', callback: (v) => `${v}%` },
      },
    },
    ...propertyBarClickOptions(revOccRows.map((r) => ({ id: r.propertyId })), onSelectProperty, 'property-performance'),
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Grid container spacing={1.5}>
        <KpiCardShell label="Total Room Revenue" value={fmtDollar(totalRoomRevenue)} caption="Full-year 2026, all properties" />
        <KpiCardShell label="Avg Occupancy %" value={fmtPct(data.KP_BASE.occ.occPct.v)} caption="Portfolio-wide, nights-weighted" />
        {/* accent mirrors the same green/red convention as this view's own budget-variance chips
            below — this is carrying forward an already-computed verdict (over vs under budget),
            not inventing a new threshold. */}
        <KpiCardShell
          label="Properties At/Over Budget"
          value={String(overBudgetCount)}
          caption={`of ${overBudgetCount + underBudgetCount} with a budget set`}
          accent="green"
        />
        <KpiCardShell
          label="Properties Under Budget"
          value={String(underBudgetCount)}
          caption={`of ${overBudgetCount + underBudgetCount} with a budget set`}
          accent="red"
        />
      </Grid>

      {/* Properties filter reversal (2026-07-16) — this view still shows every property (its
          whole purpose is cross-property comparison), but the Topbar's selected property is now
          spotlighted below rather than silently ignored. */}
      {selectedPropertyId && (
        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
          Highlighting {selectedRow?.propertyName ?? selectedPropertyId} (Topbar Properties filter) — table and charts still show every property for comparison.
        </Typography>
      )}

      {rows.length === 0 ? (
        <EmptyState message="No properties match this filter selection." />
      ) : (
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
      )}

      {varianceRows.length === 0 ? (
        <EmptyState message="No properties with a budget set in this selection." />
      ) : (
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
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Revenue &amp; Occupancy by Property</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            Full-year 2026 · bars = Budget vs Actual Room Revenue (left axis) · dots = Occupancy % (right axis), green = at/above that property&apos;s own Budget Occupancy %, red = below · hover a dot for the Budget Occupancy % it&apos;s compared against · click a bar/dot for detail
          </Typography>
          <Box sx={{ height: 320, position: 'relative' }}>
            <Chart type="bar" data={revOccChartData as unknown as ChartData<'bar', (number | null)[], string>} options={revOccChartOptions} />
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
                  const isSelected = selectedPropertyId !== null && r.propertyId === selectedPropertyId
                  return (
                    <TableRow
                      key={r.propertyName}
                      sx={{
                        '&:last-child td': { border: 0 },
                        bgcolor: isSelected ? 'primary.light' : undefined,
                        borderLeft: isSelected ? '3px solid' : undefined,
                        borderLeftColor: isSelected ? 'primary.main' : undefined,
                      }}
                    >
                      <TableCell
                        onClick={() => r.propertyId && onSelectProperty({ type: 'property', id: r.propertyId, sourceView: 'property-performance' })}
                        sx={{
                          fontFamily: 'Inter, sans-serif', fontWeight: isSelected ? 700 : 500,
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
