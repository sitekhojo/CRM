import { useEffect, useMemo, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'
import { Target, Pencil } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Modal, useToast } from './ui'
import { fmtNum } from '../lib/format'

export const METRICS = [['scout', 'Scouted', '#0ea5e9'], ['ho', 'Handover', '#f59e0b'], ['en', 'Energisation', '#10b981']]
const ym = d => String(d || '').slice(0, 7)
export const fyMonths = (now = new Date()) => {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(y, 3 + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
}
const mLabel = k => new Date(k + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

export function useTargets() {
  const [targets, setTargets] = useState(null)
  const load = () => supabase.from('app_settings').select('value').eq('key', 'targets').maybeSingle().then(({ data }) => setTargets(data?.value?.months || {}))
  useEffect(() => { load() }, [])
  return { targets, reload: load }
}

/**
 * FY trend: cumulative target vs actual vs projected (actual + expected dates), per metric.
 * series: { scout: { actual: {ym: qis}, expected: null }, ho: { actual, expected: {ym: qis} }, en: { actual, expected } }
 */
export default function TargetTrend({ series, filtered }) {
  const { isAdmin } = useAuth()
  const { targets, reload } = useTargets()
  const [metric, setMetric] = useState('en')
  const [edit, setEdit] = useState(false)
  const months = fyMonths()
  const cur = ym(new Date().toISOString())
  const color = METRICS.find(x => x[0] === metric)[2]

  const d = useMemo(() => {
    if (!targets) return null
    const s = series[metric]
    let tCum = 0, aCum = 0, pCum = null
    const hasTargets = months.some(k => Number(targets[k]?.[metric]))
    const rows = months.map(k => {
      const t = Number(targets[k]?.[metric]) || 0
      tCum += t
      const a = s.actual[k] || 0
      if (k <= cur) aCum += a
      let proj = null
      if (s.expected && k >= cur) {
        if (pCum === null) pCum = aCum - a // up to the end of last month
        pCum += (k === cur ? a : 0) + (s.expected[k] || 0)
        proj = pCum
      }
      return { k, label: mLabel(k), target: hasTargets ? tCum : null, tMonth: t, actual: k <= cur ? aCum : null, aMonth: k <= cur ? a : null, projected: proj, eMonth: s.expected?.[k] || 0 }
    })
    const fyTarget = tCum
    const done = aCum
    const projectedEnd = s.expected ? rows[rows.length - 1].projected ?? done : done
    const targetToDate = rows.filter(r => r.k <= cur).reduce((a, r) => a + r.tMonth, 0)
    return { rows, hasTargets, fyTarget, done, projectedEnd, pipeline: projectedEnd - done, gap: Math.max(0, fyTarget - projectedEnd), targetToDate }
  }, [targets, series, metric]) // eslint-disable-line

  if (!d) return <div className="card p-6 text-center text-sm text-slate-400">Loading…</div>
  const name = METRICS.find(x => x[0] === metric)[1]
  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-2 text-sm font-bold text-slate-900"><Target className="h-4 w-4" />Target vs actual · {name} · FY{String(Number(months[0].slice(0, 4)) + 1).slice(2)} (cumulative QIS)</h3>
        <span className="flex rounded-lg border border-slate-300 p-0.5 text-xs font-semibold">
          {METRICS.map(([k, l]) => <button key={k} onClick={() => setMetric(k)} className={`rounded-md px-2.5 py-1 ${metric === k ? 'bg-navy-900 text-white' : 'text-slate-600'}`}>{l}</button>)}
        </span>
        {isAdmin && <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" />Set targets</button>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="FY target" v={d.hasTargets ? fmtNum(d.fyTarget) : '—'} sub={d.hasTargets ? `${fmtNum(d.targetToDate)} due by end of ${mLabel(cur)}` : 'not set yet'} />
        <Kpi label="Achieved so far" v={fmtNum(d.done)} cls="text-navy-900" sub={d.hasTargets && d.targetToDate ? `${Math.round((100 * d.done) / d.targetToDate)}% of target to date` : 'this FY'} />
        <Kpi label="In pipeline (expected)" v={series[metric].expected ? fmtNum(d.pipeline) : '—'} cls="text-amber-700" sub={series[metric].expected ? `by expected ${metric === 'ho' ? 'HO' : 'energisation'} dates, rest of FY` : 'n/a for scouting'} />
        <Kpi label="Heading to" v={fmtNum(d.projectedEnd)} cls="text-sky-700" sub="by end of FY at this rate" />
        <Kpi label={metric === 'scout' ? 'Still to scout' : 'Additional to scout'} v={d.hasTargets ? fmtNum(d.gap) : '—'} cls={d.gap ? 'text-red-600' : 'text-emerald-700'}
          sub={!d.hasTargets ? 'set targets to see the gap' : d.gap ? `QIS short of the FY target` : 'on track for the FY target'} />
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={d.rows} margin={{ left: -10, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <ReferenceLine x={mLabel(cur)} stroke="#cbd5e1" strokeDasharray="3 3" label={{ value: 'today', fontSize: 10, fill: '#94a3b8', position: 'insideTopRight' }} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const x = payload[0].payload
            return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
              <div className="mb-1 font-semibold">{x.label}</div>
              {x.target !== null && <div className="text-slate-600">Target: <b>{fmtNum(x.target)}</b> <span className="text-slate-400">(+{fmtNum(x.tMonth)} this month)</span></div>}
              {x.actual !== null && <div style={{ color }}>Actual: <b>{fmtNum(x.actual)}</b> <span className="text-slate-400">(+{fmtNum(x.aMonth)})</span></div>}
              {x.projected !== null && <div className="text-sky-700">Heading to: <b>{fmtNum(x.projected)}</b> <span className="text-slate-400">(+{fmtNum(x.eMonth)} expected)</span></div>}
            </div>
          }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {d.hasTargets && <Line type="monotone" dataKey="target" name="Target" stroke="#334155" strokeWidth={2} strokeDasharray="6 4" dot={false} />}
          <Line type="monotone" dataKey="actual" name="Actual" stroke={color} strokeWidth={3} dot={{ r: 3 }} connectNulls={false} />
          {series[metric].expected && <Line type="monotone" dataKey="projected" name="Heading to (pipeline)" stroke="#0284c7" strokeWidth={2} strokeDasharray="2 3" dot={{ r: 2 }} />}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-slate-500">
        Actual: {metric === 'en' ? 'energisation dates from the QIS tracker' : metric === 'ho' ? 'handover dates of CRM sites' : 'QIS of leads/deals added (dropped included, as they were scouted)'}.
        {series[metric].expected && <> Heading to = actual + open sites by their expected {metric === 'ho' ? 'HO' : 'energisation'} date (dates already passed count in this month).</>}
        {' '}Targets are for the whole company{filtered ? ' — filters above change actual and pipeline but not the target line' : ''}.
        {!d.hasTargets && isAdmin && <> <button className="font-semibold text-brand-700 hover:underline" onClick={() => setEdit(true)}>Set monthly targets</button> to see the target line and gap.</>}
      </p>
      {edit && <TargetsModal targets={targets} months={months} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload() }} />}
    </div>
  )
}

const Kpi = ({ label, v, sub, cls = 'text-slate-900' }) => (
  <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`text-xl font-extrabold ${cls}`}>{v}</p><p className="text-[11px] text-slate-500">{sub}</p></div>
)

