'use client'
import { createTheme } from '@mui/material/styles'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary:   { main: '#B7632A', light: '#FAEEDA', dark: '#854F0B', contrastText: '#fff' },
    secondary: { main: '#4A5A3A', light: '#EAF3DE', dark: '#27500A', contrastText: '#fff' },
    success:   { main: '#3B6D11' },
    error:     { main: '#C0392B' },
    warning:   { main: '#9A7A3A' },
    background: { default: '#F5F0E8', paper: '#FAF6EC' },
    text: { primary: '#1F1A14', secondary: '#6B5F50', disabled: '#A0917E' },
    divider: '#C9BEA9',
  },
  typography: {
    fontFamily: '"Inter", system-ui, sans-serif',
    h1: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500 },
    h2: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500 },
    h3: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500 },
    h4: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500 },
    h5: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500 },
    h6: { fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500 },
    body1: { fontSize: '0.8125rem' },
    body2: { fontSize: '0.75rem' },
    caption: { fontSize: '0.6875rem', color: '#6B5F50' },
    overline: { fontSize: '0.625rem', letterSpacing: '0.1em', color: '#6B5F50' },
    button: { fontFamily: '"Inter", system-ui, sans-serif', textTransform: 'none', fontWeight: 500 },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '@import': "url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap')",
        html: { height: '100%' },
        body: { height: '100%', overflowX: 'hidden' },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
      defaultProps: { elevation: 0 },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: '0.5px solid #C9BEA9', backgroundColor: '#FAF6EC' },
      },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: '14px', '&:last-child': { paddingBottom: '14px' } } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B5F50', borderBottomColor: '#C9BEA9', padding: '4px 10px 6px' },
        body: { fontSize: '0.6875rem', fontFamily: '"JetBrains Mono", monospace', borderBottomColor: 'rgba(201,190,169,0.4)', padding: '5px 10px' },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: '#C9BEA9' } } },
    MuiChip: {
      styleOverrides: { root: { height: 20, fontSize: '0.625rem', fontWeight: 600 } },
    },
    MuiTab: {
      styleOverrides: {
        root: { fontSize: '0.6875rem', fontWeight: 500, textTransform: 'none', minHeight: 38, padding: '6px 14px' },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: { fontSize: '0.625rem', fontWeight: 500, padding: '3px 10px', textTransform: 'none', border: 'none', borderRadius: '3px !important' },
      },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        select: { fontSize: '0.6875rem', padding: '4px 8px' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 3, height: 8, backgroundColor: '#F5F0E8' },
        bar: { borderRadius: 3 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          borderLeft: '2px solid transparent',
          padding: '8px 16px',
          fontSize: '0.78rem',
          '&.Mui-selected': {
            backgroundColor: '#FAEEDA',
            borderLeftColor: '#B7632A',
            color: '#854F0B',
            '&:hover': { backgroundColor: '#FAEEDA' },
          },
          '&:hover': { backgroundColor: '#F5F0E8' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: { borderColor: '#C9BEA9' },
      },
    },
  },
})

export default theme
