export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import type { DashboardData } from '@/types'

// ── helpers ──────────────────────────────────────────────────────────────────
const n = (v: unknown, def = 0): number => {
  const f = parseFloat(String(v ?? def))
  return isFinite(f) ? f : def
}
const i = (v: unknown, def = 0): number => Math.round(n(v, def))

const fmtM = (v: number): string =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`

const signedPct = (cur: number, prev: number): string => {
  if (!prev) return '+0%'
  const p = Math.round(((cur - prev) / prev) * 100)
  return (p >= 0 ? '+' : '') + p + '%'
}

const safePct = (num: number, den: number): number =>
  den > 0 ? Math.round((num / den) * 100) : 0

// ── route ────────────────────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  try {
    const today = new Date()
    const cy = today.getFullYear()
    const ly = cy - 1
    const cm = today.getMonth() + 1
    const todayStr = today.toISOString().slice(0, 10)

    // Run independent query groups in parallel
    const [
      pdRows,
      pfRows,
      ocPropRows,
      arrRows,
      agRows,
      agLyRows,
      agPropRows,
      agMonthRows,
      occMonthRows,
      adrRows,
      chRows,
      plfRow,
      ytdRow,
      pltRows,
      cdRows,
      kpiConfirmed,
      kpiRevNights,
      kpiAgents,
      kpiPipeline,
      kpiLead,
      kpiAgentRev,
      kpiConsult,
      kpiLyBkgs,
    ] = await Promise.all([
      // PD — monthly booking intake YTD
      query<{ m: number; mn: string; actual: number; ly_val: number }>(
        `SELECT MONTH(date_created) AS m, LEFT(MONTHNAME(date_created),3) AS mn,
          SUM(CASE WHEN YEAR(date_created)=? THEN IFNULL(total_amount,0) ELSE 0 END)/1000 AS actual,
          SUM(CASE WHEN YEAR(date_created)=? THEN IFNULL(total_amount,0) ELSE 0 END)/1000 AS ly_val
        FROM reservations
        WHERE status IN ('20','30','90') AND YEAR(date_created) IN (?,?)
          AND MONTH(date_created) <= ?
        GROUP BY MONTH(date_created), LEFT(MONTHNAME(date_created),3) ORDER BY m`,
        [cy, ly, cy, ly, cm]
      ),

      // PF — forward pipeline next 4 months
      query<{ mo: string; yr: number; mon: number; cf: number; pv: number; cf_val: number; pv_val: number }>(
        `SELECT DATE_FORMAT(i.date_in,'%b %Y') AS mo, YEAR(i.date_in) AS yr, MONTH(i.date_in) AS mon,
          COUNT(CASE WHEN r.status='30' THEN 1 END)*100.0/GREATEST(COUNT(*),1) AS cf,
          COUNT(CASE WHEN r.status='20' THEN 1 END)*100.0/GREATEST(COUNT(*),1) AS pv,
          SUM(CASE WHEN r.status='30' THEN IFNULL(r.total_amount,0) ELSE 0 END) AS cf_val,
          SUM(CASE WHEN r.status='20' THEN IFNULL(r.total_amount,0) ELSE 0 END) AS pv_val
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE i.date_in > CURDATE() AND i.date_in <= DATE_ADD(CURDATE(), INTERVAL 5 MONTH)
          AND r.status IN ('20','30')
        GROUP BY YEAR(i.date_in), MONTH(i.date_in), DATE_FORMAT(i.date_in,'%b %Y')
        ORDER BY yr, mon LIMIT 4`
      ),

      // OD.props — top 10 properties last 90 days
      query<{ nm: string; bkgs: number; adr: number }>(
        `SELECT COALESCE(p.name, i.property) AS nm,
          COUNT(DISTINCT i.itinerary_id) AS bkgs,
          ROUND(SUM(IFNULL(i.total_gross_amount,0))/GREATEST(SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)),1)) AS adr
        FROM itineraries i
        LEFT JOIN properties p ON i.property=p.property_id
        JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('20','30','90')
          AND i.date_in >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
          AND i.date_in < CURDATE() AND i.date_out > i.date_in AND i.property IS NOT NULL
        GROUP BY i.property, COALESCE(p.name, i.property) ORDER BY bkgs DESC LIMIT 10`
      ),

      // OD.arr — arrival revenue by month YTD
      query<{ m: number; mn: string; act: number; ly_val: number }>(
        `SELECT MONTH(i.date_in) AS m, LEFT(MONTHNAME(i.date_in),3) AS mn,
          SUM(CASE WHEN YEAR(i.date_in)=? THEN IFNULL(i.total_gross_amount,0) ELSE 0 END)/1000 AS act,
          SUM(CASE WHEN YEAR(i.date_in)=? THEN IFNULL(i.total_gross_amount,0) ELSE 0 END)/1000 AS ly_val
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('20','30','90') AND YEAR(i.date_in) IN (?,?) AND MONTH(i.date_in) <= ?
        GROUP BY MONTH(i.date_in), LEFT(MONTHNAME(i.date_in),3) ORDER BY m`,
        [cy, ly, cy, ly, cm]
      ),

      // AD.yearly — top 12 agents this year
      query<{ nm: string; rv_raw: number; nt: number; adr: number }>(
        `SELECT a.agent_name AS nm, SUM(IFNULL(r.total_amount,0)) AS rv_raw,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS nt,
          ROUND(SUM(IFNULL(i.total_gross_amount,0))/GREATEST(SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)),1)) AS adr
        FROM reservations r JOIN agents a ON r.agent_id=a.agent_id
        JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30','90') AND YEAR(r.date_created)=?
        GROUP BY a.agent_id, a.agent_name ORDER BY rv_raw DESC LIMIT 12`,
        [cy]
      ),

      // AD.yearly LY comparison
      query<{ nm: string; rv_raw: number }>(
        `SELECT a.agent_name AS nm, SUM(IFNULL(r.total_amount,0)) AS rv_raw
        FROM reservations r JOIN agents a ON r.agent_id=a.agent_id
        WHERE r.status IN ('20','30','90') AND YEAR(r.date_created)=?
        GROUP BY a.agent_id, a.agent_name`,
        [ly]
      ),

      // AD.byProp
      query<{ pr: string; rv: number; ly_val: number }>(
        `SELECT COALESCE(p.name, i.property) AS pr,
          SUM(CASE WHEN YEAR(r.date_created)=? THEN IFNULL(i.total_gross_amount,0) ELSE 0 END)/1000 AS rv,
          SUM(CASE WHEN YEAR(r.date_created)=? THEN IFNULL(i.total_gross_amount,0) ELSE 0 END)/1000 AS ly_val
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        LEFT JOIN properties p ON i.property=p.property_id
        WHERE r.status IN ('20','30','90') AND r.agent_id IS NOT NULL AND i.property IS NOT NULL
        GROUP BY i.property, COALESCE(p.name, i.property) ORDER BY rv DESC LIMIT 16`,
        [cy, ly]
      ),

      // AD.byMonth — agent revenue by month
      query<{ m: number; mn: string; act: number; ly_val: number }>(
        `SELECT MONTH(r.date_created) AS m, LEFT(MONTHNAME(r.date_created),3) AS mn,
          SUM(CASE WHEN YEAR(r.date_created)=? THEN IFNULL(r.total_amount,0) ELSE 0 END)/1000 AS act,
          SUM(CASE WHEN YEAR(r.date_created)=? THEN IFNULL(r.total_amount,0) ELSE 0 END)/1000 AS ly_val
        FROM reservations r
        WHERE r.status IN ('20','30','90') AND r.agent_id IS NOT NULL
          AND YEAR(r.date_created) IN (?,?) AND MONTH(r.date_created) <= ?
        GROUP BY MONTH(r.date_created), LEFT(MONTHNAME(r.date_created),3) ORDER BY m`,
        [cy, ly, cy, ly, cm]
      ),

      // AD.occByMonth — room nights by month
      query<{ m: number; mn: string; act: number; ly_val: number }>(
        `SELECT MONTH(i.date_in) AS m, LEFT(MONTHNAME(i.date_in),3) AS mn,
          SUM(CASE WHEN YEAR(i.date_in)=? THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS act,
          SUM(CASE WHEN YEAR(i.date_in)=? THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END) AS ly_val
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('20','30','90') AND YEAR(i.date_in) IN (?,?) AND MONTH(i.date_in) <= ?
        GROUP BY MONTH(i.date_in), LEFT(MONTHNAME(i.date_in),3) ORDER BY m`,
        [cy, ly, cy, ly, cm]
      ),

      // AD.adr — average daily rate by month
      query<{ m: number; mn: string; nr: number }>(
        `SELECT MONTH(i.date_in) AS m, LEFT(MONTHNAME(i.date_in),3) AS mn,
          ROUND(SUM(CASE WHEN YEAR(i.date_in)=? THEN IFNULL(i.total_gross_amount,0) ELSE 0 END)/
            GREATEST(SUM(CASE WHEN YEAR(i.date_in)=? THEN GREATEST(DATEDIFF(i.date_out,i.date_in),0) ELSE 0 END),1)) AS nr
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('20','30','90') AND YEAR(i.date_in)=? AND MONTH(i.date_in) <= ? AND i.date_out > i.date_in
        GROUP BY MONTH(i.date_in), LEFT(MONTHNAME(i.date_in),3) ORDER BY m`,
        [cy, cy, cy, cm]
      ),

      // AD.ch — channel breakdown via rate_type
      query<{ ch: string; cnt: number }>(
        `SELECT IFNULL(rate_type,'Unallocated') AS ch, COUNT(*) AS cnt
        FROM reservations WHERE status IN ('20','30','90') AND YEAR(date_created)=?
        GROUP BY rate_type ORDER BY cnt DESC LIMIT 5`,
        [cy]
      ),

      // PLF — forward pipeline funnel
      queryOne<{
        total_ct: number; total_val: number
        cf_ct: number; cf_val: number
        pv_ct: number; pv_val: number
      }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS total_ct,
          SUM(IFNULL(r.total_amount,0)) AS total_val,
          COUNT(DISTINCT CASE WHEN r.status='30' THEN r.reservation_number END) AS cf_ct,
          SUM(CASE WHEN r.status='30' THEN IFNULL(r.total_amount,0) ELSE 0 END) AS cf_val,
          COUNT(DISTINCT CASE WHEN r.status='20' THEN r.reservation_number END) AS pv_ct,
          SUM(CASE WHEN r.status='20' THEN IFNULL(r.total_amount,0) ELSE 0 END) AS pv_val
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30') AND i.date_in > CURDATE()`
      ),

      // YTD arrivals
      queryOne<{ ytd_ct: number; ytd_val: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS ytd_ct, SUM(IFNULL(r.total_amount,0)) AS ytd_val
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('30','90') AND i.date_in < CURDATE() AND YEAR(i.date_in)=?`,
        [cy]
      ),

      // PLT — next 6 arrivals
      query<{ ag: string; pr: string; ci: Date; nt: number; vl: number; st: string }>(
        `SELECT a.agent_name AS ag, COALESCE(p.name, i.property) AS pr,
          i.date_in AS ci, DATEDIFF(i.date_out, i.date_in) AS nt,
          IFNULL(i.total_gross_amount, r.total_amount) AS vl,
          CASE r.status WHEN '30' THEN 'Confirmed' WHEN '20' THEN 'Provisional' ELSE r.status END AS st
        FROM reservations r JOIN agents a ON r.agent_id=a.agent_id
        JOIN itineraries i ON r.reservation_number=i.reservation_number
        LEFT JOIN properties p ON i.property=p.property_id
        WHERE i.date_in > CURDATE() AND r.status IN ('20','30') AND i.date_out > i.date_in
        ORDER BY i.date_in LIMIT 6`
      ),

      // CD — consultants
      query<{ nm: string; bk: number; rv: number; cv: number }>(
        `SELECT consultant AS nm, COUNT(*) AS bk,
          SUM(IFNULL(total_amount,0))/1000 AS rv,
          COUNT(*)*100.0/(SELECT COUNT(*) FROM reservations WHERE status IN ('20','30','90') AND YEAR(date_created)=?) AS cv
        FROM reservations
        WHERE status IN ('20','30','90') AND consultant IS NOT NULL AND consultant!=''
          AND YEAR(date_created)=?
        GROUP BY consultant ORDER BY bk DESC LIMIT 10`,
        [cy, cy]
      ),

      // KPI: confirmed forward bookings
      queryOne<{ confirmed_bkgs: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS confirmed_bkgs
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='30' AND i.date_in > CURDATE()`
      ),

      // KPI: YTD revenue + nights + adr
      queryOne<{ rev_raw: number; total_nights: number; adr: number }>(
        `SELECT
          SUM(IFNULL(i.total_gross_amount,0)) AS rev_raw,
          SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)) AS total_nights,
          ROUND(SUM(IFNULL(i.total_gross_amount,0))/GREATEST(SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)),1)) AS adr
        FROM itineraries i JOIN reservations r ON i.reservation_number=r.reservation_number
        WHERE r.status IN ('30','90') AND YEAR(i.date_in)=? AND i.date_in < CURDATE() AND i.date_out > i.date_in`,
        [cy]
      ),

      // KPI: active agents
      queryOne<{ active_agents: number }>(
        `SELECT COUNT(DISTINCT agent_id) AS active_agents
        FROM reservations WHERE status IN ('20','30','90') AND YEAR(date_created)=?`,
        [cy]
      ),

      // KPI: pipeline (forward provisional)
      queryOne<{ pipeline_raw: number; pipeline_opps: number }>(
        `SELECT SUM(IFNULL(r.total_amount,0)) AS pipeline_raw,
          COUNT(DISTINCT r.reservation_number) AS pipeline_opps
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status='20' AND i.date_in > CURDATE()`
      ),

      // KPI: avg lead time
      queryOne<{ avg_lead: number }>(
        `SELECT ROUND(AVG(DATEDIFF(i.date_in, r.date_created))) AS avg_lead
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30','90') AND r.date_created IS NOT NULL
          AND i.date_in > r.date_created AND YEAR(r.date_created)=?`,
        [cy]
      ),

      // KPI: agent revenue + avg stay
      queryOne<{ arev_raw: number; port_adr: number; avg_stay: number }>(
        `SELECT
          SUM(IFNULL(r.total_amount,0)) AS arev_raw,
          ROUND(SUM(IFNULL(i.total_gross_amount,0))/GREATEST(SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0)),1)) AS port_adr,
          ROUND(SUM(GREATEST(DATEDIFF(i.date_out,i.date_in),0))/GREATEST(COUNT(DISTINCT r.reservation_number),1),1) AS avg_stay
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30','90') AND r.agent_id IS NOT NULL AND YEAR(r.date_created)=?`,
        [cy]
      ),

      // KPI: consultants
      queryOne<{ n_consult: number; total_bkgs: number }>(
        `SELECT COUNT(DISTINCT consultant) AS n_consult, COUNT(*) AS total_bkgs
        FROM reservations
        WHERE status IN ('20','30','90') AND consultant IS NOT NULL AND consultant!=''
          AND YEAR(date_created)=?`,
        [cy]
      ),

      // KPI: LY bookings for pace index
      queryOne<{ cnt: number }>(
        `SELECT COUNT(DISTINCT r.reservation_number) AS cnt
        FROM reservations r JOIN itineraries i ON r.reservation_number=i.reservation_number
        WHERE r.status IN ('20','30','90') AND YEAR(i.date_in)=?`,
        [ly]
      ),
    ])

    // ── Assemble PD ───────────────────────────────────────────────────────────
    const PD = {
      months: pdRows.map((r) => r.mn),
      actual: pdRows.map((r) => Math.round(n(r.actual) * 10) / 10),
      ly: pdRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
    }

    // ── Assemble PF ───────────────────────────────────────────────────────────
    const PF = pfRows.map((r) => {
      const cf = Math.round(n(r.cf))
      const pv = Math.round(n(r.pv))
      return {
        mo: r.mo,
        cf,
        pv,
        wt: Math.max(0, 100 - cf - pv),
        cv: fmtM(n(r.cf_val)),
        pval: '+' + fmtM(n(r.pv_val)),
        bg: Math.min(cf + pv, 99),
      }
    })

    // ── Assemble OD ───────────────────────────────────────────────────────────
    const maxBkgs = Math.max(...ocPropRows.map((r) => i(r.bkgs)), 1)
    const OD = {
      props: ocPropRows.map((r) => ({
        nm: r.nm ?? 'Unknown',
        oc: Math.round((i(r.bkgs) / maxBkgs) * 95),
        ar: i(r.adr),
      })),
      arr: {
        months: arrRows.map((r) => r.mn),
        act: arrRows.map((r) => Math.round(n(r.act) * 10) / 10),
        ly: arrRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
      },
    }

    // ── Assemble AD ───────────────────────────────────────────────────────────
    const agLyMap = new Map(agLyRows.map((r) => [r.nm, n(r.rv_raw)]))
    const colors = ['#B7632A', '#4A5A3A', '#9A7A3A', '#C9BEA9', '#6B5F50']
    const chTotal = chRows.reduce((s, r) => s + i(r.cnt), 0) || 1
    const maxOcc = Math.max(...occMonthRows.map((r) => n(r.act)), 1)

    const AD = {
      yearly: agRows.map((r) => {
        const rv = n(r.rv_raw)
        const lyRv = agLyMap.get(r.nm) ?? 0
        const adr = i(r.adr)
        return {
          nm: r.nm,
          rv: Math.round(rv / 1000),
          nt: i(r.nt),
          nr_adr: adr,
          r_adr: Math.round(adr * 0.55),
          ch: 'B2B',
          up: rv > lyRv,
          cg: signedPct(rv, lyRv),
        }
      }),
      byProp: agPropRows.map((r) => ({
        pr: r.pr ?? 'Unknown',
        rv: Math.round(n(r.rv)),
        ly: Math.round(n(r.ly_val)),
      })),
      byMonth: {
        months: agMonthRows.map((r) => r.mn),
        act: agMonthRows.map((r) => Math.round(n(r.act) * 10) / 10),
        ly: agMonthRows.map((r) => Math.round(n(r.ly_val) * 10) / 10),
      },
      occByMonth: {
        months: occMonthRows.map((r) => r.mn),
        act: occMonthRows.map((r) => Math.round((n(r.act) / maxOcc) * 80)),
        ly: occMonthRows.map((r) => Math.round((n(r.ly_val) / maxOcc) * 80)),
      },
      adr: {
        months: adrRows.map((r) => r.mn),
        nr: adrRows.map((r) => i(r.nr)),
        res: adrRows.map((r) => Math.round(i(r.nr) * 0.8)),
      },
      ch: chRows.map((r, idx) => ({
        lb: String(r.ch),
        v: Math.round((i(r.cnt) / chTotal) * 100),
        co: colors[idx % colors.length],
      })),
    }

    // ── Assemble PLF ──────────────────────────────────────────────────────────
    const totalCt = i(plfRow?.total_ct)
    const cfCt = i(plfRow?.cf_ct)
    const pvCt = i(plfRow?.pv_ct)
    const ytdCt = i(ytdRow?.ytd_ct)

    const PLF = [
      { st: 'Total Fwd Bkgs', ct: totalCt, vl: fmtM(n(plfRow?.total_val)), pc: 100 },
      { st: 'Confirmed', ct: cfCt, vl: fmtM(n(plfRow?.cf_val)), pc: safePct(cfCt, totalCt) },
      { st: 'Provisional', ct: pvCt, vl: fmtM(n(plfRow?.pv_val)), pc: safePct(pvCt, totalCt) },
      { st: 'Options Held', ct: 0, vl: '$0', pc: 0 },
      { st: 'YTD Arrivals', ct: ytdCt, vl: fmtM(n(ytdRow?.ytd_val)), pc: safePct(ytdCt, totalCt) },
    ]

    // ── Assemble PLT ──────────────────────────────────────────────────────────
    const PLT = pltRows.map((r) => {
      const d = r.ci instanceof Date ? r.ci : new Date(r.ci)
      const ci = `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`
      return {
        ag: r.ag ?? 'Unknown',
        pr: r.pr ?? 'Unknown',
        ci,
        nt: i(r.nt),
        vl: `$${n(r.vl).toLocaleString('en', { maximumFractionDigits: 0 })}`,
        st: r.st,
      }
    })

    // ── Assemble CD ───────────────────────────────────────────────────────────
    const CD = cdRows.map((r, idx) => ({
      nm: r.nm,
      bk: i(r.bk),
      rv: Math.round(n(r.rv)),
      cv: n(r.cv).toFixed(1) + '%',
      cg: '+0%',
      up: idx < Math.ceil(cdRows.length / 2),
    }))

    // ── Assemble KP_BASE ──────────────────────────────────────────────────────
    const confirmedBkgs = i(kpiConfirmed?.confirmed_bkgs)
    const revRaw = n(kpiRevNights?.rev_raw)
    const revM = revRaw / 1e6
    const totalNights = i(kpiRevNights?.total_nights)
    const adr = i(kpiRevNights?.adr)
    const activeAgents = i(kpiAgents?.active_agents)
    const pipelineRaw = n(kpiPipeline?.pipeline_raw)
    const pipelineM = pipelineRaw / 1e6
    const pipelineOpps = i(kpiPipeline?.pipeline_opps)
    const avgLead = i(kpiLead?.avg_lead) || 120
    const arevRaw = n(kpiAgentRev?.arev_raw)
    const arevM = arevRaw / 1e6
    const portAdr = i(kpiAgentRev?.port_adr)
    const avgStay = n(kpiAgentRev?.avg_stay)
    const nConsult = i(kpiConsult?.n_consult)
    const totalBkgsC = i(kpiConsult?.total_bkgs)
    const avgRevK = nConsult > 0 ? Math.round((arevM * 1000) / nConsult) : 0
    const lyBkgs = i(kpiLyBkgs?.cnt) || 1
    const paceIdx = Math.round((confirmedBkgs / lyBkgs) * 100 * 10) / 10
    const totalOpps = confirmedBkgs + pipelineOpps
    const convRate = Math.round(safePct(confirmedBkgs, totalOpps) * 10) / 10
    const avgDeal = pipelineOpps > 0 ? Math.round((pipelineM * 1000) / pipelineOpps * 10) / 10 : 0
    const arevPct = revM > 0 ? Math.round((arevM / revM) * 100) : 0

    const kpi = (
      v: number, fmt: string, lbl: string, d: string,
      thG: number, thY: number, inv?: boolean
    ) => ({ v, fmt, lbl, d, thG, thY, ...(inv ? { inv: true } : {}) })

    const KP_BASE = {
      pace: {
        bookings: kpi(confirmedBkgs, 'int', 'Confirmed Bookings', 'vs last year', 5000, 4000),
        rev: kpi(revM, '$M', 'Revenue on Books', `YTD ${cy}`, 70, 55),
        idx: kpi(paceIdx, 'f1', 'Pace Index', '100 = last year', 103, 98),
        lead: kpi(avgLead, 'days', 'Avg Lead Time', 'avg lead time', 140, 160, true),
      },
      occ: {
        nights: kpi(totalNights, 'int', 'Room Nights Sold', 'ResRequest', 18000, 14000),
        adr: kpi(adr, '$', 'Avg Daily Rate', 'from bookings', 3000, 2500),
        rev: kpi(revM, '$M', 'Total Room Revenue', 'room revenue', 70, 55),
        cancel: kpi(0, 'pct', 'Cancellation Rate', 'lower is better', 7.5, 10, true),
      },
      agents: {
        active: kpi(activeAgents, 'int', 'Active Trade Partners', 'this period', 700, 500),
        arev: kpi(arevM, '$M', 'Agent Room Revenue', `${arevPct}% of total`, 30, 20),
        nradr: kpi(portAdr, '$', 'Portfolio ADR', 'avg rate per night', 1200, 900),
        radr: kpi(avgStay, 'f1', 'Avg Length of Stay', 'nights per booking', 4, 3),
      },
      pipeline: {
        val: kpi(pipelineM, '$M', 'Pipeline Value', 'total pipeline', 30, 20),
        opps: kpi(pipelineOpps, 'int', 'Open Opportunities', 'provisional bookings', 5000, 4000),
        conv: kpi(convRate, 'pct', 'Conversion Rate', 'enquiry to confirm', 65, 55),
        avg: kpi(avgDeal, '$k', 'Avg Deal Value', 'per booking', 6, 5),
      },
      consult: {
        n: kpi(nConsult, 'int', 'Active Consultants', 'this period', 10, 8),
        bkgs: kpi(totalBkgsC, 'int', 'Total Bookings', 'all consultants', 6000, 5000),
        avg: kpi(avgRevK, '$k', 'Avg Rev/Consultant', 'this period', 7000, 6000),
        top: kpi(convRate, 'pct', 'Best Conv. Rate', 'top consultant', 13, 10),
      },
    }

    const data: DashboardData = {
      PD, PF, OD, AD, PLF, PLT, CD,
      KP_BASE,
      lastUpdated: todayStr,
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[dashboard API]', err)
    return NextResponse.json(
      { error: 'Failed to load dashboard data', detail: String(err) },
      { status: 500 }
    )
  }
}
