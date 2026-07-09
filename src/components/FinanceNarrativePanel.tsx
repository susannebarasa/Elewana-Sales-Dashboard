'use client'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import type { FinanceNarrative } from '@/lib/sandRiverFinance'
import { FINANCE_DARK } from '@/lib/designTokens'

// Finance Executive Narrative (2026-07-16) — deliberate dark sibling to ExecutiveStoryPanel
// (Sales Executive Summary's version is a light card, plain paragraph, no pills). Approved as a
// distinct, spec'd pattern for this one page rather than a reuse of that component — see
// FINANCE_DARK in designTokens.ts for why these particular tones were chosen (inverted ink
// family, not a new unrelated palette).
export default function FinanceNarrativePanel({ narrative }: { narrative: FinanceNarrative | null }) {
  return (
    <Card
      sx={{
        mb: 1.5,
        bgcolor: FINANCE_DARK.bg,
        border: '0.5px solid',
        borderColor: 'rgba(255,255,255,0.08)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
      }}
    >
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={8}>
            <Typography
              variant="overline"
              sx={{ display: 'block', mb: 0.5, color: FINANCE_DARK.eyebrow, letterSpacing: '0.18em' }}
            >
              Executive Summary
            </Typography>
            {narrative ? (
              <>
                <Typography
                  sx={{
                    fontFamily: '"Cormorant Garamond", Georgia, serif',
                    fontWeight: 600,
                    fontSize: 20,
                    color: FINANCE_DARK.headline,
                    mb: 0.75,
                  }}
                >
                  {narrative.headline}
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', lineHeight: 1.75, color: FINANCE_DARK.body }}>
                  {narrative.body}
                </Typography>
              </>
            ) : (
              <Typography sx={{ fontSize: '0.75rem', lineHeight: 1.75, color: FINANCE_DARK.body, fontStyle: 'italic' }}>
                No data loaded yet — the narrative will summarize this period once Sand River&apos;s MIS figures are imported.
              </Typography>
            )}
          </Grid>
          <Grid size={4}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, height: '100%', justifyContent: 'center' }}>
              {(narrative?.pills ?? []).length > 0 ? (
                narrative!.pills.map((p, i) => (
                  <Box key={i} sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 18, color: FINANCE_DARK.headline }}>
                      {p.value}
                    </Typography>
                    <Typography sx={{ fontSize: '0.625rem', color: FINANCE_DARK.body }}>{p.label}</Typography>
                  </Box>
                ))
              ) : (
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 18, color: FINANCE_DARK.body }}>
                    —
                  </Typography>
                  <Typography sx={{ fontSize: '0.625rem', color: FINANCE_DARK.body }}>NDL — no data loaded</Typography>
                </Box>
              )}
            </Box>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  )
}
