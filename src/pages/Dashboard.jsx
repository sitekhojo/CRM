import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList, Legend } from 'recharts'
import { Layers, CalendarPlus, CalendarDays, Zap, Activity, Boxes, Network } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints, inPipeline, exitOf, inPipeAt, dayBefore, workedIn, isTrackerSite, isBulkImport } from '../lib/deals'
import { supabase, fetchAll } from '../lib/supabase'
import { useConfig, stagesFor, REGIONS, leadLabel } from '../lib/config'
import DealFilters from '../components/DealFilters'
import PeriodBar, { nextMonths, periodRange, periodLabel, isoDay } from '../components/PeriodBar'
import FranchisePayments from '../components/FranchisePayments'
import TargetTrend, { fyMonths } from '../components/TargetTrend'
import FyPlan from '../components/FyPlan'
import { PlanTable, TypeSplit } from '../components/Forecast'
import { Stat, StageBadge, PageLoader, Modal } from '../components/ui'
import { fmtNum, daysLabel, daysInt, stageAgeTone, AGE_TONES, startOfWeek, startOfMonth, fmtDate } from '../lib/format'
import { haversine, hasLoc } from '../lib/geo'

export default function Dashboard() {
  const { deals, loading, reload } = useDeals()
  const { stages = [], users = [], team = [], cities = [] } = useConfig()
  const [history, setHistory] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [period, setPeriod] = useState({ kind: 'month', from: '', to: '' })
  const [network, setNetwork] = useState([])
  const [metric, setMetric] = useState('qis') // chart unit: 'qis' | 'sites'
  const [enOpen, setEnOpen] = useState(false)
  const [list, setList] = useState(null)
  const [listType, setListType] = useState('')
  const [grain, setGrain] = useState('month') // energisation / HO trend: 'week' | 'month'
  const [showHo, setShowHo] = useState(false)
  const nav = useNavigate()

  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => {}) }, [])

  useEffect(() => {
    fetchAll(() => supabase.from('stage_history_overview').select('id,site_id,from_stage_id,to_stage_id,from_stage_name,to_stage_name,days_in_from_stage,changed_at,changed_by,city,site_created_by').order('id'))
      .then(setHistory).catch(() => setHistory([]))
  }, [])

  const m = useMemo(() => {
    if (!deals) return null
    const rows = applyFilters(deals, filters).filter(r => !isTrackerSite(r)) // pipeline metrics only; energisation comes from the tracker
    const [pStart, pEnd] = periodRange(period)
    const selYm = period.kind === 'next' ? new Set(nextMonths(period)) : null
    const inP = d => { if (!d) return false; const t = new Date(d); return t >= pStart && t <= pEnd && (!selYm || selYm.has(isoDay(t).slice(0, 7))) }
    const keyId = Object.fromEntries(stages.map(s => [s.key, s.id]))
    const firstEntry = (siteId, stageId) => (history || []).find(x => x.site_id === siteId && x.to_stage_id === stageId)?.changed_at
    const hoDate = r => r.extra?.ho_date || firstEntry(r.id, keyId.ho_done) || (r.stage_id === keyId.ho_done ? r.stage_entered_at : null)
    const enDate = r => r.extra?.energized_on || firstEntry(r.id, keyId.energized) || (r.stage_id === keyId.energized ? r.stage_entered_at : null)
    const wk = startOfWeek(), mo = startOfMonth()
    const by = (fn) => rows.reduce((acc, r) => { const k = fn(r); acc[k] = (acc[k] || 0) + 1; return acc }, {})

    // stage-wise & city-wise follow the period: All time = every site; otherwise sites added in the period
    const scoped = period.kind === 'all' ? rows : rows.filter(r => inP(r.created_at))
    const worked = rows.filter(r => workedIn(r, isoDay(pStart), isoDay(pEnd))) // opening pipeline + added in the period
    const pipeline = stagesFor(stages, filters.siteType).filter(s => s.category !== 'dropped').map(s => {
      const xs = worked.filter(r => r.stage_id === s.id)
      return { id: s.id, cat: s.category, name: s.name, color: s.color, sla: s.sla_days, count: xs.length, sites: xs.length, qis: sumQis(xs),
        overdue: xs.filter(r => r.is_overdue).length, avgDays: avg(xs.map(r => +r.days_in_stage)) }
    })

    const open = rows.filter(r => r.stage_category !== 'dropped')
    const cityCounts = Object.values(scoped.filter(r => r.stage_category !== 'dropped').reduce((acc, r) => {
      const c = acc[r.city] || (acc[r.city] = { city: r.city, sites: 0, qis: 0 })
      c.sites += 1; c.qis += qisOf(r); return acc
    }, {})).sort((a, b) => b[metric] - a[metric] || b.sites - a.sites)
    const energizedDeals = rows.filter(r => r.stage_category === 'live')
    const near = (d, n) => hasLoc(d) && haversine(d.latitude, d.longitude, n.latitude, n.longitude) <= 100
    const cityRegion = Object.fromEntries((cities || []).map(c => [c.name.toLowerCase(), c.region]))
    const netOk = n => n.point_type === 'own_station' && (!filters.city.length || filters.city.includes(n.city)) && (!filters.siteType.length || filters.siteType.includes(n.site_type)) && (!filters.region.length || filters.region.includes(cityRegion[String(n.city || '').toLowerCase()]))
    const netAll = network.filter(netOk)
    const net = network.filter(netOk)
      .filter(n => !energizedDeals.some(d => near(d, n))) // already counted as a deal

    // energisation + handover trend (WoW / MoM)
    const delivery = (() => {
      const enEvents = [
        ...netAll.flatMap(n => Object.entries(n.energized_dates || {}).map(([d, c]) => ({ d, qis: Number(c) || 0 }))),
      ]
      const hoEvents = rows.map(r => ({ d: String(hoDate(r) || '').slice(0, 10), qis: qisOf(r) })).filter(x => x.d)
      const N = 12
      const starts = grain === 'week'
        ? Array.from({ length: N }, (_, i) => { const d = startOfWeek(); d.setDate(d.getDate() - 7 * (N - 1 - i)); return d })
        : Array.from({ length: N }, (_, i) => { const d = startOfMonth(); d.setMonth(d.getMonth() - (N - 1 - i)); return d })
      const key = d => isoDay(d)
      const bucket = ds => { const t = new Date(ds + 'T12:00:00'); for (let i = N - 1; i >= 0; i--) if (t >= starts[i]) return i; return -1 }
      const out = starts.map((s, i) => ({
        label: grain === 'week' ? s.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : s.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        from: key(s), to: key(new Date((starts[i + 1] ? starts[i + 1].getTime() : (grain === 'week' ? s.getTime() + 7 * 864e5 : new Date(s.getFullYear(), s.getMonth() + 1, 1).getTime())) - 864e5)),
        en: 0, enSites: 0, ho: 0, hoSites: 0,
      }))
      for (const e of enEvents) { const i = bucket(e.d); if (i >= 0 && e.d <= out[N - 1].to) { out[i].en += e.qis; out[i].enSites++ } }
      for (const e of hoEvents) { const i = bucket(e.d); if (i >= 0 && e.d <= out[N - 1].to) { out[i].ho += e.qis; out[i].hoSites++ } }
      const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null)
      const cur = out[N - 1], prev = out[N - 2]
      return { rows: out, cur, prev, enChg: pct(cur.en, prev.en), hoChg: pct(cur.ho, prev.ho), avgEn: Math.round(out.slice(0, N - 1).reduce((a, x) => a + x.en, 0) / (N - 1)) }
    })()

    // weekly trend (last 12 weeks)
    const weeks = Array.from({ length: 12 }, (_, i) => { const d = startOfWeek(); d.setDate(d.getDate() - 7 * (11 - i)); return d })
    const trend = weeks.map((w, i) => {
      const end = weeks[i + 1] || new Date(8.64e15)
      return { week: w.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), count: (() => { const xs = rows.filter(r => { const c = new Date(r.created_at); return c >= w && c < end }); return metric === 'qis' ? xs.reduce((a, r) => a + qisOf(r), 0) : xs.length })() }
    })

    // TAT between stages, restricted to the filtered deals
    const ids = new Set(rows.map(r => r.id))
    const h = (history || []).filter(x => ids.has(x.site_id) && x.from_stage_id && x.days_in_from_stage !== null)
    const tat = stages.filter(s => ['active', 'approved'].includes(s.category)).map(s => {
      const xs = h.filter(x => x.from_stage_id === s.id).map(x => +x.days_in_from_stage)
      return { id: s.id, name: s.name, color: s.color, sla: s.sla_days, avg: avg(xs), n: xs.length }
    }).filter(x => x.n > 0)

    // Lead → Energized cycle time
    const firstAt = {}, liveAt = {}
    const liveIds = new Set(stages.filter(s => s.category === 'live').map(s => s.id))
    for (const x of (history || [])) {
      if (!ids.has(x.site_id)) continue
      if (!x.from_stage_id) firstAt[x.site_id] = new Date(x.changed_at)
      if (liveIds.has(x.to_stage_id)) liveAt[x.site_id] = new Date(x.changed_at)
    }
    const cycle = avg(Object.keys(liveAt).filter(k => firstAt[k]).map(k => (liveAt[k] - firstAt[k]) / 864e5))

    // team performance, by site owner (team roster, grouped by region)
    const regionRank = r => { const i = REGIONS.indexOf(r); return i < 0 ? 99 : i }
    const names = [...new Set([...team.filter(t => t.is_active).map(t => t.name), ...rows.map(r => r.owner).filter(Boolean)])]
    const teamRows = [...names.map(n => ({ name: n, t: team.find(x => x.name === n) })), { name: null, t: null }].map(({ name, t }) => {
      const owned = rows.filter(r => (r.owner || null) === name)
      const added = owned.filter(r => !isBulkImport(r) && inP(r.created_at))
      return {
        id: name || '_none', name: name || 'Unassigned', region: t?.region || owned[0]?.region || '—', lead: t?.is_lead ? leadLabel(t.region) : null, active: t ? t.is_active : !!name,
        added: qs(added),
        stillOpen: qs(added.filter(r => ['active', 'approved'].includes(r.stage_category))),
        ho: qs(owned.filter(r => inP(hoDate(r)))),
        won: qs(owned.filter(r => r.stage_category === 'live' && inP(enDate(r)))),
        dropped: qs(owned.filter(r => r.stage_category === 'dropped' && inP(r.stage_entered_at))),
      }
    }).filter(x => x.added.sites || x.ho.sites || x.won.sites || x.dropped.sites || (x.active && x.id !== '_none'))
      .sort((a, b) => regionRank(a.region) - regionRank(b.region) || (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || b.added.qis - a.added.qis)

    const stuck = rows.filter(r => ['active', 'approved', 'hold'].includes(r.stage_category)).sort((a, b) => b.days_in_stage - a.days_in_stage).slice(0, 25)

    // Handover-focused view
    const todayStr = isoDay(new Date())
    const curYm = todayStr.slice(0, 7)
    const nextYm = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return isoDay(d).slice(0, 7) })()
    const PENDING_KEYS = ['scouting', 'scouted', 'deployment_feasibility', 'loi_signed', 'agreement_signed']
    const pendingStages = stages.filter(s => s.is_active && PENDING_KEYS.includes(s.key)).sort((a, b) => a.sort_order - b.sort_order)
    const pendingIds = new Set(pendingStages.map(s => s.id))
    const pendingRows = rows.filter(r => pendingIds.has(r.stage_id))
    const awaitingRows = rows.filter(r => r.stage_id === keyId.ho_done)
    const notLive = rows.filter(r => !['live', 'dropped'].includes(r.stage_category))
    const enThisMonth = notLive.filter(r => String(r.extra?.expected_en || '').slice(0, 7) === curYm)
    const enOverdue = notLive.filter(r => r.extra?.expected_en && r.extra.expected_en < curYm + '-01')
    const hoNextMonth = pendingRows.filter(r => selYm?.has(String(r.extra?.expected_ho || '').slice(0, 7)))
    const enNextMonth = notLive.filter(r => selYm?.has(String(r.extra?.expected_en || '').slice(0, 7)))
    const handedInP = rows.filter(r => inP(hoDate(r)))
    // Pending handover follows the period: sites whose Expected HO falls in it (whole pipeline for "All time")
    const dueTo = (() => {
      const a = pStart
      if (period.kind === 'month') return isoDay(new Date(a.getFullYear(), a.getMonth() + 1, 0))
      if (period.kind === 'quarter') return isoDay(new Date(a.getFullYear(), a.getMonth() + 3, 0))
      if (period.kind === 'fy') return isoDay(new Date(a.getFullYear() + 1, 2, 31))
      return isoDay(pEnd)
    })()
    const dueFrom = isoDay(pStart)
    const allPending = period.kind === 'all'
    const exp = r => r.extra?.expected_ho || ''
    const dueRows = allPending ? pendingRows : pendingRows.filter(r => exp(r) >= dueFrom && exp(r) <= dueTo && (!selYm || selYm.has(exp(r).slice(0, 7))))
    const slipRows = allPending || selYm || dueTo < todayStr ? [] : pendingRows.filter(r => exp(r) && exp(r) < dueFrom)
    const noDateRows = allPending ? [] : pendingRows.filter(r => !exp(r))
    const hv = {
      allPending, dueTo, due: qs(dueRows), slip: qs(slipRows), noDate: qs(noDateRows),
      lists: { pending: pendingRows, due: dueRows, slip: slipRows, noDate: noDateRows, enThisMonth, enOverdue, hoNext: hoNextMonth, enNext: enNextMonth, handed: handedInP },
      pending: qs(pendingRows), pendingByStage: pendingStages.map(s => ({ id: s.id, name: s.name, color: s.color, rows: dueRows.filter(r => r.stage_id === s.id), ...qs(dueRows.filter(r => r.stage_id === s.id)) })),
      hold: qs(rows.filter(r => r.stage_category === 'hold')), awaiting: qs(awaitingRows), handed: qs(handedInP),
      enThisMonth: qs(enThisMonth), enOverdue: qs(enOverdue), hoNext: qs(hoNextMonth), enNext: qs(enNextMonth), curYm, nextYm,
    }

    // Target-trend series (FY, by month)
    const byMonth = (xs, dateOf) => xs.reduce((o, r) => { const k = String(dateOf(r) || '').slice(0, 7); if (k) o[k] = (o[k] || 0) + qisOf(r); return o }, {})
    const enActual = {}
    for (const n of netAll) for (const [d, c] of Object.entries(n.energized_dates || {})) { const k = d.slice(0, 7); enActual[k] = (enActual[k] || 0) + (Number(c) || 0) }
    const expMonth = d => (d && d.slice(0, 7) < curYm ? curYm : String(d || '').slice(0, 7))
    const series = {
      scout: { actual: byMonth(rows.filter(r => !isBulkImport(r)), r => r.created_at), expected: null },
      ho: { actual: byMonth(rows, hoDate), expected: byMonth(pendingRows.filter(r => r.extra?.expected_ho), r => expMonth(r.extra.expected_ho)) },
      en: { actual: enActual, expected: byMonth(notLive.filter(r => r.extra?.expected_en), r => expMonth(r.extra.expected_en)),
        base: netAll.reduce((a, n) => a + (Number(n.weight) || 0), 0) - fyMonths().reduce((a, k) => a + (enActual[k] || 0), 0) },
    }

    const out = {
      total: open.length,
      ageing: (() => {
        const open = rows.filter(r => ['active', 'approved', 'hold'].includes(r.stage_category))
        return stages.filter(st => st.is_active && ['active', 'approved', 'hold'].includes(st.category)).map(st => {
          const xs = open.filter(r => r.stage_id === st.id)
          const cells = AGE_BUCKETS.map(([lo, hi]) => {
            const ys = xs.filter(r => +r.days_in_stage >= lo && +r.days_in_stage <= hi)
            return { lo, hi, qis: sumQis(ys), sites: ys.length, cls: AGE_TONES.find(t => t.lo === lo)?.cls || '' }
          })
          return { id: st.id, name: st.name, color: st.color, sla: st.sla_days, qis: sumQis(xs), sites: xs.length, overdueQis: sumQis(xs.filter(r => r.is_overdue)), cells }
        }).filter(x => x.sites > 0)
      })(),
      period: (() => {
        const added = rows.filter(r => !isBulkImport(r) && inP(r.created_at))
        const stillOpen = added.filter(r => ['active', 'approved'].includes(r.stage_category))
        const ho = rows.filter(r => inP(hoDate(r)))
        // energized in period: QIS-tracker dates + CRM energized sites that are not in the tracker
        const trackerEn = netAll.reduce((a, n) => a + Object.entries(n.energized_dates || {}).reduce((b, [d, c]) => b + (inP(d + 'T12:00:00') ? c : 0), 0), 0)
        const crmOnly = energizedDeals.filter(d => !netAll.some(n => near(d, n)))
        const crmEn = crmOnly.filter(r => inP(enDate(r)))
        const crmMatchedIds = new Set(energizedDeals.filter(d => !crmOnly.includes(d)).map(d => d.id))
        const enSites = netAll.filter(n => Object.keys(n.energized_dates || {}).some(d => inP(d + 'T12:00:00'))).length
        const enList = [
          ...netAll.flatMap(n => {
            const ds = Object.entries(n.energized_dates || {}).filter(([d]) => inP(d + 'T12:00:00'))
            if (!ds.length) return []
            const deal = energizedDeals.find(d => near(d, n))
            return [{ key: 'n' + n.id, name: n.name, city: n.city, siteType: n.site_type, qis: ds.reduce((a, [, c]) => a + (Number(c) || 0), 0), date: ds.map(([d]) => d).sort().pop(), source: 'QIS tracker', dealId: deal?.id }]
          }),
        ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.qis - a.qis)
        const pFrom = isoDay(pStart), pTo = isoDay(pEnd)
        const pipe = rows.filter(r => inPipeline(r, pFrom, pTo))
        const carried = pipe.filter(r => String(r.created_at).slice(0, 10) < pFrom)
        const pipeAdded = pipe.filter(r => !carried.includes(r))
        const closedDrop = rows.filter(r => r.stage_category === 'dropped' && inP(r.stage_entered_at))
        const status = {}
        for (const r of pipe) {
          const k = r.stage_id; const isNew = !carried.includes(r)
          const x = status[k] || (status[k] = { id: k, name: r.stage_name, color: r.stage_color, order: r.stage_order, qis: 0, sites: 0, newQis: 0 })
          x.qis += qisOf(r); x.sites++; if (isNew) x.newQis += qisOf(r)
        }
        const flow = {}
        for (const r of added) { const k = r.stage_name; flow[k] = flow[k] || { name: k, color: r.stage_color, order: r.stage_order, qis: 0, sites: 0 }; flow[k].qis += qisOf(r); flow[k].sites++ }
        return {
          label: periodLabel(period, pStart, pEnd), from: isoDay(pStart), to: isoDay(pEnd),
          added: qs(added), open: qs(stillOpen), ho: qs(ho),
          bridge: (() => {
            const from = isoDay(pStart), to = isoDay(pEnd), prev = dayBefore(from)
            const exits = k => rows.filter(r => { const x = exitOf(r); return x && x.kind === k && x.date >= from && x.date <= to })
            return { prev, opening: qs(rows.filter(r => inPipeAt(r, prev))), handed: qs(exits('ho')), dropped: qs(exits('dropped')), closing: qs(rows.filter(r => inPipeAt(r, to))) }
          })(),
          en: { qis: trackerEn, sites: enSites, list: enList }, crmMatched: crmMatchedIds.size,
          flow: Object.values(flow).sort((a, b) => a.order - b.order),
          pipe: qs(pipe), carried: qs(carried), pipeAdded: qs(pipeAdded), droppedInP: qs(closedDrop), status: Object.values(status).sort((a, b) => a.order - b.order),
        }
      })(),
      totalQis: sumQis(open),
      openPipe: qs(rows.filter(r => !['dropped', 'live'].includes(r.stage_category))),
      awaiting: qs(rows.filter(r => r.stage_category === 'approved')),
      weekQis: sumQis(open.filter(r => new Date(r.created_at) >= wk)),
      monthQis: sumQis(open.filter(r => new Date(r.created_at) >= mo)),
      netSites: netAll.length,
      netQis: netAll.reduce((a, n) => a + (Number(n.weight) || 0), 0),
      leads: open.filter(r => r.record_type === 'lead').length,
      deals: open.filter(r => r.record_type !== 'lead').length,
      week: open.filter(r => new Date(r.created_at) >= wk).length,
      month: open.filter(r => new Date(r.created_at) >= mo).length,
      active: rows.filter(r => ['active', 'approved'].includes(r.stage_category)).length,
      approved: rows.filter(r => r.stage_category === 'approved').length,
      live: rows.filter(r => r.stage_category === 'live').length,
      dropped: rows.filter(r => r.stage_category === 'dropped').length,
      hold: rows.filter(r => r.stage_category === 'hold').length,
      pipeQis: rows.filter(r => ['active', 'approved'].includes(r.stage_category)).reduce((a, r) => a + (Number(r.extra?.qis_count) || 0), 0),
      liveQis: rows.filter(r => r.stage_category === 'live').reduce((a, r) => a + (Number(r.extra?.qis_count) || 0), 0),
      overdue: stuck.length,
      cityCounts, trend, delivery, tat, team: teamRows, stuck, cycle, hv, series,
      dropReasons: Object.entries(by(r => r.stage_category === 'dropped' ? r.drop_reason || 'Unspecified' : null)).filter(([k]) => k !== 'null').sort((a, b) => b[1] - a[1]),
    }
    // Energized bar = energisations in the period from the QIS tracker (same as the Energized card)
    out.pipeline = pipeline.map(p => (p.cat === 'live' ? { ...p, qis: out.period.en.qis, sites: out.period.en.sites, count: out.period.en.sites } : p))
    return out
  }, [deals, filters, stages, users, team, cities, history, network, metric, period, grain])

  if (loading || !m) return <PageLoader />
  const listPath = t => (t === 'lead' ? '/app/leads' : t === 'deal' ? '/app/deals' : '/app/all')
  const go = q => nav(`${listPath(filters.recordType)}?${q}`)
  const openList = (title, rows) => { setListType(''); setList({ title, rows }) }
  const goCard = (card, extra) => {
    const p = new URLSearchParams({ card, ...extra })
    if (filters.city.length) p.set('city', filters.city.join(','))
    if (filters.siteType.length) p.set('siteType', filters.siteType.join(','))
    if (filters.region.length && !extra.region) p.set('region', filters.region.join(','))
    if (filters.owner.length && !extra.owner) p.set('owner', filters.owner.join(','))
    if (filters.recordType) p.set('type', filters.recordType)
    if (filters.stage.length && !extra.stage) p.set('stage', filters.stage.join(','))
    nav(`${listPath(filters.recordType)}?${p}`)
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold text-navy-900">{(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()}, Team Indofast Energy</h1>
          <p className="text-sm text-slate-500">Network expansion at a glance{filters.from || filters.to ? ' · date filter applies to deal creation date' : ''}</p>
        </div>
      </div>
      <DealFilters value={filters} onChange={setFilters} show={['region', 'city', 'owner', 'type', 'stage', 'siteType', 'format']} />
      <PeriodBar value={period} onChange={setPeriod} label={m.period.label} future />

      {period.kind === 'next' ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Expected handover" value={fmtNum(m.hv.hoNext.qis)} icon={CalendarDays} tone="amber" sub={`${fmtNum(m.hv.hoNext.sites)} sites · by Expected HO date`}
            onClick={() => openList(`Expected handover · ${m.period.label}`, m.hv.lists.hoNext)} />
          <Stat label="Expected energisation" value={fmtNum(m.hv.enNext.qis)} icon={Zap} tone="green" sub={`${fmtNum(m.hv.enNext.sites)} sites · by Expected energisation date`}
            onClick={() => openList(`Expected energisation · ${m.period.label}`, m.hv.lists.enNext)} />
          <Stat label="Pending handover" value={fmtNum(m.hv.pending.qis)} icon={Boxes} tone="blue" sub={`${fmtNum(m.hv.pending.sites)} sites · in pipeline today`} onClick={() => openList('Pending handover · in pipeline today', m.hv.lists.pending)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Handed over" value={fmtNum(m.hv.handed.qis)} icon={CalendarDays} tone="amber" sub={`${fmtNum(m.hv.handed.sites)} sites · ${m.period.label}`}
            onClick={() => openList(`Handed over ${m.period.label}`, m.hv.lists.handed)} />
          {m.hv.allPending ? (
            <Stat label="Pending handover" value={fmtNum(m.hv.pending.qis)} icon={Boxes} tone="blue" sub={`${fmtNum(m.hv.pending.sites)} sites · whole pipeline today`}
              onClick={() => openList('Pending handover · whole pipeline today', m.hv.lists.pending)} />
          ) : (
            <Stat label="Pending handover" value={fmtNum(m.hv.due.qis)} icon={Boxes} tone="blue"
              sub={`${fmtNum(m.hv.due.sites)} sites · Expected HO ${m.period.label}${m.hv.slip.sites ? ` · +${fmtNum(m.hv.slip.qis)} QIS overdue` : ''}`}
              onClick={() => openList(`Pending handover · Expected HO ${m.period.label}${m.hv.slip.sites ? ' (overdue listed separately)' : ''}`, m.hv.lists.due)} />
          )}
          <Stat label="To energize this month" value={fmtNum(m.hv.enThisMonth.qis)} icon={Zap} tone="amber" sub={`${fmtNum(m.hv.enThisMonth.sites)} sites · expected${m.hv.enOverdue.sites ? ` · +${fmtNum(m.hv.enOverdue.qis)} QIS overdue` : ''}`}
            onClick={() => openList('To energize this month · by Expected energisation date', m.hv.lists.enThisMonth)} />
          <Stat label="Energized" value={fmtNum(m.period.en.qis)} icon={Zap} tone="green" sub={`${fmtNum(m.period.en.sites)} sites · ${m.period.label} · QIS tracker`}
            onClick={() => setEnOpen(true)} />
        </div>
      )}
      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-bold text-slate-900">Pending handover by stage</h3>
          <span className="text-xs text-slate-500">{m.hv.allPending ? 'whole pipeline today' : `Expected HO ${m.period.label.replace(/^expected /, '')}`} · not dropped, not on hold{!m.hv.allPending && m.hv.slip.sites ? <> · <button className="font-semibold text-red-600 hover:underline" onClick={() => openList('Pending handover · Expected HO date already passed', m.hv.lists.slip)}>{fmtNum(m.hv.slip.qis)} QIS overdue</button></> : null}{!m.hv.allPending && m.hv.noDate.sites ? <> · <button className="font-semibold text-slate-600 hover:underline" onClick={() => openList('Pending handover · no Expected HO date', m.hv.lists.noDate)}>{fmtNum(m.hv.noDate.qis)} QIS with no Expected HO date</button></> : null}{m.hv.hold.sites ? ` · ${fmtNum(m.hv.hold.qis)} QIS (${m.hv.hold.sites} sites) on hold` : ''}</span>
          <button className="ml-auto text-xs font-semibold text-brand-700 hover:underline" onClick={() => nav('/app/map?network=1')}>Energized network: {fmtNum(m.netQis)} QIS · {fmtNum(m.netSites)} sites →</button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {m.hv.pendingByStage.map(s => (
            <button key={s.id} onClick={() => openList(`${s.name} · pending handover`, s.rows)} className="rounded-lg border border-slate-200 p-3 text-left transition hover:shadow-md" style={{ borderTopColor: s.color, borderTopWidth: 3 }}>
              <p className="truncate text-xs font-semibold text-slate-600">{s.name}</p>
              <p className="text-xl font-extrabold text-navy-900">{fmtNum(s.qis)} <span className="text-xs font-semibold text-slate-400">QIS</span></p>
              <p className="text-[11px] text-slate-500">{s.sites} sites</p>
            </button>
          ))}
        </div>
      </div>

      <Modal open={!!list} onClose={() => setList(null)} wide="xl"
        title={list ? `${list.title} · ${fmtNum(list.rows.reduce((a, r) => a + (Number(r.extra?.qis_count) || 0), 0))} QIS · ${list.rows.length} sites` : ''}
        footer={<button className="btn-primary" onClick={() => setList(null)}>Close</button>}>
        {list && <TypeSplit rows={list.rows} value={listType} onChange={setListType} />}
        {list && <div className="max-h-[62vh] overflow-auto"><PlanTable rows={list.rows.filter(r => !listType || (r.site_type || 'Not set') === listType)} onChanged={reload} /></div>}
      </Modal>
      <Modal open={enOpen} onClose={() => setEnOpen(false)} wide title={`Energized ${m.period.label} · ${fmtNum(m.period.en.qis)} QIS · ${fmtNum(m.period.en.sites)} sites`}
        footer={<><button className="btn btn-ghost" onClick={() => nav('/app/map?network=1')}>Open on map</button><button className="btn btn-primary" onClick={() => setEnOpen(false)}>Close</button></>}>
        {m.period.en.list.length === 0 ? <p className="text-sm text-slate-400">Nothing energized in this period.</p> : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2 pr-2">Site</th><th className="pr-2">City</th><th className="pr-2">Type</th><th className="pr-2 text-right">QIS</th><th className="pr-2">Energized on</th><th>Source</th></tr></thead>
              <tbody>
                {m.period.en.list.map(x => (
                  <tr key={x.key} className={`border-t border-slate-100 ${x.dealId ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => x.dealId && nav(`/app/deals/${x.dealId}`)}>
                    <td className="py-2 pr-2 font-medium text-navy-900">{x.name}</td><td className="pr-2">{x.city}</td><td className="pr-2">{x.siteType || '—'}</td>
                    <td className="pr-2 text-right font-semibold">{fmtNum(x.qis)}</td><td className="whitespace-nowrap pr-2">{x.date ? fmtDate(x.date) : '—'}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${x.source === 'Pipeline' || x.dealId ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{x.dealId && x.source !== 'Pipeline' ? 'Tracker + Pipeline' : x.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>





      <FyPlan deals={deals} network={network} cities={cities} team={team} filters={filters} />

      <TargetTrend series={m.series} filtered={!!(filters.region.length || filters.city.length || filters.owner.length || filters.siteType.length || filters.stage.length || filters.recordType || filters.format)} />

        <Panel title="Longest pending in current stage (top 25)">
          {m.stuck.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nothing pending.</p> : (
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-100"><th className="th">Deal</th><th className="th">Stage</th><th className="th">City</th><th className="th">Owner</th><th className="th text-right">QIS</th><th className="th text-right">Days in stage</th></tr></thead>
                <tbody>
                  {m.stuck.map(d => (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="td"><Link className="font-semibold text-slate-900 hover:text-brand-700" to={`/app/deals/${d.id}`}>{d.name}</Link><div className="font-mono text-[10px] text-slate-400">{d.site_code}</div></td>
                      <td className="td"><StageBadge name={d.stage_name} color={d.stage_color} /></td>
                      <td className="td">{d.city}</td>
                      <td className="td">{d.owner || '—'}</td>
                      <td className="td text-right">{d.extra?.qis_count ?? '—'}</td><td className="td text-right"><span className={`inline-block min-w-[2.5rem] rounded-md px-2 py-0.5 text-center font-bold ${stageAgeTone(d.days_in_stage, d.stage_category).cls}`}>{daysInt(d.days_in_stage)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

      <Panel title={<span className="flex items-center justify-between">Franchise payments<Link to="/app/acquisition?tab=payments" className="text-xs font-semibold text-brand-700 hover:underline">Open in Acquisition Desk →</Link></span>}>
        <FranchisePayments filters={filters} compact />
      </Panel>

      <Panel title={`Team performance · by site owner · ${m.period.label}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-slate-100">
              <th className="th">Owner</th><th className="th">Region</th><th className="th text-right">QIS added</th><th className="th text-right">Of those, still Scouting → Handover</th>
              <th className="th text-right">Handed over</th><th className="th text-right">Energized</th><th className="th text-right">Dropped</th>
            </tr></thead>
            <tbody>
              {m.team.map((t, i) => (
                <tr key={t.id} className={`hover:bg-slate-50 ${i && m.team[i - 1].region !== t.region ? 'border-t-2 border-slate-200' : 'border-b border-slate-50'}`}>
                  <td className="td font-semibold">
                    <button className="hover:underline" onClick={() => t.id !== '_none' && goCard(`Sites owned by ${t.name}`, { owner: t.name })}>{t.name}</button>
                    {t.lead && <span className="ml-1 rounded bg-brand-50 px-1 text-[10px] font-semibold text-brand-700">{t.lead}</span>}
                    {!t.active && t.id !== '_none' && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}
                  </td>
                  <td className="td text-slate-500">{t.region}</td>
                  <QS v={t.added} bold /><QS v={t.stillOpen} /><QS v={t.ho} cls="text-amber-700" /><QS v={t.won} cls="text-emerald-700" /><QS v={t.dropped} cls="text-slate-500" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">All columns follow the selected period: added = created in the period; handed over / energized / dropped = happened in the period. Click a name to see their sites. Data as of {fmtDate(new Date())}.</p>
      </Panel>

      <Panel title={<span className="flex flex-wrap items-center gap-2">
          <span className="mr-auto">QIS energized{showHo ? ' & handed over' : ''} — {grain === 'week' ? 'week on week (Mon–Sun)' : 'month on month'}</span>
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><input type="checkbox" checked={showHo} onChange={e => setShowHo(e.target.checked)} className="accent-amber-500" />Show handover</label>
          <span className="flex rounded-lg border border-slate-300 p-0.5 text-xs font-semibold">
            {[['month', 'MoM'], ['week', 'WoW']].map(([v, l]) => <button key={v} onClick={() => setGrain(v)} className={`rounded-md px-2.5 py-1 ${grain === v ? 'bg-navy-900 text-white' : 'text-slate-600'}`}>{l}</button>)}
          </span>
        </span>}>
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>{grain === 'week' ? 'This week' : 'This month'}: <b className="text-emerald-700">{fmtNum(m.delivery.cur.en)} QIS</b> energized <span className="text-slate-400">({m.delivery.cur.enSites} sites)</span>
            {m.delivery.enChg !== null && <span className={`ml-1 font-semibold ${m.delivery.enChg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{m.delivery.enChg >= 0 ? '▲' : '▼'} {Math.abs(m.delivery.enChg)}% vs {grain === 'week' ? 'last week' : 'last month'} ({fmtNum(m.delivery.prev.en)})</span>}</span>
          <span className="text-slate-500">Avg of previous 11 {grain === 'week' ? 'weeks' : 'months'}: <b>{fmtNum(m.delivery.avgEn)} QIS</b></span>
          {showHo && <span>Handed over: <b className="text-amber-600">{fmtNum(m.delivery.cur.ho)} QIS</b>{m.delivery.hoChg !== null && <span className={`ml-1 font-semibold ${m.delivery.hoChg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{m.delivery.hoChg >= 0 ? '▲' : '▼'} {Math.abs(m.delivery.hoChg)}%</span>}</span>}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={m.delivery.rows} margin={{ left: -20, right: 4, top: 16 }}>
            <CartesianGrid vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip cursor={{ fill: '#f8fafc' }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const x = payload[0].payload
              return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                <div className="font-semibold">{fmtDate(x.from)} – {fmtDate(x.to)}</div>
                <div className="text-emerald-700">Energized: <b>{x.en} QIS</b> · {x.enSites} sites</div>
                {showHo && <div className="text-amber-600">Handed over: <b>{x.ho} QIS</b> · {x.hoSites} sites</div>}
              </div>
            }} />
            {showHo && <Legend wrapperStyle={{ fontSize: 12 }} />}
            <Bar dataKey="en" name="QIS energized" fill="#10b981" radius={[4, 4, 0, 0]}><LabelList dataKey="en" position="top" fontSize={10} fill="#475569" formatter={v => (v ? v : '')} /></Bar>
            {showHo && <Bar dataKey="ho" name="QIS handed over" fill="#f59e0b" radius={[4, 4, 0, 0]}><LabelList dataKey="ho" position="top" fontSize={10} fill="#475569" formatter={v => (v ? v : '')} /></Bar>}
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-1 text-xs text-slate-500">Energized = energisation dates from the QIS tracker (Settings → Network data). {grain === 'week' ? 'The current week is partial.' : 'The current month is partial.'} Follows the region / city / site-type filters above.</p>
      </Panel>
    </div>
  )
}

const Panel = ({ title, children, className = '' }) => (
  <div className={`card p-4 sm:p-5 ${className}`}><h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>{children}</div>
)
const QS = ({ v, bold, cls = '' }) => (
  <td className={`td text-right ${cls}`}><span className={bold ? 'font-bold' : ''}>{v.qis}</span><span className="block text-[11px] text-slate-400">{v.sites} sites</span></td>
)
const qs = rs => ({ qis: rs.reduce((a, r) => a + (Number(r.extra?.qis_count) || 0), 0), sites: rs.length })
const AGE_BUCKETS = [[0, 7], [8, 15], [16, 30], [31, 60], [61, Infinity]]
const qisOf = r => Number(r.extra?.qis_count) || 0
const sumQis = rs => rs.reduce((a, r) => a + qisOf(r), 0)
const Toggle = ({ value, onChange }) => (
  <span className="flex rounded-lg border border-slate-300 p-0.5 text-xs font-semibold">
    {[['qis', 'QIS'], ['sites', 'Sites']].map(([v, l]) => (
      <button key={v} onClick={() => onChange(v)} className={`rounded-md px-2.5 py-1 ${value === v ? 'bg-navy-900 text-white' : 'text-slate-600'}`}>{l}</button>
    ))}
  </span>
)
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
