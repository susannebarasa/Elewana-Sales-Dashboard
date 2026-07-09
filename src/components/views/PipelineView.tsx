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
import type { DashboardData, EntityClickContext } from '@/types'
import KpiRow from '@/components/KpiRow'

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }
type Props = {
  data: DashboardData
  filters: Filters
  onSelectAgent: (agentId: string) => void
  onSelectProperty: (context: EntityClickContext) => void
}

export default function PipelineView({ data, filters, onSelectAgent, onSelectProperty }: Props) {
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
              {data.PLF.map((f) => {
                // Options Held is a subset of Provisional, not a peer funnel stage —
                // indented, muted, and labeled "of Provisional" so it can't be mistaken
                // for a 5th independent stage when skimming the funnel.
                const isSubset = f.st === 'Options Held'
                return (
                  <Box
                    key={f.st}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      py: isSubset ? 0.5 : 0.75,
                      pl: isSubset ? 2 : 0,
                      borderBottom: isSubset ? 'none' : '0.5px solid',
                      borderLeft: isSubset ? '2px solid' : 'none',
                      borderColor: 'divider',
                      opacity: isSubset ? 0.72 : 1,
                    }}
                  >
                    <Typography sx={{ fontSize: isSubset ? 10 : 11, fontWeight: 500, color: isSubset ? 'text.secondary' : 'text.primary', minWidth: isSubset ? 112 : 130 }}>
                      {isSubset ? '↳ ' : ''}{f.st}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(f.pc, 100)}
                      sx={{
                        flex: 1,
                        height: isSubset ? 4 : 6,
                        borderRadius: isSubset ? 2 : 0,
                        bgcolor: '#F5F0E8',
                        '& .MuiLinearProgress-bar': { bgcolor: isSubset ? '#C9A876' : '#B7632A' },
                      }}
                    />
                    <Typography sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'text.secondary', minWidth: 40, textAlign: 'right' }}>
                      {f.ct.toLocaleString()}
                    </Typography>
                    <Typography sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: isSubset ? 'text.secondary' : 'text.primary', fontWeight: isSubset ? 400 : 600, minWidth: 70, textAlign: 'right' }}>
                      {f.vl}
                    </Typography>
                  </Box>
                )
              })}
              <Typography variant="caption" sx={{ display: 'block', pl: 2, mt: -0.25, mb: 0.5, color: 'text.secondary', fontStyle: 'italic' }}>
                {data.PLF.find((f) => f.st === 'Options Held')?.pc ?? 0}% of Provisional — not counted separately in Total Fwd Bkgs
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1.25, mt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Box>
                  <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary' }}>
                    YTD Arrivals
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    Past check-ins this year · not part of forward pipeline
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 13, fontWeight: 600, color: 'text.primary' }}>
                    {data.YTD_ARR.vl}
                  </Typography>
                  <Typography sx={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'text.secondary' }}>
                    {data.YTD_ARR.ct.toLocaleString()} arrivals
                  </Typography>
                </Box>
              </Box>
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
                        <TableCell
                          onClick={() => onSelectAgent(t.agentId)}
                          sx={{
                            fontFamily: 'Inter,sans-serif', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          {t.ag}
                        </TableCell>
                        <TableCell
                          onClick={() => t.propertyId && onSelectProperty({ type: 'property', id: t.propertyId, sourceView: 'pl' })}
                          sx={{
                            fontFamily: 'Inter,sans-serif', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: t.propertyId ? 'primary.main' : 'text.secondary',
                            cursor: t.propertyId ? 'pointer' : 'default',
                            '&:hover': t.propertyId ? { textDecoration: 'underline' } : undefined,
                          }}
                        >
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
