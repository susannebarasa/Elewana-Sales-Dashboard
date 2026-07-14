'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import CloseIcon from '@mui/icons-material/Close'
import { Chart as ChartJS, ArcElement, Tooltip as ChartTooltip } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import type { AgentProfile } from '@/types'

ChartJS.register(ArcElement, ChartTooltip)

// Design tokens — same palette as SalesExecutiveSummaryDesign.tsx, lifted from the Claude Design
// export so this panel (a superset of AgentProfilePanel + AgentPerformanceDrillPanel, restyled)
// matches the agent-panel screenshots pixel-for-pixel. Sources the SAME /api/agent/[agentId]
// route as those two panels — no backend changes, every field here already existed on
// AgentProfile (revenue-by-property, active bookings, cancellation history, footer stats).
const T = {
  cd: '#FCF8F0', sf: '#F3EFE6', br: '#C9BEA9',
  oc: '#B7632A', ocl: '#FAEEDA', ocd: '#854F0B', dk: '#2A2318',
  ink: '#1F1A14', ink2: '#3A3026', mu: '#6B5F50', rg: '#3B6D11', rr: '#C0392B', ra: '#CA8A04',
  se: '"Cormorant Garamond", Georgia, serif',
  sa: 'Inter, system-ui, sans-serif',
  mo: '"JetBrains Mono", monospace',
}

const DONUT_PALETTE = [T.oc, '#4A5A3A', '#9A7A3A', '#7A5C46', '#C9A66B', '#6E7B57', '#A7997F', '#8A5A2A']

