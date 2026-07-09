'use client'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Grid from '@mui/material/Grid'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Tooltip as ChartTooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { DashboardData } from '@/types'
import MiniStatRow from '@/components/MiniStatRow'
import { KpiCardShell } from '@/components/KpiRow'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip)

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters }

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
  },
} as const

const fmtDollar = (v: number): string =>
  Math.abs(v) >= 1e6 ? `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(1)}M`
    : Math.abs(v) >= 1e3 ? `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e3).toFixed(1)}k`
    : `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString()}`

// Booking Status Movement (2026-07-15, reduced to 4 cards 2026-07-09) — KPI row + monthly trend
// chart, no drill-down table (this view is about movement over time, not comparing discrete
// entities, per the confirmed scope). Waitlisted's "Not Tracked" card removed as part of the
// 4-card standardization pass — it was never counting anything (no waitlist status code exists
// in ResRequest, only 0/10/20/30/90), so dropping it loses no real information. Booking
// Amendments stays dropped entirely (no version/amendment-count column exists in the schema).
// New Confirmed moved to a 4th line on the chart below; Provisional → Confirmed moved to the
// MiniStatRow under the chart — neither silently dropped, just no longer full-size cards.
export default function BookingStatusMovementView({ data, filters }: Props) {
  const bsm = data.BOOKING_STATUS_MOVEMENT

  const chartData = {
    labels: bsm.monthlyTrend.months,
    datasets: [
      {
        label: 'Confirmed',
        data: bsm.monthlyTrend.confirmed.map((v) => v / 1000),
        borderColor: '#3B6D11',
        backgroundColor: 'rgba(59,109,17,0.08)',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: 'Provisional',
        data: bsm.monthlyTrend.provisional.map((v) => v / 1000),
        borderColor: '#B7632A',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 2,
        borderDash: [4, 3],
      },
      {
        label: 'Cancelled',
        data: bsm.monthlyTrend.cancelled.map((v) => v / 1000),
        borderColor: '#C0392B',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 2,
        borderDash: [2, 2],
      },
      {
        label: 'New Confirmed',
        data: bsm.monthlyTrend.newConfirmed.map((v) => v / 1000),
        borderColor: '#4A5A3A', // secondary/olive-green — was an out-of-system blue-gray
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 2,
        borderDash: [6, 2],
      },
    ],
  }

  return (
    <Box>
      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        <KpiCardShell label="Confirmed" value={fmtDollar(bsm.confirmed.value)} caption={`${bsm.confirmed.count.toLocaleString()} bookings`} />
        <KpiCardShell label="Provisional" value={fmtDollar(bsm.provisional.value)} caption={`${bsm.provisional.count.toLocaleString()} bookings`} />
        {/* accent=red mirrors the chart's own Cancelled line color below — a real loss signal, not a fabricated threshold */}
        <KpiCardShell label="Cancelled" value={fmtDollar(bsm.cancelled.value)} caption={`${bsm.cancelled.count.toLocaleString()} confirmed bookings lost`} accent="red" />
        <KpiCardShell
          label="Net Pick-up"
          value={fmtDollar(bsm.netPickup)}
          caption="New Confirmed + Converted − Cancelled"
          accent={bsm.netPickup >= 0 ? 'green' : 'red'}
          tooltip="New Confirmed (created & confirmed this period) + Provisional → Confirmed (created earlier, converted this period) − Cancelled. The two conversion sources are mutually exclusive by date_created, so this is a non-overlapping net figure."
        />
      </Grid>

      <MiniStatRow
        items={[
          {
            label: 'New Confirmed',
            value: `${fmtDollar(bsm.newConfirmed.value)} (${bsm.newConfirmed.count.toLocaleString()} bookings)`,
            tooltip: 'Bookings created and confirmed within this period — also plotted as a 4th line on the chart below.',
          },
          {
            label: 'Provisional → Confirmed',
            value: `${bsm.provisionalToConfirmed.ratePct.toFixed(1)}% (${bsm.provisionalToConfirmed.count.toLocaleString()} of ${bsm.provisionalToConfirmed.totalCount.toLocaleString()})`,
            tooltip: 'Only counts bookings that were Provisional before this period and converted within it. Bookings created and confirmed in the same period are counted under New Confirmed instead, to avoid double-counting.',
          },
          { label: 'Waitlisted', value: 'Not Tracked', tooltip: 'No waitlist status code exists in ResRequest (only New Inquiry, Quote, Provisional, Confirmed, Cancelled) — confirmed, not approximated.' },
        ]}
      />

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Monthly Booking Status Movement</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            {filters.year} · Confirmed / Provisional / Cancelled / New Confirmed ($k)
          </Typography>
          <Box sx={{ height: 220, position: 'relative' }}>
            <Line data={chartData} options={CHART_OPTS} />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 3, bgcolor: '#3B6D11', borderRadius: 1 }} />
              <Typography variant="caption">Confirmed</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 2, bgcolor: '#B7632A', borderRadius: 1 }} />
              <Typography variant="caption">Provisional</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 2, bgcolor: '#C0392B', borderRadius: 1 }} />
              <Typography variant="caption">Cancelled</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 2, bgcolor: '#4A5A3A', borderRadius: 1 }} />
              <Typography variant="caption">New Confirmed</Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
