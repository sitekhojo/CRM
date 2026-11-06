import { useEffect, useMemo, useState } from 'react'
import { Flag, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isTrackerSite } from '../lib/deals'
import { Modal, useToast } from './ui'
import { fmtNum, fmtDate } from '../lib/format'

// Acquisition must be done by 31 Dec of the FY (energisation follows by FY end).
const acqDeadline = () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return `${y}-12-31` }
export const DEFAULT_PLAN = {
  company_target: 3034, leads_per_win: 4, qis_per_site: 3, scout_by: acqDeadline(), work_days: 6,
  cities: [
    { city: 'Delhi', target: 525, share: 40 }, { city: 'Bengaluru', target: 934, share: 60 }, { city: 'Hyderabad', target: 480, share: 60 },
    { city: 'Gurugram', target: 205, share: 50 }, { city: 'Ghaziabad', target: 87, share: 100 }, { city: 'Faridabad', target: 20, share: 100 },
    { city: 'Mumbai', target: 240, share: 50 }, { city: 'Pune', target: 130, share: 100 }, { city: 'Ahmedabad', target: 30, share: 0 },
  ],
}
const qisOf = r => Number(r.extra?.qis_count) || 0
const ymOf = d => String(d || '').slice(0, 7)
const monthLbl = k => new Date(k + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short' })
const r1 = v => Math.round(v * 10) / 10
/** Working days from tomorrow up to and including `to` (Mon–Sat when 6, Mon–Fri when 5). */
function workDays(fromDate, to, perWeek) {
  let n = 0; const d = new Date(fromDate); d.setHours(12, 0, 0, 0); const end = new Date(to + 'T12:00:00')
  while (d < end) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && (perWeek >= 6 || w !== 6)) n++ }
  return n
}

export function usePlan() {
  const [plan, setPlan] = useState(null)
  const load = () => supabase.from('app_settings').select('value').eq('key', 'fy_plan').maybeSingle().then(({ data }) => setPlan({ ...DEFAULT_PLAN, ...(data?.value || {}) }))
  useEffect(() => { load() }, [])
  return { plan, reload: load }
}

