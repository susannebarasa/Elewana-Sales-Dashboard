'use client'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'

export const DRAWER_WIDTH = 200

const NAV = [
  {
    group: 'ANALYTICS',
    items: [
      { id: 'sales', label: 'Sales' },
      { id: 'marketing', label: 'Marketing' },
      { id: 'ops', label: 'Operations' },
    ],
  },
  {
    group: 'EXPERIENCE',
    items: [
      { id: 'gex', label: 'Guest Experience' },
      { id: 'finance', label: 'Finance' },
      { id: 'mis', label: 'MIS' },
    ],
  },
]

type Props = { view: string; onView: (v: string) => void }

export default function Sidebar({ view, onView }: Props) {
  return (
    <Drawer
      variant="permanent"
      slotProps={{
        paper: {
          sx: {
            width: DRAWER_WIDTH,
            bgcolor: 'background.paper',
            borderRight: '0.5px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        },
      }}
    >
      {/* Brand */}
      <Box sx={{ px: 2, pt: 2.25, pb: 1.75, borderBottom: '0.5px solid', borderColor: 'divider' }}>
        <Typography
          sx={{
            fontFamily: '"Cormorant Garamond", Georgia, serif',
            fontSize: 26,
            fontWeight: 500,
            color: 'text.primary',
            lineHeight: 1,
          }}
        >
          Elewana
        </Typography>
        <Typography
          sx={{
            fontSize: '0.5rem',
            fontWeight: 600,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'primary.main',
            mt: 0.5,
          }}
        >
          Collection
        </Typography>
      </Box>

      {/* Nav groups */}
      {NAV.map(({ group, items }) => (
        <List
          key={group}
          disablePadding
          subheader={
            <ListSubheader
              disableSticky
              sx={{
                fontSize: '0.53rem',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'text.secondary',
                lineHeight: 1,
                pt: 1.5,
                pb: 0.75,
                px: 2,
                bgcolor: 'transparent',
              }}
            >
              {group}
            </ListSubheader>
          }
        >
          {items.map(({ id, label }) => (
            <ListItemButton
              key={id}
              selected={view === id}
              onClick={() => onView(id)}
              sx={{ gap: 1, py: 1, px: 2 }}
            >
              <Box
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  bgcolor: view === id ? 'primary.main' : 'text.secondary',
                  opacity: view === id ? 1 : 0.5,
                  flexShrink: 0,
                }}
              />
              <ListItemText
                primary={label}
                slotProps={{ primary: { sx: { fontSize: '0.78rem' } } }}
              />
            </ListItemButton>
          ))}
        </List>
      ))}

      {/* Footer */}
      <Box sx={{ mt: 'auto' }}>
        <Divider />
        <Typography
          sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.5625rem',
            color: 'text.secondary',
            px: 2,
            py: 1.25,
            letterSpacing: '0.04em',
          }}
        >
          ResRequest Sync · live
        </Typography>
      </Box>
    </Drawer>
  )
}
