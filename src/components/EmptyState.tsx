'use client'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

// Empty state (2026-07-16 design pass) — same rounded/left-accent card shell as a populated KPI
// card, neutral stone accent (there's no RAG verdict on an absence of data), one-line message
// instead of a blank chart or $0.
export default function EmptyState({ message, height = 120 }: { message: string; height?: number }) {
  return (
    <Card sx={{ borderLeft: '4px solid', borderLeftColor: '#8A7B65', borderRadius: 1.5 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, height, color: 'text.secondary' }}>
          <InfoOutlinedIcon sx={{ fontSize: 18 }} />
          <Typography variant="caption">{message}</Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
