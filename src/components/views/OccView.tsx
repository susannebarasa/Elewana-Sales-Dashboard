'use client'
import {
  Box, Grid, Card, CardContent, Typography, Alert, LinearProgress,
} from '@mui/material'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData } from '@/types'
import KpiRow from '@/components/KpiRow'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip)

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
}

export default function OccView({ data, filters }: Props) {
  const kp = data.KP_BASE.occ

  const revByPropData = {
    labels: data.OD.props.map((p) => p.nm),
    datasets: [{
      data: data.OD.props.map((p) => p.ar),
      backgroundColor: 'rgba(183,99,42,0.7)',
      borderRadius: 3,
    }],
  }

  const arrTrendData = {
    labels: data.OD.arr.months,
    datasets: [
      { label: filters.year, data: data.OD.arr.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.OD.arr.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
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

      <KpiRow metrics={[kp.nights, kp.adr, kp.rev, kp.cancel]} />

      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Revenue by Property</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>ADR from ResRequest bookings — last 90 days</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Bar data={revByPropData} options={{ ...CHART_OPTS, indexAxis: 'y' as const }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Arrival Revenue Trend</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{filters.year} vs LY — itinerary gross revenue</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Line data={arrTrendData} options={CHART_OPTS} />
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
              <Typography sx={{ fontSize: 11, color: 'text.primary', minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
    </Box>
  )
}
