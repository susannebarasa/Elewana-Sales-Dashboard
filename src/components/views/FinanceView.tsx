'use client'
import { useState, Fragment } from 'react'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import EmptyState from '@/components/EmptyState'
import FinanceNarrativePanel from '@/components/FinanceNarrativePanel'
import {
  getSandRiverFinance, PERIOD_LABELS,
  type FinancePeriod, type FinanceMetric, type FinancePLLine, type PLSection,
} from '@/lib/sandRiverFinance'
import { RAG_DEEP_RED } from '@/lib/designTokens'

// Finance (Sand River, 2026-07-16) — standalone tab, entirely independent of the shared
// /api/dashboard payload (see page.tsx's renderContent — this is checked before the
// loading/error/data gates for exactly that reason). All figures are currently NDL (No Data
// Loaded) — real Sand River MIS figures are blocked on the "actuals showing as zero" sheet
// issue; this page is built structure-first per the user's explicit "no invented numbers, use
// the NDL treatment" instruction, ready for src/data/sandRiverFinance.json to be replaced with
// real figures once that's resolved. RECON (ResRequest vs MIS comparison), the AI Query Box, and
// any MotherDuck/DuckDB queries are explicitly out of scope — never build them here.

const KPI_LABELS: { key: 'netRevenue' | 'contributionToHO' | 'ebitda' | 'netProfit'; label: string }[] = [
  { key: 'netRevenue', label: 'Net Revenue' },
  { key: 'contributionToHO', label: 'Contribution to HO' },
  { key: 'ebitda', label: 'EBITDA' },
  { key: 'netProfit', label: 'Net Profit' },
]

const RAG_COLOR: Record<string, string> = {
  green: '#3B6D11',
  amber: '#B7632A',
  red: '#C0392B',
  deepRed: RAG_DEEP_RED,
}

const NDL_BG = '#F0EDE8'
const NDL_BORDER = '#C9BEA9'
const TBC_BG = '#FFFBF0'
const TBC_BORDER = '#EFC97A'

function StatusBadge({ status }: { status: 'ok' | 'tbc' | 'ndl' }) {
  if (status === 'ndl') {
    return <Chip label="NDL" size="small" sx={{ height: 16, fontSize: '0.5625rem', bgcolor: '#E8E2D8', color: '#8A7D70', border: '0.5px solid', borderColor: NDL_BORDER }} />
  }
  if (status === 'tbc') {
    return <Chip label="TBC" size="small" sx={{ height: 16, fontSize: '0.5625rem', bgcolor: '#FFF3CD', color: '#854F0B', border: '0.5px solid', borderColor: TBC_BORDER }} />
  }
  return null
}

function FinanceKpiCard({ label, metric }: { label: string; metric: FinanceMetric }) {
  if (metric.status === 'ndl') {
    return (
      <Card sx={{ bgcolor: NDL_BG, borderLeft: '2.5px solid', borderLeftColor: NDL_BORDER, borderRadius: 1.5, height: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
            <Typography variant="overline" sx={{ fontSize: '0.5625rem', letterSpacing: '0.1em', color: 'text.secondary' }}>
              {label}
            </Typography>
            <StatusBadge status="ndl" />
          </Box>
          <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, fontSize: 23, color: '#8A7D70' }}>
            —
          </Typography>
          <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary', mt: 0.5 }}>
            No data loaded
          </Typography>
        </CardContent>
      </Card>
    )
  }

  // 'ok' / 'tbc' — not reachable with today's all-NDL dataset, kept ready for real data.
  const rag = metric.rag ? RAG_COLOR[metric.rag] : '#C9BEA9'
  const bg = metric.status === 'tbc' ? TBC_BG : undefined
  return (
    <Card sx={{ bgcolor: bg, border: '0.5px solid', borderColor: rag, borderRadius: 1.5, height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, bgcolor: rag }} />
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
          <Typography variant="overline" sx={{ fontSize: '0.5625rem', letterSpacing: '0.1em', color: 'text.secondary' }}>
            {label}
          </Typography>
          {metric.status === 'tbc' && <StatusBadge status="tbc" />}
        </Box>
        <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, fontSize: 23, fontStyle: metric.status === 'tbc' ? 'italic' : 'normal' }}>
          {metric.value !== null ? metric.value : '—'}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary' }}>
            {metric.budget !== null ? `Budget ${metric.budget}` : ''}
          </Typography>
          <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.625rem', color: rag }}>
            {metric.variancePct !== null ? `${metric.variancePct > 0 ? '▲' : '▼'} ${metric.variancePct}%` : ''}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

const SECTION_TITLES: Record<PLSection, string> = {
  revenue: 'Revenue',
  costs: 'Costs',
  summary: 'Summary',
  drivers: 'Top Drivers',
}

const TOTAL_ROW_KEYS = new Set(['netRevenue', 'contribution', 'ebitda', 'nop'])
const BOLD_TOTAL_KEYS = new Set(['nop'])

