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
  pl: ['PLF', 'YTD_ARR', 'PLT', 'KP_BASE', 'lastUpdated'],
  cn: ['CD', 'KP_BASE', 'lastUpdated'],
  'property-performance': ['PROPERTY_PERFORMANCE', 'KP_BASE', 'lastUpdated'],
  'market-segment-performance': ['MARKET_SEGMENT_PERFORMANCE', 'lastUpdated'],
  'booking-status-movement': ['BOOKING_STATUS_MOVEMENT', 'lastUpdated'],
}
