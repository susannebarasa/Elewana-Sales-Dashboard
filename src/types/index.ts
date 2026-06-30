export interface PaceData {
  months: string[]
  actual: number[]
  ly: number[]
}

export interface PipelineFutureItem {
  mo: string
  cf: number
  pv: number
  wt: number
  cv: string
  pval: string
  bg: number
}

export interface OccupancyData {
  props: { nm: string; oc: number; ar: number }[]
  arr: { months: string[]; act: number[]; ly: number[] }
}

export interface AgentYearly {
  nm: string
  rv: number
  nt: number
  nr_adr: number
  r_adr: number
  ch: string
  up: boolean
  cg: string
}

export interface AgentData {
  yearly: AgentYearly[]
  byProp: { pr: string; rv: number; ly: number }[]
  byMonth: { months: string[]; act: number[]; ly: number[] }
  occByMonth: { months: string[]; act: number[]; ly: number[] }
  adr: { months: string[]; nr: number[]; res: number[] }
  ch: { lb: string; v: number; co: string }[]
}

export interface PipelineFunnelItem {
  st: string
  ct: number
  vl: string
  pc: number
}

export interface PipelineTableItem {
  ag: string
  pr: string
  ci: string
  nt: number
  vl: string
  st: string
}

export interface ConsultantItem {
  nm: string
  bk: number
  rv: number
  cv: string
  cg: string
  up: boolean
}

export interface KpiMetric {
  v: number
  fmt: string
  lbl: string
  d: string
  thG: number
  thY: number
  inv?: boolean
}

export interface KpiBase {
  pace: {
    bookings: KpiMetric
    rev: KpiMetric
    idx: KpiMetric
    lead: KpiMetric
  }
  occ: {
    nights: KpiMetric
    adr: KpiMetric
    rev: KpiMetric
    cancel: KpiMetric
  }
  agents: {
    active: KpiMetric
    arev: KpiMetric
    nradr: KpiMetric
    radr: KpiMetric
  }
  pipeline: {
    val: KpiMetric
    opps: KpiMetric
    conv: KpiMetric
    avg: KpiMetric
  }
  consult: {
    n: KpiMetric
    bkgs: KpiMetric
    avg: KpiMetric
    top: KpiMetric
  }
}

export interface DashboardData {
  PD: PaceData
  PF: PipelineFutureItem[]
  OD: OccupancyData
  AD: AgentData
  PLF: PipelineFunnelItem[]
  PLT: PipelineTableItem[]
  CD: ConsultantItem[]
  KP_BASE: KpiBase
  lastUpdated: string
}
