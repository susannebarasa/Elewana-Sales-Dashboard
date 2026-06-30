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

export default function AgentsView({ data, filters }: Props) {
  const kp = data.KP_BASE.agents

  const byMonthData = {
    labels: data.AD.byMonth.months,
    datasets: [
      { label: filters.year, data: data.AD.byMonth.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: data.AD.byMonth.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
    ],
  }

  const byPropData = {
    labels: data.AD.byProp.slice(0, 10).map((p) => p.pr),
    datasets: [
      { label: filters.year, data: data.AD.byProp.slice(0, 10).map((p) => p.rv), backgroundColor: 'rgba(183,99,42,0.7)', borderRadius: 3 },
      { label: 'LY', data: data.AD.byProp.slice(0, 10).map((p) => p.ly), backgroundColor: 'rgba(107,95,80,0.35)', borderRadius: 3 },
    ],
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <KpiRow metrics={[kp.active, kp.arev, kp.nradr, kp.radr]} />

      <Grid container spacing={1.5}>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Agent Revenue by Month</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{filters.year} vs LY — agent-linked bookings</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Line data={byMonthData} options={CHART_OPTS} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Revenue by Property</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{filters.year} vs LY — top 10 properties</Typography>
              <Box sx={{ height: 200, position: 'relative' }}>
                <Bar data={byPropData} options={CHART_OPTS} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Top Trade Partners</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>YTD {filters.year} — ranked by revenue</Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Agent</TableCell>
                  <TableCell align="right">Revenue ($k)</TableCell>
                  <TableCell align="right">Nights</TableCell>
                  <TableCell align="right">ADR</TableCell>
                  <TableCell align="right">YoY</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.AD.yearly.slice(0, 10).map((r) => (
                  <TableRow key={r.nm} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'text.primary', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.nm}
                    </TableCell>
                    <TableCell align="right">${r.rv.toLocaleString()}k</TableCell>
                    <TableCell align="right">{r.nt.toLocaleString()}</TableCell>
                    <TableCell align="right">${r.nr_adr.toLocaleString()}</TableCell>
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
    </Box>
  )
}
