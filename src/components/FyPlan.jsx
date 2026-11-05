import { useEffect, useMemo, useState } from 'react'
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Flag, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isTrackerSite } from '../lib/deals'
import { Modal, useToast } from './ui'
import { fmtNum, fmtDate } from '../lib/format'

const fyEnd = () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() + 1 : n.getFullYear(); return `${y}-03-31` }
export const DEFAULT_PLAN = {
  leads_per_win: 4, qis_per_site: 3, scout_by: fyEnd(), work_days: 6,
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
      const acq = (short * share) / 100
      const ho = inCity.filter(r => r.stage_key === 'ho_done' || r.stage_name === 'Handover Done').reduce((a, r) => a + qisOf(r), 0)
      const pendingPipe = Math.max(0, acq - ho)
      const pending = inCity.filter(r => r.stage_category === 'active' || r.stage_name === 'Agreement Signed')
      const visCur = pending.filter(r => ymOf(r.extra?.expected_ho) === cur).reduce((a, r) => a + qisOf(r), 0)
      const visNext = pending.filter(r => ymOf(r.extra?.expected_ho) === next).reduce((a, r) => a + qisOf(r), 0)
      const vis = visCur + visNext
      const toAcquire = Math.max(0, pendingPipe - vis)
      const sitesWin = toAcquire / (Number(plan.qis_per_site) || 3)
      const sitesScout = sitesWin * (Number(plan.leads_per_win) || 4)
      const scouted30 = inCity.filter(r => new Date(r.created_at) >= since).length
      const needDay = days ? sitesScout / days : null
      const paceDay = scouted30 / days30
      return { city: c.city, owner: owner[lc] || '—', region: region[lc] || '—', energised, target, short, share, acq, ho, pendingPipe, visCur, visNext, vis, toAcquire, sitesWin, sitesScout, needDay, paceDay, scouted30 }
    })
    const sum = k => list.reduce((a, x) => a + (x[k] || 0), 0)
    const total = { energised: sum('energised'), target: sum('target'), short: sum('short'), acq: sum('acq'), ho: sum('ho'), pendingPipe: sum('pendingPipe'), visCur: sum('visCur'), visNext: sum('visNext'), vis: sum('vis'), toAcquire: sum('toAcquire'), sitesWin: sum('sitesWin'), sitesScout: sum('sitesScout'), needDay: days ? sum('sitesScout') / days : null, paceDay: sum('paceDay'), scouted30: sum('scouted30') }
    return { list, total, days, days30 }
  }, [plan, deals, network, cities, filters, cur, next]) // eslint-disable-line

  if (!m) return <div className="card p-6 text-center text-sm text-slate-400">Loading FY plan…</div>
  const chart = m.list.filter(x => x.target).map(x => ({ city: x.city, need: r1(x.needDay || 0), pace: r1(x.paceDay) }))
  const tone = x => (!x.needDay ? 'text-slate-400' : x.paceDay >= x.needDay ? 'text-emerald-700' : x.paceDay >= x.needDay * 0.7 ? 'text-amber-700' : 'text-red-600')
  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto flex items-center gap-2 text-sm font-bold text-slate-900"><Flag className="h-4 w-4" />FY exit plan by city · what the acquisition team still has to find (QIS)</h3>
          {isAdmin && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" />Edit targets & split</button>}
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <K l="FY exit target" v={fmtNum(m.total.target)} s={`${fmtNum(m.total.energised)} energised today`} />
          <K l="Acquisition team target" v={fmtNum(r1(m.total.acq), 1)} s={`of ${fmtNum(m.total.short)} short; rest via SPP`} cls="text-navy-900" />
          <K l="Already handed over" v={fmtNum(m.total.ho)} s="Handover Done, awaiting energisation" cls="text-teal-700" />
          <K l={`Visibility ${monthLbl(cur)} + ${monthLbl(next)}`} v={fmtNum(m.total.vis)} s="pending sites by Expected HO date" cls="text-amber-700" />
          <K l="Pending acquisition" v={fmtNum(Math.round(m.total.toAcquire))} s="no pipeline visibility yet — must be scouted" cls="text-red-600" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">City</th><th className="px-2 py-2 text-right">Energised today</th><th className="px-2 py-2 text-right">FY target</th><th className="px-2 py-2 text-right">Short of target</th>
                <th className="px-2 py-2 text-right">Acq. share</th><th className="px-2 py-2 text-right">Acq. team target</th><th className="px-2 py-2 text-right">Already HO'd</th>
                <th className="bg-sky-50 px-2 py-2 text-right">Pending pipeline</th><th className="px-2 py-2 text-right">{monthLbl(cur)} visibility</th><th className="px-2 py-2 text-right">{monthLbl(next)} visibility</th>
                <th className="px-2 py-2 text-right">Total visibility</th><th className="bg-red-50 px-2 py-2 text-right">Pending acquisition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {m.list.map(x => (
                <tr key={x.city} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold">{x.city}<div className="text-[10px] font-normal text-slate-400">{x.region} · {x.owner}</div></td>
                  <td className="px-2 py-2 text-right">{fmtNum(x.energised)}</td><td className="px-2 py-2 text-right">{fmtNum(x.target)}</td><td className="px-2 py-2 text-right">{fmtNum(x.short)}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{x.share}%</td><td className="px-2 py-2 text-right font-semibold">{fmtNum(r1(x.acq), 1)}</td><td className="px-2 py-2 text-right text-teal-700">{fmtNum(x.ho)}</td>
                  <td className="bg-sky-50/60 px-2 py-2 text-right font-semibold">{fmtNum(r1(x.pendingPipe), 1)}</td><td className="px-2 py-2 text-right">{x.visCur || '—'}</td><td className="px-2 py-2 text-right">{x.visNext || '—'}</td>
                  <td className="px-2 py-2 text-right">{x.vis || '—'}</td>
                  <td className={`px-2 py-2 text-right text-base font-extrabold ${x.toAcquire >= 30 ? 'bg-fuchsia-100 text-fuchsia-800' : x.toAcquire ? 'bg-emerald-50 text-emerald-800' : 'bg-emerald-50 text-emerald-700'}`}>{fmtNum(Math.round(x.toAcquire))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
              <tr><td className="px-3 py-2">Total</td><td className="px-2 py-2 text-right">{fmtNum(m.total.energised)}</td><td className="px-2 py-2 text-right">{fmtNum(m.total.target)}</td><td className="px-2 py-2 text-right">{fmtNum(m.total.short)}</td><td />
                <td className="px-2 py-2 text-right">{fmtNum(r1(m.total.acq), 1)}</td><td className="px-2 py-2 text-right">{fmtNum(m.total.ho)}</td><td className="px-2 py-2 text-right">{fmtNum(r1(m.total.pendingPipe), 1)}</td>
                <td className="px-2 py-2 text-right">{fmtNum(m.total.visCur)}</td><td className="px-2 py-2 text-right">{fmtNum(m.total.visNext)}</td><td className="px-2 py-2 text-right">{fmtNum(m.total.vis)}</td><td className="px-2 py-2 text-right text-red-600">{fmtNum(Math.round(m.total.toAcquire))}</td></tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Energised today = QIS tracker. Short = target − energised. Acq. team target = short × acquisition share (the rest goes to SPP). Already HO'd = Handover Done, not yet energized.
          Pending pipeline = acq. target − already HO'd. Visibility = pending sites (Scouting → Agreement) with an Expected HO date in {monthLbl(cur)} or {monthLbl(next)}. <b>Pending acquisition</b> = pending pipeline − visibility: QIS with no pipeline yet. Pink = 30+ QIS still to find.</p>
      </div>

      <div className="card p-4 sm:p-5">
        <h3 className="mb-1 text-sm font-bold text-slate-900">Scouting productivity needed · sites per working day</h3>
        <p className="mb-3 text-xs text-slate-500">
          Assumes 1 in <b>{plan.leads_per_win}</b> scouted sites converts and <b>{plan.qis_per_site} QIS</b> per site (so {plan.leads_per_win * 10} sites scouted ≈ 10 sites ≈ {plan.qis_per_site * 10} QIS),
          {' '}<b>{m.days}</b> working days ({plan.work_days === 6 ? 'Mon–Sat' : 'Mon–Fri'}) left to scout, up to {fmtDate(plan.scout_by)}. Current pace = sites added to SiteKhojo in the last 30 days.
        </p>
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <ResponsiveContainer width="100%" height={290}>
              <ComposedChart data={chart} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals />
                <YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v, n) => [`${v} sites/day`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="need" name="Needed per day" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={10} />
                <Bar dataKey="pace" name="Current pace per day" fill="#10b981" radius={[0, 4, 4, 0]} barSize={10} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto xl:col-span-3">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2 text-left">City · owner</th><th className="px-2 py-2 text-right">QIS to find</th><th className="px-2 py-2 text-right">Sites to win</th><th className="px-2 py-2 text-right">Sites to scout</th>
                  <th className="px-2 py-2 text-right">Needed / day</th><th className="px-2 py-2 text-right">Needed / week</th><th className="px-2 py-2 text-right">Pace / day <span className="normal-case text-slate-400">(30d)</span></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {m.list.map(x => (
                  <tr key={x.city}>
                    <td className="px-3 py-2 font-semibold">{x.city}<div className="text-[10px] font-normal text-slate-400">{x.owner}</div></td>
                    <td className="px-2 py-2 text-right">{fmtNum(Math.round(x.toAcquire))}</td><td className="px-2 py-2 text-right">{fmtNum(Math.ceil(x.sitesWin))}</td>
                    <td className="px-2 py-2 text-right font-semibold">{fmtNum(Math.ceil(x.sitesScout))}</td>
                    <td className="px-2 py-2 text-right text-base font-extrabold text-red-600">{x.needDay ? fmtNum(x.needDay, 1) : '—'}</td>
                    <td className="px-2 py-2 text-right">{x.needDay ? fmtNum(x.needDay * plan.work_days, 1) : '—'}</td>
                    <td className={`px-2 py-2 text-right font-bold ${tone(x)}`}>{fmtNum(x.paceDay, 1)}<div className="text-[10px] font-normal text-slate-400">{x.scouted30} in 30d</div></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <tr><td className="px-3 py-2">Total</td><td className="px-2 py-2 text-right">{fmtNum(Math.round(m.total.toAcquire))}</td><td className="px-2 py-2 text-right">{fmtNum(Math.ceil(m.total.sitesWin))}</td><td className="px-2 py-2 text-right">{fmtNum(Math.ceil(m.total.sitesScout))}</td>
                  <td className="px-2 py-2 text-right text-red-600">{m.total.needDay ? fmtNum(m.total.needDay, 1) : '—'}</td><td className="px-2 py-2 text-right">{m.total.needDay ? fmtNum(m.total.needDay * plan.work_days, 1) : '—'}</td><td className="px-2 py-2 text-right">{fmtNum(m.total.paceDay, 1)}</td></tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-slate-500">Pace colour: <span className="font-semibold text-emerald-700">green</span> at or above what's needed · <span className="font-semibold text-amber-700">amber</span> 70–99% · <span className="font-semibold text-red-600">red</span> below 70%.</p>
          </div>
        </div>
      </div>
      {edit && <PlanModal plan={plan} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload() }} />}
    </div>
  )
}

const K = ({ l, v, s, cls = 'text-slate-900' }) => (
  <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</p><p className={`text-xl font-extrabold ${cls}`}>{v}</p><p className="text-[11px] text-slate-500">{s}</p></div>
)

function PlanModal({ plan, onClose, onSaved }) {
  const toast = useToast()
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(plan)))
  const [busy, setBusy] = useState(false)
  const setC = (i, k, v) => setP(x => ({ ...x, cities: x.cities.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }))
  const save = async () => {
    setBusy(true)
    const value = { ...p, leads_per_win: Number(p.leads_per_win) || 4, qis_per_site: Number(p.qis_per_site) || 3, work_days: Number(p.work_days) === 5 ? 5 : 6,
      cities: p.cities.filter(c => c.city.trim()).map(c => ({ city: c.city.trim(), target: Number(c.target) || 0, share: Math.min(100, Math.max(0, Number(c.share) || 0)) })) }
    const { error } = await supabase.from('app_settings').upsert({ key: 'fy_plan', value, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast('FY plan saved'); onSaved()
  }
  return (
    <Modal open onClose={onClose} wide title="FY exit targets and acquisition split" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <label className="block"><span className="text-xs font-semibold text-slate-500">Scouted sites per win</span><input type="number" min="1" className="input" value={p.leads_per_win} onChange={e => setP({ ...p, leads_per_win: e.target.value })} /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">QIS per site</span><input type="number" min="1" step="0.5" className="input" value={p.qis_per_site} onChange={e => setP({ ...p, qis_per_site: e.target.value })} /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Scout by</span><input type="date" className="input" value={p.scout_by} onChange={e => setP({ ...p, scout_by: e.target.value })} /></label>
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
