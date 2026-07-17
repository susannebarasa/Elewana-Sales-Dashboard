/**
 * View-scoped dashboard query sets (2026-07-09).
 *
 * Cold load used to run all ~67 queries for every tab. Each Sales sub-tab now
 * requests only the query IDs it needs. `all` keeps the previous full batch for
 * debugging / cache warmers.
 *
 * Query IDs match the named results destructured from the main batch in
 * src/app/api/dashboard/route.ts. `marketSegments` is the separate 9-query
 * market-segment batch.
 */

export const DASHBOARD_VIEWS = [
  'exec-summary',
  'sales-exec-summary',
  'sales-exec-summary-kpis',
  'sales-exec-summary-charts',
  'sales-exec-summary-leaderboard',
  'property-performance',
  'market-segment-performance',
  'booking-status-movement',
  'tp',
  'pace',
  'occ',
  'pl',
  'cn',
  'all',
] as const

export type DashboardView = (typeof DASHBOARD_VIEWS)[number]

/** Main-batch query IDs (58) + marketSegments flag. */
export type DashboardQueryId =
  | 'pdRows'
  | 'pfRows'
  | 'ocPropRows'
  | 'arrRows'
  | 'dayUseArrRows'
  | 'agRows'
  | 'dayUseAgentRows'
  | 'agLyRows'
  | 'agPropRows'
  | 'dayUsePropRows'
  | 'agMonthRows'
  | 'dayUseAgentMonthRows'
  | 'occMonthRows'
  | 'adrRows'
  | 'chRows'
  | 'plfRow'
  | 'ytdRow'
  | 'pltRows'
  | 'cdRows'
  | 'kpiConfirmed'
  | 'kpiRevNights'
  | 'kpiTotalRevFullYear'
  | 'kpiBudgetActual'
  | 'budgetActualByPropRows'
  | 'kpiAgents'
  | 'kpiPipeline'
  | 'kpiLead'
  | 'kpiAgentRev'
  | 'kpiConsult'
  | 'kpiLyBkgs'
  | 'kpiAgentsLy'
  | 'kpiAgentRevLy'
  | 'kpiRevNightsLy'
  | 'kpiLeadLy'
  | 'kpiConsultLy'
  | 'cdLyRows'
  | 'kpiConfirmedBounded'
  | 'kpiConfirmedStly'
  | 'kpiPipelineStly'
  | 'kpiCancel'
  | 'kpiCancelLy'
  | 'kpiForecastTargetRows'
  | 'kpiForecastStlyRows'
  | 'kpiForecastPace'
  | 'kpiForecastCancelLyFullYear'
  | 'revparNightsRows'
  | 'agentPaceRows'
  | 'cancelDriverNightsRows'
  | 'cancelDriverRevRows'
  | 'lowSeasonByAgentRows'
  | 'agentPropCountRows'
  | 'agentConversionRows'
  | 'extrasByPropRows'
  | 'dayUseExtrasByPropRows'
  | 'bookingConfirmedProvisionalByMonth'
  | 'bookingCancelledByMonth'
  | 'bookingNewConfirmedByMonth'
  | 'bookingConversionRow'
  | 'marketSegments'
  | 'agentTotalsRow'
  | 'agentTotalsLyRow'

export const ALL_QUERY_IDS: readonly DashboardQueryId[] = [
  'pdRows',
  'pfRows',
  'ocPropRows',
  'arrRows',
  'dayUseArrRows',
  'agRows',
  'dayUseAgentRows',
  'agLyRows',
  'agPropRows',
  'dayUsePropRows',
  'agMonthRows',
  'dayUseAgentMonthRows',
  'occMonthRows',
  'adrRows',
  'chRows',
  'plfRow',
  'ytdRow',
  'pltRows',
  'cdRows',
  'kpiConfirmed',
  'kpiRevNights',
  'kpiTotalRevFullYear',
  'kpiBudgetActual',
  'budgetActualByPropRows',
  'kpiAgents',
  'kpiPipeline',
  'kpiLead',
  'kpiAgentRev',
  'kpiConsult',
  'kpiLyBkgs',
  'kpiAgentsLy',
  'kpiAgentRevLy',
  'kpiRevNightsLy',
  'kpiLeadLy',
  'kpiConsultLy',
  'cdLyRows',
  'kpiConfirmedBounded',
  'kpiConfirmedStly',
  'kpiPipelineStly',
  'kpiCancel',
  'kpiCancelLy',
  'kpiForecastTargetRows',
  'kpiForecastStlyRows',
  'kpiForecastPace',
  'kpiForecastCancelLyFullYear',
  'revparNightsRows',
  'agentPaceRows',
  'cancelDriverNightsRows',
  'cancelDriverRevRows',
  'lowSeasonByAgentRows',
  'agentPropCountRows',
  'agentConversionRows',
  'extrasByPropRows',
  'dayUseExtrasByPropRows',
  'bookingConfirmedProvisionalByMonth',
  'bookingCancelledByMonth',
  'bookingNewConfirmedByMonth',
  'bookingConversionRow',
  'marketSegments',
  'agentTotalsRow',
  'agentTotalsLyRow',
] as const

