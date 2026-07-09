'use client'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Skeleton from '@mui/material/Skeleton'

// Loading state (2026-07-16 design pass) — shaped like the real layouts views settle into, so the
// page doesn't visually jump when data arrives. Matters more than usual here: cold-load can run
// 35-95s+ under DB contention (see project_performance_investigation memory) — a bare spinner for
// that long reads as broken, a shaped skeleton reads as "loading a real page."
export function KpiCardSkeletonRow() {
  return (
    <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
      {[0, 1, 2, 3].map((i) => (
        <Grid size={3} key={i}>
          <Card sx={{ borderLeft: '4px solid', borderLeftColor: '#C9BEA9', borderRadius: 1.5, height: '100%' }}>
            <CardContent>
              <Skeleton variant="text" width="55%" height={14} />
              <Skeleton variant="text" width="70%" height={40} sx={{ my: 0.5 }} />
              <Skeleton variant="text" width="80%" height={14} />
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  )
}

export function ChartSkeletonRow() {
  return (
    <Grid container spacing={1.5}>
      {[0, 1].map((i) => (
        <Grid size={6} key={i}>
          <Card>
            <CardContent>
              <Skeleton variant="text" width="35%" height={20} sx={{ mb: 1 }} />
              <Skeleton variant="rounded" width="100%" height={180} />
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  )
}

export function TableSkeletonBlock({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <CardContent>
        <Skeleton variant="text" width="30%" height={20} sx={{ mb: 1 }} />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} variant="text" width="100%" height={26} />
        ))}
      </CardContent>
    </Card>
  )
}

export default function DashboardSkeleton() {
  return (
    <Box>
      <KpiCardSkeletonRow />
      <ChartSkeletonRow />
    </Box>
  )
}
