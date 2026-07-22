'use client'
import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import ButtonGroup from '@mui/material/ButtonGroup'
import Button from '@mui/material/Button'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import MuiTooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarController, LineController,
  PointElement, LineElement, BarElement, ArcElement, Tooltip as ChartTooltip,
} from 'chart.js'
import type { ChartData, ChartOptions, Plugin } from 'chart.js'
import { Line, Chart, Doughnut } from 'react-chartjs-2'
import type { DashboardData, EntityClickContext, KpiMetric } from '@/types'
import type { SesFilters } from '@/app/sales-exec-summary/page'
import { fmtK, budgetVariance } from '@/components/KpiRow'
import { buildExecutiveNarrative } from '@/lib/execNarrative'
import { propertyBarClickOptions } from '@/lib/chartClicks'
import { PROPERTY_ROOM_COUNTS } from '@/lib/constants'
import { MARKET_SEGMENT_VALUES } from '@/lib/agentSegments'
import { MARKET_SEGMENT_COLORS } from '@/lib/designTokens'
import { T } from '@/lib/sesTheme'
import SesAgentSearch from '@/components/SesAgentSearch'
import { SesKpiNarrativeSkeleton, SesChartsSkeleton, SesLeaderboardSkeleton } from '@/components/SesSkeleton'

// BarController/LineController registered explicitly (mirrors PropertyPerformanceView.tsx's
// 2026-07-16j fix) — the generic <Chart> component below (needed for the mixed bar+line Revenue &
// Occupancy chart) doesn't auto-register a controller the way the typed <Line> component elsewhere
// on this page does; without these the chart throws at render and silently fails to appear.
// ArcElement (2026-07-17) — needed by the typed <Doughnut> component (Room Revenue by Market
// Segment chart); DoughnutController auto-registers via that typed component the same way
// BarController does via <Bar> elsewhere, so only the element needs registering here.
ChartJS.register(CategoryScale, LinearScale, BarController, LineController, PointElement, LineElement, BarElement, ArcElement, ChartTooltip)

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

