import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { Layers, CalendarPlus, CalendarDays, Zap, Activity, Boxes, Network } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints } from '../lib/deals'
import { supabase, fetchAll } from '../lib/supabase'
import { useConfig, stagesFor } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { Stat, StageBadge, PageLoader } from '../components/ui'
import { fmtNum, daysLabel, startOfWeek, startOfMonth, fmtDate } from '../lib/format'
import { haversine } from '../lib/geo'

export default function Dashboard() {
  const { deals, loading } = useDeals()
  const { stages = [], users = [] } = useConfig()
  const [history, setHistory] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [period, setPeriod] = useState({ kind: 'month', from: '', to: '' })
  const [network, setNetwork] = useState([])
  const [metric, setMetric] = useState('qis') // chart unit: 'qis' | 'sites'
  const nav = useNavigate()

  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => {}) }, [])

  useEffect(() => {
    fetchAll(() => supabase.from('stage_history_overview').select('id,site_id,from_stage_id,to_stage_id,from_stage_name,to_stage_name,days_in_from_stage,changed_at,changed_by,city,site_created_by').order('id'))
      .then(setHistory).catch(() => setHistory([]))
  }, [])

  const m = useMemo(() => {
    if (!deals) return null
    const rows = applyFilters(deals, filters)
    const [pStart, pEnd] = periodRange(period)
    const inP = d => { if (!d) return false; const t = new Date(d); return t >= pStart && t <= pEnd }
    const keyId = Object.fromEntries(stages.map(s => [s.key, s.id]))
    const firstEntry = (siteId, stageId) => (history || []).find(x => x.site_id === siteId && x.to_stage_id === stageId)?.changed_at
    const hoDate = r => r.extra?.ho_date || firstEntry(r.id, keyId.ho_done) || (r.stage_id === keyId.ho_done ? r.stage_entered_at : null)
    const enDate = r => r.extra?.energized_on || firstEntry(r.id, keyId.energized) || (r.stage_id === keyId.energized ? r.stage_entered_at : null)
    const wk = startOfWeek(), mo = startOfMonth()
    const by = (fn) => rows.reduce((acc, r) => { const k = fn(r); acc[k] = (acc[k] || 0) + 1; return acc }, {})

    const stageCounts = by(r => r.stage_id)
    const pipeline = stagesFor(stages, filters.siteType).map(s => ({
      id: s.id, name: s.name, color: s.color, sla: s.sla_days, count: stageCounts[s.id] || 0, sites: stageCounts[s.id] || 0,
      qis: rows.filter(r => r.stage_id === s.id).reduce((a, r) => a + qisOf(r), 0),
      overdue: rows.filter(r => r.stage_id === s.id && r.is_overdue).length,
      avgDays: avg(rows.filter(r => r.stage_id === s.id).map(r => +r.days_in_stage)),
    }))

    const open = rows.filter(r => r.stage_category !== 'dropped')
    const cityCounts = Object.values(open.reduce((acc, r) => {
      const c = acc[r.city] || (acc[r.city] = { city: r.city, sites: 0, qis: 0 })
      c.sites += 1; c.qis += qisOf(r); return acc
    }, {})).sort((a, b) => b[metric] - a[metric] || b.sites - a.sites)
    const energizedDeals = rows.filter(r => r.stage_category === 'live')
    const netAll = network.filter(n => n.point_type === 'own_station' && (!filters.city.length || filters.city.includes(n.city)) && (!filters.siteType.length || filters.siteType.includes(n.site_type)))
    const net = network.filter(n => n.point_type === 'own_station' && (!filters.city.length || filters.city.includes(n.city)) && (!filters.siteType.length || filters.siteType.includes(n.site_type)))
      .filter(n => !energizedDeals.some(d => haversine(d.latitude, d.longitude, n.latitude, n.longitude) <= 100)) // already counted as a deal

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

    // team performance
    const team = users.map(u => {
      const mine = rows.filter(r => r.created_by === u.id)
      const owned = rows.filter(r => r.assigned_to === u.id)
      const moves = h.filter(x => x.changed_by === u.id)
      return {
        id: u.id, name: u.full_name || u.email, active: u.is_active,
        scouted: qs(mine),
        week: qs(mine.filter(r => new Date(r.created_at) >= wk)),
        month: qs(mine.filter(r => new Date(r.created_at) >= mo)),
        owned: qs(owned.filter(r => ['active', 'approved'].includes(r.stage_category))),
        won: qs(owned.filter(r => r.stage_category === 'live')),
        dropped: qs(owned.filter(r => r.stage_category === 'dropped')),
        overdue: owned.filter(r => r.is_overdue).length,
        moves: moves.length,
      }
    }).filter(t => t.scouted.sites || t.owned.sites || t.moves || t.active).sort((a, b) => b.scouted.qis - a.scouted.qis)

    const stuck = rows.filter(r => r.is_overdue).sort((a, b) => (b.days_in_stage - b.stage_sla_days) - (a.days_in_stage - a.stage_sla_days))

    return {
      total: open.length,
      pending: (() => {
        const open = rows.filter(r => ['active', 'approved', 'hold'].includes(r.stage_category))
        const rowsOut = stages.filter(st => st.is_active && ['active', 'approved', 'hold'].includes(st.category)).map(st => {
          const xs = open.filter(r => r.stage_id === st.id)
          const days = xs.map(r => +r.days_in_stage)
          return {
            id: st.id, name: st.name, color: st.color, sla: st.sla_days, sites: xs.length, qis: sumQis(xs),
            avg: avg(days), max: days.length ? Math.max(...days) : null,
            items: xs.map(r => ({ id: r.id, name: r.name, city: r.city, days: +r.days_in_stage, qis: qisOf(r) })),
          }
        }).filter(x => x.sites > 0)
        const maxDays = Math.max(30, ...rowsOut.map(x => x.max || 0))
        return { rows: rowsOut, scale: Math.min(90, Math.ceil(maxDays / 10) * 10) }
      })(),
      ageing: (() => {
        const open = rows.filter(r => ['active', 'approved', 'hold'].includes(r.stage_category))
        return stages.filter(st => st.is_active && ['active', 'approved', 'hold'].includes(st.category)).map(st => {
          const xs = open.filter(r => r.stage_id === st.id)
          const cells = AGE_BUCKETS.map(([lo, hi]) => {
            const ys = xs.filter(r => +r.days_in_stage >= lo && +r.days_in_stage <= hi)
            return { lo, hi, qis: sumQis(ys), sites: ys.length, overSla: st.sla_days ? lo > st.sla_days : false, partSla: st.sla_days ? hi > st.sla_days && lo <= st.sla_days : false }
          })
          return { id: st.id, name: st.name, color: st.color, sla: st.sla_days, qis: sumQis(xs), sites: xs.length, overdueQis: sumQis(xs.filter(r => r.is_overdue)), cells }
        }).filter(x => x.sites > 0)
      })(),
      period: (() => {
        const added = rows.filter(r => inP(r.created_at))
        const stillOpen = added.filter(r => ['active', 'approved'].includes(r.stage_category))
        const ho = rows.filter(r => inP(hoDate(r)))
        // energized in period: QIS-tracker dates + CRM energized sites that are not in the tracker
        const trackerEn = netAll.reduce((a, n) => a + Object.entries(n.energized_dates || {}).reduce((b, [d, c]) => b + (inP(d + 'T12:00:00') ? c : 0), 0), 0)
        const crmOnly = energizedDeals.filter(d => !netAll.some(n => haversine(d.latitude, d.longitude, n.latitude, n.longitude) <= 100))
        const crmEn = crmOnly.filter(r => inP(enDate(r)))
        const crmMatchedIds = new Set(energizedDeals.filter(d => !crmOnly.includes(d)).map(d => d.id))
        const enSites = netAll.filter(n => Object.keys(n.energized_dates || {}).some(d => inP(d + 'T12:00:00'))).length + crmEn.length
        const flow = {}
        for (const r of added) { const k = r.stage_name; flow[k] = flow[k] || { name: k, color: r.stage_color, order: r.stage_order, qis: 0, sites: 0 }; flow[k].qis += qisOf(r); flow[k].sites++ }
        return {
          label: periodLabel(period, pStart, pEnd),
          added: qs(added), open: qs(stillOpen), ho: qs(ho),
          en: { qis: trackerEn + sumQis(crmEn), sites: enSites }, crmMatched: crmMatchedIds.size,
          flow: Object.values(flow).sort((a, b) => a.order - b.order),
        }
      })(),
      totalQis: sumQis(open),
      weekQis: sumQis(open.filter(r => new Date(r.created_at) >= wk)),
      monthQis: sumQis(open.filter(r => new Date(r.created_at) >= mo)),
      netSites: net.length,
      netQis: net.reduce((a, n) => a + (Number(n.weight) || 0), 0),
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
      pipeline, cityCounts, trend, tat, team, stuck, cycle,
      dropReasons: Object.entries(by(r => r.stage_category === 'dropped' ? r.drop_reason || 'Unspecified' : null)).filter(([k]) => k !== 'null').sort((a, b) => b[1] - a[1]),
    }
  }, [deals, filters, stages, users, history, network, metric, period])

  if (loading || !m) return <PageLoader />
  const go = q => nav(`/app/deals?${q}`)

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold text-navy-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Network expansion at a glance{filters.from || filters.to ? ' · date filter applies to deal creation date' : ''}</p>
        </div>
      </div>
      <DealFilters value={filters} onChange={setFilters} show={['city', 'type', 'stage', 'siteType']} />
      <PeriodBar value={period} onChange={setPeriod} label={m.period.label} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total QIS" value={fmtNum(m.totalQis)} icon={Boxes} sub={`${fmtNum(m.total)} sites · all open, excl. dropped`} />
        <Stat label="QIS added" value={fmtNum(m.period.added.qis)} icon={CalendarPlus} tone="blue" sub={`${fmtNum(m.period.added.sites)} sites · ${m.period.label}`} />
        <Stat label="QIS in pipeline" value={fmtNum(m.period.open.qis)} icon={Activity} tone="teal" sub={`${fmtNum(m.period.open.sites)} sites · of those added, still Scouting → Handover`} />
        <Stat label="QIS handed over" value={fmtNum(m.period.ho.qis)} icon={CalendarDays} tone="amber" sub={`${fmtNum(m.period.ho.sites)} sites · ${m.period.label}`} />
        <Stat label="QIS energized" value={fmtNum(m.period.en.qis)} icon={Zap} tone="green" sub={`${fmtNum(m.period.en.sites)} sites · ${m.period.label}`} />
        <Stat label="Energized network" value={fmtNum(m.netQis + m.liveQis)} icon={Network} tone="green" sub={`${fmtNum(m.netSites + m.live)} sites to date · +${fmtNum(m.period.en.qis)} in period`} />
      </div>

      <Panel title={`Where did the QIS added ${m.period.label} go? (current stage)`}>
        {m.period.flow.length === 0 ? <p className="text-sm text-slate-400">No QIS added in this period.</p> : (
          <>
            <div className="flex h-8 w-full overflow-hidden rounded-lg">
              {m.period.flow.map(f => (
                <div key={f.name} title={`${f.name}: ${f.qis} QIS`} style={{ width: `${(100 * f.qis) / Math.max(1, m.period.added.qis)}%`, background: f.color }} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {m.period.flow.map(f => (
                <span key={f.name} className="flex items-center gap-1.5 text-sm"><span className="h-3 w-3 rounded-sm" style={{ background: f.color }} />{f.name} <b>{f.qis}</b><span className="text-xs text-slate-400">QIS · {f.sites} sites</span></span>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel title="Pending right now — how long sites have been waiting in each stage">
        <div className="space-y-1">
          <div className="hidden grid-cols-12 gap-3 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid">
            <span className="col-span-2">Stage</span><span className="col-span-1 text-right">QIS</span><span className="col-span-1 text-right">Avg wait</span><span className="col-span-1 text-right">Oldest</span>
            <span className="col-span-7 flex justify-between"><span>each dot = a site (size = QIS) · days in stage →</span><span>{m.pending.scale}+ d</span></span>
          </div>
          {m.pending.rows.map(p => (
            <div key={p.id} className="grid grid-cols-12 items-center gap-3 rounded-lg px-1 py-2 hover:bg-slate-50">
              <span className="col-span-12 md:col-span-2"><StageBadge name={p.name} color={p.color} /></span>
              <span className="col-span-4 text-right md:col-span-1"><b className="text-lg">{p.qis}</b><span className="block text-[11px] text-slate-400">{p.sites} sites</span></span>
              <span className={`col-span-4 text-right md:col-span-1 ${p.sla && p.avg > p.sla ? 'text-red-600' : ''}`}><b className="text-lg">{fmtNum(p.avg, 0)}</b> d<span className="block text-[11px] text-slate-400">avg</span></span>
              <span className={`col-span-4 text-right md:col-span-1 ${p.sla && p.max > p.sla ? 'text-red-600' : ''}`}><b className="text-lg">{fmtNum(p.max, 0)}</b> d<span className="block text-[11px] text-slate-400">oldest</span></span>
              <div className="relative col-span-12 h-9 rounded-md bg-slate-100 md:col-span-7">
                {p.sla && p.sla < m.pending.scale && (
                  <div className="absolute inset-y-0 z-0 border-l-2 border-dashed border-red-400" style={{ left: `${(100 * p.sla) / m.pending.scale}%` }} title={`SLA ${p.sla} days`}>
                    <span className="absolute -top-0.5 left-1 text-[9px] font-bold text-red-500">SLA {p.sla}d</span>
                  </div>
                )}
                {p.items.map(x => (
                  <button key={x.id} onClick={() => nav(`/app/deals/${x.id}`)} title={`${x.name} · ${x.city} · ${fmtNum(x.days, 0)} days · ${x.qis} QIS`}
                    className={`absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow transition hover:z-20 hover:scale-150 ${p.sla && x.days > p.sla ? 'bg-red-500' : p.sla && x.days > p.sla * 0.7 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                    style={{ left: `${Math.min(98, Math.max(2, (100 * Math.min(x.days, m.pending.scale)) / m.pending.scale))}%`, width: 10 + Math.min(10, x.qis * 1.2), height: 10 + Math.min(10, x.qis * 1.2) }} />
                ))}
              </div>
            </div>
          ))}
          {m.pending.rows.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Nothing pending.</p>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Days counted from the date the site entered its current stage (e.g. LOI signed on 1 Jan → on 20 Jan it shows 20 days in LOI Signed). <span className="text-emerald-600">●</span> on track · <span className="text-amber-500">●</span> nearing SLA · <span className="text-red-500">●</span> beyond SLA. Hover a dot for the site, click to open it.</p>
      </Panel>


      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title={<span className="flex items-center justify-between">Stage-wise pipeline<Toggle value={metric} onChange={setMetric} /></span>} className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={m.pipeline} margin={{ left: -20, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey={metric} name={metric === 'qis' ? 'QIS' : 'Sites'} radius={[6, 6, 0, 0]} onClick={d => go(`stage=${d.id}`)} className="cursor-pointer">
                {m.pipeline.map(p => <Cell key={p.id} fill={p.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={`City-wise ${metric === 'qis' ? 'QIS' : 'sites'} (excl. dropped)`}>
          <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
            {m.cityCounts.length === 0 && <p className="text-sm text-slate-400">No data</p>}
            {m.cityCounts.map(c => (
              <button key={c.city} onClick={() => go(`city=${encodeURIComponent(c.city)}`)} className="block w-full text-left">
                <div className="flex justify-between text-sm"><span className="font-medium">{c.city}</span>
                  <span><b>{fmtNum(c[metric])}</b> <span className="text-xs text-slate-400">{metric === 'qis' ? `QIS · ${c.sites} sites` : `sites · ${c.qis} QIS`}</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(100 * c[metric]) / Math.max(1, m.cityCounts[0][metric])}%` }} /></div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="How long are QIS pending? (current stage × days in stage)" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b border-slate-100">
                <th className="th">Stage</th><th className="th text-right">QIS</th><th className="th text-right">SLA</th>
                {AGE_BUCKETS.map(([lo, hi]) => <th key={lo} className="th text-center">{hi === Infinity ? `${lo}+ d` : `${lo}–${hi} d`}</th>)}
                <th className="th text-right">Beyond SLA</th>
              </tr></thead>
              <tbody>
                {m.ageing.map(a => (
                  <tr key={a.id} className="border-b border-slate-50">
                    <td className="td"><StageBadge name={a.name} color={a.color} /></td>
                    <td className="td text-right font-semibold">{a.qis}<span className="block text-[11px] font-normal text-slate-400">{a.sites} sites</span></td>
                    <td className="td text-right text-slate-500">{a.sla ? `${a.sla} d` : '—'}</td>
                    {a.cells.map(c => (
                      <td key={c.lo} className="px-1 py-1 text-center">
                        {c.sites ? (
                          <button onClick={() => go(`stage=${a.id}&age=${c.lo}-${c.hi === Infinity ? '' : c.hi}`)} title="Open these sites"
                            className={`w-full rounded-md px-2 py-1.5 text-sm font-bold transition hover:ring-2 hover:ring-slate-300 ${c.overSla ? 'bg-red-100 text-red-700' : c.partSla ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
                            {c.qis}<span className="block text-[10px] font-medium opacity-70">{c.sites} {c.sites === 1 ? "site" : "sites"}</span>
                          </button>
                        ) : <span className="text-slate-200">·</span>}
                      </td>
                    ))}
                    <td className={`td text-right font-semibold ${a.overdueQis ? 'text-red-600' : 'text-slate-300'}`}>{a.overdueQis} QIS</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500"><span className="rounded bg-emerald-50 px-1 text-emerald-800">green</span> within SLA · <span className="rounded bg-amber-100 px-1 text-amber-800">amber</span> crossing SLA · <span className="rounded bg-red-100 px-1 text-red-700">red</span> beyond SLA. Click a cell to open those sites. SLA days are set in Settings → Pipeline stages.</p>
        </Panel>
        <Panel title={`${metric === 'qis' ? 'QIS' : 'Sites'} added — last 12 weeks`}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={m.trend} margin={{ left: -25, right: 4 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={1} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="count" name={metric === 'qis' ? 'QIS' : 'Sites'} fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title={`Stuck beyond SLA (${m.stuck.length})`} className="xl:col-span-2">
          {m.stuck.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nothing stuck. 🎉</p> : (
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-100"><th className="th">Deal</th><th className="th">Stage</th><th className="th">City</th><th className="th">Owner</th><th className="th text-right">Days / SLA</th></tr></thead>
                <tbody>
                  {m.stuck.map(d => (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="td"><Link className="font-semibold text-slate-900 hover:text-brand-700" to={`/app/deals/${d.id}`}>{d.name}</Link><div className="font-mono text-[10px] text-slate-400">{d.site_code}</div></td>
                      <td className="td"><StageBadge name={d.stage_name} color={d.stage_color} /></td>
                      <td className="td">{d.city}</td>
                      <td className="td">{d.assigned_to_name || '—'}</td>
                      <td className="td text-right font-semibold text-red-600">{fmtNum(d.days_in_stage, 1)} / {d.stage_sla_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Drop reasons">
          {m.dropReasons.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No dropped deals</p> : (
            <ul className="space-y-2 text-sm">{m.dropReasons.map(([r, n]) => <li key={r} className="flex justify-between"><span>{r}</span><b>{n}</b></li>)}</ul>
          )}
        </Panel>
      </div>

      <Panel title="Team performance">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-slate-100">
              <th className="th">Team member</th><th className="th text-right">QIS scouted</th><th className="th text-right">This week</th><th className="th text-right">This month</th>
              <th className="th text-right">QIS in pipeline (owned)</th><th className="th text-right">QIS energized</th><th className="th text-right">QIS dropped</th><th className="th text-right">Beyond SLA</th><th className="th text-right">Stage moves</th>
            </tr></thead>
            <tbody>
              {m.team.map(t => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="td font-semibold">{t.name}{!t.active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}</td>
                  <QS v={t.scouted} bold /><QS v={t.week} /><QS v={t.month} />
                  <QS v={t.owned} /><QS v={t.won} cls="text-emerald-700" /><QS v={t.dropped} cls="text-slate-500" />
                  <td className={`td text-right ${t.overdue ? 'font-semibold text-red-600' : 'text-slate-300'}`}>{t.overdue}</td><td className="td text-right">{t.moves}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Data as of {fmtDate(new Date())}.</p>
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
function periodRange({ kind, from, to }) {
  const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999)
  if (kind === 'custom') {
    return [from ? new Date(from + 'T00:00:00') : new Date(2000, 0, 1), to ? new Date(to + 'T23:59:59') : end]
  }
  if (kind === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end]
  if (kind === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q, 1), end] }
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1 // Indian FY: Apr–Mar
  return [new Date(fy, 3, 1), end]
}
function periodLabel({ kind }, a, b) {
  const f = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  if (kind === 'month') return `in ${a.toLocaleDateString('en-IN', { month: 'long' })}`
  if (kind === 'quarter') { const fyq = ((Math.floor(a.getMonth() / 3) + 3) % 4) + 1; return `in Q${fyq} (${a.toLocaleDateString('en-IN', { month: 'short' })}–now)` }
  if (kind === 'fy') { const y = a.getFullYear(); return `in FY${String(y + 1).slice(2)} (Apr ${y}–now)` }
  return `${f(a)} – ${f(b)}`
}
function PeriodBar({ value, onChange, label }) {
  const opt = [['month', 'This month'], ['quarter', 'This quarter'], ['fy', 'This FY'], ['custom', 'Custom']]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
        {opt.map(([k, l]) => (
          <button key={k} onClick={() => onChange({ ...value, kind: k })} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${value.kind === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>
      {value.kind === 'custom' && (
        <div className="flex items-center gap-1">
          <input type="date" className="input w-auto" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} />
          <span className="text-slate-400">–</span>
          <input type="date" className="input w-auto" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} />
        </div>
      )}
      <span className="text-sm text-slate-500">Showing activity <b>{label}</b></span>
    </div>
  )
}
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
