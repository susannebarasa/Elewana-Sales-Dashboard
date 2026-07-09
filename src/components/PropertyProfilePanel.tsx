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
import type { PropertyProfile } from '@/types'

const fmtDollar = (v: number | null): string =>
  v === null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`
const fmtPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`)

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Grid size={3}>
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="overline" sx={{ display: 'block' }}>{label}</Typography>
          <Typography
            variant="h4"
            sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontSize: 24, lineHeight: 1, color: 'text.primary', my: 0.5 }}
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
  propertyId: string | null
  onClose: () => void
}

// Property Profile Panel (2026-07-15) — opened only from Property Performance today. Per the
// context-aware drill-down standing instruction, this panel shows exactly Property Performance's
// own KPI set — Room Revenue, Extras Revenue, RevPAR, Occupancy %, ADR, Room Nights Sold, Budget
// Variance %, plus Top Agents contributing to this property — deliberately tight, no monthly
// trend chart, no arrivals/cancellation history (that richer shape belongs to Agent Profile /
// Agent Performance's own drill-downs, not this one).
export default function PropertyProfilePanel({ propertyId, onClose }: Props) {
  const [profile, setProfile] = useState<PropertyProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!propertyId) {
      setProfile(null)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/property/${encodeURIComponent(propertyId)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error ?? 'Server error'))
        return r.json()
      })
      .then((d: PropertyProfile) => { setProfile(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [propertyId])

  return (
    <Drawer anchor="right" open={!!propertyId} onClose={onClose}>
      <Box sx={{ width: { xs: '100vw', sm: '42vw' }, minWidth: { sm: 440 }, maxWidth: '100vw', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: 2, borderBottom: '0.5px solid', borderColor: 'divider' }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: 20, fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
              {profile?.propertyName ?? (loading ? 'Loading…' : 'Property Performance')}
            </Typography>
            {profile && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{profile.country}</Typography>
                <Chip
                  label={`${profile.keys} keys`}
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
          {error && <Alert severity="error">Failed to load property performance: {error}</Alert>}
          {profile && (
            <>
              {profile.caveat && (
                <Alert severity="warning" sx={{ mb: 1.5, fontSize: '0.75rem' }}>{profile.caveat}</Alert>
              )}

              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Stat label="Room Revenue" value={fmtDollar(profile.roomRevenue)} note="Full-year 2026" />
                <Stat label="Extras Revenue" value={fmtDollar(profile.extrasRevenue)} note="F&B, activities, transfers etc." />
                <Stat label="RevPAR" value={fmtDollar(profile.revpar)} />
                <Stat label="Occupancy %" value={fmtPct(profile.occPct)} />
                <Stat label="ADR" value={fmtDollar(profile.adr)} />
                <Stat label="Room Nights Sold" value={(profile.soldNights ?? 0).toLocaleString()} />
                <Stat label="Budget Variance %" value={fmtPct(profile.budgetVariancePct)} note="Actual ÷ Budget" />
              </Grid>

              <Divider sx={{ my: 1.5 }} />

              <Typography variant="overline" sx={{ display: 'block', mb: 0.5 }}>
                Top Agents
              </Typography>
              <Table size="small" sx={{ mb: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Agent</TableCell>
                    <TableCell align="right">Room Revenue</TableCell>
                    <TableCell align="right">Room Nights</TableCell>
                    <TableCell align="right">% of Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profile.topAgents.map((a) => (
                    <TableRow key={a.agentId} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.agentName}</TableCell>
                      <TableCell align="right">${a.roomRevenue.toLocaleString()}</TableCell>
                      <TableCell align="right">{a.roomNights.toLocaleString()}</TableCell>
                      <TableCell align="right">{a.pctOfPropertyTotal.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                  {profile.topAgents.length === 0 && (
                    <TableRow><TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', border: 0 }}>No agent-attributed business this year</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
