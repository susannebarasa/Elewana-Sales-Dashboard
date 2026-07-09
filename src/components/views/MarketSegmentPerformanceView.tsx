'use client'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  BarElement, Tooltip as ChartTooltip,
} from 'chart.js'
import type { ChartOptions } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext } from '@/types'

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip)

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = {
  data: DashboardData
  filters: Filters
  onSelectSegment: (context: EntityClickContext) => void
}

const fmtDollar = (v: number): string =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`

// Same green/red "up/down" convention already used elsewhere (Booking Status Movement's
// Confirmed/Cancelled series, Agent Pace's gainers/decliners) — gray for segments with no real
// prior-year base to compare against (yoyPct null, shown as "—" in the table too).
const YOY_UP = '#3B6D11'
const YOY_DOWN = '#C0392B'
const YOY_NONE = 'rgba(107,95,80,0.35)'

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

// Market Segment Performance (2026-07-15) — one row per Market Segment value (including
// Unallocated, never hidden). Sorted by Room Revenue descending. Respects the dashboard's own
// year/period/channel filters (unlike Property Performance, which is fixed to full-year-2026
// because of its Budget dependency) — the click-through panel is passed the same `filters` so the
// two never show contradictory numbers for the same segment.
export default function MarketSegmentPerformanceView({ data, filters, onSelectSegment }: Props) {
  const rows = [...data.MARKET_SEGMENT_PERFORMANCE].sort((a, b) => b.roomRevenue - a.roomRevenue)

  const chartData = {
    labels: rows.map((r) => r.segment),
    datasets: [{
      data: rows.map((r) => r.roomRevenue),
      backgroundColor: rows.map((r) => (r.yoyPct === null ? YOY_NONE : r.yoyPct >= 0 ? YOY_UP : YOY_DOWN)),
      borderRadius: 3,
    }],
  }

  const chartOptions: ChartOptions<'bar'> = {
    ...CHART_OPTS,
    onClick: (_event, elements) => {
      const idx = elements[0]?.index
      if (idx === undefined) return
      const segment = rows[idx]?.segment
      if (segment) onSelectSegment({ type: 'segment', id: segment, sourceView: 'market-segment-performance' })
    },
    onHover: (event, elements) => {
      const target = event.native?.target as HTMLElement | null | undefined
      if (target) target.style.cursor = elements.length > 0 ? 'pointer' : 'default'
    },
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.25 }}>Room Revenue by Market Segment</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            {filters.year} · green = YoY growth, red = YoY decline, gray = no prior-year base to compare · click a bar for detail
          </Typography>
          <Box sx={{ height: Math.max(180, rows.length * 32), position: 'relative' }}>
            <Bar data={chartData} options={chartOptions} />
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Market Segment Performance</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            {filters.year} · click a segment for property/agent breakdown
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left' }}>Market Segment</TableCell>
                  <TableCell align="right">Room Revenue</TableCell>
                  <TableCell align="right">Room Nights</TableCell>
                  <TableCell align="right">ADR</TableCell>
                  <TableCell align="right">YoY %</TableCell>
                  <TableCell align="right">Active Agents</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.segment} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell
                      onClick={() => onSelectSegment({ type: 'segment', id: r.segment, sourceView: 'market-segment-performance' })}
                      sx={{
                        fontFamily: 'Inter, sans-serif', fontWeight: 500, color: 'primary.main',
                        maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {r.segment}
                    </TableCell>
                    <TableCell align="right">{fmtDollar(r.roomRevenue)}</TableCell>
                    <TableCell align="right">{r.roomNights.toLocaleString()}</TableCell>
                    <TableCell align="right">{r.adr !== null ? `$${r.adr.toLocaleString()}` : '—'}</TableCell>
                    <TableCell align="right" sx={{ color: r.yoyPct === null ? 'text.secondary' : r.yoyPct >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                      {r.yoyPct === null ? '—' : `${r.yoyPct >= 0 ? '+' : ''}${r.yoyPct.toFixed(1)}%`}
                    </TableCell>
                    <TableCell align="right">{r.activeAgents.toLocaleString()}</TableCell>
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
