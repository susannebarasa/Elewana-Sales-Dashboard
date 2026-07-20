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
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import CloseIcon from '@mui/icons-material/Close'
import type { AgentProfile } from '@/types'

const fmtDollar = (v: number): string =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Grid size={3}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="overline" sx={{ display: 'block' }}>{label}</Typography>
          <Typography
            variant="h4"
            sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 700, fontSize: 24, lineHeight: 1, color: 'text.primary', my: 0.5 }}
          >
            {value}
          </Typography>
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

type Props = {
  agentId: string | null
  onClose: () => void
}

// Agent Performance drill-down panel (2026-07-14g) — deliberately separate from
// AgentProfilePanel, not a variant of it. Fetches the SAME /api/agent/[agentId] route (no new
// route needed — Channel/Market Segment/Conversion Rate/Properties Produced already lived there)
// but surfaces the subset of fields that match the Agent Performance (Trade Partners) page's own
// content — Properties Produced and Cancellation History specifically, which AgentProfilePanel
// does not show. AgentProfilePanel is untouched and still used by every other view's agent click
// (Consultants, Pipeline, Daily) — this panel is wired ONLY from AgentsView.tsx.
export default function AgentPerformanceDrillPanel({ agentId, onClose }: Props) {
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

  // disableEnforceFocus (2026-07-20) — see AgentProfilePanel.tsx for the full explanation: MUI's
  // default Modal focus trap kept the AI Query Box's input from ever receiving focus while this
  // Drawer was open.
  return (
    <Drawer anchor="right" open={!!agentId} onClose={onClose} disableEnforceFocus>
      <Box sx={{ width: { xs: '100vw', sm: '42vw' }, minWidth: { sm: 440 }, maxWidth: '100vw', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: 2, borderBottom: '0.5px solid', borderColor: 'divider' }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: 20, fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
              {profile?.agentName ?? (loading ? 'Loading…' : 'Agent Performance')}
            </Typography>
            {profile && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                {profile.country && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{profile.country}</Typography>
                )}
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
          {error && <Alert severity="error">Failed to load agent performance: {error}</Alert>}
          {profile && (
            <>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Stat label="Room Revenue YTD" value={fmtDollar(profile.summary.revenueYtd)} />
                <Stat label="Room Nights" value={profile.summary.roomNights.toLocaleString()} note="Actualized, partial year" />
                <Stat label="Materialisation" value={`${profile.summary.conversionRate}%`} note="Confirmed / (Confirmed + Pipeline)" />
                <Stat label="Properties Produced" value={profile.propertyBreakdown.length.toLocaleString()} />
              </Grid>

              <Divider sx={{ my: 1.5 }} />

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Properties Produced
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

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Cancellation History
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                All-time — {profile.cancellationSummary.totalCancelledBookings.toLocaleString()} cancelled bookings,{' '}
                {profile.cancellationSummary.totalNightsLost.toLocaleString()} nights lost,{' '}
                ${profile.cancellationSummary.totalRevenueLost.toLocaleString()} revenue lost (Room Revenue only)
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ mb: 1, '& td, & th': { px: '6px', whiteSpace: 'nowrap' } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Reservation</TableCell>
                      <TableCell align="center">Arrival</TableCell>
                      <TableCell align="center">Cancelled</TableCell>
                      <TableCell align="right">Nights</TableCell>
                      <TableCell align="right">Revenue Lost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {profile.cancellationHistory.map((c, idx) => (
                      <TableRow key={`${c.reservationNumber}-${idx}`} sx={{ '&:last-child td': { border: 0 } }}>
                        <TableCell>
                          <Box sx={{ color: 'primary.main', fontWeight: 600 }}>{c.reservationNumber}</Box>
                          <Box sx={{ color: 'text.secondary', fontSize: '0.625rem', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.property}</Box>
                        </TableCell>
                        <TableCell align="center">{c.arrivalDate}</TableCell>
                        <TableCell align="center">{c.cancelledDate}</TableCell>
                        <TableCell align="right">{c.nightsLost}</TableCell>
                        <TableCell align="right" sx={{ color: 'error.main', fontWeight: 600 }}>${c.revenueLost.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {profile.cancellationHistory.length === 0 && (
                      <TableRow><TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', border: 0 }}>No cancellations on record</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
              {profile.cancellationSummary.totalCancelledBookings > profile.cancellationHistory.length && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontStyle: 'italic' }}>
                  +{profile.cancellationSummary.totalCancelledBookings - profile.cancellationHistory.length} more
                </Typography>
              )}
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
