/**
 * Design-pass color tokens (2026-07-16) — chart palette and text-safe color
 * variants, kept separate from theme.ts (MUI theme config) and constants.ts
 * (business-logic constants). Every value here is derived from the existing
 * olive/amber/brick/cream system in theme.ts — no new hues introduced.
 *
 * WARNING_TEXT exists because theme.ts's warning.main (#9A7A3A) only clears
 * WCAG AA (4.5:1) against the new #EDEEE6 background at large/bold sizes
 * (3.44:1 contrast) — fine for KPI numbers and accent bars, not for small
 * caption/table text. Use WARNING_TEXT for small amber text; use
 * theme warning.main for large bold numbers, chips, and accent bars.
 */

export const CHART_COLORS = {
  trend: '#B7632A', // primary/terracotta — this-year / actual series
  comparison: '#8A7B65', // warm stone, dashed — LY / STLY reference series
  positive: '#3B6D11', // olive/success — over-budget-good, positive variance
  negative: '#C0392B', // brick/error — under bars, negative variance
  neutral: '#C9BEA9', // divider-tone — reference/target bars (e.g. "Budget")
  budgetGold: '#8A6D1D', // dark gold — target/budget segment in bridge-style charts
  categoryRotation: ['#B7632A', '#4A5A3A', '#8A7B65'], // max 3 tones for multi-category bars
} as const

export const WARNING_TEXT = '#8A6D1D'

// Finance View (Sand River, 2026-07-16) — RAG has a 4th tier here (SKILL.md's "below budget AND
// below last year" case) that the rest of the app's 3-tier success/error/warning doesn't need.
// Kept separate from CHART_COLORS since it's a severity classification, not a series palette.
export const RAG_DEEP_RED = '#7B1A1A'

// Finance's Executive Narrative panel is a deliberately dark sibling to ExecutiveStoryPanel (which
// is light, per Sales Executive Summary) — approved as a distinct, spec'd pattern for this one
// page, not a rollout of dark mode elsewhere. Ink-family tones already used for text.primary, just
// inverted for a dark surface, so it still reads as "this app" rather than a bolted-on component.
export const FINANCE_DARK = {
  bg: '#2A2318',
  headline: '#F5EDD8',
  body: '#A89880',
  eyebrow: '#D4A855',
} as const

// Property-filter spotlight (2026-07-16, "no exceptions" pass) — for any "by property" bar chart
// that must keep showing every property (a ranking/comparison view) while still visibly
// respecting the Topbar's selected property: the selected bar goes solid + gets a dark border,
// everything else dims. Shared here (not per-component) since Property Performance and Sales
// Executive Summary's "Bookings by Property" chart both use the exact same treatment — a future
// third chart should reuse this rather than reinvent its own version.
export const PROPERTY_HIGHLIGHT = {
  bar: '#B7632A',
  dim: 'rgba(183,99,42,0.28)',
  border: '#1F1A14',
} as const
