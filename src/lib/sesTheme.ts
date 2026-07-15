// Design tokens for the Sales Executive Summary page — lifted verbatim from the Claude Design
// export's :root CSS block ("Elewana Sales Executive Summary.html"). Hoisted out of
// SalesExecutiveSummaryDesign.tsx (2026-07-16c, progressive-loading pass) so SesSkeleton.tsx can
// share the exact same palette instead of maintaining an independent copy that could drift.
export const T = {
  bg: '#EDEEE6', cd: '#FAF6EC', sf: '#F3EFE6',
  rg: '#3B6D11', ra: '#CA8A04', rr: '#C0392B', br: '#C9BEA9',
  oc: '#B7632A', ocl: '#FAEEDA', ocd: '#854F0B', ly: '#A7997F', dk: '#2A2318',
  ink: '#1F1A14', ink2: '#3A3026', mu: '#6B5F50',
  se: '"Cormorant Garamond", Georgia, serif',
  sa: 'Inter, system-ui, sans-serif',
  mo: '"JetBrains Mono", monospace',
} as const
