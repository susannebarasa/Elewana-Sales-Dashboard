'use client'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import MuiTooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import KpiRow, { fmtK, budgetVariance } from '@/components/KpiRow'
import ExecutiveStoryPanel from '@/components/ExecutiveStoryPanel'
import { propertyBarClickOptions } from '@/lib/chartClicks'
import { PROPERTY_HIGHLIGHT } from '@/lib/designTokens'
import type { KpiMetric } from '@/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip)

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string; property: string }
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

// Compact stat-pair card (2026-07-16 — replaced the earlier value-less mini bar charts, which had
// no visible axis/scale and were less informative than plain numbers) — 2 related numbers side by
// side, label + bold number + a colored delta line reusing the same variance formula the rest of
// the app uses (budgetVariance).
function MiniStat({ label, metric, deltaLabel }: { label: string; metric: KpiMetric; deltaLabel?: string }) {
  const delta = budgetVariance(metric)
  return (
    <Box sx={{ flex: 1, textAlign: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.4 }}>
        <Typography variant="overline" sx={{ display: 'block', fontSize: '0.6rem', color: 'text.secondary' }}>{label}</Typography>
        {metric.tooltip && (
          <MuiTooltip
            title={<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, maxWidth: 260 }}>{metric.tooltip.map((line, idx) => <span key={idx}>{line}</span>)}</Box>}
            arrow
          >
            <InfoOutlinedIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
          </MuiTooltip>
        )}
      </Box>
      <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 700, fontSize: 26, lineHeight: 1.1, color: 'text.primary' }}>
        {fmtK(metric.v, metric.fmt)}
      </Typography>
      {delta && (
        <Typography variant="caption" sx={{ fontWeight: 700, color: delta.positive ? 'success.main' : 'error.main' }}>
          {delta.positive ? '▲' : '▼'} {delta.text}{deltaLabel ? ` ${deltaLabel}` : ''}
        </Typography>
      )}
    </Box>
  )
}

// Severity-colored stat (for pace ratios that have no ly baseline — the value itself IS the
// 100=on-pace scale, so color comes from the metric's own thresholds instead of a delta).
function MiniStatSeverity({ label, metric }: { label: string; metric: KpiMetric }) {
  const { thG, thY } = metric
  const hasThresholds = typeof thG === 'number' && typeof thY === 'number'
  const good = hasThresholds && (metric.inv ? metric.v <= thG : metric.v >= thG)
  const ok = hasThresholds && (metric.inv ? metric.v <= thY : metric.v >= thY)
  const color = !hasThresholds ? 'text.primary' : good ? 'success.main' : ok ? 'warning.main' : 'error.main'
  return (
    <Box sx={{ flex: 1, textAlign: 'center' }}>
      <Typography variant="overline" sx={{ display: 'block', fontSize: '0.6rem', color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 700, fontSize: 26, lineHeight: 1.1, color }}>
        {fmtK(metric.v, metric.fmt)}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>100 = on pace</Typography>
    </Box>
  )
}

