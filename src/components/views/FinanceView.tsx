'use client'
import { useState, Fragment } from 'react'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import EmptyState from '@/components/EmptyState'
import FinanceNarrativePanel from '@/components/FinanceNarrativePanel'
import {
  getSandRiverFinance, PERIOD_LABELS,
  type FinancePeriod, type FinanceMetric, type FinancePLLine, type PLSection, type ChartStatus,
} from '@/lib/sandRiverFinance'
import { RAG_DEEP_RED, CHART_COLORS } from '@/lib/designTokens'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip)

// Finance (Sand River) — standalone tab, entirely independent of the shared /api/dashboard
// payload (see page.tsx's renderContent — this is checked before the loading/error/data gates
// for exactly that reason).
//
// DATA STATUS (re-extracted 2026-07-10): the prior "No Selection" sheet bug is fixed — Actual,
// Budget, and Last Year are all real now (see the header comment in sandRiverFinance.ts for the
// exact row/column mapping). All 3 charts and all 4 KPI cards currently render their 'ok' branch.
//
// Chart rendering below is driven ENTIRELY by data.charts.{cumulativeRevenuePace,monthlyCostStack,
// netProfitWaterfall} (a ChartStatus each — 'ndl' | 'budget-only' | 'ok'), NOT by assuming today's
// data shape — if a future re-extraction ever regresses (e.g. the sheet breaks again for one
// property), these branches still degrade correctly with no code change:
//   - 'ndl': neither Actual nor Budget known for that chart → EmptyState.
//   - 'budget-only': Budget known, Actual not → single Budget-only series.
//   - 'ok': both known → real Actual series alongside the Budget reference (current state).
// The Net Profit Waterfall is inherently a variance chart (every bar is an Actual-minus-Budget
// delta) — 'budget-only' can't produce a meaningful bridge either, so it renders as EmptyState
// alongside 'ndl'; only 'ok' draws the real waterfall, built to the exact 6-bar spec in the
// source SKILL.md §17 (Budget NP → Revenue Var → Managed Cost Var → Imposed Cost Var → HO Cost
// Var → Actual NP) — see buildWaterfallSteps below.
// RECON (ResRequest vs MIS comparison), the AI Query Box, and any MotherDuck/DuckDB queries are
// explicitly out of scope — never build them here.

const KPI_LABELS: { key: 'netRevenue' | 'contributionToHO' | 'ebitda' | 'netProfit'; label: string }[] = [
  { key: 'netRevenue', label: 'Net Revenue' },
  { key: 'contributionToHO', label: 'Contribution to HO' },
  { key: 'ebitda', label: 'EBITDA' },
  { key: 'netProfit', label: 'Net Profit' },
]

const RAG_COLOR: Record<string, string> = {
  green: '#3B6D11',
  amber: '#B7632A',
  red: '#C0392B',
  deepRed: RAG_DEEP_RED,
}

const NDL_BG = '#F0EDE8'
const NDL_BORDER = '#C9BEA9'
const TBC_BG = '#FFFBF0'
const TBC_BORDER = '#EFC97A'

