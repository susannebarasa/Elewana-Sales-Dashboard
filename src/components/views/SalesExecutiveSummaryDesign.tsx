'use client'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import ButtonGroup from '@mui/material/ButtonGroup'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Tooltip as ChartTooltip,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext, KpiMetric } from '@/types'
import type { SesFilters } from '@/app/sales-exec-summary/page'
import { fmtK, budgetVariance } from '@/components/KpiRow'
import { buildExecutiveNarrative } from '@/lib/execNarrative'
import { propertyBarClickOptions } from '@/lib/chartClicks'
import { PROPERTY_ROOM_COUNTS } from '@/lib/constants'
import { MARKET_SEGMENT_VALUES } from '@/lib/agentSegments'
import SesAgentSearch from '@/components/SesAgentSearch'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ChartTooltip)

// Design tokens — lifted verbatim from the Claude Design export's :root CSS block
// ("Elewana Sales Executive Summary.html") so this page matches pixel-for-pixel rather than
// reusing the rest of the app's MUI theme.
const T = {
  bg: '#EDEEE6', cd: '#FAF6EC', sf: '#F3EFE6',
  rg: '#3B6D11', ra: '#CA8A04', rr: '#C0392B', br: '#C9BEA9',
  oc: '#B7632A', ocl: '#FAEEDA', ocd: '#854F0B', ly: '#A7997F', dk: '#2A2318',
  ink: '#1F1A14', ink2: '#3A3026', mu: '#6B5F50',
  se: '"Cormorant Garamond", Georgia, serif',
  sa: 'Inter, system-ui, sans-serif',
  mo: '"JetBrains Mono", monospace',
}

const PROPERTY_OPTIONS = [
  { value: 'all', label: 'All Properties' },
  ...Object.entries(PROPERTY_ROOM_COUNTS)
    .filter(([, cap]) => cap.propertyId !== null)
    .map(([name, cap]) => ({ value: cap.propertyId as string, label: name })),
]

// Agent Leaderboard row cap (2026-07-16 design edit) — real data brought this table to 819
// agents; capped + scrollable with a sticky header, same treatment as the mockup's ses-app.js.
const LEADERBOARD_CAP = 150

const PERIOD_OPTIONS: { value: SesFilters['period']; label: string }[] = [
  { value: 'm', label: 'MTD' },
  { value: 'y', label: 'YTD' },
  { value: 'a', label: 'Full Year' },
]

type Props = {
  data: DashboardData
  filters: SesFilters
  onFilters: (f: SesFilters) => void
  onSelectAgent: (agentId: string) => void
  onSelectProperty: (context: EntityClickContext) => void
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: T.mu } },
    y: { grid: { color: 'rgba(201,190,169,0.4)' }, ticks: { font: { size: 9 }, color: T.mu } },
  },
} as const

function Variance({ metric }: { metric: KpiMetric }) {
  const d = budgetVariance(metric)
  if (!d) return null
  return (
    <Box component="span" sx={{ fontFamily: T.mo, fontSize: 10.5, fontWeight: 600, color: d.positive ? T.rg : T.rr }}>
      {d.positive ? '▲' : '▼'} {d.text}
    </Box>
  )
}

// RAG (red/amber/green) KPI status — 2026-07-16 design edit, ported from the Claude Design
// mockup: r < 0%, a < 2.5%, g >= 2.5% (YoY, or vs Budget for Occupancy % — see below).
// 'neutral' when no real comparator exists at all — never fabricated. Occupancy % has no real
// prior-year capacity query (matches the mockup's ses-app.js/ses-data.js gap note), but as of
// 2026-07-16 carries a genuine Budget Occupancy % in the same `ly` slot instead (see its KpiCard
// usage below) — this function doesn't care which baseline populated `ly`, just that it's real.
type Rag = 'r' | 'a' | 'g' | 'neutral'
function ragFromYoyPct(pct: number | null): Rag {
  if (pct === null || pct === undefined || isNaN(pct)) return 'neutral'
  return pct < 0 ? 'r' : pct < 2.5 ? 'a' : 'g'
}
function yoyPct(metric: KpiMetric): number | null {
  return typeof metric.ly === 'number' && metric.ly > 0 ? ((metric.v - metric.ly) / metric.ly) * 100 : null
}
const RAG_STYLES: Record<Rag, { bg: string; border: string; valueColor: string; barColor: string }> = {
  g: { bg: 'linear-gradient(180deg,#F5FAEE 0%,#EAF3DE 100%)', border: 'rgba(59,109,17,.45)', valueColor: T.rg, barColor: T.rg },
  a: { bg: 'linear-gradient(180deg,#FEFCEF 0%,#FBF4D6 100%)', border: 'rgba(202,138,4,.5)', valueColor: '#8A5A00', barColor: T.ra },
  r: { bg: 'linear-gradient(180deg,#FEF3F1 0%,#FBE2DE 100%)', border: 'rgba(192,57,43,.5)', valueColor: T.rr, barColor: T.rr },
  neutral: { bg: 'linear-gradient(180deg,#FFFDF7 0%,' + T.cd + ' 100%)', border: T.br, valueColor: T.ink, barColor: T.br },
}

