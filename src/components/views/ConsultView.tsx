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
import Chip from '@mui/material/Chip'
import type { DashboardData } from '@/types'
import KpiRow from '@/components/KpiRow'

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters }

export default function ConsultView({ data, filters }: Props) {
  const kp = data.KP_BASE.consult

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <KpiRow metrics={[kp.n, kp.bkgs, kp.avg, kp.top]} />

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: 15, mb: 0.5 }}>Consultant Performance</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            YTD {filters.year} — ranked by bookings
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Consultant</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Revenue ($k)</TableCell>
                  <TableCell align="right">Share</TableCell>
                  <TableCell align="center">YoY</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.CD.map((c) => (
                  <TableRow key={c.nm} sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ fontFamily: 'Inter,sans-serif', fontWeight: 500, color: 'text.primary' }}>
                      {c.nm}
                    </TableCell>
                    <TableCell align="right">{c.bk.toLocaleString()}</TableCell>
                    <TableCell align="right">${c.rv.toLocaleString()}k</TableCell>
                    <TableCell align="right">{c.cv}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={c.cg}
                        size="small"
                        sx={{
                          bgcolor: c.up ? '#EAF3DE' : '#FEF2F2',
                          color: c.up ? '#3B6D11' : '#C0392B',
                          height: 18,
                          fontSize: '0.6rem',
                          fontWeight: 600,
                        }}
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