// Sales Executive Summary (2026-07-15) — quick-glance top-level page, deliberately NOT a
// duplicate of the full Pace tab: KPI row + a 3-card Pace row + two reused charts only. No
// narrative and no property-level drill-down (Budget-by-Property table, Forecast table, Forward
// Booking Pace bars all stay exclusive to the Pace tab) — the Pace tab is the intended next click
// for anyone wanting that detail.
export default function ExecSummaryView({ data, filters, onSelectProperty }: Props) {
  const kp = data.KP_BASE

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

  // Property (2026-07-16, "no exceptions" pass) — same spotlight treatment as Property
  // Performance: the selected property's bar goes solid + bordered, the rest dim, rather than
  // filtering the ranking down to one bar (which would defeat this chart's comparative purpose).
  const selectedPropertyId = filters.property !== 'all' ? filters.property : null
  const propChartData = {
    labels: data.OD.props.map((p) => p.nm),
    datasets: [{
      data: data.OD.props.map((p) => p.oc),
      backgroundColor: data.OD.props.map((p) => (selectedPropertyId && p.id === selectedPropertyId ? PROPERTY_HIGHLIGHT.bar : selectedPropertyId ? PROPERTY_HIGHLIGHT.dim : 'rgba(183,99,42,0.7)')),
      borderColor: data.OD.props.map((p) => (selectedPropertyId && p.id === selectedPropertyId ? PROPERTY_HIGHLIGHT.border : 'transparent')),
      borderWidth: data.OD.props.map((p) => (selectedPropertyId && p.id === selectedPropertyId ? 1.5 : 0)),
      borderRadius: 3,
    }],
  }

  // Room Revenue label override (2026-07-15) — Exec-Summary-local only, does NOT touch
  // kp.occ.rev's underlying lbl/d (the Occupancy tab's "Total Room Revenue" card is untouched).
  // occ.rev is actualized-stays-only (see OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY in constants.ts),
  // while Agent Room Revenue elsewhere on this dashboard includes forward-confirmed bookings —
  // same honest-labeling pattern as AgentProfilePanel's "Actualized, partial year" notes, so the
  // gap between the two figures reads as a basis difference, not a bug, when compared side by side.
  const roomRevenueActualized = {
    ...kp.occ.rev,
    lbl: 'Room Revenue (Actualized)',
    d: 'Stays already occurred — not full-year',
  }

  return (
    <Box>
      {/* 4-card standard (2026-07-09) — Room Revenue, Room Nights, Occupancy %, Pace vs Budget %.
          ADR/RevPAR/MTD+YTD Budget/Pace ratios moved to the 3 compact charts below rather than
          dropped — still visible, just charted instead of read as bare percentages. */}
      <KpiRow metrics={[roomRevenueActualized, kp.occ.nights, kp.occ.occPct, kp.execPace.vsBudget]} />

      {/* Narrative panel (2026-07-16) — moved below the KPI row: cards first, narrative second. */}
      <ExecutiveStoryPanel data={data} property={filters.property} period={filters.period} />

      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        <Grid size={4}>
          <Card>
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="overline" sx={{ display: 'block', fontSize: '0.625rem', color: 'text.secondary', mb: 0.5 }}>ADR / RevPAR</Typography>
              <Box sx={{ display: 'flex', height: 78 }}>
                <MiniStat label="ADR" metric={kp.occ.adr} />
                <Box sx={{ width: '0.5px', bgcolor: 'divider', mx: 0.5 }} />
                <MiniStat label="RevPAR" metric={kp.occ.revpar} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="overline" sx={{ display: 'block', fontSize: '0.625rem', color: 'text.secondary', mb: 0.5 }}>Actual vs Budget</Typography>
              <Box sx={{ display: 'flex', height: 78 }}>
                <MiniStat label="MTD" metric={kp.pace.budgetMtd} deltaLabel="vs budget" />
                <Box sx={{ width: '0.5px', bgcolor: 'divider', mx: 0.5 }} />
                <MiniStat label="YTD" metric={kp.pace.budgetYtd} deltaLabel="vs budget" />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="overline" sx={{ display: 'block', fontSize: '0.625rem', color: 'text.secondary', mb: 0.5 }}>Pace % (100 = on pace)</Typography>
              <Box sx={{ display: 'flex', height: 78 }}>
                <MiniStatSeverity label="vs Forecast" metric={kp.execPace.vsForecast} />
                <Box sx={{ width: '0.5px', bgcolor: 'divider', mx: 0.5 }} />
                <MiniStatSeverity label="vs STLY" metric={kp.execPace.vsStly} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

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
                {selectedPropertyId && ' · selected property highlighted, full ranking still shown'}
              </Typography>
              <Box sx={{ height: 180, position: 'relative' }}>
                <Bar
                  data={propChartData}
                  options={{ ...CHART_OPTS, indexAxis: 'y' as const, ...propertyBarClickOptions(data.OD.props, onSelectProperty, 'exec-summary') }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
