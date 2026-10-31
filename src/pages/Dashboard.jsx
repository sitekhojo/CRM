import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { Layers, CalendarPlus, CalendarDays, AlertTriangle, CheckCircle2, Zap, XCircle, Activity } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS } from '../lib/deals'
import { supabase, fetchAll } from '../lib/supabase'
import { useConfig } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { Stat, StageBadge, PageLoader } from '../components/ui'
import { fmtNum, daysLabel, startOfWeek, startOfMonth, fmtDate } from '../lib/format'

export default function Dashboard() {
  const { deals, loading } = useDeals()
  const { stages = [], users = [] } = useConfig()
  const [history, setHistory] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const nav = useNavigate()

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
    const pipeline = stages.filter(s => s.is_active).map(s => ({
      id: s.id, name: s.name, color: s.color, sla: s.sla_days, count: stageCounts[s.id] || 0,
      overdue: rows.filter(r => r.stage_id === s.id && r.is_overdue).length,
      avgDays: avg(rows.filter(r => r.stage_id === s.id).map(r => +r.days_in_stage)),
    }))

    const cityCounts = Object.entries(by(r => r.city)).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count)

    // weekly trend (last 12 weeks)
    const weeks = Array.from({ length: 12 }, (_, i) => { const d = startOfWeek(); d.setDate(d.getDate() - 7 * (11 - i)); return d })
    const trend = weeks.map((w, i) => {
      const end = weeks[i + 1] || new Date(8.64e15)
      return { week: w.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), count: rows.filter(r => { const c = new Date(r.created_at); return c >= w && c < end }).length }
    })

    // TAT between stages, restricted to the filtered deals
    const ids = new Set(rows.map(r => r.id))
    const h = (history || []).filter(x => ids.has(x.site_id) && x.from_stage_id && x.days_in_from_stage !== null)
    const tat = stages.filter(s => s.category === 'active').map(s => {
      const xs = h.filter(x => x.from_stage_id === s.id).map(x => +x.days_in_from_stage)
      return { id: s.id, name: s.name, color: s.color, sla: s.sla_days, avg: avg(xs), n: xs.length }
    }).filter(x => x.n > 0)

    // Lead → Live cycle time
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
        scouted: mine.length,
        week: mine.filter(r => new Date(r.created_at) >= wk).length,
        month: mine.filter(r => new Date(r.created_at) >= mo).length,
        owned: owned.filter(r => r.stage_category === 'active').length,
        won: owned.filter(r => ['approved', 'live'].includes(r.stage_category)).length,
        dropped: owned.filter(r => r.stage_category === 'dropped').length,
        overdue: owned.filter(r => r.is_overdue).length,
        moves: moves.length,
      }
    }).filter(t => t.scouted || t.owned || t.moves || t.active).sort((a, b) => b.scouted - a.scouted)

    const stuck = rows.filter(r => r.is_overdue).sort((a, b) => (b.days_in_stage - b.stage_sla_days) - (a.days_in_stage - a.stage_sla_days))

    return {
      total: rows.length,
      leads: rows.filter(r => r.record_type === 'lead').length,
      deals: rows.filter(r => r.record_type !== 'lead').length,
      week: rows.filter(r => new Date(r.created_at) >= wk).length,
      month: rows.filter(r => new Date(r.created_at) >= mo).length,
      active: rows.filter(r => r.stage_category === 'active').length,
      approved: rows.filter(r => r.stage_category === 'approved').length,
      live: rows.filter(r => r.stage_category === 'live').length,
      dropped: rows.filter(r => r.stage_category === 'dropped').length,
      overdue: stuck.length,
      pipeline, cityCounts, trend, tat, team, stuck, cycle,
      dropReasons: Object.entries(by(r => r.stage_category === 'dropped' ? r.drop_reason || 'Unspecified' : null)).filter(([k]) => k !== 'null').sort((a, b) => b[1] - a[1]),
    }
  }, [deals, filters, stages, users, history])

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Total sites" value={fmtNum(m.total)} icon={Layers} sub={`${m.leads} leads · ${m.deals} deals`} />
        <Stat label="This week" value={fmtNum(m.week)} icon={CalendarPlus} tone="blue" />
        <Stat label="This month" value={fmtNum(m.month)} icon={CalendarDays} tone="blue" />
        <Stat label="In pipeline" value={fmtNum(m.active)} icon={Activity} />
        <Stat label="Approved" value={fmtNum(m.approved)} icon={CheckCircle2} tone="teal" />
        <Stat label="Live" value={fmtNum(m.live)} icon={Zap} tone="green" />
        <Stat label="Dropped" value={fmtNum(m.dropped)} icon={XCircle} tone="red" />
        <Stat label="Beyond SLA" value={fmtNum(m.overdue)} icon={AlertTriangle} tone={m.overdue ? 'red' : 'slate'} onClick={() => go('overdue=1')} sub="Click to view" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Stage-wise pipeline" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={m.pipeline} margin={{ left: -20, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="count" name="Deals" radius={[6, 6, 0, 0]} onClick={d => go(`stage=${d.id}`)} className="cursor-pointer">
                {m.pipeline.map(p => <Cell key={p.id} fill={p.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="City-wise distribution">
          <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
            {m.cityCounts.length === 0 && <p className="text-sm text-slate-400">No data</p>}
            {m.cityCounts.map(c => (
              <button key={c.city} onClick={() => go(`city=${encodeURIComponent(c.city)}`)} className="block w-full text-left">
                <div className="flex justify-between text-sm"><span className="font-medium">{c.city}</span><span className="font-bold">{c.count}</span></div>
                <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(100 * c.count) / m.cityCounts[0].count}%` }} /></div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Pending at each stage" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b border-slate-100"><th className="th">Stage</th><th className="th text-right">Deals</th><th className="th text-right">Avg days in stage</th><th className="th text-right">SLA</th><th className="th text-right">Beyond SLA</th><th className="th text-right">Avg TAT (exited)</th></tr></thead>
              <tbody>
                {m.pipeline.map(p => {
                  const t = m.tat.find(x => x.id === p.id)
                  return (
                    <tr key={p.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => go(`stage=${p.id}`)}>
                      <td className="td"><StageBadge name={p.name} color={p.color} /></td>
                      <td className="td text-right font-semibold">{p.count}</td>
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
          <p className="mt-2 text-xs text-slate-500">Avg TAT = average days deals spent in a stage before moving on. Avg lead → live cycle: <b>{m.cycle !== null ? daysLabel(m.cycle) : 'no live deals yet'}</b></p>
        </Panel>
        <Panel title="Sites added — last 12 weeks">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={m.trend} margin={{ left: -25, right: 4 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={1} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="count" name="Sites" fill="#10b981" radius={[4, 4, 0, 0]} />
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
              <th className="th">Team member</th><th className="th text-right">Scouted</th><th className="th text-right">This week</th><th className="th text-right">This month</th>
              <th className="th text-right">Open deals owned</th><th className="th text-right">Approved / Live</th><th className="th text-right">Dropped</th><th className="th text-right">Beyond SLA</th><th className="th text-right">Stage moves</th>
            </tr></thead>
            <tbody>
              {m.team.map(t => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="td font-semibold">{t.name}{!t.active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}</td>
                  <td className="td text-right font-bold">{t.scouted}</td><td className="td text-right">{t.week}</td><td className="td text-right">{t.month}</td>
                  <td className="td text-right">{t.owned}</td><td className="td text-right text-emerald-700">{t.won}</td><td className="td text-right text-slate-500">{t.dropped}</td>
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
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
