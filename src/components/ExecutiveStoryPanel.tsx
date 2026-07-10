'use client'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import type { DashboardData } from '@/types'
import { buildExecutiveNarrative } from '@/lib/execNarrative'

// Executive Story Panel (2026-07-09, moved below the KPI row + given elevation 2026-07-16) — sits
// under the 4 KPI cards on Sales Executive Summary (cards first, narrative second, per the design
// pass). Deterministic, template-assembled narrative (see execNarrative.ts) — no LLM involved.
// Rendered as one flowing paragraph rather than separate bullets, since the sentences are meant to
// read as a short briefing, not a checklist. A tasteful drop shadow (not a heavy/skeuomorphic one)
// lifts it slightly above the page, distinguishing it from the flat bordered cards around it.
export default function ExecutiveStoryPanel({ data, property }: { data: DashboardData; property: string }) {
  const sentences = buildExecutiveNarrative(data, property)
  return (
    <Card
      sx={{
        mb: 1.5,
        bgcolor: '#FAF7F0',
        border: '0.5px solid',
        borderColor: 'divider',
        boxShadow: '0 4px 14px rgba(31,26,20,0.09)',
      }}
    >
      <CardContent>
        <Typography variant="overline" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
          Executive Summary
        </Typography>
        <Typography sx={{ fontSize: '0.8125rem', lineHeight: 1.6, color: 'text.primary' }}>
          {sentences.map((s, i) => (
            <Box component="span" key={i}>
              {s}{i < sentences.length - 1 ? ' ' : ''}
            </Box>
          ))}
        </Typography>
      </CardContent>
    </Card>
  )
}
