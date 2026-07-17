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

// 9-slot categorical palette (2026-07-17, Market Segment donut) — this app's existing
// CHART_COLORS above tops out at 3 tones (categoryRotation), enough for the RAG/trend charts
// elsewhere but not for a 9-way identity chart (the Market Segment donut shows all 9 segments,
// no folding into "Other" — a fixed product requirement, not a design choice this palette could
// sidestep by capping series count the way the dataviz skill's own default guidance prefers).
// Colors picked and validated with the dataviz skill's scripts/validate_palette.js against this
// app's actual card surface (#FAF6EC, theme.ts's background.paper): the fixed-order/adjacent
// pairlist (the relevant check here, since color follows segment IDENTITY, not sort rank — a
// segment keeps its color as revenue changes and the sort reorders) passes every hard gate
// (lightness band, chroma floor, adjacent CVD >= 6, normal-vision floor >= 15) except gold
// sitting at 2.2:1 contrast (WARN — mitigated below).
// NOT achievable at 9 slots, confirmed via the validator's own --pairs all mode: true all-pairs
// CVD safety, where literally any two segments could end up visually adjacent post-sort. The
// skill's own reference 8-hue palette hits this same ceiling at 4 slots — this isn't a palette
// this session failed to find, it's a documented limit of how many hues the human eye (aided by
// simulated colorblindness) can tell apart unaided. Mitigation, per the skill's own prescription
// for floor-band CVD: secondary encoding — the donut's legend directly labels every segment by
// name + % (never color-only identity), and its tooltip states the exact revenue + % in text.
export const MARKET_SEGMENT_COLORS: Record<string, string> = {
  'INT. AGENT': '#B7632A',
  'DMC': '#1E88C4',
  'DMC (International Presence)': '#C62839',
  'INT. DIRECT': '#0E8C7A',
  'LOCAL DIRECT': '#D4A017',
  'CLOSED USER GROUPS': '#6A3FA0',
  'DIGITAL': '#2E7D32',
  'STAFF STAYS': '#B23E7A',
  'Unallocated': '#6B7A1E',
}

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