// $ formatter that keeps the sign visible on cost/deduction rows (sheet stores those as
// negative) rather than silently dropping it — a P&L line reading "$161,235" for a cost row
// would misreadable as income.
function fmtMoney(v: number | null): string {
  if (v === null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`
}

function fmtMoneyK(v: number): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(v) / 1000)}K`
}

// Always-visible chart key (2026-07-16, chart-legend audit) — swatch + label, same "thickness
// distinguishes solid vs dashed" convention already used by PaceView/ExecSummaryView/
// BookingStatusMovementView's inline legend rows, not a chart-native Chart.js legend (kept off via
// CHART_OPTS' legend:false everywhere, since Chart.js's own legend widget doesn't match this app's
// type scale/spacing as cleanly as a plain Box row does).
function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <Box key={it.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: it.dashed ? 2 : 3, bgcolor: it.color, borderRadius: 1 }} />
          <Typography variant="caption">{it.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function StatusBadge({ status }: { status: 'ok' | 'tbc' | 'ndl' }) {
  if (status === 'ndl') {
    return <Chip label="NDL" size="small" sx={{ height: 16, fontSize: '0.5625rem', bgcolor: '#E8E2D8', color: '#8A7D70', border: '0.5px solid', borderColor: NDL_BORDER }} />
  }
  if (status === 'tbc') {
    return <Chip label="TBC" size="small" sx={{ height: 16, fontSize: '0.5625rem', bgcolor: '#FFF3CD', color: '#854F0B', border: '0.5px solid', borderColor: TBC_BORDER }} />
  }
  return null
}

function FinanceKpiCard({ label, metric }: { label: string; metric: FinanceMetric }) {
  if (metric.status === 'ndl') {
    // Actual is NDL, but Budget may still be known (confirmed real data) — show it as the
    // reference figure rather than blanket-hiding everything, per explicit user confirmation.
    return (
      <Card sx={{ bgcolor: NDL_BG, borderLeft: '2.5px solid', borderLeftColor: NDL_BORDER, borderRadius: 1.5, height: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
            <Typography variant="overline" sx={{ fontSize: '0.5625rem', letterSpacing: '0.1em', color: 'text.secondary' }}>
              {label}
            </Typography>
            <StatusBadge status="ndl" />
          </Box>
          <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, fontSize: 23, color: '#8A7D70' }}>
            —
          </Typography>
          <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary', mt: 0.5 }}>
            No actual data loaded
          </Typography>
          {metric.budget !== null && (
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.primary', mt: 0.25, fontFamily: '"JetBrains Mono", monospace' }}>
              Budget {fmtMoney(metric.budget)}
            </Typography>
          )}
        </CardContent>
      </Card>
    )
  }

  // 'ok' — the live branch now that Actual data is real. 'tbc' stays kept-ready (no current
  // Finance line item is genuinely "received but unverified").
  const rag = metric.rag ? RAG_COLOR[metric.rag] : '#C9BEA9'
  const bg = metric.status === 'tbc' ? TBC_BG : undefined
  return (
    <Card sx={{ bgcolor: bg, border: '0.5px solid', borderColor: rag, borderRadius: 1.5, height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, bgcolor: rag }} />
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
          <Typography variant="overline" sx={{ fontSize: '0.5625rem', letterSpacing: '0.1em', color: 'text.secondary' }}>
            {label}
          </Typography>
          {metric.status === 'tbc' && <StatusBadge status="tbc" />}
        </Box>
        <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, fontSize: 23, fontStyle: metric.status === 'tbc' ? 'italic' : 'normal' }}>
          {fmtMoney(metric.value)}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary' }}>
            {metric.budget !== null ? `Budget ${fmtMoney(metric.budget)}` : ''}
          </Typography>
          <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.625rem', color: rag }}>
            {metric.variancePct !== null ? `${metric.variancePct > 0 ? '▲' : '▼'} ${metric.variancePct}%` : ''}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

const SECTION_TITLES: Record<PLSection, string> = {
  revenue: 'Revenue',
  costs: 'Costs',
  summary: 'Summary',
  drivers: 'Top Drivers',
}

const TOTAL_ROW_KEYS = new Set(['netRevenue', 'contribution', 'ebitda', 'nop'])
const BOLD_TOTAL_KEYS = new Set(['nop'])

function FinancePLTable({ lines, period }: { lines: FinancePLLine[]; period: FinancePeriod }) {
  const [mode, setMode] = useState<'summary' | 'detail'>('summary')
  const visible = lines.filter((l) => mode === 'detail' || !l.detailOnly)
  const sections: PLSection[] = ['revenue', 'costs', 'summary', 'drivers']

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Profit &amp; Loss</Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, v) => v && setMode(v)}
            size="small"
            sx={{
              bgcolor: 'background.default',
              border: '0.5px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: '2px',
              '& .MuiToggleButtonGroup-grouped': {
                border: 'none',
                fontSize: '0.6875rem',
                '&.Mui-selected': { bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.primary' } },
              },
            }}
          >
            <ToggleButton value="summary" sx={{ lineHeight: 1, px: 1.5 }}>Summary</ToggleButton>
            <ToggleButton value="detail" sx={{ lineHeight: 1, px: 1.5 }}>Detail</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Legend banner (SKILL.md §7) — NDL/TBC key. No active TBC items today (every row is
            NDL on the Actual side), so only the legend renders, not a TBC item list. */}
        <Box sx={{ display: 'flex', gap: 2, mb: 1.5, p: 1, bgcolor: 'background.default', borderRadius: 1, border: '0.5px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StatusBadge status="ndl" />
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>No Data Loaded — Actual not yet received; Budget shown where known</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StatusBadge status="tbc" />
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Pending Confirmation — received but unverified</Typography>
          </Box>
        </Box>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Line Item</TableCell>
              <TableCell align="right" sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Actual</TableCell>
              <TableCell align="right" sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Budget</TableCell>
              <TableCell align="right" sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Variance</TableCell>
              <TableCell align="center" sx={{ fontSize: '0.6875rem', color: 'text.secondary', width: 56 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sections.map((section) => {
              const rows = visible.filter((l) => l.section === section)
              if (rows.length === 0) return null
              return (
                <Fragment key={section}>
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      sx={{ bgcolor: 'background.default', fontSize: '0.625rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary', py: 0.5 }}
                    >
                      {SECTION_TITLES[section]}
                    </TableCell>
                  </TableRow>
                  {rows.map((l) => {
                    const isNdl = l.status === 'ndl'
                    const isTbc = l.status === 'tbc'
                    const isTotal = TOTAL_ROW_KEYS.has(l.key)
                    const isBold = BOLD_TOTAL_KEYS.has(l.key)
                    const valueForPeriod = l.value ? l.value[period] : null
                    const budgetForPeriod = l.budget ? l.budget[period] : null
                    const varianceForPeriod = l.variance ? l.variance[period] : null
                    return (
                      <TableRow
                        key={l.key}
                        sx={{
                          bgcolor: isNdl ? NDL_BG : isTbc ? TBC_BG : isTotal ? 'primary.light' : undefined,
                          borderLeft: isNdl ? `2.5px solid ${NDL_BORDER}` : isTbc ? `2.5px solid ${TBC_BORDER}` : undefined,
                        }}
                      >
                        <TableCell
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: isBold ? 700 : isTotal ? 600 : 400,
                            fontStyle: isTbc ? 'italic' : 'normal',
                            pl: l.detailOnly ? 3 : 1.5,
                          }}
                        >
                          {l.label}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace', color: isNdl ? '#8A7D70' : undefined }}>
                          {fmtMoney(valueForPeriod)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace' }}>
                          {fmtMoney(budgetForPeriod)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace', color: isNdl ? '#8A7D70' : undefined }}>
                          {fmtMoney(varianceForPeriod)}
                        </TableCell>
                        <TableCell align="center">
                          <StatusBadge status={l.status} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ActualNotAvailableNote() {
  return (
    <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary', mt: 0.5, fontStyle: 'italic' }}>
      Actual not available — Budget shown only
    </Typography>
  )
}

// Waterfall bridge step — exact 6-bar spec from the source SKILL.md §17 (Budget NP → Revenue Var
// → Managed Cost Var → Imposed Cost Var → HO Cost Var → Actual NP). Bars 1 and 6 are 'total'
// (anchored at 0, solid — bar 6 is deliberately NOT required to land where bar 5's bridge ends;
// the gap, if any, is the real D&A/Finance Cost/other-non-EBITDA variance the 4-bar bridge
// doesn't cover — an honest simplification per spec, not an arithmetic error). Bars 2-5 are
// floating bridges colored green/red by favorable/unfavorable direction.
//
// Each bridge value is exactly that line's `variance[period]` (value-minus-budget) already
// computed in sandRiverFinance.json — for a cost line stored negative (managedCosts/imposedCosts/
// hoCosts), value-minus-budget already equals "budget magnitude minus actual magnitude" (both
// negative, so the signs cancel algebraically), so no separate magnitude math is needed here.
interface WaterfallStep { label: string; range: [number, number]; kind: 'total' | 'up' | 'down' }

function buildWaterfallSteps(lines: FinancePLLine[], period: FinancePeriod): WaterfallStep[] {
  const line = (key: string) => lines.find((l) => l.key === key)
  const nop = line('nop')
  const budgetNP = nop?.budget?.[period] ?? 0
  const actualNP = nop?.value?.[period] ?? 0
  const revenueVar = line('netRevenue')?.variance?.[period] ?? 0
  const managedVar = line('managedCosts')?.variance?.[period] ?? 0
  const imposedVar = line('imposedCosts')?.variance?.[period] ?? 0
  const hoVar = line('hoCosts')?.variance?.[period] ?? 0

  let cum = budgetNP
  const bridge = (label: string, delta: number): WaterfallStep => {
    const from = cum
    cum += delta
    return { label, range: [from, cum], kind: delta >= 0 ? 'up' : 'down' }
  }

  return [
    { label: 'Budget NP', range: [0, budgetNP], kind: 'total' },
    bridge('Revenue Var', revenueVar),
    bridge('Managed Cost Var', managedVar),
    bridge('Imposed Cost Var', imposedVar),
    bridge('HO Cost Var', hoVar),
    { label: 'Actual NP', range: [0, actualNP], kind: 'total' },
  ]
}

export default function FinanceView() {
  const [period, setPeriod] = useState<FinancePeriod>('y')
  const data = getSandRiverFinance()
  const kpis = data.kpis[period]
  const mb = data.monthlyBudget
  const ma = data.monthlyActual
  const revenuePaceStatus: ChartStatus = data.charts.cumulativeRevenuePace
  const monthlyCostStackStatus: ChartStatus = data.charts.monthlyCostStack
  const netProfitWaterfallStatus: ChartStatus = data.charts.netProfitWaterfall

  // 'ok' requires monthlyActual to actually be populated — falls back to the budget-only series
  // if the two ever disagree (status flipped ahead of the data, or vice versa) rather than
  // rendering a broken chart.
  const revenuePaceData = {
    labels: mb.months,
    datasets: [
      ...(revenuePaceStatus === 'ok' && ma
        ? [{
          label: 'Actual',
          data: ma.revenue,
          borderColor: CHART_COLORS.trend,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
        }]
        : []),
      {
        label: 'Budget',
        data: mb.revenue,
        borderColor: CHART_COLORS.comparison,
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  }

  // 'ok': the stack becomes real Actual costs (the newsworthy content once available), Budget
  // demotes to a dashed revenue reference line alongside the solid Actual revenue line — same
  // "Actual solid / Budget dashed" convention as revenuePaceData above.
  const costStackOk = monthlyCostStackStatus === 'ok' && ma
  const costStackData = {
    labels: mb.months,
    datasets: [
      { label: 'Managed Costs', data: costStackOk ? ma.managedCosts : mb.managedCosts, backgroundColor: CHART_COLORS.categoryRotation[1], stack: 'costs' },
      { label: 'Imposed Costs', data: costStackOk ? ma.imposedCosts : mb.imposedCosts, backgroundColor: CHART_COLORS.negative, stack: 'costs' },
      {
        label: costStackOk ? 'Revenue (Actual)' : 'Revenue (Budget)',
        data: costStackOk ? ma.revenue : mb.revenue,
        type: 'line' as const,
        borderColor: CHART_COLORS.trend,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
      ...(costStackOk
        ? [{
          label: 'Revenue (Budget)',
          data: mb.revenue,
          type: 'line' as const,
          borderColor: CHART_COLORS.comparison,
          backgroundColor: 'transparent',
          borderDash: [4, 3],
          borderWidth: 1.5,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: 'y',
        }]
        : []),
    ],
  }

  const waterfallSteps = netProfitWaterfallStatus === 'ok' ? buildWaterfallSteps(data.plLines, period) : []
  const waterfallData = {
    labels: waterfallSteps.map((s) => s.label),
    datasets: [{
      data: waterfallSteps.map((s) => s.range),
      backgroundColor: waterfallSteps.map((s) => (
        s.kind === 'total' ? CHART_COLORS.budgetGold : s.kind === 'up' ? CHART_COLORS.positive : CHART_COLORS.negative
      )),
      borderRadius: 2,
    }],
  }
  const waterfallOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { raw: unknown }) => {
            const [start, end] = ctx.raw as [number, number]
            return fmtMoneyK(end - start)
          },
        },
      },
    },
    scales: {
      y: { ticks: { callback: (v: string | number) => fmtMoneyK(Number(v)), font: { size: 9 } } },
      x: { ticks: { font: { size: 8 } } },
    },
  }

  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: { raw: unknown }) => fmtMoneyK(Number(ctx.raw)) } } },
    scales: {
      y: { ticks: { callback: (v: string | number) => fmtMoneyK(Number(v)), font: { size: 9 } } },
      x: { ticks: { font: { size: 9 } } },
    },
  }

  const barOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: { raw: unknown }) => fmtMoneyK(Number(ctx.raw)) } } },
    scales: {
      y: { stacked: true, ticks: { callback: (v: string | number) => fmtMoneyK(Number(v)), font: { size: 9 } } },
      x: { stacked: true, ticks: { font: { size: 9 } } },
    },
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 1.5 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500, fontSize: 26, lineHeight: 1.1 }}>
            {data.property.name}
          </Typography>
          <Typography sx={{ fontStyle: 'italic', fontSize: '0.75rem', color: 'text.secondary' }}>
            {data.property.operatorLabel}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          {/* Static, non-personalized — this app has no user-identity/auth system to greet by
              name (unlike the SKILL.md mockup's hardcoded 'Sueh' fallback). */}
          <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontStyle: 'italic', fontSize: 12, color: 'warning.main', mb: 0.5 }}>
            Finance MIS Report
          </Typography>
          <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6875rem', color: 'text.secondary' }}>
            {data.reportPeriod ? `${data.reportPeriod.label} ${data.reportPeriod.year}` : 'No period loaded'}
          </Typography>
        </Box>
      </Box>

      {/* Period toggle — deliberately local state, NOT the Topbar's shared filters.period (the
          whole global filter cluster is hidden for this view — see Topbar.tsx). */}
      <ToggleButtonGroup
        value={period}
        exclusive
        onChange={(_, v) => v && setPeriod(v)}
        size="small"
        sx={{
          mb: 1.5,
          bgcolor: 'background.paper',
          border: '0.5px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: '2px',
          '& .MuiToggleButtonGroup-grouped': {
            border: 'none',
            fontSize: '0.6875rem',
            px: 1.5,
            '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.main' } },
          },
        }}
      >
        {(['m', 'y', 'a'] as const).map((p) => (
          <ToggleButton key={p} value={p} sx={{ lineHeight: 1 }}>
            {data.reportPeriod && p !== 'a' ? `${PERIOD_LABELS[p]} (${data.reportPeriod.label})` : PERIOD_LABELS[p]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* 4 KPI cards */}
      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        {KPI_LABELS.map(({ key, label }) => (
          <Grid size={3} key={key}>
            <FinanceKpiCard label={label} metric={kpis[key]} />
          </Grid>
        ))}
      </Grid>

      {/* Executive Narrative — dark sibling panel */}
      <FinanceNarrativePanel narrative={data.narrative} />

      {/* 3 charts */}
      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary' }}>
                Cumulative Revenue Pace
              </Typography>
              {revenuePaceStatus === 'ndl' ? (
                <EmptyState message="No data loaded — neither Actual nor Budget figures are available for this chart yet." height={130} />
              ) : (
                <>
                  {revenuePaceStatus === 'budget-only' && <ActualNotAvailableNote />}
                  <Box sx={{ height: 130, mt: 1 }}>
                    <Line data={revenuePaceData} options={lineOpts} />
                  </Box>
                  <ChartLegend
                    items={[
                      ...(revenuePaceStatus === 'ok' && ma ? [{ label: 'Actual', color: CHART_COLORS.trend }] : []),
                      { label: 'Budget', color: CHART_COLORS.comparison, dashed: true },
                    ]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary' }}>
                Monthly Cost Stack vs Revenue
              </Typography>
              {monthlyCostStackStatus === 'ndl' ? (
                <EmptyState message="No data loaded — neither Actual nor Budget figures are available for this chart yet." height={130} />
              ) : (
                <>
                  {monthlyCostStackStatus === 'budget-only' && <ActualNotAvailableNote />}
                  <Box sx={{ height: 130, mt: 1 }}>
                    {/* Mixed bar+line dataset — react-chartjs-2's ChartData<'bar'> type doesn't model
                        a per-dataset type override, though Chart.js itself handles it fine at
                        runtime (same technique as a bar-chart-with-line-overlay anywhere else). */}
                    <Bar data={costStackData as never} options={barOpts} />
                  </Box>
                  <ChartLegend
                    items={[
                      { label: 'Managed Costs', color: CHART_COLORS.categoryRotation[1] },
                      { label: 'Imposed Costs', color: CHART_COLORS.negative },
                      { label: costStackOk ? 'Revenue (Actual)' : 'Revenue (Budget)', color: CHART_COLORS.trend },
                      ...(costStackOk ? [{ label: 'Revenue (Budget)', color: CHART_COLORS.comparison, dashed: true }] : []),
                    ]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                Net Profit Waterfall
              </Typography>
              {netProfitWaterfallStatus === 'ok' ? (
                <>
                  <Box sx={{ height: 130, mt: 1 }}>
                    <Bar data={waterfallData} options={waterfallOpts} />
                  </Box>
                  <ChartLegend
                    items={[
                      { label: 'Total', color: CHART_COLORS.budgetGold },
                      { label: 'Increase', color: CHART_COLORS.positive },
                      { label: 'Decrease', color: CHART_COLORS.negative },
                    ]}
                  />
                </>
              ) : (
                <EmptyState message="No data loaded — this is an Actual-vs-Budget bridge chart, so it needs real Actual figures to mean anything." height={130} />
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* P&L table */}
      <FinancePLTable lines={data.plLines} period={period} />
    </Box>
  )
}
