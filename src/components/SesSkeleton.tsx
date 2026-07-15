'use client'
import Box from '@mui/material/Box'
import Skeleton from '@mui/material/Skeleton'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import { T } from '@/lib/sesTheme'

// Sales Executive Summary's own skeleton set (2026-07-16c, progressive-loading pass) — deliberately
// NOT src/components/DashboardSkeleton.tsx (that one is shared by src/app/page.tsx and
// DailyView.tsx, generic-grey, out of scope here). Each component below is shaped to match its
// real counterpart in SalesExecutiveSummaryDesign.tsx 1:1 (same grid, same card chrome, same
// heights) so a section's skeleton -> real-content swap causes zero layout jump, and every pulse
// is tinted ochre (rgba(183,99,42,0.10-0.15)) rather than MUI's default grey so it reads as part of
// this page's palette rather than a generic loading state bleeding in from elsewhere.
const PULSE = 'rgba(183,99,42,0.13)'
const PULSE_DARK = 'rgba(245,237,216,0.09)'

function Pulse({ w, h, r = 4, dark = false, sx }: { w: string | number; h: number; r?: number; dark?: boolean; sx?: object }) {
  return (
    <Skeleton
      variant="rounded"
      width={w}
      height={h}
      sx={{ bgcolor: dark ? PULSE_DARK : PULSE, borderRadius: `${r}px`, ...sx }}
    />
  )
}

// KPI row (4 cards) + narrative panel (headline/body + 3 pills) — matches the real
// `KpiCard`/narrative Box grid in SalesExecutiveSummaryDesign.tsx.
export function SesKpiNarrativeSkeleton() {
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', mb: '16px' }}>
        {[0, 1, 2, 3].map((i) => (
          <Box
            key={i}
            sx={{
              bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '15px 17px 15px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 6px 14px rgba(31,26,20,.10)',
            }}
          >
            <Pulse w="55%" h={10} sx={{ mb: '10px' }} />
            <Pulse w="70%" h={30} sx={{ mb: '10px' }} />
            <Pulse w="80%" h={10} />
          </Box>
        ))}
      </Box>
      <Box sx={{ bgcolor: T.dk, borderRadius: '10px', p: '20px 24px', mb: '16px', display: 'grid', gridTemplateColumns: '1fr 210px', gap: '26px' }}>
        <Box>
          <Pulse w={140} h={9} dark sx={{ mb: '12px' }} />
          <Pulse w="85%" h={22} dark sx={{ mb: '10px' }} />
          <Pulse w="95%" h={13} dark sx={{ mb: '6px' }} />
          <Pulse w="60%" h={13} dark />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '9px', borderLeft: '0.5px solid rgba(210,190,160,0.22)', pl: '22px' }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ bgcolor: 'rgba(255,255,255,0.045)', border: '0.5px solid rgba(210,190,160,0.22)', borderRadius: '7px', p: '10px 13px' }}>
              <Pulse w="50%" h={20} dark sx={{ mb: '8px' }} />
              <Pulse w="70%" h={8} dark />
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// 2-column chart row — matches the real `ChartCard` pair (Monthly Revenue Trend / By Property).
export function SesChartsSkeleton() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', mb: '16px' }}>
      {[0, 1].map((i) => (
        <Box key={i} sx={{ bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '16px 18px' }}>
          <Pulse w="45%" h={16} sx={{ mb: '8px' }} />
          <Pulse w="65%" h={9} sx={{ mb: '14px' }} />
          <Pulse w="100%" h={230} r={6} />
        </Box>
      ))}
    </Box>
  )
}

// Agent Leaderboard table — sticky header + placeholder rows, same column set as the real table.
const LEADERBOARD_SKELETON_ROWS = 8
const COLS = ['Agent', 'Segment', 'Room Revenue', 'Nights', 'ADR', 'Materialisation', 'YoY']

export function SesLeaderboardSkeleton() {
  return (
    <Box sx={{ bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '16px 18px' }}>
      <Pulse w={180} h={16} sx={{ mb: '10px' }} />
      <Pulse w={240} h={9} sx={{ mb: '12px' }} />
      <Box sx={{ maxHeight: 430, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLS.map((c, i) => (
                <TableCell
                  key={c}
                  align={i === 0 || i === 1 ? 'left' : 'right'}
                  sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}
                >
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: LEADERBOARD_SKELETON_ROWS }).map((_, i) => (
              <TableRow key={i} sx={{ '&:last-child td': { border: 0 } }}>
                <TableCell sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w="70%" h={12} /></TableCell>
                <TableCell sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w={64} h={16} r={20} /></TableCell>
                <TableCell align="right" sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w={50} h={12} sx={{ ml: 'auto' }} /></TableCell>
                <TableCell align="right" sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w={36} h={12} sx={{ ml: 'auto' }} /></TableCell>
                <TableCell align="right" sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w={40} h={12} sx={{ ml: 'auto' }} /></TableCell>
                <TableCell align="right" sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w={34} h={12} sx={{ ml: 'auto' }} /></TableCell>
                <TableCell align="right" sx={{ borderBottom: `0.5px solid ${T.br}` }}><Pulse w={30} h={12} sx={{ ml: 'auto' }} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}