function TargetsModal({ targets, months, onClose, onSaved }) {
  const toast = useToast()
  const [t, setT] = useState(() => Object.fromEntries(months.map(k => [k, { scout: targets[k]?.scout ?? '', ho: targets[k]?.ho ?? '', en: targets[k]?.en ?? '' }])))
  const [busy, setBusy] = useState(false)
  const set = (k, f, v) => setT(x => ({ ...x, [k]: { ...x[k], [f]: v } }))
  const tot = f => months.reduce((a, k) => a + (Number(t[k][f]) || 0), 0)
  const save = async () => {
    setBusy(true)
    const clean = {}
    for (const k of months) { const o = {}; for (const [f] of METRICS) if (t[k][f] !== '' && t[k][f] !== null) o[f] = Number(t[k][f]); if (Object.keys(o).length) clean[k] = o }
    const months0 = { ...targets, ...clean }
    for (const k of months) if (!clean[k]) delete months0[k]
    const { error } = await supabase.from('app_settings').upsert({ key: 'targets', value: { months: months0 }, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast('Targets saved'); onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Monthly targets (QIS)" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save targets'}</button></>}>
      <p className="mb-2 text-xs text-slate-500">QIS per month for the whole company. Leave blank where there's no target.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Month</th>{METRICS.map(([k, l]) => <th key={k} className="px-1 text-right">{l}</th>)}</tr></thead>
        <tbody>
          {months.map(k => (
            <tr key={k} className="border-t border-slate-100">
              <td className="py-1 font-semibold">{mLabel(k)}</td>
              {METRICS.map(([f]) => <td key={f} className="px-1 py-1"><input type="number" min="0" className="input py-1 text-right" value={t[k][f]} onChange={e => set(k, f, e.target.value)} /></td>)}
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-slate-200 font-bold"><td className="py-1">FY total</td>{METRICS.map(([f]) => <td key={f} className="px-2 text-right">{fmtNum(tot(f))}</td>)}</tr></tfoot>
      </table>
    </Modal>
  )
}