/**
 * Per-view query sets. Derived from which DashboardData keys each view reads
 * (see src/components/views/*) plus ExecutiveStoryPanel's narrative deps for
 * exec-summary (REVPAR, AGENT_PACE, CANCEL_DRIVERS, FORECAST/execPace).
 */
export const VIEW_QUERY_IDS: Record<DashboardView, readonly DashboardQueryId[]> = {
  'exec-summary': [
    'pdRows',
    'ocPropRows',
    'kpiConfirmed',
    'kpiRevNights',
    'kpiRevNightsLy',
    'kpiLyBkgs',
    'kpiBudgetActual',
    // Full Year vs Budget fix (2026-07-16e) — KP_BASE.pace.budgetFullYear (execNarrative.ts's
    // sentence1, period==='a') needs kpiTotalRevFullYear's booking-inclusive, monthLo/monthHi-
    // bound total. Without it here, this view's own qOne('kpiTotalRevFullYear') silently returns
    // null -> totalRevFullYearM=0 -> a $0 Full Year figure, not the intended fix.
    'kpiTotalRevFullYear',
    'budgetActualByPropRows',
    'revparNightsRows',
    'kpiForecastTargetRows',
    'kpiForecastStlyRows',
    'kpiForecastPace',
    'kpiForecastCancelLyFullYear',
    'agentPaceRows',
    'cancelDriverNightsRows',
    'cancelDriverRevRows',
  ],
  pace: [
    'pdRows',
    'pfRows',
    'ocPropRows',
    'kpiConfirmed',
    'kpiRevNights',
    'kpiRevNightsLy',
    'kpiLyBkgs',
    'kpiLead',
    'kpiLeadLy',
    'kpiConfirmedBounded',
    'kpiConfirmedStly',
    'kpiBudgetActual',
    'budgetActualByPropRows',
    'kpiForecastTargetRows',
    'kpiForecastStlyRows',
    'kpiForecastPace',
    'kpiForecastCancelLyFullYear',
  ],
  occ: [
    'ocPropRows',
    'arrRows',
    'dayUseArrRows',
    'kpiRevNights',
    'kpiRevNightsLy',
    'kpiCancel',
    'kpiCancelLy',
    'budgetActualByPropRows',
    'revparNightsRows',
  ],
  tp: [
    'agRows',
    'dayUseAgentRows',
    'agLyRows',
    'agPropRows',
    'dayUsePropRows',
    'agMonthRows',
    'dayUseAgentMonthRows',
    'occMonthRows',
    'adrRows',
    'chRows',
    'kpiAgents',
    'kpiAgentRev',
    'kpiAgentsLy',
    'kpiAgentRevLy',
    'kpiTotalRevFullYear',
    'agentPaceRows',
    'cancelDriverNightsRows',
    'cancelDriverRevRows',
    'lowSeasonByAgentRows',
    'agentPropCountRows',
    'agentConversionRows',
  ],
  pl: [
    'plfRow',
    'ytdRow',
    'pltRows',
    'kpiConfirmed',
    'kpiPipeline',
    'kpiConfirmedBounded',
    'kpiConfirmedStly',
    'kpiPipelineStly',
  ],
  // Sales Executive Summary standalone page (2026-07-16) — ADDITIVE, 'exec-summary' (KPI/
  // narrative/pace) plus ONLY the 'tp' query IDs that actually feed AD.yearly (the agent
  // leaderboard) and AD.byProp (the segment-scoped by-property chart) — the two AD fields
  // SalesExecutiveSummaryDesign.tsx actually reads. Trimmed 2026-07-16 (load-time fix): the
  // page was pulling the FULL 'tp' bundle (20 query IDs), including agMonthRows/
  // dayUseAgentMonthRows/occMonthRows/adrRows/chRows (feed AD.byMonth/occByMonth/adr/ch —
  // unused, no monthly agent-revenue or channel-mix chart on this page), kpiAgents/
  // kpiAgentRev/kpiAgentsLy/kpiAgentRevLy/kpiTotalRevFullYear (feed KP_BASE.agents — this
  // page never reads kp.agents, only kp.occ/kp.pace/kp.execPace), and lowSeasonByAgentRows
  // (feeds LOW_SEASON_AGENTS — not rendered here). Per the DB-contention finding (cold-load
  // is DB-side, not connection-pool-bound — see project_performance_investigation memory),
  // fewer concurrent queries directly helps every cold hit, not just cache-warm ones.
  'sales-exec-summary': [
    'pdRows',
    'ocPropRows',
    'kpiConfirmed',
    'kpiRevNights',
    'kpiRevNightsLy',
    'kpiLyBkgs',
    'kpiBudgetActual',
    // Full Year vs Budget fix (2026-07-16e) — see 'exec-summary' comment above; needed for
    // KP_BASE.pace.budgetFullYear, now read by execNarrative.ts's sentence1 for period==='a'.
    'kpiTotalRevFullYear',
    'budgetActualByPropRows',
    'revparNightsRows',
    'kpiForecastTargetRows',
    'kpiForecastStlyRows',
    'kpiForecastPace',
    'kpiForecastCancelLyFullYear',
    'agentPaceRows',
    'cancelDriverNightsRows',
    'cancelDriverRevRows',
    'agRows',
    'dayUseAgentRows',
    'agLyRows',
    'agPropRows',
    'dayUsePropRows',
    'agentPropCountRows',
    'agentConversionRows',
  ],
  // Sales Executive Summary progressive-load split (2026-07-16b) — the page is moving to 3
  // parallel fetches so sections render as they arrive, fastest first. Each view's ID list was
  // derived by tracing, in route.ts, exactly which query-result variables feed the DashboardData
  // fields SalesExecutiveSummaryDesign.tsx and execNarrative.ts actually read (grepped both files
  // line by line — not copied from 'sales-exec-summary' above, which is intentionally broader).
  // Notably: FORECAST, top-level REVPAR, and CANCEL_DRIVERS are read by NEITHER file (kp.occ.revpar
  // is a KP_BASE field, not top-level REVPAR.byProperty) — their underlying queries are excluded
  // from all 3 views below even though 'sales-exec-summary' (unsplit) still fetches them for
  // parity with 'exec-summary'. LOW_SEASON_AGENTS is likewise unread here (only AgentsView.tsx's
  // 'tp' view reads it) — excluded from every new view's IDs and DATA_KEYS.
  'sales-exec-summary-kpis': [
    // KP_BASE.occ.rev/nights/adr (+ YoY ly counterparts)
    'kpiRevNights',
    'kpiRevNightsLy',
    // KP_BASE.occ.revpar/occPct (portfolio-aggregate RevPAR/Occ%, actual + budget-target side)
    'budgetActualByPropRows',
    'revparNightsRows',
    // KP_BASE.pace.budgetMtd/budgetYtd + KP_BASE.execPace.vsBudget (also sentence1 of the
    // narrative, which reads these same two fields)
    'kpiBudgetActual',
    // KP_BASE.pace.budgetFullYear (2026-07-16e fix) — sentence1's period==='a' branch, added
    // alongside kpiBudgetActual above because the previous Full-Year-reuses-YTD bug meant no
    // genuine full-year figure was ever read here.
    'kpiTotalRevFullYear',
    // AGENT_PACE.gainers/decliners — sentence2 of the narrative (execNarrative.ts)
    'agentPaceRows',
  ],
  'sales-exec-summary-charts': [
    // PD (Monthly Revenue Trend line chart)
    'pdRows',
    // BUDGET.occByProperty (Revenue & Occupancy by Property chart, 2026-07-17 — replaces the old
    // By Property chart, which read OD.props/AD.byProp, both dropped below). Same two queries
    // 'sales-exec-summary-kpis' already fetches for KP_BASE.occ.revpar/occPct — traced in
    // route.ts: budgetOccByProperty <- revparByProperty <- actualByPropMap (budgetActualByPropRows)
    // + revparNightsMap (revparNightsRows) + PROPERTY_ROOM_COUNTS/getPropertyBudget (static).
    'budgetActualByPropRows',
    'revparNightsRows',
    // ocPropRows (OD.props) / agPropRows+dayUsePropRows (AD.byProp) dropped (2026-07-17) — both
    // only fed the old By Property chart's two display modes, now removed.
    // MARKET_SEGMENT_PERFORMANCE (Room Revenue by Market Segment donut, moved here 2026-07-17 from
    // Market Segment Performance's own tab, per explicit correction) — same separate 9-query
    // market-segment batch 'market-segment-performance' already fetches, run concurrently
    // alongside the main query batch (see route.ts's Promise.all), not sequentially after it.
    'marketSegments',
  ],
  'sales-exec-summary-leaderboard': [
    // AD.yearly (+ new AD.yearlyDirectory, see Task 2) — agRows is the base row set,
    // agLyRows/dayUseAgentRows/agentPropCountRows/agentConversionRows are the per-agent Maps
    // merged into each row (LY revenue, Day Use extras, Properties Produced, Conversion Rate).
    'agRows',
    'agLyRows',
    'dayUseAgentRows',
    'agentPropCountRows',
    'agentConversionRows',
    // AD.totals (2026-07-16g, leaderboard footer) — agentTotalsRow/agentTotalsLyRow mirror
    // agRows' own rv+lg join structure exactly (same r.date_created basis, same status splits,
    // same AND_A/AND_P scoping) but aggregate instead of per-agent, so the footer is a genuine
    // full-population total (not capped to the visible top 150), reconcilable with agRows' own
    // rv_raw/nt values — not a reuse of the Trade Partners KPI cards, which use a different
    // (i.date_in) date basis and would not sum-reconcile with what the table actually shows.
    'agentTotalsRow',
    'agentTotalsLyRow',
  ],
  cn: ['cdRows', 'cdLyRows', 'kpiConsult', 'kpiConsultLy', 'kpiAgentRev', 'kpiAgentRevLy'],
  'property-performance': [
    'budgetActualByPropRows',
    'revparNightsRows',
    'extrasByPropRows',
    'dayUseExtrasByPropRows',
    'kpiRevNights',
    'kpiRevNightsLy',
  ],
  'market-segment-performance': ['marketSegments'],
  'booking-status-movement': [
    'bookingConfirmedProvisionalByMonth',
    'bookingCancelledByMonth',
    'bookingNewConfirmedByMonth',
    'bookingConversionRow',
  ],
  all: ALL_QUERY_IDS,
}

