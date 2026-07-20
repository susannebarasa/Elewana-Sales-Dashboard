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
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import CloseIcon from '@mui/icons-material/Close'
import type { MarketSegmentProfile, EntityClickContext } from '@/types'

interface Filters { period: 'm' | 'y' | 'a'; year: string; channel: string; market: string }

const fmtDollar = (v: number | null): string =>
  v === null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`

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
  segment: string | null
  filters: Filters
  onClose: () => void
  onSelectProperty: (context: EntityClickContext) => void
  onSelectAgent: (agentId: string) => void
}

// Market Segment Profile Panel (2026-07-15) — opened only from Market Segment Performance today.
// Per the context-aware drill-down standing instruction, this panel shows exactly Market Segment
// Performance's own KPI set (Room Revenue, Room Nights, ADR, YoY %, Active Agents) plus Property
// and Agent breakdowns — deliberately tight, no monthly trend chart, no arrivals/cancellation
// history. Fetches with the SAME year/period/channel filters the table used, so the two never
// disagree for the same segment (unlike Property Performance, this table isn't fixed to a hardcoded
// year, so the filters must be threaded through).
export default function MarketSegmentProfilePanel({ segment, filters, onClose, onSelectProperty, onSelectAgent }: Props) {
  const [profile, setProfile] = useState<MarketSegmentProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!segment) {
      setProfile(null)
      return
    }
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ year: filters.year, period: filters.period, channel: filters.channel })
    fetch(`/api/market-segment/${encodeURIComponent(segment)}?${params.toString()}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: MarketSegmentProfile) => { setProfile(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [segment, filters.year, filters.period, filters.channel])

  // disableEnforceFocus (2026-07-20) — see AgentProfilePanel.tsx for the full explanation: MUI's
  // default Modal focus trap kept the AI Query Box's input from ever receiving focus while this
  // Drawer was open.
  return (
    <Drawer anchor="right" open={!!segment} onClose={onClose} disableEnforceFocus>
      <Box sx={{ width: { xs: '100vw', sm: '42vw' }, minWidth: { sm: 440 }, maxWidth: '100vw', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: 2, borderBottom: '0.5px solid', borderColor: 'divider' }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: 20, fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
              {profile?.segment ?? (loading ? 'Loading…' : 'Market Segment')}
            </Typography>
            {profile && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{filters.year} · {filters.period.toUpperCase()}</Typography>
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
          {error && <Alert severity="error">Failed to load market segment performance: {error}</Alert>}
          {profile && (
            <>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Stat label="Room Revenue" value={fmtDollar(profile.roomRevenue)} />
                <Stat label="Room Nights" value={profile.roomNights.toLocaleString()} />
                <Stat label="ADR" value={fmtDollar(profile.adr)} />
                <Stat
                  label="YoY %"
                  value={profile.yoyPct === null ? '—' : `${profile.yoyPct >= 0 ? '+' : ''}${profile.yoyPct.toFixed(1)}%`}
                  note="vs same period last year"
                />
                <Stat label="Active Agents" value={profile.activeAgents.toLocaleString()} />
              </Grid>

              <Divider sx={{ my: 1.5 }} />

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Property Breakdown
              </Typography>
              <Table size="small" sx={{ mb: 2 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Property</TableCell>
                    <TableCell align="right">Room Revenue</TableCell>
                    <TableCell align="right">Room Nights</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profile.propertyBreakdown.map((p) => (
                    <TableRow key={p.propertyId ?? p.propertyName} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell
                        onClick={() => p.propertyId && onSelectProperty({ type: 'property', id: p.propertyId, sourceView: 'market-segment-performance' })}
                        sx={{
                          maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: p.propertyId ? 'primary.main' : 'text.primary',
                          cursor: p.propertyId ? 'pointer' : 'default',
                          '&:hover': p.propertyId ? { textDecoration: 'underline' } : undefined,
                        }}
                      >
                        {p.propertyName}
                      </TableCell>
                      <TableCell align="right">${p.roomRevenue.toLocaleString()}</TableCell>
                      <TableCell align="right">{p.roomNights.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {profile.propertyBreakdown.length === 0 && (
                    <TableRow><TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', border: 0 }}>No property data this period</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>

              <Divider sx={{ my: 1.5 }} />

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Top Agents
              </Typography>
              <Table size="small" sx={{ mb: 0.5 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Agent</TableCell>
                    <TableCell align="right">Room Revenue</TableCell>
                    <TableCell align="right">Room Nights</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profile.agentBreakdown.map((a) => (
                    <TableRow key={a.agentId} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell
                        onClick={() => onSelectAgent(a.agentId)}
                        sx={{
                          maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {a.agentName}
                      </TableCell>
                      <TableCell align="right">${a.roomRevenue.toLocaleString()}</TableCell>
                      <TableCell align="right">{a.roomNights.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {profile.agentBreakdown.length === 0 && (
                    <TableRow><TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', border: 0 }}>No agent-attributed business this period</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {profile.agentBreakdownTotalCount > profile.agentBreakdown.length && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontStyle: 'italic' }}>
                  +{profile.agentBreakdownTotalCount - profile.agentBreakdown.length} more
                </Typography>
              )}
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
