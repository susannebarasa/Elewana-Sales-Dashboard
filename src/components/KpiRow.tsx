'use client'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import type { KpiMetric } from '@/types'

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

function rag(m: KpiMetric, sv: number): 'green' | 'amber' | 'red' {
  const good = m.inv ? sv <= m.thG : sv >= m.thG
  const ok   = m.inv ? sv <= m.thY : sv >= m.thY
  return good ? 'green' : ok ? 'amber' : 'red'
}

type Props = {
  metrics: KpiMetric[]
  propMult?: number
  periodMult?: number
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

        const borderColor = r === 'green' ? 'success.main' : r === 'red' ? 'error.main' : 'warning.main'
        const bgColor     = r === 'green' ? '#F2F8EE'       : r === 'red' ? '#FEF2F2'    : '#FDF8EE'
        const chgColor    = r === 'green' ? 'success.main'  : r === 'red' ? 'error.main' : 'warning.main'

        return (
          <Grid size={3} key={m.lbl}>
            <Card sx={{ border: '0.5px solid', borderColor, bgcolor: bgColor, borderRadius: 1.5, height: '100%' }}>
              <CardContent>
                <Typography variant="overline" sx={{ display: 'block' }}>{m.lbl}</Typography>
                <Typography
                  variant="h4"
                  sx={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontSize: 34, lineHeight: 1, color: 'text.primary', my: 0.5 }}
                >
                  {fmtK(sv, m.fmt)}
                </Typography>
                <Typography variant="caption">
                  {m.d}
                  {chgStr !== undefined && (
                    <>
                      {' '}·{' '}
                      {m.stly && (
                        <Box
                          component="span"
                          sx={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: 'text.secondary', border: '0.5px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.4, mr: 0.5, verticalAlign: 1 }}
                        >
                          STLY
                        </Box>
                      )}
                      {m.budget && (
                        <Box
                          component="span"
                          sx={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: 'text.secondary', border: '0.5px solid', borderColor: 'divider', borderRadius: 0.5, px: 0.4, mr: 0.5, verticalAlign: 1 }}
                        >
                          BUDGET
                        </Box>
                      )}
                      <Box component="span" sx={{ fontWeight: 700, color: chgColor }}>
                        {chgStr}
                      </Box>
                    </>
                  )}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )
      })}
    </Grid>
  )
}