function KpiCard({ label, metric, caption }: { label: string; metric: KpiMetric; caption: string }) {
  const rag = ragFromYoyPct(yoyPct(metric))
  const s = RAG_STYLES[rag]
  return (
    <Box
      sx={{
        background: s.bg, border: `0.5px solid ${s.border}`, borderRadius: '9px', p: '15px 17px 15px',
        flex: 1, position: 'relative', overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 6px 14px rgba(31,26,20,.10), 0 2px 4px rgba(31,26,20,.07)',
        transition: 'transform .14s, box-shadow .14s',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 13px 24px rgba(31,26,20,.15), 0 4px 7px rgba(31,26,20,.10)' },
      }}
    >
      <Typography sx={{ fontFamily: T.sa, fontSize: 8.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.mu, mb: '7px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: T.se, fontSize: 33, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1, color: s.valueColor, mb: '8px', textShadow: '0 1px 0 rgba(255,255,255,.85), 0 2px 4px rgba(31,26,20,.22)' }}>
        {fmtK(metric.v, metric.fmt)}
      </Typography>
      <Box sx={{ fontFamily: T.sa, fontSize: 10.5, color: T.mu, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Variance metric={metric} /> {caption}
      </Box>
      <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '3px', bgcolor: s.barColor }} />
    </Box>
  )
}

function NarrativePill({ value, label, sub, color }: { value: string; label: string; sub?: string; color?: string }) {
  return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.045)', border: '0.5px solid rgba(210,190,160,0.22)', borderRadius: '7px', p: '10px 13px', flex: 1 }}>
      <Typography sx={{ fontFamily: T.se, fontSize: 24, fontWeight: 600, lineHeight: 1, color: '#F5EDD8' }}>{value}</Typography>
      <Typography sx={{ fontSize: 8, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#7A6A58', mt: '6px' }}>{label}</Typography>
      {sub && <Typography sx={{ fontFamily: T.mo, fontSize: 9.5, mt: '5px', color: color ?? '#7A6A58' }}>{sub}</Typography>}
    </Box>
  )
}

// Always-visible chart key (2026-07-16, chart-legend audit) — swatch + label, matching the
// convention already used by PaceView/ExecSummaryView/BookingStatusMovementView's inline legend
// rows rather than Chart.js's own legend widget (kept off via CHART_OPTS' legend:false everywhere
// on this page, since the native widget doesn't match this page's type scale as cleanly).
function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <Box sx={{ display: 'flex', gap: '14px', mt: '10px', flexWrap: 'wrap' }}>
      {items.map((it) => (
        <Box key={it.label} sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box sx={{ width: 12, height: it.dashed ? 2 : 3, bgcolor: it.color, borderRadius: '2px' }} />
          <Typography sx={{ fontSize: 10, color: T.mu }}>{it.label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function ChartCard({ title, sub, children, height = 230, legend }: { title: string; sub: string; children: ReactNode; height?: number; legend?: ReactNode }) {
  return (
    <Box sx={{ bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '16px 18px', flex: 1 }}>
      <Typography sx={{ fontFamily: T.se, fontSize: 18, fontWeight: 500, color: T.ink, letterSpacing: '-0.005em' }}>{title}</Typography>
      <Typography sx={{ fontSize: 10, color: T.mu, mb: '12px', fontStyle: 'italic' }}>{sub}</Typography>
      <Box sx={{ height, position: 'relative' }}>{children}</Box>
      {legend}
    </Box>
  )
}

const selSx = {
  fontFamily: T.sa, fontSize: 12, color: T.ink2, bgcolor: T.sf,
  height: 30,
  '.MuiOutlinedInput-notchedOutline': { borderColor: T.br },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: T.oc },
}

export default function SalesExecutiveSummaryDesign({ data, filters, onFilters, onSelectAgent, onSelectProperty }: Props) {
  const kp = data.KP_BASE
  const propertyLabel = filters.property === 'all'
    ? 'All Properties'
    : PROPERTY_OPTIONS.find((p) => p.value === filters.property)?.label ?? filters.property
  const periodLabel = filters.period === 'm' ? `Month to date · ${filters.year}` : filters.period === 'y' ? `Year to date · ${filters.year}` : `Full year · ${filters.year}`

  // Room Revenue label override — same "Actualized, not full-year" honesty note as
  // src/components/views/ExecSummaryView.tsx's roomRevenueActualized (occ.rev is
  // actualized-stays-only; Agent Room Revenue elsewhere includes forward-confirmed bookings).
  const roomRevenue = kp.occ.rev

  const narrative = buildExecutiveNarrative(data, filters.period)
  const [headline, ...body] = narrative

  const paceChartData = {
    labels: data.PD.months,
    datasets: [
      { label: filters.year, data: data.PD.actual, borderColor: T.oc, backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2.5, tension: 0.35, pointRadius: 3, pointBackgroundColor: T.oc },
      { label: 'Last year', data: data.PD.ly, borderColor: T.ly, borderDash: [5, 4], fill: false, tension: 0.35, borderWidth: 2, pointRadius: 2, pointBackgroundColor: T.ly },
    ],
  }

  // By-Property chart — occupancy ranking when no Segment is selected (matches
  // ExecSummaryView's OD.props), Segment-scoped revenue by property when one is (matches
  // AgentsView's AD.byProp, which /api/dashboard already filters server-side by the Segment
  // ('market') param — no client-side re-filtering needed here).
  const segmentActive = filters.market !== 'all'
  const selectedPropertyId = filters.property !== 'all' ? filters.property : null
  const byPropItems = segmentActive ? data.AD.byProp.slice(0, 10) : data.OD.props
  const byPropData = segmentActive
    ? {
        labels: byPropItems.map((p) => ('pr' in p ? p.pr : p.nm)),
        datasets: [{ data: data.AD.byProp.slice(0, 10).map((p) => p.rv), backgroundColor: T.oc, borderRadius: 3 }],
      }
    : {
        labels: data.OD.props.map((p) => p.nm),
        datasets: [{
          data: data.OD.props.map((p) => p.oc),
          backgroundColor: data.OD.props.map((p) => (selectedPropertyId && p.id === selectedPropertyId ? T.oc : 'rgba(183,99,42,0.55)')),
          borderRadius: 3,
        }],
      }

  return (
    <Box sx={{ fontFamily: T.sa, color: T.ink2 }}>
      {/* Header */}
      <Box sx={{ bgcolor: T.cd, borderBottom: `0.5px solid ${T.br}`, px: '30px', py: '14px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Box component="img" src="/elewana-collection-logo.png" alt="Elewana Collection" sx={{ height: 38, width: 'auto' }} />
        <Box>
          <Typography sx={{ fontFamily: T.se, fontSize: 25, fontWeight: 600, color: T.ink, lineHeight: 1, letterSpacing: '-0.01em' }}>
            Elewana Collection
          </Typography>
          <Typography sx={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.24em', textTransform: 'uppercase', color: T.oc, mt: '4px' }}>
            Sales Executive Summary
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.mu, mb: '3px' }}>Data as at</Typography>
          <Typography sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2 }}>{data.lastUpdated}</Typography>
        </Box>
      </Box>

      {/* Sub bar: tab + filters */}
      <Box sx={{ bgcolor: T.cd, borderBottom: `0.5px solid ${T.br}`, px: '30px', py: '11px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <Box sx={{ fontFamily: T.sa, fontSize: 12, fontWeight: 600, px: '16px', py: '7px', borderRadius: '20px', bgcolor: T.ink, color: T.cd }}>
          Sales Executive Summary
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', ml: 'auto' }}>
          <Select
            size="small"
            value={filters.property}
            onChange={(e) => onFilters({ ...filters, property: e.target.value })}
            sx={selSx}
          >
            {PROPERTY_OPTIONS.map((p) => <MenuItem key={p.value} value={p.value} sx={{ fontSize: 12 }}>{p.label}</MenuItem>)}
          </Select>
          <Select
            size="small"
            value={filters.market}
            onChange={(e) => onFilters({ ...filters, market: e.target.value })}
            sx={selSx}
          >
            <MenuItem value="all" sx={{ fontSize: 12 }}>All Segments</MenuItem>
            {MARKET_SEGMENT_VALUES.map((s) => <MenuItem key={s} value={s} sx={{ fontSize: 12 }}>{s}</MenuItem>)}
          </Select>
          <ButtonGroup size="small" sx={{ bgcolor: T.sf, border: `0.5px solid ${T.br}`, borderRadius: '6px', p: '2px' }}>
            {PERIOD_OPTIONS.map((p) => (
              <Button
                key={p.value}
                onClick={() => onFilters({ ...filters, period: p.value })}
                sx={{
                  fontFamily: T.sa, fontSize: 10.5, fontWeight: 600, px: '11px', py: '5px', borderRadius: '4px !important',
                  border: 'none !important', color: filters.period === p.value ? T.cd : T.mu,
                  bgcolor: filters.period === p.value ? `${T.ink} !important` : 'transparent',
                }}
              >
                {p.label}
              </Button>
            ))}
          </ButtonGroup>
          <SesAgentSearch agents={data.AD.yearly} onSelectAgent={onSelectAgent} />
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ px: '30px', py: '22px 30px 44px', maxWidth: 1360, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '14px', mb: '18px', flexWrap: 'wrap' }}>
          <Typography sx={{ fontFamily: T.se, fontSize: 33, fontWeight: 600, color: T.ink, lineHeight: 1, letterSpacing: '-0.015em' }}>
            {propertyLabel}
          </Typography>
          {filters.property === 'all' && (
            <Box sx={{ fontFamily: T.mo, fontSize: 10, letterSpacing: '0.03em', px: '10px', py: '3px', borderRadius: '20px', bgcolor: T.ocl, color: T.ocd }}>
              {Object.values(PROPERTY_ROOM_COUNTS).filter((c) => c.propertyId !== null).length} PROPERTIES · KENYA · TANZANIA · ZANZIBAR
            </Box>
          )}
          <Typography sx={{ fontSize: 11, color: T.mu }}>{periodLabel}</Typography>
        </Box>

        {/* KPI row — exactly 4 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', mb: '16px' }}>
          <KpiCard label="Room Revenue (Actualized)" metric={roomRevenue} caption="vs last year" />
          <KpiCard label="Room Nights Sold" metric={kp.occ.nights} caption="vs last year" />
          {/* caption reads "vs Budget", not "vs last year" — Occupancy % has no real prior-year
              capacity query to compare against (see ragFromYoyPct's comment above), but as of
              2026-07-16 kp.occ.occPct.ly now carries a real Budget Occupancy % target instead
              (budgetRns ÷ available room nights, same derivation as the Actual side), so this
              card's badge is a genuine Budget variance, not a fabricated YoY one. */}
          <KpiCard label="Occupancy %" metric={kp.occ.occPct} caption="vs Budget" />
          <KpiCard label="ADR" metric={kp.occ.adr} caption="vs last year" />
        </Box>

        {/* Narrative panel */}
        <Box sx={{ bgcolor: T.dk, borderRadius: '10px', p: '20px 24px', mb: '16px', display: 'grid', gridTemplateColumns: '1fr 210px', gap: '26px' }}>
          <Box>
            <Typography sx={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.ra, mb: '9px' }}>
              Executive Summary
            </Typography>
            {headline && (
              <Typography sx={{ fontFamily: T.se, fontSize: 22, fontWeight: 600, color: '#F5EDD8', mb: '11px', lineHeight: 1.24, letterSpacing: '-0.005em' }}>
                {headline}
              </Typography>
            )}
            <Typography sx={{ fontSize: 13, color: '#A89880', lineHeight: 1.72 }}>{body.join(' ')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '9px', borderLeft: '0.5px solid rgba(210,190,160,0.22)', pl: '22px' }}>
            <NarrativePill value={fmtK(kp.occ.revpar.v, kp.occ.revpar.fmt)} label="RevPAR" sub="occ × ADR" />
            <NarrativePill
              value={fmtK(kp.pace.budgetMtd.v, kp.pace.budgetMtd.fmt)}
              label="MTD vs Budget"
              sub={budgetVariance(kp.pace.budgetMtd)?.text}
              color={budgetVariance(kp.pace.budgetMtd)?.positive ? '#8FCB7A' : '#E58A7C'}
            />
            <NarrativePill
              value={fmtK(kp.pace.budgetYtd.v, kp.pace.budgetYtd.fmt)}
              label="YTD vs Budget"
              sub={budgetVariance(kp.pace.budgetYtd)?.text}
              color={budgetVariance(kp.pace.budgetYtd)?.positive ? '#8FCB7A' : '#E58A7C'}
            />
          </Box>
        </Box>

        {/* Charts */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', mb: '16px' }}>
          <ChartCard
            title="Monthly Revenue Trend — 2026 vs LY"
            sub={`Monthly confirmed Room Revenue, this year vs last`}
            legend={<ChartLegend items={[{ label: filters.year, color: T.oc }, { label: 'Last Year', color: T.ly, dashed: true }]} />}
          >
            <Line
              data={paceChartData}
              options={{
                ...CHART_OPTS,
                scales: {
                  ...CHART_OPTS.scales,
                  y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, callback: (v: number | string) => `$${v}k` } },
                },
              }}
            />
          </ChartCard>
          <ChartCard
            title="By Property"
            sub={segmentActive ? `${filters.market} revenue by property ($k) · this period` : 'Relative occupancy · trailing 90 days'}
            height={Math.max(230, byPropItems.length * 22 + 26)}
          >
            <Bar
              data={byPropData}
              options={{
                ...CHART_OPTS, indexAxis: 'y' as const,
                scales: {
                  ...CHART_OPTS.scales,
                  y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, autoSkip: false, crossAlign: 'far' as const } },
                },
                ...propertyBarClickOptions(byPropItems as unknown as { id: string | null }[], onSelectProperty, 'sales-exec-summary'),
              }}
            />
          </ChartCard>
        </Box>

        {/* Agent Leaderboard — capped + scrollable with a sticky header (2026-07-16 design edit,
            necessary once real data brought this to 819 agents instead of the mockup's 16). */}
        <Box sx={{ bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '16px 18px' }}>
          <Typography sx={{ fontFamily: T.se, fontSize: 18, fontWeight: 500, color: T.ink, mb: '2px' }}>Agent Leaderboard</Typography>
          <Typography sx={{ fontSize: 10, color: T.mu, mb: '12px', fontStyle: 'italic' }}>
            {data.AD.yearly.length > LEADERBOARD_CAP
              ? `Top ${LEADERBOARD_CAP} of ${data.AD.yearly.length} agents`
              : `${data.AD.yearly.length} agent${data.AD.yearly.length === 1 ? '' : 's'}`}
            {' '}· click any row for a full profile
          </Typography>
          <Box sx={{ maxHeight: 430, overflow: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'left', fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>Agent</TableCell>
                  <TableCell sx={{ textAlign: 'left', fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>Segment</TableCell>
                  <TableCell align="right" sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>Room Revenue</TableCell>
                  <TableCell align="right" sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>Nights</TableCell>
                  <TableCell align="right" sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>ADR</TableCell>
                  <TableCell align="right" sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>Materialisation</TableCell>
                  <TableCell align="right" sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.mu, borderBottom: `0.5px solid ${T.ink}`, bgcolor: T.cd }}>YoY</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.AD.yearly.slice(0, LEADERBOARD_CAP).map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => onSelectAgent(r.id)}
                    sx={{ cursor: 'pointer', '&:hover td': { bgcolor: T.sf }, '&:last-child td': { border: 0 } }}
                  >
                    <TableCell sx={{ fontFamily: T.sa, fontSize: 12.5, fontWeight: 500, color: T.ink, borderBottom: `0.5px solid ${T.br}`, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.nm}
                    </TableCell>
                    <TableCell sx={{ borderBottom: `0.5px solid ${T.br}`, maxWidth: 170 }}>
                      <Box sx={{ display: 'inline-block', fontFamily: T.mo, fontSize: 9.5, px: '9px', py: '2px', borderRadius: '20px', bgcolor: r.mkt === 'Unallocated' ? T.sf : T.ocl, color: r.mkt === 'Unallocated' ? T.mu : T.ocd }}>
                        {r.mkt}
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2, borderBottom: `0.5px solid ${T.br}` }}>${r.rv.toLocaleString()}k</TableCell>
                    <TableCell align="right" sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2, borderBottom: `0.5px solid ${T.br}` }}>{r.nt.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2, borderBottom: `0.5px solid ${T.br}` }}>${r.nr_adr.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2, borderBottom: `0.5px solid ${T.br}` }}>{r.conversionRate.toFixed(1)}%</TableCell>
                    <TableCell align="right" sx={{ fontFamily: T.mo, fontSize: 11, fontWeight: 600, color: r.up ? T.rg : T.rr, borderBottom: `0.5px solid ${T.br}` }}>{r.cg}</TableCell>
                  </TableRow>
                ))}
                {data.AD.yearly.length === 0 && (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ color: T.mu, fontStyle: 'italic', border: 0, py: 4 }}>No agents match these filters.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