// Progressive-loading prop contract (2026-07-16c) — this page's backend is split into 3
// independent /api/dashboard views (kpis / charts / leaderboard, see src/lib/dashboardViews.ts),
// each resolving at its own pace. Rather than one `data: DashboardData`, each section gets its own
// data/loading/error trio so it can independently swap skeleton -> real content -> error without
// waiting on (or being blocked by) the other two.
type Props = {
  kpisData: DashboardData | null
  kpisLoading: boolean
  kpisError: string | null
  chartsData: DashboardData | null
  chartsLoading: boolean
  chartsError: string | null
  leaderboardData: DashboardData | null
  leaderboardLoading: boolean
  leaderboardError: string | null
  filters: SesFilters
  onFilters: (f: SesFilters) => void
  onSelectAgent: (agentId: string) => void
  onSelectProperty: (context: EntityClickContext) => void
  onSelectSegment: (context: EntityClickContext) => void
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

// Raw-dollar axis/tooltip formatter for the Revenue & Occupancy chart (2026-07-17) — takes the
// actual dollar figure (e.g. 3284659), NOT a pre-scaled-to-millions value like fmtK's '$M' format
// expects. Passing a raw dollar amount through fmtK(v, '$M') double-counts the scale (reads as
// "$3284659.0M" instead of "$3.3M") — this divides by 1e6/1e3 itself, matching
// PropertyPerformanceView.tsx's own fmtDollar (same chart, same data shape, same bug to avoid).
const fmtDollarAxis = (v: number | null): string =>
  v === null ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v).toLocaleString()}`

// Mirrors PropertyPerformanceView.tsx's isNoDataRow exactly — Ngorongoro Explorer is forced to
// the "no data" treatment despite real $0/0% numbers (pre-opening property; a colored dot would
// misread as performing rather than not yet open — confirmed 2026-07-16h decision, same basis here).
const isRevOccNoDataRow = (r: { actualOccPct: number | null; budgetOccPct: number | null; propertyName: string }): boolean =>
  r.actualOccPct === null || r.budgetOccPct === null || r.propertyName === 'Ngorongoro Explorer'

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
// Widened (2026-07-22) from `metric: KpiMetric` to this minimal structural shape so it also
// accepts the lightweight { label, v, ly } comparison pairs KpiCard's `comparisons` prop carries
// (Full Year's vs-Budget pair) — those aren't full KpiMetric objects (no fmt/lbl/d/etc.), but the
// only fields this function ever reads are v/ly, so nothing about its behavior changes for
// existing KpiMetric callers.
function yoyPct(m: { v: number; ly?: number }): number | null {
  return typeof m.ly === 'number' && m.ly > 0 ? ((m.v - m.ly) / m.ly) * 100 : null
}
const RAG_STYLES: Record<Rag, { bg: string; border: string; valueColor: string; barColor: string }> = {
  g: { bg: 'linear-gradient(180deg,#F5FAEE 0%,#EAF3DE 100%)', border: 'rgba(59,109,17,.45)', valueColor: T.rg, barColor: T.rg },
  a: { bg: 'linear-gradient(180deg,#FEFCEF 0%,#FBF4D6 100%)', border: 'rgba(202,138,4,.5)', valueColor: '#8A5A00', barColor: T.ra },
  r: { bg: 'linear-gradient(180deg,#FEF3F1 0%,#FBE2DE 100%)', border: 'rgba(192,57,43,.5)', valueColor: T.rr, barColor: T.rr },
  neutral: { bg: 'linear-gradient(180deg,#FFFDF7 0%,' + T.cd + ' 100%)', border: T.br, valueColor: T.ink, barColor: T.br },
}

// Dark "detail card" tooltip (2026-07-22) — replaces the old flat-text tooltip lines for metrics
// carrying `tooltipDetail`: header, bold Actualized primary figure, colored vs-Last-Year
// comparison row, then secondary breakdown rows (OTB / OTB vs Budget / Extras etc., whatever the
// route supplied). Reuses the same dark-narrative-panel palette already established elsewhere on
// this page (T.dk background, #F5EDD8/#A89880/#7A6A58 text tiers, #8FCB7A/#E58A7C variance colors
// — see the Executive Summary narrative panel below) rather than MUI Tooltip's default gray, so
// this reads as the same design system, not a bolted-on widget.
function DetailTooltip({ metric }: { metric: KpiMetric }) {
  const detail = metric.tooltipDetail
  if (!detail) return null
  // Same-elapsed-basis fix (2026-07-22) — prefer detail.actualizedLy (always Jan 1–this month,
  // last year) over metric.ly whenever it's present. metric.ly follows the period toggle's own
  // monthLo/monthHi (last year's COMPLETE 12 months when the card is in Full Year mode), which
  // would compare metric.v (still partial-year actualized-to-date) against a full prior year —
  // the exact partial-vs-full mismatch already fixed for the card headline, just resurfacing
  // here. Falls back to metric.ly for any tooltipDetail that didn't set actualizedLy.
  const d = budgetVariance({ v: metric.v, ly: detail.actualizedLy ?? metric.ly })
  // Text palette (2026-07-22d) — rebuilt from scratch for the new #8C7550 mid-tone background.
  // The old palette (pale cream/amber/green/red) was tuned for the near-black T.dk fill and
  // fails badly here (e.g. the old muted-label color computes to ~1:1 against this background —
  // effectively invisible). A mid-luminance background doesn't pair well with EITHER a fully
  // pale or fully dark text set at full strength, so this is a dedicated 2-tier system verified
  // against #8C7550 specifically: near-white for emphasis (4.29:1), near-black for secondary
  // text (3.93:1), and darkened/desaturated green+red for variance (3.90:1 / 3.55:1) — all
  // computed via actual WCAG contrast math, not eyeballed.
  const TT_EMPHASIS = '#FFFCF5'
  const TT_SECONDARY = '#1F1A14'
  const TT_UP = '#0E2001'
  const TT_DOWN = '#4A0C06'
  return (
    <Box sx={{ minWidth: 230, maxWidth: 290 }}>
      <Typography sx={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: TT_EMPHASIS, mb: '10px' }}>
        {detail.header}
      </Typography>
      <Typography sx={{ fontSize: 8, letterSpacing: '0.09em', textTransform: 'uppercase', color: TT_SECONDARY, mb: '2px' }}>
        Actualized
      </Typography>
      <Typography sx={{ fontFamily: T.se, fontSize: 26, fontWeight: 600, color: TT_EMPHASIS, lineHeight: 1, mb: '6px' }}>
        {fmtK(metric.v, metric.fmt)}
      </Typography>
      {d && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', mb: '12px' }}>
          <Box component="span" sx={{ fontFamily: T.mo, fontSize: 11.5, fontWeight: 600, color: d.positive ? TT_UP : TT_DOWN }}>
            {d.positive ? '▲' : '▼'} {d.text}
          </Box>
          {/* Label fix (2026-07-22) — this was hardcoded "vs Last Year" always, which is wrong
              for Occupancy % (metric.budget: true, its `ly` slot holds the Budget target, not a
              real prior-year value) — contradicted the card's own "vs 2026 Budget Target"
              caption directly below it. Now matches whichever basis `d`'s `ly` actually came from. */}
          <Typography component="span" sx={{ fontSize: 10, color: TT_SECONDARY }}>
            {metric.budget ? 'vs 2026 Budget Target' : 'vs Last Year'}
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '7px', borderTop: '0.5px solid rgba(31,26,20,0.25)', pt: '10px' }}>
        {detail.breakdown.map((row) => (
          <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
            <Typography sx={{ fontSize: 10, color: TT_SECONDARY, flexShrink: 0 }}>{row.label}</Typography>
            {/* Wrapping fix (2026-07-22) — `whiteSpace: nowrap` was fine for short $-value rows
                (Room Revenue/Nights) but forced long descriptive text (Occupancy %'s "Basis" row,
                "Full-year 2026, all periods — not period-filterable") onto one line, overflowing
                the tooltip box instead of wrapping. Removed nowrap + right-aligned the wrap so
                short values still read as a single line naturally, long ones wrap cleanly. */}
            <Typography sx={{ fontFamily: T.mo, fontSize: 10.5, color: TT_EMPHASIS, fontWeight: 500, textAlign: 'right' }}>{row.value}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function KpiCard({
  label, metric, caption, displayValue, comparisons,
}: {
  label: string
  metric: KpiMetric
  caption: string
  // Full Year OTB override (2026-07-22) — when set, this replaces metric.v as the bold headline
  // number. metric itself stays the real actualized figure throughout (RAG coloring and the
  // detail tooltip's "Actualized" primary both still read metric.v/metric.ly untouched) — only
  // the visible big number swaps, so the tooltip's "Actualized: $X" line never contradicts what
  // metric actually holds.
  displayValue?: number
  // Full Year dual-comparison override (2026-07-22) — when set, replaces the single Variance/
  // caption line with one row per entry (e.g. "vs Last Year" and "vs Budget" both shown at once).
  // Omitted (undefined) for every other card/period, which keep today's single-comparison line.
  comparisons?: { label: string; v: number; ly: number }[]
}) {
  // RAG basis (2026-07-22 fix) — when `comparisons` is set (Full Year's dual-comparison mode),
  // the card's headline is the OTB figure, so its health verdict should read OTB-vs-Budget too,
  // not the original actualized-vs-LY pair still sitting in `metric`. Falls back to `metric`
  // itself (unchanged behavior) for every other card/period, which never pass `comparisons`.
  const budgetComparison = comparisons?.find((c) => c.label === 'vs Budget')
  const rag = ragFromYoyPct(yoyPct(budgetComparison ?? metric))
  const s = RAG_STYLES[rag]
  const shownValue = displayValue ?? metric.v
  const tooltipContent = metric.tooltipDetail
    ? <DetailTooltip metric={metric} />
    : metric.tooltip
      ? <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, maxWidth: 260 }}>{metric.tooltip.map((line, idx) => <span key={idx}>{line}</span>)}</Box>
      : null
  // Hover-area fix (2026-07-17) — the tooltip used to be wrapped around only the small info icon,
  // so a user had to hit that few-pixel target to see it. MuiTooltip now wraps the whole card
  // (below); the icon stays as a visual affordance only, no longer its own separate hover target.
  const card = (
    <Box
      sx={{
        background: s.bg, border: `0.5px solid ${s.border}`, borderRadius: '9px', p: '15px 17px 15px',
        flex: 1, position: 'relative', overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 6px 14px rgba(31,26,20,.10), 0 2px 4px rgba(31,26,20,.07)',
        transition: 'transform .14s, box-shadow .14s',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 13px 24px rgba(31,26,20,.15), 0 4px 7px rgba(31,26,20,.10)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mb: '7px' }}>
        <Typography sx={{ fontFamily: T.sa, fontSize: 8.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.mu }}>
          {label}
        </Typography>
        {tooltipContent && <InfoOutlinedIcon sx={{ fontSize: 12, color: T.mu }} />}
      </Box>
      <Typography sx={{ fontFamily: T.se, fontSize: 33, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1, color: s.valueColor, mb: '8px', textShadow: '0 1px 0 rgba(255,255,255,.85), 0 2px 4px rgba(31,26,20,.22)' }}>
        {fmtK(shownValue, metric.fmt)}
      </Typography>
      <Box sx={{ fontFamily: T.sa, fontSize: 10.5, color: T.mu, display: 'flex', flexDirection: comparisons ? 'column' : 'row', alignItems: comparisons ? 'flex-start' : 'center', gap: comparisons ? '4px' : '6px', flexWrap: 'wrap' }}>
        {comparisons
          ? comparisons.map((c) => {
              const d = budgetVariance({ v: c.v, ly: c.ly })
              return d && (
                <Box key={c.label} sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Box component="span" sx={{ fontFamily: T.mo, fontWeight: 600, color: d.positive ? T.rg : T.rr }}>
                    {d.positive ? '▲' : '▼'} {d.text}
                  </Box>
                  {c.label}
                </Box>
              )
            })
          : (<><Variance metric={metric} /> {caption}</>)}
      </Box>
      <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '3px', bgcolor: s.barColor }} />
    </Box>
  )
  return tooltipContent
    ? (
      <MuiTooltip
        title={tooltipContent}
        arrow
        // Background (2026-07-22d, final) — swapped from T.dk to a dedicated warm grey #8C7550.
        // T.dk matched the Narrative panel directly below the KPI row exactly, so a tooltip
        // opening there was nearly indistinguishable from the panel's own content behind it.
        // #8C7550 clears the WCAG 3:1 UI-boundary threshold against BOTH surfaces the tooltip can
        // appear over: 3.53:1 vs T.dk (#2A2318, the panel) and 4.07:1 vs T.cd (#FAF6EC, the light
        // card fill) — found by scanning the warm-hue-ratio scale rather than guessing (an
        // earlier candidate, #7A6E5E, cleared the SAME outer check but turned out to sit in a
        // mid-luminance zone that broke every one of the tooltip's own text colors — see
        // DetailTooltip's TT_EMPHASIS/TT_SECONDARY/TT_UP/TT_DOWN, a text palette rebuilt from
        // scratch and verified against #8C7550 specifically, not reused from the old T.dk design).
        // Border removed (2026-07-22d) — the amber border from the 07-22b fix is now nearly
        // invisible here (1.66:1, amber-on-amber) since this background is itself warm/amber-
        // toned; it was only load-bearing back when the fill matched the panel exactly. The fill
        // color itself now does that job, so the border was dropped rather than kept as
        // barely-visible decoration.
        slotProps={{
          tooltip: {
            sx: {
              bgcolor: '#8C7550', borderRadius: '10px', p: '14px 16px',
              boxShadow: '0 18px 40px rgba(0,0,0,.35)',
            },
          },
          arrow: { sx: { color: '#8C7550' } },
        }}
      >
        {card}
      </MuiTooltip>
    )
    : card
}

function NarrativePill({ value, label, sub, color, tooltip }: { value: string; label: string; sub?: string; color?: string; tooltip?: string[] }) {
  return (
    <Box sx={{ bgcolor: 'rgba(255,255,255,0.045)', border: '0.5px solid rgba(210,190,160,0.22)', borderRadius: '7px', p: '10px 13px', flex: 1 }}>
      <Typography sx={{ fontFamily: T.se, fontSize: 24, fontWeight: 600, lineHeight: 1, color: '#F5EDD8' }}>{value}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mt: '6px' }}>
        <Typography sx={{ fontSize: 8, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#7A6A58' }}>{label}</Typography>
        {tooltip && (
          <MuiTooltip
            title={<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, maxWidth: 260 }}>{tooltip.map((line, idx) => <span key={idx}>{line}</span>)}</Box>}
            arrow
          >
            <InfoOutlinedIcon sx={{ fontSize: 11, color: '#7A6A58' }} />
          </MuiTooltip>
        )}
      </Box>
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

// legendPosition (2026-07-17, Market Segment donut) — every existing ChartCard on this page puts
// its legend below the plot; the donut's spec explicitly calls for the legend ABOVE the chart
// (name + % of total read before the shape, not after). Added as an opt-in prop rather than a new
// component so the donut still gets this card's exact title/sub/border treatment.
function ChartCard({ title, sub, children, height = 230, legend, legendPosition = 'below' }: { title: string; sub: string; children: ReactNode; height?: number; legend?: ReactNode; legendPosition?: 'above' | 'below' }) {
  return (
    <Box sx={{ bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '16px 18px', flex: 1 }}>
      <Typography sx={{ fontFamily: T.se, fontSize: 18, fontWeight: 500, color: T.ink, letterSpacing: '-0.005em' }}>{title}</Typography>
      <Typography sx={{ fontSize: 10, color: T.mu, mb: '12px', fontStyle: 'italic' }}>{sub}</Typography>
      {legendPosition === 'above' && legend}
      <Box sx={{ height, position: 'relative', mt: legendPosition === 'above' ? '12px' : 0 }}>{children}</Box>
      {legendPosition === 'below' && legend}
    </Box>
  )
}

const selSx = {
  fontFamily: T.sa, fontSize: 12, color: T.ink2, bgcolor: T.sf,
  height: 30,
  '.MuiOutlinedInput-notchedOutline': { borderColor: T.br },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: T.oc },
}

export default function SalesExecutiveSummaryDesign({
  kpisData, kpisLoading, kpisError,
  chartsData, chartsLoading, chartsError,
  leaderboardData, leaderboardLoading, leaderboardError,
  filters, onFilters, onSelectAgent, onSelectProperty, onSelectSegment,
}: Props) {
  const propertyLabel = filters.property === 'all'
    ? 'All Properties'
    : PROPERTY_OPTIONS.find((p) => p.value === filters.property)?.label ?? filters.property
  const periodLabel = filters.period === 'm' ? `Month to date · ${filters.year}` : filters.period === 'y' ? `Year to date · ${filters.year}` : `Full year · ${filters.year}`
  // Full Year OTB redefinition (2026-07-22) — gates the Room Revenue/Room Nights Sold KpiCard
  // overrides below; see their usage for what changes and why.
  const isFullYear = filters.period === 'a'

  // "Data as at" — whichever section resolves first (they all share the same server clock at
  // request time, so once more than one has landed they read identically; never crashes if the
  // others are still in flight).
  const lastUpdated = kpisData?.lastUpdated ?? chartsData?.lastUpdated ?? leaderboardData?.lastUpdated ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let paceChartData: any = null
  // Chart 1 subtitle scope (2026-07-16e) — derived purely from `filters` (already a prop), no new
  // data/query. Mirrors the Claude Design mockup's self-relabeling scope.
  const segmentActive = filters.market !== 'all'
  const chart1Scope = `${segmentActive ? filters.market : 'Portfolio'}${filters.property !== 'all' ? ` · ${propertyLabel}` : ''}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let revOccRows: DashboardData['BUDGET']['occByProperty'] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let revOccChartData: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let segmentRows: DashboardData['MARKET_SEGMENT_PERFORMANCE'] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let segmentDonutData: any = null

  if (chartsData) {
    paceChartData = {
      labels: chartsData.PD.months,
      datasets: [
        { label: filters.year, data: chartsData.PD.actual, borderColor: T.oc, backgroundColor: 'rgba(183,99,42,0.1)', borderWidth: 2.5, tension: 0.35, pointRadius: 3, pointBackgroundColor: T.oc },
        { label: 'Last year', data: chartsData.PD.ly, borderColor: T.ly, borderDash: [5, 4], fill: false, tension: 0.35, borderWidth: 2, pointRadius: 2, pointBackgroundColor: T.ly },
      ],
    }

    // Room Revenue by Market Segment donut (2026-07-17 — moved here from the Market Segment
    // Performance tab per explicit correction: this chart belongs on Sales Executive Summary, not
    // Market Segment Performance). All 9 segments individually, never folded into "Other" (explicit
    // product requirement). Color keyed to segment IDENTITY via MARKET_SEGMENT_COLORS
    // (designTokens.ts), not sort position — a segment keeps its color as revenue shifts and the
    // ranking reorders (dataviz skill's "color follows the entity, never its rank" rule).
    segmentRows = [...chartsData.MARKET_SEGMENT_PERFORMANCE].sort((a, b) => b.roomRevenue - a.roomRevenue)
    const segmentColor = (segment: string): string => MARKET_SEGMENT_COLORS[segment] ?? 'rgba(122,106,88,0.6)'
    segmentDonutData = {
      labels: segmentRows.map((r) => r.segment),
      datasets: [{
        data: segmentRows.map((r) => r.roomRevenue),
        backgroundColor: segmentRows.map((r) => segmentColor(r.segment)),
        // Card-surface border acts as a visible gap between slices (dataviz skill's spacer
        // convention) — without it, two similarly-lit adjacent slices can read as one shape.
        borderColor: T.cd,
        borderWidth: 2,
        hoverOffset: 6,
      }],
    }

    // Revenue & Occupancy by Property (2026-07-17) — replaces the old By-Property chart (occupancy
    // ranking / segment-scoped revenue). Budget vs Actual Room Revenue grouped bars + an Occupancy %
    // dot overlay (green = at/above that property's own Budget Occupancy %, red = below), same
    // data/logic as PropertyPerformanceView's own Revenue & Occupancy chart (data.BUDGET.
    // occByProperty) — kept as two near-identical implementations rather than a shared component
    // since the two pages' design systems (MUI Card/Typography vs this page's raw sx/T-token
    // styling) don't share a chart-wrapper convention. Portfolio-wide, so unlike the old chart it
    // does NOT respond to the Market Segment filter — Budget has no segment breakdown to filter by.
    revOccRows = [...chartsData.BUDGET.occByProperty].sort((a, b) => (b.actualRevenue ?? -1) - (a.actualRevenue ?? -1))
    revOccChartData = {
      labels: revOccRows.map((r) => r.propertyName),
      datasets: [
        { type: 'bar' as const, label: 'Budget Room Revenue', data: revOccRows.map((r) => r.budgetRevenue ?? 0), backgroundColor: 'rgba(183,99,42,0.35)', borderRadius: 3, yAxisID: 'y' },
        { type: 'bar' as const, label: 'Actual Room Revenue', data: revOccRows.map((r) => r.actualRevenue ?? 0), backgroundColor: T.oc, borderRadius: 3, yAxisID: 'y' },
        {
          type: 'line' as const,
          label: 'Occupancy % (vs Budget)',
          data: revOccRows.map((r) => r.actualOccPct),
          showLine: false,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBorderWidth: 0,
          pointBackgroundColor: revOccRows.map((r) => (
            isRevOccNoDataRow(r) ? 'rgba(122,106,88,0.4)' : r.actualOccPct! >= r.budgetOccPct! ? T.rg : T.rr
          )),
          yAxisID: 'y1',
        },
      ],
    }
  }

  const revOccLegendItems = [
    { label: 'Budget Room Revenue', color: 'rgba(183,99,42,0.35)' },
    { label: 'Actual Room Revenue', color: T.oc },
    { label: 'Occupancy % (vs Budget)', color: T.rg },
  ]
  const revOccChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const row = revOccRows[ctx.dataIndex]
            if (ctx.dataset.label === 'Occupancy % (vs Budget)') {
              return isRevOccNoDataRow(row)
                ? `Occupancy %: no data (${row.caveat ?? 'see caveat'})`
                : `Occupancy %: ${row.actualOccPct!.toFixed(1)}% (Budget: ${row.budgetOccPct !== null ? row.budgetOccPct.toFixed(1) + '%' : '—'})`
            }
            return `${ctx.dataset.label}: ${fmtDollarAxis((ctx.raw as number) ?? 0)}`
          },
          afterBody: (items) => {
            const row = revOccRows[items[0]?.dataIndex ?? 0]
            return row?.caveat ? [`⚠ ${row.caveat}`] : []
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 }, color: T.mu } },
      y: {
        position: 'left',
        grid: { color: 'rgba(201,190,169,0.4)' },
        ticks: { font: { size: 9 }, color: T.mu, callback: (v) => fmtDollarAxis(Number(v)) },
      },
      y1: {
        position: 'right',
        min: 0,
        grid: { drawOnChartArea: false },
        ticks: { font: { size: 9 }, color: T.mu, callback: (v) => `${v}%` },
      },
    },
    ...propertyBarClickOptions(revOccRows.map((r) => ({ id: r.propertyId })), onSelectProperty, 'sales-exec-summary'),
  }

  // Room Revenue by Market Segment donut — legend (name + % of total, ABOVE the chart per spec)
  // and tooltip (exact revenue + %). totalSegmentRevenue is the sum of exactly these 9 rows, so
  // percentages always foot to 100% — there's no hidden 10th bucket.
  const totalSegmentRevenue = segmentRows.reduce((s, r) => s + r.roomRevenue, 0)
  const segmentLegendItems = segmentRows.map((r) => ({
    label: `${r.segment} (${totalSegmentRevenue > 0 ? ((r.roomRevenue / totalSegmentRevenue) * 100).toFixed(1) : '0.0'}%)`,
    color: MARKET_SEGMENT_COLORS[r.segment] ?? 'rgba(122,106,88,0.6)',
  }))
  const segmentDonutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Segments sorted descending (segmentRows, above) + rotation -90 (12 o'clock) means the
    // largest segment always starts at 12 and the rest follow clockwise in descending size.
    rotation: -90,
    cutout: '58%',
    plugins: {
      legend: { display: false }, // custom legend above the chart (ChartLegend) is the one the spec asks for
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const r = segmentRows[ctx.dataIndex]
            const pct = totalSegmentRevenue > 0 ? (r.roomRevenue / totalSegmentRevenue) * 100 : 0
            return `${fmtDollarAxis(r.roomRevenue)} (${pct.toFixed(1)}%)`
          },
        },
      },
    },
    onClick: (_event, elements) => {
      const idx = elements[0]?.index
      if (idx === undefined) return
      const segment = segmentRows[idx]?.segment
      if (segment) onSelectSegment({ type: 'segment', id: segment, sourceView: 'sales-exec-summary' })
    },
    onHover: (event, elements) => {
      const target = event.native?.target as HTMLElement | null | undefined
      if (target) target.style.cursor = elements.length > 0 ? 'pointer' : 'default'
    },
  }

  // Value labels on chart points (2026-07-16g) — mirrors the mockup's lineLabels plugin exactly
  // (window.TWEAKS.valueLabels confirmed true there, i.e. the mockup ships with labels-on, not a
  // toggled-off default). Chart.js afterDatasetsDraw plugin.
  const lineValueLabelsPlugin: Plugin<'line'> = {
    id: 'lineValueLabels',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx
      const m0 = chart.getDatasetMeta(0)
      const m1 = chart.getDatasetMeta(1)
      const n = m0.data.length
      if (!n || !m1.data.length) return
      const d0 = chart.data.datasets[0].data as number[]
      const d1 = chart.data.datasets[1].data as number[]
      ctx.save()
      ctx.font = '600 9.5px "JetBrains Mono", monospace'
      for (let i = 0; i < n; i++) {
        const p0 = m0.data[i], p1 = m1.data[i]
        const actualAbove = p0.y <= p1.y // this-year line is higher on screen at this point
        ctx.textAlign = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center'
        const dx = i === 0 ? 4 : i === n - 1 ? -4 : 0
        ctx.fillStyle = T.ocd
        ctx.fillText(`$${Math.round(d0[i])}k`, p0.x + dx, p0.y + (actualAbove ? -9 : 16))
        ctx.fillStyle = '#8A7C64'
        ctx.fillText(`$${Math.round(d1[i])}k`, p1.x + dx, p1.y + (actualAbove ? 16 : -9))
      }
      ctx.restore()
    },
  }
  const narrative = kpisData
    ? buildExecutiveNarrative(kpisData, filters.period, filters.property !== 'all' ? propertyLabel : null)
    : null
  const [headline, ...body] = narrative ?? []

  return (
    <Box sx={{ fontFamily: T.sa, color: T.ink2 }}>
      {/* Header — always visible, no data dependency other than the "Data as at" timestamp */}
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
          <Typography sx={{ fontFamily: T.mo, fontSize: 11, color: T.ink2 }}>{lastUpdated ?? '—'}</Typography>
        </Box>
      </Box>

      {/* Sub bar: tab + filters — always visible; Find Agent tolerates the leaderboard section
          still loading (empty options + disabled, see SesAgentSearch's `loading` prop) */}
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
                // Full Year caveat (2026-07-22) — this toggle compares actual-to-date (future months
                // haven't happened, so the .v side never grows past YTD) against a COMPLETE prior
                // year, unlike MTD/YTD where both sides are bounded the same way. Native `title`
                // (not MuiTooltip) deliberately — MUI's ButtonGroup clones props onto its direct
                // children to draw the grouped border; wrapping this Button in a Tooltip would make
                // Tooltip the child ButtonGroup clones onto instead, breaking that styling.
                title={p.value === 'a' ? 'Actual-to-date vs. full prior year — will read artificially low until the year completes' : undefined}
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
          <SesAgentSearch agents={leaderboardData?.AD.yearlyDirectory ?? []} onSelectAgent={onSelectAgent} loading={leaderboardLoading} />
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

        {/* KPI row + Narrative panel — kpis section */}
        {kpisError && <Alert severity="error" sx={{ mb: '16px' }}>Failed to load KPIs: {kpisError}</Alert>}
        {!kpisError && (kpisLoading || !kpisData) && <SesKpiNarrativeSkeleton />}
        {!kpisError && !kpisLoading && kpisData && (
          <>
            {/* Room Revenue label override — same "Actualized, not full-year" honesty note as
                src/components/views/ExecSummaryView.tsx's roomRevenueActualized (occ.rev is
                actualized-stays-only; Agent Room Revenue elsewhere includes forward-confirmed
                bookings). */}
            {/* Full Year redefinition (2026-07-22) — for Room Revenue/Room Nights Sold ONLY, and
                ONLY when Full Year is selected: headline swaps from actualized-to-date to the OTB
                (on-the-books) total, shown against BOTH vs-Last-Year and vs-Budget in one card.
                MTD/YTD are completely untouched (isFullYear false → displayValue/comparisons are
                both undefined → KpiCard falls back to exactly today's single-line behavior).
                Deliberately does NOT touch KP_BASE.occ.rev/occ.nights themselves — those stay
                actualized-only so ExecSummaryView's Occupancy tab (which reuses them, unaffected
                by this page's Full Year toggle) keeps its own documented "actualized, not
                full-year" behavior exactly as before. New pace.budgetFullYear/budgetFullYearNights
                fields carry the OTB + Budget-target basis instead — see route.ts. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', mb: '16px' }}>
              <KpiCard
                label={isFullYear ? 'Room Revenue (OTB)' : 'Room Revenue (Actualized)'}
                metric={kpisData.KP_BASE.occ.rev}
                caption="vs last year"
                displayValue={isFullYear ? kpisData.KP_BASE.pace.budgetFullYear.v : undefined}
                comparisons={isFullYear ? [
                  { label: 'vs Last Year', v: kpisData.KP_BASE.pace.budgetFullYear.v, ly: kpisData.KP_BASE.occ.rev.ly ?? 0 },
                  { label: 'vs Budget', v: kpisData.KP_BASE.pace.budgetFullYear.v, ly: kpisData.KP_BASE.pace.budgetFullYear.ly ?? 0 },
                ] : undefined}
              />
              <KpiCard
                label={isFullYear ? 'Room Nights Sold (OTB)' : 'Room Nights Sold'}
                metric={kpisData.KP_BASE.occ.nights}
                caption="vs last year"
                displayValue={isFullYear ? kpisData.KP_BASE.pace.budgetFullYearNights.v : undefined}
                comparisons={isFullYear ? [
                  { label: 'vs Last Year', v: kpisData.KP_BASE.pace.budgetFullYearNights.v, ly: kpisData.KP_BASE.occ.nights.ly ?? 0 },
                  { label: 'vs Budget', v: kpisData.KP_BASE.pace.budgetFullYearNights.v, ly: kpisData.KP_BASE.pace.budgetFullYearNights.ly ?? 0 },
                ] : undefined}
              />
              {/* Occupancy % has no real prior-year capacity query to compare against (see
                  ragFromYoyPct's comment above), but as of 2026-07-16 kp.occ.occPct.ly carries a
                  real Budget Occupancy % target instead (budgetRns ÷ available room nights, same
                  derivation as the Actual side). Caption (2026-07-22, simplified) now says so
                  explicitly in one unambiguous line — "vs 2026 Budget Target" — rather than the
                  earlier badge+"vs Budget" pairing, which read as redundant ("Budget vs Budget")
                  without being any clearer about WHICH year's target this is. */}
              <KpiCard label="Occupancy %" metric={kpisData.KP_BASE.occ.occPct} caption="vs 2026 Budget Target" />
              <KpiCard label="ADR" metric={kpisData.KP_BASE.occ.adr} caption="vs last year" />
            </Box>

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
                <NarrativePill value={fmtK(kpisData.KP_BASE.occ.revpar.v, kpisData.KP_BASE.occ.revpar.fmt)} label="RevPAR" sub="occ × ADR" tooltip={kpisData.KP_BASE.occ.revpar.tooltip} />
                <NarrativePill
                  value={fmtK(kpisData.KP_BASE.pace.budgetMtd.v, kpisData.KP_BASE.pace.budgetMtd.fmt)}
                  label="MTD vs Budget"
                  sub={budgetVariance(kpisData.KP_BASE.pace.budgetMtd)?.text}
                  color={budgetVariance(kpisData.KP_BASE.pace.budgetMtd)?.positive ? '#8FCB7A' : '#E58A7C'}
                />
                <NarrativePill
                  value={fmtK(kpisData.KP_BASE.pace.budgetYtd.v, kpisData.KP_BASE.pace.budgetYtd.fmt)}
                  label="YTD vs Budget"
                  sub={budgetVariance(kpisData.KP_BASE.pace.budgetYtd)?.text}
                  color={budgetVariance(kpisData.KP_BASE.pace.budgetYtd)?.positive ? '#8FCB7A' : '#E58A7C'}
                />
              </Box>
            </Box>
          </>
        )}

        {/* Charts — charts section */}
        {chartsError && <Alert severity="error" sx={{ mb: '16px' }}>Failed to load charts: {chartsError}</Alert>}
        {!chartsError && (chartsLoading || !chartsData) && <SesChartsSkeleton />}
        {!chartsError && !chartsLoading && chartsData && paceChartData && revOccChartData && segmentDonutData && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', mb: '16px' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <ChartCard
                title="Monthly Revenue Trend — 2026 vs LY"
                sub={`${chart1Scope} — monthly confirmed Room Revenue, this year vs last`}
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
                  plugins={[lineValueLabelsPlugin]}
                />
              </ChartCard>
              <ChartCard
                title="Room Revenue by Market Segment"
                sub={`${filters.year} · share of total Room Revenue, all 9 segments · click a slice for detail`}
                height={200}
                legend={<ChartLegend items={segmentLegendItems} />}
                legendPosition="above"
              >
                <Doughnut data={segmentDonutData} options={segmentDonutOptions} />
              </ChartCard>
            </Box>
            <ChartCard
              title="Revenue & Occupancy by Property"
              sub="Full-year 2026 · bars = Budget vs Actual Room Revenue (left axis) · dots = Occupancy % (right axis), green = at/above that property's own Budget Occupancy %, red = below"
              height={340}
              legend={<ChartLegend items={revOccLegendItems} />}
            >
              <Chart type="bar" data={revOccChartData as unknown as ChartData<'bar', (number | null)[], string>} options={revOccChartOptions} />
            </ChartCard>
          </Box>
        )}

        {/* Agent Leaderboard — leaderboard section. Capped + scrollable with a sticky header
            (2026-07-16 design edit, necessary once real data brought this to 819 agents instead
            of the mockup's 16). */}
        {leaderboardError && <Alert severity="error">Failed to load Agent Leaderboard: {leaderboardError}</Alert>}
        {!leaderboardError && (leaderboardLoading || !leaderboardData) && <SesLeaderboardSkeleton />}
        {!leaderboardError && !leaderboardLoading && leaderboardData && (
          <Box sx={{ bgcolor: T.cd, border: `0.5px solid ${T.br}`, borderRadius: '9px', p: '16px 18px' }}>
            <Typography sx={{ fontFamily: T.se, fontSize: 18, fontWeight: 500, color: T.ink, mb: '2px' }}>Agent Leaderboard</Typography>
            <Typography sx={{ fontSize: 10, color: T.mu, mb: '12px', fontStyle: 'italic' }}>
              {/* Total count now comes from yearlyDirectory (the full, uncapped agent list) since
                  data.AD.yearly itself is pre-limited server-side to LEADERBOARD_CAP — see the
                  2026-07-16b Agent Leaderboard payload trim. */}
              {leaderboardData.AD.yearlyDirectory.length > LEADERBOARD_CAP
                ? `Top ${LEADERBOARD_CAP} of ${leaderboardData.AD.yearlyDirectory.length} agents`
                : `${leaderboardData.AD.yearlyDirectory.length} agent${leaderboardData.AD.yearlyDirectory.length === 1 ? '' : 's'}`}
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
                  {/* data.AD.yearly is already capped to LEADERBOARD_CAP server-side (2026-07-16b) —
                      no client-side slice needed anymore. */}
                  {leaderboardData.AD.yearly.map((r) => (
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
                  {leaderboardData.AD.yearly.length === 0 && (
                    <TableRow><TableCell colSpan={7} align="center" sx={{ color: T.mu, fontStyle: 'italic', border: 0, py: 4 }}>No agents match these filters.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
            {/* Footer totals (2026-07-16f) — mirrors the mockup's .tbltotals row. Sourced from
                AD.totals, a dedicated server-side aggregate over agRows' full matching population
                (same date_created basis, same exclusions/segment/property/period filters) — NOT a
                sum of the visible top-{LEADERBOARD_CAP} rows, so it stays correct even when the
                table is capped. Recalculates under any Segment filter (e.g. DMC only) since AD.totals
                itself is queried with the same AND_A segment clause as the leaderboard population. */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', mt: '14px', pt: '14px', borderTop: `0.5px solid ${T.ink}` }}>
              <Box>
                <Typography sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mu, mb: '2px' }}>
                  {filters.market !== 'all' ? `${filters.market} Room Revenue` : 'Total Room Revenue'}
                </Typography>
                <Typography sx={{ fontFamily: T.mo, fontSize: 16, fontWeight: 600, color: T.ink }}>
                  {fmtK(leaderboardData.AD.totals.revenue, '$M')}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mu, mb: '2px' }}>Total Room Nights</Typography>
                <Typography sx={{ fontFamily: T.mo, fontSize: 16, fontWeight: 600, color: T.ink }}>
                  {leaderboardData.AD.totals.nights.toLocaleString()}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mu, mb: '2px' }}>Blended ADR</Typography>
                <Typography sx={{ fontFamily: T.mo, fontSize: 16, fontWeight: 600, color: T.ink }}>
                  ${leaderboardData.AD.totals.adr.toLocaleString()}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontFamily: T.sa, fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mu, mb: '2px' }}>
                  {leaderboardData.AD.totals.agentCount.toLocaleString()} Agent{leaderboardData.AD.totals.agentCount === 1 ? '' : 's'}
                </Typography>
                <Typography sx={{
                  fontFamily: T.mo, fontSize: 16, fontWeight: 600,
                  color: leaderboardData.AD.totals.yoyPct == null ? T.mu : leaderboardData.AD.totals.yoyPct >= 0 ? T.rg : T.rr,
                }}>
                  {leaderboardData.AD.totals.yoyPct == null
                    ? '—'
                    : `${leaderboardData.AD.totals.yoyPct >= 0 ? '+' : ''}${leaderboardData.AD.totals.yoyPct.toFixed(1)}% YoY`}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