const fmtDollar = (v: number): string =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`

// RAG (red/amber/green) tile status — 2026-07-16 design edit, ported from the Claude Design
// mockup: applied to Revenue/Room Nights (by YoY) and Materialisation (by conversion rate).
type Rag = 'r' | 'a' | 'g' | 'neutral'
const RAG_STYLES: Record<Rag, { bg: string; valueColor: string; border: string }> = {
  g: { bg: 'linear-gradient(180deg,#F5FAEE,#EAF3DE)', valueColor: T.rg, border: 'rgba(59,109,17,.45)' },
  a: { bg: 'linear-gradient(180deg,#FEFCEF,#FBF4D6)', valueColor: '#8A5A00', border: 'rgba(202,138,4,.5)' },
  r: { bg: 'linear-gradient(180deg,#FEF3F1,#FBE2DE)', valueColor: T.rr, border: 'rgba(192,57,43,.5)' },
  neutral: { bg: T.sf, valueColor: T.ink, border: T.br },
}

function KpiTile({ label, value, sub, color, rag = 'neutral' }: { label: string; value: string; sub?: string; color?: string; rag?: Rag }) {
  const s = RAG_STYLES[rag]
  return (
    <Box sx={{ background: s.bg, border: `0.5px solid ${s.border}`, borderRadius: '8px', p: '11px 10px', flex: 1, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8), 0 4px 10px rgba(31,26,20,.09)' }}>
      <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mu, mb: '6px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: T.se, fontSize: 19, fontWeight: 600, color: s.valueColor, lineHeight: 1, letterSpacing: '-0.01em' }}>{value}</Typography>
      {sub && <Typography sx={{ fontFamily: T.mo, fontSize: 10, mt: '6px', color: color ?? T.mu }}>{sub}</Typography>}
    </Box>
  )
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <Box sx={{ mb: '12px' }}>
      <Typography sx={{ fontFamily: T.se, fontSize: 17, fontWeight: 500, color: T.ink }}>{title}</Typography>
      <Typography sx={{ fontSize: 10, color: T.mu, fontStyle: 'italic' }}>{sub}</Typography>
    </Box>
  )
}

const cellHeadSx = { fontSize: 8.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, px: '7px' }
const cellSx = { fontFamily: T.mo, fontSize: 10.5, color: T.ink2, borderBottom: `0.5px solid ${T.br}`, px: '7px' }

type Props = {
  agentId: string | null
  onClose: () => void
}

export default function SalesExecAgentPanel({ agentId, onClose }: Props) {
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

  const totalPropRev = profile ? profile.propertyBreakdown.reduce((t, p) => t + p.revenue, 0) : 0
  const donutData = profile ? {
    labels: profile.propertyBreakdown.map((p) => p.property),
    datasets: [{
      data: profile.propertyBreakdown.map((p) => p.revenue),
      backgroundColor: profile.propertyBreakdown.map((_, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]),
      borderColor: T.cd,
      borderWidth: 2,
    }],
  } : null

  const yoyPct = profile && profile.summary.revenueYtdLy > 0
    ? ((profile.summary.revenueYtd - profile.summary.revenueYtdLy) / profile.summary.revenueYtdLy) * 100
    : null

  // Active Bookings summary figures (2026-07-16) — see the section's own comment for why "+"
  // appears when the API's per-list cap (20) is below the true total count.
  const confirmedArrivalsValueSum = profile ? profile.confirmedArrivals.reduce((t, b) => t + b.value, 0) : 0
  const confirmedArrivalsTruncated = profile ? profile.confirmedArrivalsTotalCt > profile.confirmedArrivals.length : false
  const provisionalValueSum = profile ? profile.provisionalBookings.reduce((t, b) => t + b.value, 0) : 0
  const provisionalTruncated = profile ? profile.provisionalTotalCt > profile.provisionalBookings.length : false
  // "Expiring soon" — same <=2 day threshold already used elsewhere in the app (AgentProfilePanel's
  // urgency chip) for a provisional booking's held-until-expiry window.
  const expiringSoonCount = profile ? profile.provisionalBookings.filter((b) => b.daysToExpiry !== null && b.daysToExpiry <= 2).length : 0

  return (
    <Drawer
      anchor="right"
      open={!!agentId}
      onClose={onClose}
      slotProps={{ paper: { sx: { top: 0, right: 0, height: '100dvh', width: { xs: '100vw', sm: '44%' }, minWidth: { sm: 460 }, maxWidth: { sm: 660 } } } }}
    >
      <Box sx={{ width: '100%', height: '100%', bgcolor: T.cd, display: 'flex', flexDirection: 'column', fontFamily: T.sa }}>
        <Box sx={{ position: 'relative', flex: 1, overflowY: 'auto', p: '26px 28px 36px' }}>
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="Close"
            sx={{ position: 'absolute', top: 16, right: 18, bgcolor: T.sf, border: `0.5px solid ${T.br}`, '&:hover': { bgcolor: T.ocl, color: T.oc } }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} sx={{ color: T.oc }} />
            </Box>
          )}
          {error && <Alert severity="error">Failed to load agent profile: {error}</Alert>}

          {profile && (
            <>
              {/* Header */}
              <Box sx={{ mb: '22px', pr: '40px' }}>
                <Typography sx={{ fontFamily: T.se, fontSize: 30, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em', lineHeight: 1.08, mb: '11px' }}>
                  {profile.agentName}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {profile.country && (
                    <Box sx={{ fontSize: 9.5, fontWeight: 600, px: '10px', py: '3px', borderRadius: '20px', bgcolor: T.sf, color: T.ink2, border: `0.5px solid ${T.br}` }}>
                      {profile.country}
                    </Box>
                  )}
                  <Box sx={{ fontSize: 9.5, fontWeight: 600, px: '10px', py: '3px', borderRadius: '20px', bgcolor: T.ocl, color: T.ocd }}>
                    {profile.marketSegment}
                  </Box>
                </Box>
              </Box>

              {/* KPI grid — 4. RAG on Revenue/Room Nights (by YoY) and Materialisation (by
                  conversion rate) — same thresholds as the Claude Design mockup's ses-app.js. */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '7px', mb: '24px' }}>
                <KpiTile
                  label="Revenue"
                  value={fmtDollar(profile.summary.revenueYtd)}
                  sub={yoyPct !== null ? `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(1)}% YoY` : undefined}
                  color={yoyPct !== null ? (yoyPct >= 0 ? T.rg : T.rr) : undefined}
                  rag={yoyPct === null ? 'neutral' : yoyPct < 0 ? 'r' : yoyPct < 2.5 ? 'a' : 'g'}
                />
                <KpiTile
                  label="Room Nights"
                  value={profile.summary.roomNights.toLocaleString()}
                  sub="actualized"
                  rag={yoyPct === null ? 'neutral' : yoyPct < 0 ? 'r' : yoyPct < 2.5 ? 'a' : 'g'}
                />
                <KpiTile label="ADR" value={fmtDollar(profile.summary.adr)} sub="blended" />
                <KpiTile
                  label="Materialisation"
                  value={`${profile.summary.conversionRate}%`}
                  sub="conf ÷ held"
                  rag={profile.summary.conversionRate < 60 ? 'r' : profile.summary.conversionRate < 70 ? 'a' : 'g'}
                />
              </Box>

              {/* Narrative */}
              <Box sx={{ bgcolor: T.dk, borderRadius: '9px', p: '15px 17px', mb: '24px' }}>
                <Typography sx={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: T.ra, mb: '7px' }}>
                  Agent Summary
                </Typography>
                <Typography sx={{ fontFamily: T.se, fontSize: 18, fontWeight: 600, color: '#F5EDD8', lineHeight: 1.32, letterSpacing: '-0.005em' }}>
                  {profile.agentName} {yoyPct === null ? 'has no prior-year comparison yet' : yoyPct >= 5 ? `is up ${yoyPct.toFixed(1)}% YoY` : yoyPct < 0 ? `has slipped ${yoyPct.toFixed(1)}% YoY` : `is holding steady (${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(1)}% YoY)`}
                  {profile.propertyBreakdown[0] ? `, led by ${profile.propertyBreakdown[0].property} (${fmtDollar(profile.propertyBreakdown[0].revenue)}).` : '.'}
                  {' '}Materialisation is at {profile.summary.conversionRate}% across {profile.propertyBreakdown.length} propert{profile.propertyBreakdown.length === 1 ? 'y' : 'ies'} produced.
                </Typography>
              </Box>

              {/* Revenue by Property — donut */}
              <Box sx={{ mb: '24px' }}>
                <SectionHeading title="Revenue by Property" sub={`Share of this agent's revenue · ${profile.year}`} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '18px', alignItems: 'center' }}>
                  <Box sx={{ position: 'relative', height: 150 }}>
                    {donutData && <Doughnut data={donutData} options={{ cutout: '58%', plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }} />}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    {profile.propertyBreakdown.map((p, i) => (
                      <Box key={p.property} sx={{ display: 'grid', gridTemplateColumns: '11px 1fr auto', gap: '9px', alignItems: 'center' }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
                        <Typography sx={{ fontSize: 11, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property}</Typography>
                        <Typography sx={{ fontFamily: T.mo, fontSize: 10.5, color: T.ink, whiteSpace: 'nowrap' }}>
                          {fmtDollar(p.revenue)} · {totalPropRev > 0 ? Math.round((p.revenue / totalPropRev) * 100) : 0}%
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>

              {/* Property leaderboard — scrollable with sticky header once real per-property
                  breakdowns commonly run to 15+ rows (2026-07-16 design edit). */}
              <Box sx={{ mb: '24px' }}>
                <SectionHeading
                  title="Property Leaderboard"
                  sub={`Ranked by revenue${profile.propertyBreakdown.length > 5 ? ` · ${profile.propertyBreakdown.length} properties, scroll for more` : ''}`}
                />
                <Box sx={{ maxHeight: 198, overflow: 'auto' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ ...cellHeadSx, bgcolor: T.cd }}>Property</TableCell>
                        <TableCell align="right" sx={{ ...cellHeadSx, bgcolor: T.cd }}>Revenue</TableCell>
                        <TableCell align="right" sx={{ ...cellHeadSx, bgcolor: T.cd }}>Extras</TableCell>
                        <TableCell align="right" sx={{ ...cellHeadSx, bgcolor: T.cd }}>Bookings</TableCell>
                        <TableCell align="right" sx={{ ...cellHeadSx, bgcolor: T.cd }}>% of Total</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {profile.propertyBreakdown.map((p) => (
                        <TableRow key={p.property} sx={{ '&:hover td': { bgcolor: T.sf } }}>
                          <TableCell sx={{ ...cellSx, fontFamily: T.sa, fontSize: 12, color: T.ink, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.property}</TableCell>
                          <TableCell align="right" sx={cellSx}>{fmtDollar(p.revenue)}</TableCell>
                          <TableCell align="right" sx={cellSx}>{fmtDollar(p.extras)}</TableCell>
                          <TableCell align="right" sx={cellSx}>{p.bookings}</TableCell>
                          <TableCell align="right" sx={cellSx}>{totalPropRev > 0 ? Math.round((p.revenue / totalPropRev) * 100) : 0}%</TableCell>
                        </TableRow>
                      ))}
                      {profile.propertyBreakdown.length === 0 && (
                        <TableRow><TableCell colSpan={5} align="center" sx={{ ...cellSx, fontStyle: 'italic', border: 0 }}>No property data this year</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>
              </Box>

              {/* Active Bookings — summary only (2026-07-16, simplified per request: no itemized
                  per-reservation rows). Value sums are computed from the fetched rows (API caps
                  each list at 20); counts use the true, unlimited totals. When more rows exist
                  than were fetched, the value is marked with a trailing "+" so it reads as a
                  floor, not a complete total — never silently presented as exact when it isn't. */}
              <Box sx={{ mb: '24px' }}>
                <SectionHeading title="Active Bookings" sub="Live reservations for this agent" />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <Box sx={{ bgcolor: T.sf, border: `0.5px solid ${T.br}`, borderRadius: '8px', p: '13px 14px' }}>
                    <Typography sx={{ fontFamily: T.se, fontSize: 22, fontWeight: 600, color: T.ink, lineHeight: 1 }}>
                      {profile.confirmedArrivalsTotalCt.toLocaleString()}
                    </Typography>
                    <Typography sx={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.mu, mt: '5px' }}>
                      Confirmed Arrivals Upcoming
                    </Typography>
                    <Typography sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2, mt: '6px' }}>
                      {fmtDollar(confirmedArrivalsValueSum)}{confirmedArrivalsTruncated ? '+' : ''} total value
                    </Typography>
                  </Box>
                  <Box sx={{ bgcolor: T.sf, border: `0.5px solid ${T.br}`, borderRadius: '8px', p: '13px 14px' }}>
                    <Typography sx={{ fontFamily: T.se, fontSize: 22, fontWeight: 600, color: T.ink, lineHeight: 1 }}>
                      {profile.provisionalTotalCt.toLocaleString()}
                    </Typography>
                    <Typography sx={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.mu, mt: '5px' }}>
                      Provisional Bookings Pending
                    </Typography>
                    <Typography sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2, mt: '6px' }}>
                      {fmtDollar(provisionalValueSum)}{provisionalTruncated ? '+' : ''} total value
                      {expiringSoonCount > 0 ? ` · ${expiringSoonCount} expiring soon` : ''}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Cancellation History — summary only (2026-07-16, simplified per request: no
                  itemized per-booking rows, just the 3 summary stats). */}
              <Box sx={{ mb: '24px' }}>
                <SectionHeading title="Cancellation History" sub="All-time" />
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '9px' }}>
                  <Box sx={{ bgcolor: '#FDF0EE', border: '0.5px solid rgba(192,57,43,0.35)', borderRadius: '8px', p: '11px 12px' }}>
                    <Typography sx={{ fontFamily: T.se, fontSize: 22, fontWeight: 600, color: T.rr, lineHeight: 1 }}>{profile.cancellationSummary.totalCancelledBookings.toLocaleString()}</Typography>
                    <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.mu, mt: '6px' }}>Cancelled</Typography>
                  </Box>
                  <Box sx={{ bgcolor: '#FDF0EE', border: '0.5px solid rgba(192,57,43,0.35)', borderRadius: '8px', p: '11px 12px' }}>
                    <Typography sx={{ fontFamily: T.se, fontSize: 22, fontWeight: 600, color: T.rr, lineHeight: 1 }}>{profile.cancellationSummary.totalNightsLost.toLocaleString()}</Typography>
                    <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.mu, mt: '6px' }}>Nights Lost</Typography>
                  </Box>
                  <Box sx={{ bgcolor: '#FDF0EE', border: '0.5px solid rgba(192,57,43,0.35)', borderRadius: '8px', p: '11px 12px' }}>
                    <Typography sx={{ fontFamily: T.se, fontSize: 22, fontWeight: 600, color: T.rr, lineHeight: 1 }}>${profile.cancellationSummary.totalRevenueLost.toLocaleString()}</Typography>
                    <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: T.mu, mt: '6px' }}>Revenue Lost</Typography>
                  </Box>
                </Box>
              </Box>

              {/* Footer stats */}
              <Box sx={{ borderTop: `0.5px solid ${T.br}`, pt: '16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <Box>
                  <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mu, mb: '5px' }}>Properties Produced</Typography>
                  <Typography sx={{ fontSize: 12, color: T.ink, fontWeight: 500 }}>{profile.propertyBreakdown.length}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mu, mb: '5px' }}>Materialisation</Typography>
                  <Typography sx={{ fontSize: 12, color: T.ink, fontWeight: 500 }}>{profile.summary.conversionRate}%</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mu, mb: '5px' }}>First Booking</Typography>
                  <Typography sx={{ fontSize: 12, color: T.ink, fontWeight: 500 }}>{profile.footer.firstBookingDate}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mu, mb: '5px' }}>Assigned Consultant</Typography>
                  <Typography sx={{ fontSize: 12, color: T.ink, fontWeight: 500 }}>{profile.footer.consultant}</Typography>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}
