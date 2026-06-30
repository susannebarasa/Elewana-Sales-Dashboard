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
} as const

export default function PaceView({ data, filters }: Props) {
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

  return (
    <Box>
      <KpiRow metrics={[kp.bookings, kp.rev, kp.idx, kp.lead]} />

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
                  {/* budget line */}
                  <Box sx={{ position: 'absolute', left: `${m.bg}%`, top: -2, bottom: -2, width: 1.5, bgcolor: 'divider', zIndex: 4 }} />
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
                  Bgt {m.bg}%
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
                  options={{ ...CHART_OPTS, indexAxis: 'y' as const }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