/** FY exit plan by city + scouting productivity needed to close the gap. */
export default function FyPlan({ deals, network, cities = [], team = [], filters }) {
  const { isAdmin } = useAuth()
  const { plan, reload } = usePlan()
  const [edit, setEdit] = useState(false)
  const [zone, setZone] = useState('All')
  const now = new Date()
  const cur = ymOf(now.toISOString())
  const next = (() => { const d = new Date(now.getFullYear(), now.getMonth() + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()

  const m = useMemo(() => {
    if (!plan || !deals) return null
    const region = Object.fromEntries(cities.map(c => [c.name.toLowerCase(), c.region]))
    const owner = Object.fromEntries(cities.map(c => [c.name.toLowerCase(), c.owner]))
    const keep = c => (!filters.region.length || filters.region.includes(region[c.toLowerCase()])) && (!filters.city.length || filters.city.includes(c))
    const rows0 = deals.filter(r => !isTrackerSite(r))
    const days = workDays(now, plan.scout_by, plan.work_days)
    const since = new Date(now); since.setDate(since.getDate() - 30)
    const days30 = workDays(since, now.toISOString().slice(0, 10), plan.work_days) || 1
    const list = plan.cities.filter(c => keep(c.city)).map(c => {
      const lc = c.city.toLowerCase()
      const inCity = rows0.filter(r => String(r.city || '').toLowerCase() === lc)
      const energised = network.filter(n => n.point_type === 'own_station' && String(n.city || '').toLowerCase() === lc).reduce((a, n) => a + (Number(n.weight) || 0), 0)
      const target = Number(c.target) || 0, share = Number(c.share) || 0
      const short = Math.max(0, target - energised)
      const acq = Math.ceil((short * share) / 100) // whole QIS, rounded up
      const ho = inCity.filter(r => r.stage_key === 'ho_done' || r.stage_name === 'Handover Done').reduce((a, r) => a + qisOf(r), 0)
      const pendingPipe = Math.max(0, acq - ho)
      const pending = inCity.filter(r => r.stage_category === 'active' || r.stage_name === 'Agreement Signed')
      const visCur = pending.filter(r => ymOf(r.extra?.expected_ho) === cur).reduce((a, r) => a + qisOf(r), 0)
      const visNext = pending.filter(r => ymOf(r.extra?.expected_ho) === next).reduce((a, r) => a + qisOf(r), 0)
      const vis = visCur + visNext
      const toAcquire = pendingPipe // only handed-over QIS are netted off; Nov/Dec visibility still has to be acquired
      const noPipe = Math.max(0, pendingPipe - vis)
      const sitesWin = Math.ceil(toAcquire / (Number(plan.qis_per_site) || 3))
      const sitesScout = sitesWin * (Number(plan.leads_per_win) || 4)
      const scouted30 = inCity.filter(r => new Date(r.created_at) >= since).length
      const needDay = days ? Math.ceil(sitesScout / days) : null
      const paceDay = scouted30 / days30
      return { noPipe, city: c.city, owner: owner[lc] || '—', region: region[lc] || '—', energised, target, short, share, acq, ho, pendingPipe, visCur, visNext, vis, toAcquire, sitesWin, sitesScout, needDay, paceDay, scouted30 }
    })
    const sum = k => list.reduce((a, x) => a + (x[k] || 0), 0)
    const total = { energised: sum('energised'), target: sum('target'), short: sum('short'), acq: sum('acq'), ho: sum('ho'), pendingPipe: sum('pendingPipe'), visCur: sum('visCur'), visNext: sum('visNext'), vis: sum('vis'), toAcquire: sum('toAcquire'), sitesWin: sum('sitesWin'), sitesScout: sum('sitesScout'), needDay: days ? sum('sitesScout') / days : null, paceDay: sum('paceDay'), scouted30: sum('scouted30') }
    return { list, total, days, days30 }
  }, [plan, deals, network, cities, filters, cur, next]) // eslint-disable-line

  if (!m) return <div className="card p-6 text-center text-sm text-slate-400">Loading FY plan…</div>
  const zones = ['All', ...REGION_ORDER.filter(z => m.list.some(x => x.region === z))]
  const list = zone === 'All' ? m.list : m.list.filter(x => x.region === zone)
  const T = sumUp(list, m.days)
  // Headline energised = the whole QIS-tracker network (all cities) for All zones, or every city of the zone.
  const regionOfCity = Object.fromEntries(cities.map(c => [c.name.toLowerCase(), c.region]))
  const netEnergised = network.filter(n => n.point_type === 'own_station' && (zone === 'All' || regionOfCity[String(n.city || '').toLowerCase()] === zone))
    .reduce((a, n) => a + (Number(n.weight) || 0), 0)
  const company = Number(plan.company_target) || 0
  const exit = zone === 'All' && company ? company : T.target
  const zoneOf = z => sumUp(z === 'All' ? m.list : m.list.filter(x => x.region === z), m.days)
  const maxAcq = Math.max(1, ...list.map(x => x.acq))
  const enPct = exit ? Math.round((100 * netEnergised) / exit) : 0
  return (
    <div className="card overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-navy-900 to-slate-800 px-5 py-4 text-white">
        <div className="mr-auto">
          <h3 className="flex items-center gap-2 text-base font-bold"><Flag className="h-4 w-4" />FY exit plan</h3>
          <p className="text-xs text-slate-300">What the acquisition team still has to find · acquire by {fmtDate(plan.scout_by)}</p>
        </div>
        <div className="flex rounded-lg bg-white/10 p-0.5">
          {zones.map(z => { const v = zoneOf(z).toAcquire; return (
            <button key={z} onClick={() => setZone(z)} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${zone === z ? 'bg-white text-navy-900 shadow' : 'text-slate-200 hover:bg-white/10'}`}>
              {z === 'All' ? 'All zones' : z}<span className={`ml-1.5 rounded px-1 text-[10px] ${zone === z ? 'bg-red-100 text-red-700' : 'bg-white/15'}`}>{fmtNum(Math.ceil(v))}</span>
            </button>) })}
        </div>
        {isAdmin && <button className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20" onClick={() => setEdit(true)}><Pencil className="mr-1 inline h-3.5 w-3.5" />Edit</button>}
      </div>

      {/* flow strip */}
      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
        <Flow l="FY exit target" v={fmtNum(exit)} s={zone === 'All' && company && company !== T.target ? `${fmtNum(T.target)} cities + ${fmtNum(company - T.target)} SPP / other` : `${list.length} cities`} />
        <Flow l="Energised today" v={fmtNum(netEnergised)} s={<span className="flex items-center gap-1.5" title={`${fmtNum(T.energised)} QIS in the ${list.length} plan cities`}><span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200"><span className="block h-1.5 bg-emerald-500" style={{ width: `${Math.min(100, enPct)}%` }} /></span>{enPct}% of exit · {fmtNum(T.energised)} in plan cities</span>} cls="text-emerald-700" />
        <Flow l="Acquisition target" v={fmtNum(Math.ceil(T.acq))} s={zone === 'All' && company ? `of ${fmtNum(Math.max(0, company - netEnergised))} short (${fmtNum(company)} − ${fmtNum(netEnergised)}) · rest SPP` : `of ${fmtNum(T.short)} short · rest SPP`} cls="text-navy-900" />
        <Flow l="Already handed over" v={fmtNum(T.ho)} s="awaiting energisation" cls="text-teal-600" dot="bg-teal-500" />
        <Flow l={`Visibility ${monthLbl(cur)} + ${monthLbl(next)}`} v={fmtNum(T.vis)} s={`${fmtNum(T.visCur)} + ${fmtNum(T.visNext)} by expected HO`} cls="text-amber-600" dot="bg-amber-400" />
        <Flow l="Still to scout" v={fmtNum(Math.ceil(T.toAcquire))} s="acquisition target − handed over" cls="text-red-600" dot="bg-red-500" big />
      </div>

      {/* city rows */}
      <div className="px-5 py-3">
        <div className="mb-1 flex items-center gap-4 text-[11px] text-slate-500">
          <span className="w-36">City</span><span className="hidden w-28 text-right md:block">Energised / target</span><span className="flex-1">Acquisition target, split</span><span className="w-20 text-right">To scout</span>
        </div>
        <div className="divide-y divide-slate-100">
          {list.map(x => {
            const seg = [[x.ho, 'bg-teal-500', 'Handed over'], [x.visCur, 'bg-amber-400', `${monthLbl(cur)} visibility`], [x.visNext, 'bg-amber-200', `${monthLbl(next)} visibility`], [x.noPipe, 'bg-red-400', 'No pipeline yet']]
            const used = Math.min(x.acq, x.ho + x.vis + x.noPipe)
            const w = v => `${(100 * Math.min(v, x.acq)) / maxAcq}%`
            const ep = x.target ? Math.round((100 * x.energised) / x.target) : 0
            return (
              <div key={x.city} className="flex items-center gap-4 py-2.5">
                <div className="w-36 min-w-0"><p className="truncate font-semibold text-slate-900">{x.city}</p><p className="truncate text-[11px] text-slate-400">{x.owner}</p></div>
                <div className="hidden w-28 text-right md:block"><p className="text-sm"><b>{fmtNum(x.energised)}</b><span className="text-slate-400"> / {fmtNum(x.target)}</span></p>
                  <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-1 bg-emerald-500" style={{ width: `${Math.min(100, ep)}%` }} /></div></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs text-slate-500"><b className="text-sm text-slate-800">{fmtNum(x.acq)}</b> QIS <span>· {x.share}% of {fmtNum(x.short)} short</span>
                    {x.share === 0 && <span className="rounded bg-orange-50 px-1.5 text-[10px] font-semibold text-orange-700">all SPP</span>}</div>
                  <div className="mt-1 flex h-3.5 overflow-hidden rounded-full bg-slate-100" title={seg.map(([v, , l]) => `${l}: ${fmtNum(Math.ceil(v))}`).join(' · ')}>
                    {used > 0 && seg.map(([v, c, l]) => v > 0 && <div key={l} className={`${c} h-full border-r border-white/70 last:border-0`} style={{ width: w(v) }} title={`${l}: ${fmtNum(Math.ceil(v))} QIS`} />)}
                  </div>
                  <div className="mt-0.5 flex gap-3 text-[10px] text-slate-500">
                    {x.ho > 0 && <span><span className="text-teal-600">●</span> HO'd {fmtNum(x.ho)}</span>}
                    {x.visCur > 0 && <span><span className="text-amber-400">●</span> {monthLbl(cur)} {fmtNum(x.visCur)}</span>}
                    {x.visNext > 0 && <span><span className="text-amber-200">●</span> {monthLbl(next)} {fmtNum(x.visNext)}</span>}
                  </div>
                </div>
                <div className="w-20 text-right"><p className={`text-xl font-extrabold ${x.toAcquire >= 30 ? 'text-red-600' : x.toAcquire ? 'text-amber-600' : 'text-emerald-600'}`}>{fmtNum(Math.ceil(x.toAcquire))}</p><p className="text-[10px] text-slate-400">QIS</p></div>
              </div>
            )
          })}
        </div>
      </div>

      {/* productivity */}
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-1">
          <h3 className="mr-auto text-sm font-bold text-slate-900">Scouting needed to close the gap{zone !== 'All' ? ` · ${zone}` : ''}</h3>
          <Mini l="Sites to scout" v={fmtNum(Math.ceil(T.sitesScout))} s={`→ ${fmtNum(Math.ceil(T.sitesWin))} sites won`} />
          <Mini l="Needed / day" v={T.needDay ? fmtNum(Math.ceil(T.needDay)) : '—'} cls="text-red-600" s={`${m.days} working days left`} />
          <Mini l="Pace / day" v={fmtNum(Math.ceil(T.paceDay))} cls={T.needDay && T.paceDay >= T.needDay ? 'text-emerald-600' : 'text-amber-600'} s={`${T.scouted30} sites in 30 days`} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {clubNcr(list.filter(x => x.acq > 0), m.days).map(x => {
            const pct = x.needDay ? Math.round((100 * x.paceDay) / x.needDay) : 100
            const col = !x.needDay ? 'bg-emerald-500' : pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-400' : 'bg-red-500'
            return (
              <div key={x.city} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between"><p className="truncate font-semibold text-slate-900">{x.city}</p><p className="truncate pl-2 text-[11px] text-slate-400">{x.owner}</p></div>
                {x.parts && <p className="truncate text-[10px] text-slate-400">{x.parts.join(' · ')}</p>}
                {x.needDay ? <>
                  <p className="mt-1 text-xs text-slate-500"><b className="text-lg font-extrabold text-slate-900">{fmtNum(Math.ceil(x.needDay))}</b> sites/day needed · <b>{fmtNum(Math.ceil(x.needDay) * plan.work_days)}</b>/wk</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-1.5 ${col}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  <p className="mt-1 flex justify-between text-[11px] text-slate-500"><span>pace {fmtNum(Math.ceil(x.paceDay))}/day · {pct}%</span><span>{fmtNum(Math.ceil(x.sitesScout))} to scout</span></p>
                </> : <p className="mt-2 text-xs font-semibold text-emerald-600">Covered — nothing left to scout</p>}
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">1 in {plan.leads_per_win} scouted sites converts · {plan.qis_per_site} QIS per site · {plan.work_days === 6 ? 'Mon–Sat' : 'Mon–Fri'} · pace = sites added in the last 30 days. To acquire = acquisition target − handed over (sites in the Nov/Dec pipeline still count until they're handed over).</p>
      </div>
      {edit && <PlanModal plan={plan} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload() }} />}
    </div>
  )
}

const REGION_ORDER = ['North', 'South', 'West', 'East']
const NCR = ['delhi', 'gurugram', 'gurgaon', 'noida', 'greater noida', 'ghaziabad', 'faridabad']
/** Scouting cards: Delhi, Gurugram, Noida, Ghaziabad and Faridabad clubbed into one NCR card. */
function clubNcr(list, days) {
  const ncr = list.filter(x => NCR.includes(x.city.toLowerCase()))
  if (ncr.length < 2) return list
  const s = k => ncr.reduce((a, x) => a + (x[k] || 0), 0)
  const scout = s('sitesScout')
  const owners = [...new Set(ncr.map(x => x.owner).filter(o => o && o !== '—'))]
  const card = { city: 'NCR', parts: ncr.map(x => x.city), owner: owners.join(', ') || '—', acq: s('acq'), toAcquire: s('toAcquire'), sitesWin: s('sitesWin'), sitesScout: scout,
    needDay: days && scout ? Math.ceil(scout / days) : null, paceDay: s('paceDay'), scouted30: s('scouted30') }
  const rest = list.filter(x => !ncr.includes(x))
  return [card, ...rest]
}
function sumUp(list, days) {
  const s = k => list.reduce((a, x) => a + (x[k] || 0), 0)
  const scout = s('sitesScout')
  return { energised: s('energised'), target: s('target'), short: s('short'), acq: s('acq'), ho: s('ho'), visCur: s('visCur'), visNext: s('visNext'), vis: s('vis'), toAcquire: s('toAcquire'), sitesWin: s('sitesWin'), sitesScout: scout, needDay: days ? scout / days : null, paceDay: s('paceDay'), scouted30: s('scouted30') }
}
const Flow = ({ l, v, s, cls = 'text-slate-900', dot, big }) => (
  <div className={`bg-white px-4 py-3 ${big ? 'bg-red-50/60' : ''}`}>
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}{l}</p>
    <p className={`text-2xl font-extrabold leading-tight ${cls}`}>{v}</p>
    <div className="text-[11px] text-slate-500">{s}</div>
  </div>
)
const Mini = ({ l, v, s, cls = 'text-slate-900' }) => (
  <div className="text-right"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{l}</p><p className={`text-lg font-extrabold leading-tight ${cls}`}>{v}</p><p className="text-[10px] text-slate-400">{s}</p></div>
)

function PlanModal({ plan, onClose, onSaved }) {
  const toast = useToast()
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(plan)))
  const [busy, setBusy] = useState(false)
  const setC = (i, k, v) => setP(x => ({ ...x, cities: x.cities.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }))
  const save = async () => {
    setBusy(true)
    const value = { ...p, company_target: Number(p.company_target) || 0, leads_per_win: Number(p.leads_per_win) || 4, qis_per_site: Number(p.qis_per_site) || 3, work_days: Number(p.work_days) === 5 ? 5 : 6,
      cities: p.cities.filter(c => c.city.trim()).map(c => ({ city: c.city.trim(), target: Number(c.target) || 0, share: Math.min(100, Math.max(0, Number(c.share) || 0)) })) }
    const { error } = await supabase.from('app_settings').upsert({ key: 'fy_plan', value, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast('FY plan saved'); onSaved()
  }
  return (
    <Modal open onClose={onClose} wide title="FY exit targets and acquisition split" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <label className="mb-3 block text-sm"><span className="text-xs font-semibold text-slate-500">Company FY exit target (QIS) — city targets below + SPP / other</span><input type="number" min="0" className="input" value={p.company_target ?? ''} onChange={e => setP({ ...p, company_target: e.target.value })} /></label>
      <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Scouted sites per win</span><input type="number" min="1" className="input" value={p.leads_per_win} onChange={e => setP({ ...p, leads_per_win: e.target.value })} /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">QIS per site</span><input type="number" min="1" step="0.5" className="input" value={p.qis_per_site} onChange={e => setP({ ...p, qis_per_site: e.target.value })} /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Acquire by</span><input type="date" className="input" value={p.scout_by} onChange={e => setP({ ...p, scout_by: e.target.value })} /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Working days / week</span><select className="input" value={p.work_days} onChange={e => setP({ ...p, work_days: Number(e.target.value) })}><option value={6}>6 (Mon–Sat)</option><option value={5}>5 (Mon–Fri)</option></select></label>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">City (as in SiteKhojo)</th><th className="px-1 text-right">FY exit target (QIS)</th><th className="px-1 text-right">Acquisition share %</th><th /></tr></thead>
        <tbody>
          {p.cities.map((c, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1 pr-1"><input className="input py-1" value={c.city} onChange={e => setC(i, 'city', e.target.value)} /></td>
              <td className="px-1 py-1"><input type="number" min="0" className="input py-1 text-right" value={c.target} onChange={e => setC(i, 'target', e.target.value)} /></td>
              <td className="px-1 py-1"><input type="number" min="0" max="100" className="input py-1 text-right" value={c.share} onChange={e => setC(i, 'share', e.target.value)} /></td>
              <td className="pl-1"><button className="text-slate-400 hover:text-red-600" onClick={() => setP(x => ({ ...x, cities: x.cities.filter((_, j) => j !== i) }))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-ghost mt-2 text-sm" onClick={() => setP(x => ({ ...x, cities: [...x.cities, { city: '', target: 0, share: 100 }] }))}><Plus className="h-4 w-4" />Add city</button>
      <p className="mt-2 text-xs text-slate-500">Acquisition share = part of the gap the acquisition team must deliver (the rest goes to SPP). Ahmedabad 0% = all SPP; Pune 100% = all acquisition.</p>
    </Modal>
  )
}
