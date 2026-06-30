'use client'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import type { DashboardData } from '@/types'
import KpiRow from '@/components/KpiRow'

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = { data: DashboardData; filters: Filters }

export default function PipelineView({ data, filters }: Props) {
  const kp = data.KP_BASE.pipeline

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <KpiRow metrics={[kp.val, kp.opps, kp.conv, kp.avg]} />

      <Grid container spacing={1.5}>
        {/* Pipeline Funnel */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.5 }}>Pipeline Funnel</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
                All forward bookings · {filters.year}
              </Typography>
              {data.PLF.map((f) => (
                <Box
                  key={f.st}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, borderBottom: '0.5px solid', borderColor: 'divider' }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.primary', minWidth: 130 }}>
                    {f.st}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(f.pc, 100)}
                    sx={{ flex: 1, bgcolor: '#F5F0E8', '& .MuiLinearProgress-bar': { bgcolor: '#B7632A' } }}
                  />
                  <Typography sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'text.secondary', minWidth: 40, textAlign: 'right' }}>
                    {f.ct.toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'text.primary', fontWeight: 600, minWidth: 70, textAlign: 'right' }}>
                    {f.vl}
                  </Typography>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        {/* Upcoming Arrivals */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontSize: 15, mb: 0.5 }}>Upcoming Arrivals</Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
                Next confirmed &amp; provisional check-ins
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Agent</TableCell>
                      <TableCell>Property</TableCell>
                      <TableCell align="center">Check-in</TableCell>
                      <TableCell align="right">Nts</TableCell>
                      <TableCell align="right">Value</TableCell>
                      <TableCell align="center">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.PLT.map((t, i) => (
                      <TableRow key={i} sx={{ '&:last-child td': { border: 0 } }}>
                        <TableCell sx={{ fontFamily: 'Inter,sans-serif', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.ag}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'Inter,sans-serif', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.secondary' }}>
                          {t.pr}
                        </TableCell>
                        <TableCell align="center">{t.ci}</TableCell>
                        <TableCell align="right">{t.nt}</TableCell>
                        <TableCell align="right">{t.vl}</TableCell>
                        <TableCell align="center">
                          <Chip
                            label={t.st}
                            size="small"
                            sx={{
                              bgcolor: t.st === 'Confirmed' ? '#EAF3DE' : '#FAEEDA',
                              color: t.st === 'Confirmed' ? '#27500A' : '#854F0B',
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
        </Grid>
      </Grid>
    </Box>
  )
}
