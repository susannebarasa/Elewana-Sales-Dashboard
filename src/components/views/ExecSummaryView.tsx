'use client'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'
import KpiRow, { fmtK } from '@/components/KpiRow'
import MiniStatRow from '@/components/MiniStatRow'
import ExecutiveStoryPanel from '@/components/ExecutiveStoryPanel'
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
        borderColor: 'rgba(107,95,80,0.5)',
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

  // Budget-variance % for the mini-row, same formula KpiRow itself uses for BUDGET-tagged
  // metrics (m.ly carries the budget figure for these two) — kept visually consistent with how
  // this same comparison read when it was a full card.
  const budgetVarPct = (m: { v: number; ly?: number }): string | null =>
    typeof m.ly === 'number' && m.ly > 0 ? `${((m.v - m.ly) / m.ly) * 100 >= 0 ? '+' : ''}${(((m.v - m.ly) / m.ly) * 100).toFixed(1)}%` : null

  return (
    <Box>
      <ExecutiveStoryPanel data={data} />

      {/* 4-card standard (2026-07-09) — Room Revenue, Room Nights, Occupancy %, Pace vs Budget %.
          ADR/RevPAR/MTD+YTD Budget moved to the compact strip below rather than dropped — still
          visible, just not full cards. */}
      <KpiRow metrics={[roomRevenueActualized, kp.occ.nights, kp.occ.occPct, kp.execPace.vsBudget]} />
      <MiniStatRow
        items={[
          { label: 'ADR', value: fmtK(kp.occ.adr.v, kp.occ.adr.fmt) },
          { label: 'RevPAR', value: fmtK(kp.occ.revpar.v, kp.occ.revpar.fmt) },
          {
            label: 'MTD vs Budget',
            value: `${fmtK(kp.pace.budgetMtd.v, kp.pace.budgetMtd.fmt)}${budgetVarPct(kp.pace.budgetMtd) ? ` (${budgetVarPct(kp.pace.budgetMtd)})` : ''}`,
          },
          {
            label: 'YTD vs Budget',
            value: `${fmtK(kp.pace.budgetYtd.v, kp.pace.budgetYtd.fmt)}${budgetVarPct(kp.pace.budgetYtd) ? ` (${budgetVarPct(kp.pace.budgetYtd)})` : ''}`,
          },
        ]}
      />

      {/* Pace vs Forecast/STLY (2026-07-09) — vsBudget is already in the main row above, so this
          mini-row only carries the other two ratios rather than repeating it. */}
      <MiniStatRow
        items={[
          { label: 'Pace vs Forecast %', value: fmtK(kp.execPace.vsForecast.v, kp.execPace.vsForecast.fmt), tooltip: kp.execPace.vsForecast.d },
          { label: 'Pace vs STLY %', value: fmtK(kp.execPace.vsStly.v, kp.execPace.vsStly.fmt), tooltip: kp.execPace.vsStly.d },
        ]}
      />

      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Monthly Booking Pace</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                {filters.year} vs LY confirmed bookings ($k)
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
                  <Box sx={{ width: 12, height: 2, bgcolor: 'rgba(107,95,80,0.5)', borderRadius: 1 }} />
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
