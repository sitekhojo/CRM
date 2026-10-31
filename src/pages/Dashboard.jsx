import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList, Legend } from 'recharts'
import { Layers, CalendarPlus, CalendarDays, Zap, Activity, Boxes, Network } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints } from '../lib/deals'
import { supabase, fetchAll } from '../lib/supabase'
import { useConfig, stagesFor, REGIONS } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { Stat, StageBadge, PageLoader, Modal } from '../components/ui'
import { fmtNum, daysLabel, startOfWeek, startOfMonth, fmtDate } from '../lib/format'
import { haversine, hasLoc } from '../lib/geo'

export default function Dashboard() {
  const { deals, loading } = useDeals()
  const { stages = [], users = [], team = [], cities = [] } = useConfig()
  const [history, setHistory] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [period, setPeriod] = useState({ kind: 'month', from: '', to: '' })
  const [network, setNetwork] = useState([])
  const [metric, setMetric] = useState('qis') // chart unit: 'qis' | 'sites'
  const [enOpen, setEnOpen] = useState(false)
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
    const pipeline = stagesFor(stages, filters.siteType).filter(s => s.category !== 'dropped').map(s => ({
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
        ...energizedDeals.filter(d => !netAll.some(n => near(d, n))).map(r => ({ d: String(enDate(r) || '').slice(0, 10), qis: qisOf(r) })).filter(x => x.d),
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
      return {
        id: name || '_none', name: name || 'Unassigned', region: t?.region || owned[0]?.region || '—', lead: !!t?.is_lead, active: t ? t.is_active : !!name,
        total: qs(owned.filter(r => r.stage_category !== 'dropped')),
        week: qs(owned.filter(r => new Date(r.created_at) >= wk)),
        month: qs(owned.filter(r => new Date(r.created_at) >= mo)),
        owned: qs(owned.filter(r => ['active', 'approved'].includes(r.stage_category))),
        hold: qs(owned.filter(r => r.stage_category === 'hold')),
        ho: qs(owned.filter(r => inP(hoDate(r)))),
        won: qs(owned.filter(r => r.stage_category === 'live')),
        dropped: qs(owned.filter(r => r.stage_category === 'dropped')),
        overdue: owned.filter(r => r.is_overdue).length,
      }
    }).filter(x => x.total.sites || x.dropped.sites || (x.active && x.id !== '_none'))
      .sort((a, b) => regionRank(a.region) - regionRank(b.region) || b.lead - a.lead || b.total.qis - a.total.qis)

    const stuck = rows.filter(r => r.is_overdue).sort((a, b) => (b.days_in_stage - b.stage_sla_days) - (a.days_in_stage - a.stage_sla_days))

    return {
      total: open.length,
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
        const crmOnly = energizedDeals.filter(d => !netAll.some(n => near(d, n)))
        const crmEn = crmOnly.filter(r => inP(enDate(r)))
        const crmMatchedIds = new Set(energizedDeals.filter(d => !crmOnly.includes(d)).map(d => d.id))
        const enSites = netAll.filter(n => Object.keys(n.energized_dates || {}).some(d => inP(d + 'T12:00:00'))).length + crmEn.length
        const enList = [
          ...netAll.flatMap(n => {
            const ds = Object.entries(n.energized_dates || {}).filter(([d]) => inP(d + 'T12:00:00'))
            if (!ds.length) return []
            const deal = energizedDeals.find(d => near(d, n))
            return [{ key: 'n' + n.id, name: n.name, city: n.city, siteType: n.site_type, qis: ds.reduce((a, [, c]) => a + (Number(c) || 0), 0), date: ds.map(([d]) => d).sort().pop(), source: 'QIS tracker', dealId: deal?.id }]
          }),
          ...crmEn.map(r => ({ key: 's' + r.id, name: r.name, city: r.city, siteType: r.site_type, qis: qisOf(r), date: String(enDate(r) || '').slice(0, 10), source: 'Pipeline', dealId: r.id })),
        ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.qis - a.qis)
        const flow = {}
        for (const r of added) { const k = r.stage_name; flow[k] = flow[k] || { name: k, color: r.stage_color, order: r.stage_order, qis: 0, sites: 0 }; flow[k].qis += qisOf(r); flow[k].sites++ }
        return {
          label: periodLabel(period, pStart, pEnd), from: isoDay(pStart), to: isoDay(pEnd),
          added: qs(added), open: qs(stillOpen), ho: qs(ho),
          en: { qis: trackerEn + sumQis(crmEn), sites: enSites, list: enList }, crmMatched: crmMatchedIds.size,
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
      pipeline, cityCounts, trend, delivery, tat, team: teamRows, stuck, cycle,
      dropReasons: Object.entries(by(r => r.stage_category === 'dropped' ? r.drop_reason || 'Unspecified' : null)).filter(([k]) => k !== 'null').sort((a, b) => b[1] - a[1]),
    }
  }, [deals, filters, stages, users, team, cities, history, network, metric, period, grain])

  if (loading || !m) return <PageLoader />
  const go = q => nav(`/app/deals?${q}`)
  const goCard = (card, extra) => {
    const p = new URLSearchParams({ card, ...extra })
    if (filters.city.length) p.set('city', filters.city.join(','))
    if (filters.siteType.length) p.set('siteType', filters.siteType.join(','))
    if (filters.region.length && !extra.region) p.set('region', filters.region.join(','))
    if (filters.owner.length && !extra.owner) p.set('owner', filters.owner.join(','))
    if (filters.recordType) p.set('type', filters.recordType)
    if (filters.stage.length && !extra.stage) p.set('stage', filters.stage.join(','))
    nav(`/app/deals?${p}`)
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-extrabold text-navy-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Network expansion at a glance{filters.from || filters.to ? ' · date filter applies to deal creation date' : ''}</p>
        </div>
      </div>
      <DealFilters value={filters} onChange={setFilters} show={['region', 'city', 'owner', 'type', 'stage', 'siteType']} />
      <PeriodBar value={period} onChange={setPeriod} label={m.period.label} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total QIS" value={fmtNum(m.totalQis)} icon={Boxes} sub={`${fmtNum(m.total)} sites · all open, excl. dropped`}
          onClick={() => goCard('Total QIS', { open: '1' })} />
        <Stat label="QIS added" value={fmtNum(m.period.added.qis)} icon={CalendarPlus} tone="blue" sub={`${fmtNum(m.period.added.sites)} sites · ${m.period.label}`}
          onClick={() => goCard(`QIS added ${m.period.label}`, { from: m.period.from, to: m.period.to })} />
        <Stat label="QIS in pipeline" value={fmtNum(m.period.open.qis)} icon={Activity} tone="teal" sub={`${fmtNum(m.period.open.sites)} sites · of those added, still Scouting → Handover`}
          onClick={() => goCard(`QIS in pipeline (added ${m.period.label})`, { from: m.period.from, to: m.period.to, stage: stages.filter(s => s.is_active && ['active', 'approved'].includes(s.category)).map(s => s.id).join(',') })} />
        <Stat label="QIS handed over" value={fmtNum(m.period.ho.qis)} icon={CalendarDays} tone="amber" sub={`${fmtNum(m.period.ho.sites)} sites · ${m.period.label}`}
          onClick={() => goCard(`QIS handed over ${m.period.label}`, { ho: `${m.period.from},${m.period.to}` })} />
        <Stat label="QIS energized" value={fmtNum(m.period.en.qis)} icon={Zap} tone="green" sub={`${fmtNum(m.period.en.sites)} sites · ${m.period.label}`}
          onClick={() => setEnOpen(true)} />
        <Stat label="Energized network" value={fmtNum(m.netQis + m.liveQis)} icon={Network} tone="green" sub={`${fmtNum(m.netSites + m.live)} sites to date · +${fmtNum(m.period.en.qis)} in period`}
          onClick={() => nav('/app/map?network=1')} />
      </div>

      <Modal open={enOpen} onClose={() => setEnOpen(false)} wide title={`Energized ${m.period.label} · ${fmtNum(m.period.en.qis)} QIS · ${fmtNum(m.period.en.sites)} sites`}
        footer={<><button className="btn btn-ghost" onClick={() => nav('/app/map?network=1')}>Open on map</button><button className="btn btn-ghost" onClick={() => goCard(`Pipeline sites energized ${m.period.label}`, { en: `${m.period.from},${m.period.to}` })}>Pipeline sites only</button><button className="btn btn-primary" onClick={() => setEnOpen(false)}>Close</button></>}>
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
                      <td className="td">{d.owner || '—'}</td>
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

      <Panel title="Team performance · by site owner">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-slate-100">
              <th className="th">Owner</th><th className="th">Region</th><th className="th text-right">QIS owned (excl. dropped)</th><th className="th text-right">Added this week</th><th className="th text-right">Added this month</th>
              <th className="th text-right">In pipeline</th><th className="th text-right">On hold</th><th className="th text-right">Handed over · {m.period.label}</th><th className="th text-right">Energized</th><th className="th text-right">Dropped</th><th className="th text-right">Beyond SLA</th>
            </tr></thead>
            <tbody>
              {m.team.map((t, i) => (
                <tr key={t.id} className={`hover:bg-slate-50 ${i && m.team[i - 1].region !== t.region ? 'border-t-2 border-slate-200' : 'border-b border-slate-50'}`}>
                  <td className="td font-semibold">
                    <button className="hover:underline" onClick={() => t.id !== '_none' && goCard(`Sites owned by ${t.name}`, { owner: t.name })}>{t.name}</button>
                    {t.lead && <span className="ml-1 rounded bg-brand-50 px-1 text-[10px] font-semibold text-brand-700">lead</span>}
                    {!t.active && t.id !== '_none' && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}
                  </td>
                  <td className="td text-slate-500">{t.region}</td>
                  <QS v={t.total} bold /><QS v={t.week} /><QS v={t.month} />
                  <QS v={t.owned} /><QS v={t.hold} cls="text-slate-500" /><QS v={t.ho} cls="text-amber-700" /><QS v={t.won} cls="text-emerald-700" /><QS v={t.dropped} cls="text-slate-500" />
                  <td className={`td text-right ${t.overdue ? 'font-semibold text-red-600' : 'text-slate-300'}`}>{t.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Click a name to see their sites. Reassign owners from the Owner column in Leads &amp; Deals. Data as of {fmtDate(new Date())}.</p>
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
        <p className="mt-1 text-xs text-slate-500">Energized = QIS-tracker energisation dates + pipeline sites energized in the CRM (not double-counted). {grain === 'week' ? 'The current week is partial.' : 'The current month is partial.'} Follows the region / city / site-type filters above.</p>
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
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
