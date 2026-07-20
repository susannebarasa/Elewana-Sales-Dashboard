'use client'
import { useState, useEffect } from 'react'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import CloseIcon from '@mui/icons-material/Close'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, Tooltip as ChartTooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { AgentProfile } from '@/types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip)

const fmtDollar = (v: number): string =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`

function SummaryStat({ label, value, chg, note }: { label: string; value: string; chg?: { pct: number } | null; note?: string }) {
  return (
    <Grid size={4}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="overline" sx={{ display: 'block' }}>{label}</Typography>
          <Typography
            variant="h4"
            sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 700, fontSize: 26, lineHeight: 1, color: 'text.primary', my: 0.5 }}
          >
            {value}
          </Typography>
          {chg && (
            <Typography
              sx={{ fontSize: '0.6875rem', fontWeight: 700, color: chg.pct >= 0 ? 'success.main' : 'error.main' }}
            >
              {chg.pct >= 0 ? '+' : ''}{chg.pct.toFixed(1)}% YoY
            </Typography>
          )}
          {note && (
            <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary', fontStyle: 'italic', display: 'block' }}>
              {note}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Grid>
  )
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: 'rgba(107,95,80,0.6)' } },
  },
}

type Props = {
  agentId: string | null
  onClose: () => void
}

export default function AgentProfilePanel({ agentId, onClose }: Props) {
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agentId) {
      setProfile(null)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/agent/${encodeURIComponent(agentId)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: AgentProfile) => { setProfile(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [agentId])

  const chartData = profile ? {
    labels: profile.monthlyRevenue.months,
    datasets: [
      { label: String(profile.year), data: profile.monthlyRevenue.act, borderColor: '#B7632A', backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2, tension: 0.3, pointRadius: 3 },
      { label: 'LY', data: profile.monthlyRevenue.ly, borderColor: 'rgba(107,95,80,0.5)', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
      { label: 'Extras', data: profile.monthlyRevenue.extras, borderColor: '#4A5A3A', backgroundColor: 'transparent', borderWidth: 1.5, tension: 0.3, pointRadius: 2, borderDash: [2, 2] },
    ],
  } : null

  // disableEnforceFocus (2026-07-20) — MUI's default Modal focus trap silently pulls focus back
  // into the Drawer on every attempt to focus anything outside it (confirmed live:
  // document.activeElement stayed on MuiDrawer-paper even after clicking the AI Query Box's
  // textarea, so typed keystrokes never reached it). The AI Query Box renders outside this
  // Drawer's DOM subtree at zIndex 1400 specifically so it stays usable while a panel is open —
  // the focus trap defeated that even though z-index/hit-testing were already correct.
  return (
    <Drawer anchor="right" open={!!agentId} onClose={onClose} disableEnforceFocus>
      <Box sx={{ width: { xs: '100vw', sm: '40vw' }, minWidth: { sm: 420 }, maxWidth: '100vw', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: 2, borderBottom: '0.5px solid', borderColor: 'divider' }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: 20, fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
              {profile?.agentName ?? (loading ? 'Loading…' : 'Agent Profile')}
            </Typography>
            {profile && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                {profile.country && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{profile.country}</Typography>
                )}
                <Chip
                  label={profile.commission.label}
                  size="small"
                  sx={{ bgcolor: '#F5F0E8', color: 'text.secondary', height: 18, fontSize: '0.625rem', fontWeight: 600 }}
                />
                {profile.commission.note && (
                  <Tooltip title={profile.commission.note} arrow placement="top">
                    <InfoOutlinedIcon sx={{ fontSize: 14, color: '#C9BEA9', opacity: 0.8, cursor: 'help' }} />
                  </Tooltip>
                )}
                {/* Channel / Market Segment — src/lib/agentSegments.ts. 'Unallocated' is a real,
                    known classification gap and is always shown as-is, never hidden. */}
                <Chip
                  label={profile.channel}
                  size="small"
                  sx={{ bgcolor: '#EDEBE6', color: 'text.secondary', height: 18, fontSize: '0.625rem' }}
                />
                <Chip
                  label={profile.marketSegment}
                  size="small"
                  sx={{ bgcolor: '#EDEBE6', color: 'text.secondary', height: 18, fontSize: '0.625rem' }}
                />
              </Box>
            )}
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} sx={{ color: 'primary.main' }} />
            </Box>
          )}
          {error && <Alert severity="error">Failed to load agent profile: {error}</Alert>}
          {profile && (
            <>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <SummaryStat
                  label="Room Revenue YTD"
                  value={fmtDollar(profile.summary.revenueYtd)}
                  chg={profile.summary.revenueYtdLy > 0
                    ? { pct: ((profile.summary.revenueYtd - profile.summary.revenueYtdLy) / profile.summary.revenueYtdLy) * 100 }
                    : null}
                />
                <SummaryStat
                  label="Extras YTD"
                  value={fmtDollar(profile.summary.extrasYtd)}
                  chg={profile.summary.extrasYtdLy > 0
                    ? { pct: ((profile.summary.extrasYtd - profile.summary.extrasYtdLy) / profile.summary.extrasYtdLy) * 100 }
                    : null}
                />
                <SummaryStat label="Confirmed Bookings" value={profile.summary.confirmedBookings.toLocaleString()} />
                <SummaryStat label="Room Nights" value={profile.summary.roomNights.toLocaleString()} note="Actualized, partial year" />
                <SummaryStat label="ADR" value={fmtDollar(profile.summary.adr)} note="Actualized, partial year" />
                <SummaryStat label="Conversion Rate" value={`${profile.summary.conversionRate}%`} />
                <SummaryStat label="Avg Booking Value" value={fmtDollar(profile.summary.avgBookingValue)} note="Room + Extras" />
              </Grid>

              <Divider sx={{ my: 1.5 }} />

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Monthly Revenue ({profile.year}, current vs LY) — Room Revenue, Extras shown separately
              </Typography>
              <Box sx={{ height: 160, position: 'relative', mb: 2 }}>
                {chartData && <Line data={chartData} options={{ ...CHART_OPTS, plugins: { legend: { display: true, labels: { font: { size: 9 } } } } }} />}
              </Box>

              <Divider sx={{ my: 1.5 }} />

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Property Breakdown
              </Typography>
              <Table size="small" sx={{ mb: 2 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Property</TableCell>
                    <TableCell align="right">Bookings</TableCell>
                    <TableCell align="right">Room Revenue</TableCell>
                    <TableCell align="right">Extras</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profile.propertyBreakdown.map((p) => (
                    <TableRow key={p.property} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property}</TableCell>
                      <TableCell align="right">{p.bookings}</TableCell>
                      <TableCell align="right">${p.revenue.toLocaleString()}</TableCell>
                      <TableCell align="right">${p.extras.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {profile.propertyBreakdown.length === 0 && (
                    <TableRow><TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', border: 0 }}>No property data this year</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>

              <Divider sx={{ my: 1.5 }} />

              <Grid container spacing={1.5}>
                <Grid size={6}>
                  <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                    Upcoming Confirmed Arrivals
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                    Next 30 days
                  </Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" sx={{ '& td, & th': { px: '6px', whiteSpace: 'nowrap' } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Reservation</TableCell>
                          <TableCell align="center">Arrival</TableCell>
                          <TableCell align="right">Value</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {profile.confirmedArrivals.map((b, idx) => (
                          <TableRow key={`${b.reservationNumber}-${idx}`} sx={{ '&:last-child td': { border: 0 } }}>
                            <TableCell>
                              <Box sx={{ color: 'primary.main', fontWeight: 600 }}>{b.reservationNumber}</Box>
                              <Box sx={{ color: 'text.secondary', fontSize: '0.625rem', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.property}</Box>
                            </TableCell>
                            <TableCell align="center">{b.arrivalDate}</TableCell>
                            <TableCell align="right">${b.value.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                        {profile.confirmedArrivals.length === 0 && (
                          <TableRow><TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', border: 0 }}>None in the next 30 days</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Box>
                  {profile.confirmedArrivalsTotalCt > profile.confirmedArrivals.length && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontStyle: 'italic' }}>
                      +{profile.confirmedArrivalsTotalCt - profile.confirmedArrivals.length} more
                    </Typography>
                  )}
                </Grid>

                <Grid size={6}>
                  <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                    Provisional Bookings Pending
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                    Stay not yet completed
                  </Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" sx={{ '& td, & th': { px: '6px', whiteSpace: 'nowrap' } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Reservation</TableCell>
                          <TableCell align="center">Arrival</TableCell>
                          <TableCell align="center">Expiry</TableCell>
                          <TableCell align="right">Value</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {profile.provisionalBookings.map((b, idx) => (
                          <TableRow key={`${b.reservationNumber}-${idx}`} sx={{ '&:last-child td': { border: 0 } }}>
                            <TableCell>
                              <Box sx={{ color: 'primary.main', fontWeight: 600 }}>{b.reservationNumber}</Box>
                              <Box sx={{ color: 'text.secondary', fontSize: '0.625rem', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.property}</Box>
                            </TableCell>
                            <TableCell align="center">{b.arrivalDate}</TableCell>
                            <TableCell align="center">
                              {b.daysToExpiry === null ? (
                                b.expiryDate
                              ) : (
                                <Tooltip title={`Expires ${b.expiryDate}`} arrow placement="top">
                                  <Chip
                                    label={`${b.daysToExpiry}d`}
                                    size="small"
                                    sx={{
                                      bgcolor: b.daysToExpiry <= 2 ? '#FEF2F2' : '#FAEEDA',
                                      color: b.daysToExpiry <= 2 ? '#C0392B' : '#854F0B',
                                      height: 18, fontSize: '0.6rem', fontWeight: 600, cursor: 'help',
                                    }}
                                  />
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell align="right">${b.value.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                        {profile.provisionalBookings.length === 0 && (
                          <TableRow><TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', border: 0 }}>No provisional bookings pending</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Box>
                  {profile.provisionalTotalCt > profile.provisionalBookings.length && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontStyle: 'italic' }}>
                      +{profile.provisionalTotalCt - profile.provisionalBookings.length} more
                    </Typography>
                  )}
                </Grid>
              </Grid>

              <Divider sx={{ my: 1.5 }} />

              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography variant="overline" sx={{ display: 'block' }}>Consultant</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>{profile.footer.consultant}</Typography>
                </Box>
                <Box>
                  <Typography variant="overline" sx={{ display: 'block' }}>First Booking</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>{profile.footer.firstBookingDate}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="overline" sx={{ display: 'block' }}>Total Bookings (all-time)</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>{profile.footer.totalBookingsAllTime.toLocaleString()}</Typography>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