function FinancePLTable({ lines }: { lines: FinancePLLine[] }) {
  const [mode, setMode] = useState<'summary' | 'detail'>('summary')
  const visible = lines.filter((l) => mode === 'detail' || !l.detailOnly)
  const sections: PLSection[] = ['revenue', 'costs', 'summary', 'drivers']

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Profit &amp; Loss</Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, v) => v && setMode(v)}
            size="small"
            sx={{
              bgcolor: 'background.default',
              border: '0.5px solid',
              borderColor: 'divider',
              borderRadius: 1,
              p: '2px',
              '& .MuiToggleButtonGroup-grouped': {
                border: 'none',
                fontSize: '0.6875rem',
                '&.Mui-selected': { bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.primary' } },
              },
            }}
          >
            <ToggleButton value="summary" sx={{ lineHeight: 1, px: 1.5 }}>Summary</ToggleButton>
            <ToggleButton value="detail" sx={{ lineHeight: 1, px: 1.5 }}>Detail</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Legend banner (SKILL.md §7) — NDL/TBC key. No active TBC items today (every row is
            NDL), so only the legend renders, not a TBC item list. */}
        <Box sx={{ display: 'flex', gap: 2, mb: 1.5, p: 1, bgcolor: 'background.default', borderRadius: 1, border: '0.5px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StatusBadge status="ndl" />
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>No Data Loaded — figures not yet received</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StatusBadge status="tbc" />
            <Typography sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Pending Confirmation — received but unverified</Typography>
          </Box>
        </Box>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Line Item</TableCell>
              <TableCell align="right" sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Actual</TableCell>
              <TableCell align="right" sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Budget</TableCell>
              <TableCell align="right" sx={{ fontSize: '0.6875rem', color: 'text.secondary' }}>Variance</TableCell>
              <TableCell align="center" sx={{ fontSize: '0.6875rem', color: 'text.secondary', width: 56 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sections.map((section) => {
              const rows = visible.filter((l) => l.section === section)
              if (rows.length === 0) return null
              return (
                <Fragment key={section}>
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      sx={{ bgcolor: 'background.default', fontSize: '0.625rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary', py: 0.5 }}
                    >
                      {SECTION_TITLES[section]}
                    </TableCell>
                  </TableRow>
                  {rows.map((l) => {
                    const isNdl = l.status === 'ndl'
                    const isTbc = l.status === 'tbc'
                    const isTotal = TOTAL_ROW_KEYS.has(l.key)
                    const isBold = BOLD_TOTAL_KEYS.has(l.key)
                    return (
                      <TableRow
                        key={l.key}
                        sx={{
                          bgcolor: isNdl ? NDL_BG : isTbc ? TBC_BG : isTotal ? 'primary.light' : undefined,
                          borderLeft: isNdl ? `2.5px solid ${NDL_BORDER}` : isTbc ? `2.5px solid ${TBC_BORDER}` : undefined,
                        }}
                      >
                        <TableCell
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: isBold ? 700 : isTotal ? 600 : 400,
                            fontStyle: isTbc ? 'italic' : 'normal',
                            pl: l.detailOnly ? 3 : 1.5,
                          }}
                        >
                          {l.label}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace', color: isNdl ? '#8A7D70' : undefined }}>
                          {isNdl ? '—' : l.value}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace', color: isNdl ? '#8A7D70' : undefined }}>
                          {isNdl ? '—' : l.budget}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace', color: isNdl ? '#8A7D70' : undefined }}>
                          {isNdl ? '—' : l.variance}
                        </TableCell>
                        <TableCell align="center">
                          <StatusBadge status={l.status} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default function FinanceView() {
  const [period, setPeriod] = useState<FinancePeriod>('y')
  const data = getSandRiverFinance()
  const kpis = data.kpis[period]

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 1.5 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500, fontSize: 26, lineHeight: 1.1 }}>
            {data.property.name}
          </Typography>
          <Typography sx={{ fontStyle: 'italic', fontSize: '0.75rem', color: 'text.secondary' }}>
            {data.property.operatorLabel}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          {/* Static, non-personalized — this app has no user-identity/auth system to greet by
              name (unlike the SKILL.md mockup's hardcoded 'Sueh' fallback). */}
          <Typography sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontStyle: 'italic', fontSize: 12, color: 'warning.main', mb: 0.5 }}>
            Finance MIS Report
          </Typography>
          <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6875rem', color: 'text.secondary' }}>
            {data.reportPeriod ? `${data.reportPeriod.label} ${data.reportPeriod.year}` : 'No period loaded'}
          </Typography>
        </Box>
      </Box>

      {/* Period toggle — deliberately local state, NOT the Topbar's shared filters.period (which
          is hidden entirely for this tab, per Topbar.tsx's HIDE_FILTERS_FOR_SUBS). */}
      <ToggleButtonGroup
        value={period}
        exclusive
        onChange={(_, v) => v && setPeriod(v)}
        size="small"
        sx={{
          mb: 1.5,
          bgcolor: 'background.paper',
          border: '0.5px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: '2px',
          '& .MuiToggleButtonGroup-grouped': {
            border: 'none',
            fontSize: '0.6875rem',
            px: 1.5,
            '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.main' } },
          },
        }}
      >
        {(['m', 'y', 'a'] as const).map((p) => (
          <ToggleButton key={p} value={p} sx={{ lineHeight: 1 }}>
            {data.reportPeriod && p !== 'a' ? `${PERIOD_LABELS[p]} (${data.reportPeriod.label})` : PERIOD_LABELS[p]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* 4 KPI cards */}
      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        {KPI_LABELS.map(({ key, label }) => (
          <Grid size={3} key={key}>
            <FinanceKpiCard label={label} metric={kpis[key]} />
          </Grid>
        ))}
      </Grid>

      {/* Executive Narrative — dark sibling panel */}
      <FinanceNarrativePanel narrative={data.narrative} />

      {/* 3 charts */}
      <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                Cumulative Revenue Pace
              </Typography>
              <EmptyState message="No data loaded — Actual vs Budget pace will appear here." height={130} />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                Monthly Cost Stack vs Revenue
              </Typography>
              <EmptyState message="No data loaded — Managed/Imposed cost stack will appear here." height={130} />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="overline" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                Net Profit Waterfall
              </Typography>
              <EmptyState message="No data loaded — Budget-to-Actual NP bridge will appear here." height={130} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* P&L table */}
      <FinancePLTable lines={data.plLines} />
    </Box>
  )
}