export function parseDashboardView(raw: string | null): DashboardView {
  if (raw && (DASHBOARD_VIEWS as readonly string[]).includes(raw)) {
    return raw as DashboardView
  }
  return 'exec-summary'
}

export function queryIdsForView(view: DashboardView): Set<DashboardQueryId> {
  return new Set(VIEW_QUERY_IDS[view])
}

/** Top-level DashboardData keys each view owns (for client-side merge). */
export const VIEW_DATA_KEYS: Record<Exclude<DashboardView, 'all'>, readonly string[]> = {
  'exec-summary': [
    'PD', 'OD', 'KP_BASE', 'REVPAR', 'FORECAST', 'AGENT_PACE', 'CANCEL_DRIVERS', 'lastUpdated',
  ],
  pace: ['PD', 'PF', 'OD', 'KP_BASE', 'BUDGET', 'FORECAST', 'lastUpdated'],
  occ: ['OD', 'KP_BASE', 'REVPAR', 'lastUpdated'],
  tp: ['AD', 'KP_BASE', 'AGENT_PACE', 'CANCEL_DRIVERS', 'LOW_SEASON_AGENTS', 'lastUpdated'],
  'sales-exec-summary': [
    'PD', 'OD', 'KP_BASE', 'REVPAR', 'FORECAST', 'AGENT_PACE', 'CANCEL_DRIVERS', 'AD', 'LOW_SEASON_AGENTS', 'lastUpdated',
  ],
  // KP_BASE feeds the 4 KPI cards + narrative panel; AGENT_PACE feeds narrative sentence2 only
  // (execNarrative.ts) — REVPAR/FORECAST/CANCEL_DRIVERS/LOW_SEASON_AGENTS are genuinely unread,
  // see the VIEW_QUERY_IDS comment above.
  'sales-exec-summary-kpis': ['KP_BASE', 'AGENT_PACE', 'lastUpdated'],
  // PD feeds the Monthly Revenue Trend chart; BUDGET feeds the Revenue & Occupancy by Property
  // chart (2026-07-17, replaces the old By Property chart — OD/AD no longer read here);
  // MARKET_SEGMENT_PERFORMANCE feeds the Room Revenue by Market Segment donut (2026-07-17,
  // relocated here from the Market Segment Performance tab).
  'sales-exec-summary-charts': ['PD', 'BUDGET', 'MARKET_SEGMENT_PERFORMANCE', 'lastUpdated'],
  // AD only — AD.yearly (capped 150) + AD.yearlyDirectory (all agents, light fields) feed the
  // Agent Leaderboard table and the Find Agent search respectively (see Task 2).
  'sales-exec-summary-leaderboard': ['AD', 'lastUpdated'],
  pl: ['PLF', 'YTD_ARR', 'PLT', 'KP_BASE', 'lastUpdated'],
  cn: ['CD', 'KP_BASE', 'lastUpdated'],
  'property-performance': ['PROPERTY_PERFORMANCE', 'KP_BASE', 'lastUpdated'],
  'market-segment-performance': ['MARKET_SEGMENT_PERFORMANCE', 'lastUpdated'],
  'booking-status-movement': ['BOOKING_STATUS_MOVEMENT', 'lastUpdated'],
}
