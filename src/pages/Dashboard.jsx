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
  }, [deals, filters, stages, users, history, network, metric])

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
      <DealFilters value={filters} onChange={setFilters} show={['city', 'type', 'stage', 'siteType', 'date']} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total QIS" value={fmtNum(m.totalQis)} icon={Boxes} sub={`${fmtNum(m.total)} sites · ${m.leads} leads · ${m.deals} deals (excl. dropped)`} />
        <Stat label="QIS added this week" value={fmtNum(m.weekQis)} icon={CalendarPlus} tone="blue" sub={`${fmtNum(m.week)} sites`} />
        <Stat label="QIS added this month" value={fmtNum(m.monthQis)} icon={CalendarDays} tone="blue" sub={`${fmtNum(m.month)} sites`} />
        <Stat label="QIS in pipeline" value={fmtNum(m.pipeQis)} icon={Activity} tone="teal" sub={`${fmtNum(m.active)} sites · Scouting → Handover`} />
        <Stat label="Energized via pipeline" value={fmtNum(m.liveQis)} icon={Zap} tone="green" sub={`${fmtNum(m.live)} sites · already inside the network total →`} />
        <Stat label="Energized network" value={fmtNum(m.netQis + m.liveQis)} icon={Network} tone="green" sub={`${fmtNum(m.netSites + m.live)} sites · QIS tracker, each site counted once`} />
      </div>

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
        <Panel title="Pending at each stage" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b border-slate-100"><th className="th">Stage</th><th className="th text-right">QIS</th><th className="th text-right">Sites</th><th className="th text-right">Avg days in stage</th><th className="th text-right">SLA</th><th className="th text-right">Beyond SLA</th><th className="th text-right">Avg TAT (exited)</th></tr></thead>
              <tbody>
                {m.pipeline.map(p => {
                  const t = m.tat.find(x => x.id === p.id)
                  return (
                    <tr key={p.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => go(`stage=${p.id}`)}>
                      <td className="td"><StageBadge name={p.name} color={p.color} /></td>
                      <td className="td text-right font-semibold">{p.qis || '—'}</td>
                      <td className="td text-right text-slate-500">{p.count}</td>
                      <td className="td text-right">{p.count ? daysLabel(p.avgDays) : '—'}</td>
                      <td className="td text-right text-slate-500">{p.sla ? `${p.sla} d` : '—'}</td>
                      <td className={`td text-right font-semibold ${p.overdue ? 'text-red-600' : 'text-slate-300'}`}>{p.overdue}</td>
                      <td className="td text-right">{t ? <span className={t.sla && t.avg > t.sla ? 'font-semibold text-red-600' : ''}>{daysLabel(t.avg)} <span className="text-xs text-slate-400">n={t.n}</span></span> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Avg TAT = average days deals spent in a stage before moving on. Avg scouting → energized cycle: <b>{m.cycle !== null ? daysLabel(m.cycle) : 'no energized deals yet'}</b></p>
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
