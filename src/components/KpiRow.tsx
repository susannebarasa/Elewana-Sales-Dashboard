'use client'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { KpiMetric } from '@/types'
import type { ReactNode } from 'react'

export function fmtK(v: number, fmt: string): string {
  if (fmt === 'int')  return v >= 10000 ? Math.round(v / 1000) + 'k' : Math.round(v).toLocaleString()
  if (fmt === '$M')   return v >= 1 ? '$' + v.toFixed(1) + 'M' : '$' + (v * 1000).toFixed(0) + 'k'
  if (fmt === '$')    return '$' + Math.round(v).toLocaleString()
  if (fmt === '$k')   return '$' + v.toFixed(1) + 'k'
  if (fmt === 'pct')  return v.toFixed(1) + '%'
  if (fmt === 'days') return Math.round(v) + ' days'
  if (fmt === 'f1')   return v.toFixed(1)
  return String(v)
}

// Shared variance calc for MiniStatRow's BUDGET-tagged metrics (2026-07-09) — same formula the
// card itself used before being demoted, factored out here so every mini-stat row (Exec Summary,
// Pace) computes it identically instead of each view re-deriving its own version.
export function budgetVariance(m: { v: number; ly?: number }): { text: string; positive: boolean } | null {
  if (typeof m.ly !== 'number' || m.ly <= 0) return null
  const pct = ((m.v - m.ly) / m.ly) * 100
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, positive: pct >= 0 }
}

export type KpiAccent = 'green' | 'amber' | 'red' | 'neutral'

// 'neutral' — no genuine thG/thY threshold exists for this metric (e.g. a raw portfolio total
// with no target). Renders a quiet stone accent instead of a fabricated verdict.
function rag(m: KpiMetric, sv: number): KpiAccent {
  const { thG, thY } = m
  if (typeof thG !== 'number' || typeof thY !== 'number') return 'neutral'
  const good = m.inv ? sv <= thG : sv >= thG
  const ok   = m.inv ? sv <= thY : sv >= thY
  return good ? 'green' : ok ? 'amber' : 'red'
}

// Bar accent uses a richer gold than theme warning.main (#9A7A3A) for 'amber' specifically — the
// 4px bar carries no text-contrast requirement, and #9A7A3A reads too close to the 'neutral' stone
// (#8A7B65) at a glance, undermining the caution signal it's meant to carry (2026-07-16 design
// pass fix, caught in the final screenshot review). Comparison-line TEXT keeps the darker,
// WCAG-safe warning.main — #CA8A04 fails AA contrast at caption size (see designTokens.ts).
const BAR_ACCENT_COLOR: Record<KpiAccent, string> = {
  green: 'success.main',
  amber: '#CA8A04',
  red: 'error.main',
  neutral: '#8A7B65',
}
const TEXT_ACCENT_COLOR: Record<KpiAccent, string> = {
  green: 'success.main',
  amber: 'warning.main',
  red: 'error.main',
  neutral: '#8A7B65',
}

type Props = {
  metrics: KpiMetric[]
  propMult?: number
  periodMult?: number
}

// Absolute vs. rate diff formatting for the comparison line (2026-07-16 design pass) — absolute
// metrics (counts/currency) get a same-unit $/# diff; rate metrics (pct/f1/days) get a
// point/unit diff instead, since a "$" framing doesn't apply to a percentage or a day count.
function diffText(fmt: string, diff: number): string {
  const sign = diff >= 0 ? '+' : '-'
  const abs = Math.abs(diff)
  if (fmt === 'pct') return `${sign}${abs.toFixed(1)}pts`
  if (fmt === 'days') return `${sign}${Math.round(abs)}d`
  if (fmt === 'f1') return `${sign}${abs.toFixed(1)}`
  return `${sign}${fmtK(abs, fmt)}`
}

// Shared KPI card shape (2026-07-16 design pass) — rounded corners, a colored left-edge accent
// bar (not a full border), bold number, optional comparison line. Used by KpiRow for real
// KpiMetric-driven cards below, and directly by views whose summary numbers have no ly/threshold
// basis yet (Property Performance, Booking Status Movement, Daily) so every view gets the same
// card treatment without fabricating a RAG verdict where none exists.
export function KpiCardShell({
  label, value, caption, accent = 'neutral', comparison, tooltip, labelInfo,
}: {
  label: string
  value: string
  caption?: string
  accent?: KpiAccent
  comparison?: { text: string; color: KpiAccent }
  tooltip?: ReactNode
  labelInfo?: ReactNode
}) {
  const card = (
    <Card sx={{ borderLeft: '4px solid', borderLeftColor: BAR_ACCENT_COLOR[accent], borderRadius: 1.5, height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="overline" sx={{ display: 'block' }}>{label}</Typography>
          {labelInfo && (
            <Tooltip title={labelInfo} arrow>
              <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
            </Tooltip>
          )}
        </Box>
        <Typography
          variant="h4"
          sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 700, fontSize: 34, lineHeight: 1, color: 'text.primary', my: 0.5 }}
        >
          {value}
        </Typography>
        {caption && <Typography variant="caption" sx={{ display: 'block' }}>{caption}</Typography>}
        {comparison && (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.25, fontWeight: 600, color: TEXT_ACCENT_COLOR[comparison.color] }}>
            {comparison.text}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
  return <Grid size={3}>{tooltip ? <Tooltip title={tooltip} placement="top" arrow>{card}</Tooltip> : card}</Grid>
}

export default function KpiRow({ metrics, propMult = 1, periodMult = 1 }: Props) {
  return (
    <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
      {metrics.map((m) => {
        const isRate = m.fmt === 'pct' || m.fmt === 'f1' || m.fmt === 'days'
        const isADR  = m.fmt === '$'
        const ps = isRate || isADR ? 1 + (propMult - 1) * 0.22 : propMult
        const ts = isRate || isADR ? 1 + (periodMult - 1) * 0.015 : periodMult
        const sv  = m.v * ps * ts
        // Only show a YoY % when a real prior-year value exists (m.ly) — never
        // fabricate one. hasLy also excludes ly<=0 to avoid a divide-by-zero/
        // meaningless ratio.
        const hasLy = typeof m.ly === 'number' && m.ly > 0
        const lv = hasLy ? (m.ly as number) * ps * ts : undefined
        const r   = rag(m, sv)
        const chg = hasLy ? ((sv - (lv as number)) / (lv as number)) * 100 : undefined
        const chgStr = chg !== undefined ? (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%' : undefined
        const diffStr = hasLy ? diffText(m.fmt, sv - (lv as number)) : undefined
        const arrow = chg !== undefined ? (chg >= 0 ? '▲' : '▼') : undefined
        const baselineTag = m.stly ? 'STLY' : m.budget ? 'Budget' : 'LY'

        return (
          <KpiCardShell
            key={m.lbl}
            label={m.lbl}
            value={fmtK(sv, m.fmt)}
            caption={m.d}
            accent={r}
            comparison={
              chgStr !== undefined
                ? { text: `${arrow} ${diffStr} (${chgStr}) vs ${baselineTag}`, color: r }
                : undefined
            }
          />
        )
      })}
    </Grid>
  )
}
