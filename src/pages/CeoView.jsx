import { Fragment, useEffect, useMemo, useState } from 'react'
import { Printer, ChevronRight, ChevronDown } from 'lucide-react'
import { useDeals, fetchNetworkPoints } from '../lib/deals'
import { useConfig, REGIONS } from '../lib/config'
import { energizationEvents, isTrackerCopy } from '../lib/energized'
import { PageLoader } from '../components/ui'
import { fmtNum } from '../lib/format'

/**
 * CEO View: everything on one page.
 * Handovers and energizations by city and month (actuals for past months, expected dates for the coming months),
 * where the pipeline sits by stage, and team productivity. Every number is QIS; dropped sites never count.
 * Energized numbers use the same definition as the Dashboard (lib/energized.js).
 */
const NCR = ['Delhi', 'Gurugram', 'Noida', 'Ghaziabad', 'Faridabad']
const teamCity = c => (NCR.includes(c) ? 'Delhi NCR' : c)
/** Trend starts here: Site Khojo has no handover dates before September 2026. */
const TREND_START = '2026-09'
const TYPES = [['Franchise', 'Franchise'], ['Private', 'Private'], ['SPP', 'SPP']]
const ALL_TYPES = TYPES.map(([k]) => k)
const ym = d => (d ? String(d).slice(0, 7) : null)
const q = r => Number(r.extra?.qis_count) || 0
const r1 = n => (n ? Math.round(n * 10) / 10 : 0)
const mLabel = m => new Date(m + '-15').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const addMonths = (m, k) => { const d = new Date(m + '-15'); d.setMonth(d.getMonth() + k); return d.toISOString().slice(0, 7) }
const isIocl = d => d.extra?.spp_account === 'IOCL' || d.extra?.original_site_type === 'IOCL'
const fmtPeople = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const ACQ_STAGES = [
  ['Scouted', ['scouting', 'scouted']], ['Feasibility', ['deployment_feasibility']], ['LOI', ['loi_signed']],
  ['Agreement', ['agreement_signed']], ['HO done', ['ho_done']], ['Hold', ['hold']],
]
const SPP_STAGES = [
  ['Scouted', ['scouted']], ['CPT appr.', ['cpt_approved']], ['PESO appl.', ['peso_applied']], ['PESO appr.', ['peso_approved']],
  ['Handed over', ['ho_done']], ['Hold', ['hold']],
]

export default function CeoView() {
  const { deals, loading } = useDeals()
  const { stages = [], team = [], cities = [], ready } = useConfig()
  const [network, setNetwork] = useState(null)
  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => setNetwork([])) }, [])

  const v = useMemo(() => {
    if (!deals || !ready || !network) return null
    const keyOf = Object.fromEntries(stages.map(s => [s.id, s.key]))
    const regionOf = Object.fromEntries(cities.map(c => [c.name, c.region]))
    const now = new Date()
    const cur = now.toISOString().slice(0, 7)
    const past = [-5, -4, -3, -2, -1].map(k => addMonths(cur, k)).filter(m => m >= TREND_START)
    const future = [1, 2, 3, 4, 5].map(k => addMonths(cur, k))
    const fyStart = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) + '-04'

    const alive = deals.filter(d => d.stage_category !== 'dropped')
    const handedOver = d => ['ho_done', 'energized'].includes(keyOf[d.stage_id]) || d.stage_category === 'live'
    const hoDate = d => (handedOver(d) ? d.extra?.ho_date || (keyOf[d.stage_id] === 'ho_done' ? d.stage_entered_at : null) : null)
    const events = energizationEvents(deals, network) // shared with the Dashboard

    // Flat records per table: { city, month, qis, due, type }. Grids are summed at render time for the ticked site types.
    const hoRecs = [], enRecs = []
    for (const d of alive) {
      const t = d.site_type || 'Not set'
      const done = hoDate(d)
      if (done) hoRecs.push({ city: d.city, month: ym(done), qis: q(d), due: false, type: t })
      else if (!handedOver(d) && d.extra?.expected_ho && ym(d.extra.expected_ho) >= cur) hoRecs.push({ city: d.city, month: ym(d.extra.expected_ho), qis: q(d), due: true, type: t })
      if (d.stage_category !== 'live' && !isTrackerCopy(d) && d.extra?.expected_en && ym(d.extra.expected_en) >= cur) enRecs.push({ city: d.city, month: ym(d.extra.expected_en), qis: q(d), due: true, type: t })
    }
    for (const e of events) if (e.date) enRecs.push({ city: e.city, month: ym(e.date), qis: e.qis, due: false, type: e.siteType })

    const regionRank = c => { const i = REGIONS.indexOf(regionOf[c]); return i < 0 ? 9 : i }

    // stage snapshot (open pipeline); SPP rows also split IOCL / non-IOCL
    const stageGrid = (types, defs, split) => {
      const rows = alive.filter(d => types.includes(d.site_type) && d.stage_category !== 'live')
      const by = {}
      const blank = () => defs.map(() => ({ qis: 0, sites: 0 }))
      for (const d of rows) {
        const i = defs.findIndex(([, keys]) => keys.includes(keyOf[d.stage_id]))
        if (i < 0) continue
        const c = (by[d.city || 'Not set'] ||= { all: blank(), parts: split ? { IOCL: blank(), 'Non-IOCL': blank() } : null })
        c.all[i].qis += q(d); c.all[i].sites++
        if (split) { const p = c.parts[isIocl(d) ? 'IOCL' : 'Non-IOCL'][i]; p.qis += q(d); p.sites++ }
      }
      return by
    }
    const acq = stageGrid(['Franchise', 'Private'], ACQ_STAGES, false)
    const spp = stageGrid(['SPP'], SPP_STAGES, true)

    // Productivity: acquisition team (Franchise + Private) by city team. Zonal heads are split equally across the
    // city teams they cover (e.g. Avinash ⅓ Bengaluru, ⅓ Hyderabad, ⅓ Chennai). Handovers count by the site's city.
    const firstHo = alive.map(d => ym(d.extra?.ho_date)).filter(Boolean).sort()[0] || cur
    const prodMonths = [-2, -1, 0].map(k => addMonths(cur, k)).filter(m => m >= firstHo && m >= TREND_START)
    const people = team.filter(t => t.is_active && (t.base_city || t.covers?.length))
    const share = {} // team city → [{ name, w }]
    for (const t of people) {
      const cs = t.covers?.length ? t.covers : [t.base_city]
      for (const c of cs) (share[c] ||= []).push({ name: t.covers?.length ? t.name.split(' ')[0] : t.name, w: 1 / cs.length, head: !!t.covers?.length })
    }
    const acqSites = alive.filter(d => ['Franchise', 'Private'].includes(d.site_type) && !['qis_tracker', 'payment_tracker', 'spp_pipeline'].includes(d.extra?.source))
    const acqAll = alive.filter(d => ['Franchise', 'Private'].includes(d.site_type))
    const prod = Object.entries(share).map(([b, ms]) => {
      const n = ms.reduce((a, m) => a + m.w, 0)
      const months = prodMonths.map(m => {
        const h = acqAll.filter(d => teamCity(d.city) === b && ym(hoDate(d)) === m)
        return { m, hoQ: h.reduce((a, d) => a + q(d), 0), hoS: h.length }
      })
      const names = [...ms.filter(m => !m.head).map(m => m.name), ...ms.filter(m => m.head).map(m => `${m.name} (${m.w === 0.5 ? '½' : m.w < 0.34 ? '⅓' : Math.round(m.w * 100) + '%'})`)].join(', ')
      return { base: b, n, names, months }
    }).sort((a, b) => b.n - a.n || a.base.localeCompare(b.base))
    const personRows = people.map(t => ({
      name: t.name, base: t.covers?.length ? t.covers.join(', ') : t.base_city, group: t.covers?.length ? 'Zonal heads' : t.base_city, lead: t.is_lead,
      months: prodMonths.map(m => {
        const h = acqAll.filter(d => d.owner === t.name && ym(hoDate(d)) === m)
        return { hoQ: h.reduce((a, d) => a + q(d), 0), hoS: h.length, added: acqSites.filter(d => d.owner === t.name && ym(d.created_at) === m).length }
      }),
    })).sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.base.localeCompare(b.base) || a.name.localeCompare(b.name))

    // headline numbers (all site types)
    const sum = xs => xs.reduce((a, d) => a + q(d), 0)
    const evSum = test => events.filter(e => e.date && test(e.date)).reduce((a, e) => a + e.qis, 0)
    const kpi = {
      liveQ: evSum(() => true),
      fyEnQ: evSum(d => ym(d) >= fyStart),
      hoMtdQ: sum(alive.filter(d => ym(hoDate(d)) === cur)),
      hoDueQ: sum(alive.filter(d => !handedOver(d) && ym(d.extra?.expected_ho) === cur)),
      enMtdQ: evSum(d => ym(d) === cur),
      enDueQ: sum(alive.filter(d => d.stage_category !== 'live' && !isTrackerCopy(d) && ym(d.extra?.expected_en) === cur)),
      acqPipeQ: sum(alive.filter(d => ['Franchise', 'Private'].includes(d.site_type) && d.stage_category !== 'live' && keyOf[d.stage_id] !== 'ho_done')),
      sppPipeQ: sum(alive.filter(d => d.site_type === 'SPP' && d.stage_category !== 'live' && keyOf[d.stage_id] !== 'ho_done')),
      awaitingEnQ: sum(alive.filter(d => keyOf[d.stage_id] === 'ho_done')),
    }
    return { cur, past, future, hoRecs, enRecs, regionRank, acq, spp, prod, prodMonths, personRows, kpi, regionOf, asOf: now }
  }, [deals, ready, stages, team, cities, network])

  if (loading || !v) return <PageLoader />
  const { kpi } = v

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-navy-900">CEO View</h1>
          <p className="text-sm text-slate-500">All cities on one page · every number is QIS · dropped sites never counted · as of {v.asOf.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        </div>
        <div className="flex-1" />
        <button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / PDF</button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Live network" value={fmtNum(kpi.liveQ)} sub="QIS energized till today" />
        <Kpi label="Energized this FY" value={fmtNum(kpi.fyEnQ)} sub="QIS since 1 April" />
        <Kpi label={`Handover · ${mLabel(v.cur)}`} value={fmtNum(kpi.hoMtdQ)} sub={`done · ${fmtNum(r1(kpi.hoDueQ))} more expected`} tone="emerald" />
        <Kpi label={`Energization · ${mLabel(v.cur)}`} value={fmtNum(kpi.enMtdQ)} sub={`done · ${fmtNum(r1(kpi.enDueQ))} more expected`} tone="emerald" />
        <Kpi label="Handed over, not live" value={fmtNum(kpi.awaitingEnQ)} sub="QIS awaiting energization" tone="amber" />
        <Kpi label="Open pipeline" value={fmtNum(r1(kpi.acqPipeQ + kpi.sppPipeQ))} sub={`Acquisition ${fmtNum(r1(kpi.acqPipeQ))} · SPP ${fmtNum(r1(kpi.sppPipeQ))}`} />
      </div>

      <MonthGrid title="Handovers by city" note="Past months: actual handover dates. Coming months: expected handover date of sites not yet handed over."
        recs={v.hoRecs} v={v} />
      <MonthGrid title="Energizations by city" note="Past months: actual energizations (QIS tracker + sites energized in Site Khojo not yet in the tracker). Coming months: expected energization date of sites not yet live."
        recs={v.enRecs} v={v} />

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <StageTable title="Where the pipeline is · Acquisition (Franchise + Private)" defs={ACQ_STAGES} by={v.acq} v={v} />
        <StageTable title="Where the pipeline is · Strategic Partnerships" defs={SPP_STAGES} by={v.spp} v={v} splitNote="Click a city to split IOCL / non-IOCL" />
      </div>

      <Productivity v={v} />
    </div>
  )
}

function Kpi({ label, value, sub, tone }) {
  const c = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-navy-900'
  return (
    <div className="card p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${c}`}>{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  )
}

function TypeTicks({ value, onChange }) {
  const toggle = k => { const next = value.includes(k) ? value.filter(x => x !== k) : [...value, k]; if (next.length) onChange(next) }
  return (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden">
      {TYPES.map(([k, l]) => {
        const on = value.includes(k)
        return (
          <label key={k} className={`flex cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${on ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" checked={on} onChange={() => toggle(k)} />{l}
          </label>
        )
      })}
    </div>
  )
}

function Cell({ x, muted, dueOnly }) {
  if (!x || (!x.qis && !x.dueQ)) return <span className="text-slate-300">·</span>
  if (dueOnly) return <div className="font-semibold text-sky-800">{fmtNum(r1(x.dueQ))}</div>
  return <div className={`font-semibold ${muted ? 'text-slate-500' : 'text-slate-900'}`}>{fmtNum(r1(x.qis))}{x.dueQ ? <span className="ml-1 text-[11px] font-semibold text-sky-700">+{fmtNum(r1(x.dueQ))}</span> : null}</div>
}

function MonthGrid({ title, note, recs, v }) {
  const [types, setTypes] = useState(ALL_TYPES)
  const [open, setOpen] = useState({})
  const cols = [...v.past.map(m => ({ k: m, kind: 'past' })), { k: v.cur, kind: 'cur' }, ...v.future.map(m => ({ k: m, kind: 'fut' }))]
  const shown = new Set(cols.map(c => c.k))
  const g = useMemo(() => {
    const all = types.length === ALL_TYPES.length
    const out = {}
    for (const r of recs) {
      if (!shown.has(r.month) || !(types.includes(r.type) || all)) continue
      const c = r.city || 'Not set'
      for (const key of [c, `${c}\u0000${r.type}`]) {
        const x = ((out[key] ||= {})[r.month] ||= { qis: 0, dueQ: 0 })
        if (r.due) x.dueQ += r.qis; else x.qis += r.qis
      }
    }
    return out
  }, [recs, types]) // eslint-disable-line
  const ahead = c => cols.filter(x => x.kind !== 'past').reduce((a, x) => { const y = g[c]?.[x.k]; return a + (y ? y.qis + y.dueQ : 0) }, 0)
  // only cities with something to show in the visible months
  const cities = Object.keys(g).filter(c => !c.includes('\u0000')).filter(c => cols.some(x => { const y = g[c][x.k]; return y && (y.qis || y.dueQ) }))
    .sort((a, b) => v.regionRank(a) - v.regionRank(b) || ahead(b) - ahead(a) || a.localeCompare(b))
  const tot = k => cities.reduce((a, c) => { const x = g[c]?.[k]; if (x) { a.qis += x.qis; a.dueQ += x.dueQ } return a }, { qis: 0, dueQ: 0 })
  const subTypes = c => TYPES.map(([k]) => k).filter(k => types.includes(k) && g[`${c}\u0000${k}`])
  const allOpen = cities.length > 0 && cities.every(c => open[c]) && !!open.__total
  const bg = x => (x.kind === 'cur' ? 'bg-emerald-50' : x.kind === 'fut' ? 'bg-sky-50/60' : '')
  const cell = (x, y) => <Cell x={y} dueOnly={x.kind === 'fut'} muted={x.kind === 'past'} />
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-navy-900">{title}{types.length < ALL_TYPES.length && <span className="ml-2 text-sm font-semibold text-slate-500">· {types.join(' + ')}</span>}</h2>
          <p className="text-xs text-slate-500">{note} Current month: done <span className="font-semibold text-sky-700">+ still expected</span>.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <TypeTicks value={types} onChange={setTypes} />
          <button className="text-xs font-semibold text-brand-700 hover:underline print:hidden" onClick={() => setOpen(allOpen ? {} : { ...Object.fromEntries(cities.map(c => [c, true])), __total: true })}>{allOpen ? '− Collapse all' : '+ Expand all by site type'}</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 bg-white px-3 py-2 text-left">City</th>
              {v.past.length > 0 && <th colSpan={v.past.length} className="border-l border-slate-100 px-2 py-1 text-center">Trend (actual)</th>}
              <th className="bg-emerald-50 px-2 py-1 text-center">This month</th>
              <th colSpan={v.future.length} className="bg-sky-50/60 px-2 py-1 text-center">Expected</th>
              <th className="border-l border-slate-100 px-2 py-1">Ahead</th>
            </tr>
            <tr className="border-b border-slate-200 text-xs text-slate-600">
              <th className="sticky left-0 bg-white px-3 py-1.5" />
              {cols.map(x => <th key={x.k} className={`px-3 py-1.5 font-semibold ${bg(x)}`}>{mLabel(x.k)}</th>)}
              <th className="border-l border-slate-100 px-3 py-1.5 font-semibold" title="This month (done + expected) + coming months">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cities.map(c => (
              <Fragment key={c}>
                <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(o => ({ ...o, [c]: !o[c] }))}>
                  <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1.5 text-left font-semibold text-slate-800">
                    <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[11px] font-bold leading-none text-slate-600 print:hidden">{open[c] ? '−' : '+'}</span>
                    {c}<span className="ml-1 text-[10px] font-normal text-slate-400">{v.regionOf[c] || ''}</span>
                  </td>
                  {cols.map(x => <td key={x.k} className={`px-3 py-1.5 ${bg(x)}`}>{cell(x, g[c]?.[x.k])}</td>)}
                  <td className="border-l border-slate-100 px-3 py-1.5 font-bold text-navy-900">{fmtNum(r1(ahead(c))) || '·'}</td>
                </tr>
                {open[c] && subTypes(c).map(t => {
                  const k = `${c}\u0000${t}`
                  return (
                    <tr key={k} className="bg-slate-50/70 text-[13px]">
                      <td className="sticky left-0 bg-slate-50 py-1 pl-10 pr-3 text-left text-slate-600">{t === 'SPP' ? 'SPP' : t === 'Private' ? 'PVT · Private' : 'FRN · Franchise'}</td>
                      {cols.map(x => <td key={x.k} className={`px-3 py-1 ${bg(x)}`}>{cell(x, g[k]?.[x.k])}</td>)}
                      <td className="border-l border-slate-100 px-3 py-1 font-semibold text-slate-700">{fmtNum(r1(ahead(k))) || '·'}</td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
            {!cities.length && <tr><td colSpan={cols.length + 2} className="py-6 text-center text-slate-400">Nothing for these site types</td></tr>}
          </tbody>
          <tfoot>
            <tr className="cursor-pointer border-t-2 border-slate-300 bg-slate-50 font-bold" onClick={() => setOpen(o => ({ ...o, __total: !o.__total }))}>
              <td className="sticky left-0 bg-slate-50 px-3 py-2 text-left"><span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[11px] font-bold leading-none text-slate-600 print:hidden">{open.__total ? '−' : '+'}</span>Total</td>
              {cols.map(x => <td key={x.k} className={`px-3 py-2 ${bg(x)}`}>{cell(x, tot(x.k))}</td>)}
              <td className="border-l border-slate-100 px-3 py-2 text-navy-900">{fmtNum(r1(cities.reduce((a, c) => a + ahead(c), 0)))}</td>
            </tr>
            {open.__total && TYPES.map(([t]) => t).filter(t => types.includes(t)).map(t => {
              const keys = cities.map(c => `${c}\u0000${t}`)
              const tt = k => keys.reduce((a, kk) => { const x = g[kk]?.[k]; if (x) { a.qis += x.qis; a.dueQ += x.dueQ } return a }, { qis: 0, dueQ: 0 })
              return (
                <tr key={t} className="border-t border-slate-200 bg-slate-50/70 text-[13px]">
                  <td className="sticky left-0 bg-slate-50 py-1 pl-10 pr-3 text-left text-slate-600">{t === 'SPP' ? 'SPP' : t === 'Private' ? 'PVT · Private' : 'FRN · Franchise'}</td>
                  {cols.map(x => <td key={x.k} className={`px-3 py-1 ${bg(x)}`}>{cell(x, tt(x.k))}</td>)}
                  <td className="border-l border-slate-100 px-3 py-1 font-semibold text-slate-700">{fmtNum(r1(keys.reduce((a, kk) => a + ahead(kk), 0)))}</td>
                </tr>
              )
            })}
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function StageTable({ title, defs, by, v, splitNote }) {
  const [open, setOpen] = useState({})
  const sumRow = xs => xs.reduce((a, x) => ({ qis: a.qis + x.qis, sites: a.sites + x.sites }), { qis: 0, sites: 0 })
  const cities = Object.keys(by).sort((a, b) => v.regionRank(a) - v.regionRank(b) || sumRow(by[b].all).qis - sumRow(by[a].all).qis)
  const tot = defs.map((_, i) => sumRow(cities.map(c => by[c].all[i])))
  const C = ({ x }) => (x.sites ? <div className="font-semibold">{fmtNum(r1(x.qis))}</div> : <span className="text-slate-300">·</span>)
  const canSplit = cities.some(c => by[c].parts)
  const allOpen = canSplit && cities.every(c => open[c])
  return (
    <section className="card overflow-hidden">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex-1"><h2 className="font-bold text-navy-900">{title}</h2><p className="text-xs text-slate-500">QIS of open sites by current stage (energized and dropped excluded){splitNote ? ` · ${splitNote}` : ''}</p></div>
        {canSplit && <button className="text-xs font-semibold text-brand-700 hover:underline print:hidden" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(cities.map(c => [c, true])))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead><tr className="border-b border-slate-200 text-xs text-slate-600">
            <th className="px-3 py-2 text-left">City</th>
            {defs.map(([l]) => <th key={l} className="px-3 py-2 font-semibold">{l}</th>)}
            <th className="border-l border-slate-100 px-3 py-2 font-semibold">Total</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {cities.map(c => {
              const parts = by[c].parts
              return (
                <Fragment key={c}>
                  <tr className={parts ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={parts ? () => setOpen(o => ({ ...o, [c]: !o[c] })) : undefined}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-slate-800">
                      {parts && (open[c] ? <ChevronDown className="mr-1 inline h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5 text-slate-500" />)}{c}
                    </td>
                    {by[c].all.map((x, i) => <td key={i} className="px-3 py-1.5"><C x={x} /></td>)}
                    <td className="border-l border-slate-100 px-3 py-1.5 font-bold"><C x={sumRow(by[c].all)} /></td>
                  </tr>
                  {parts && open[c] && Object.entries(parts).map(([p, xs]) => (
                    <tr key={p} className="bg-slate-50/70 text-[13px] text-slate-600">
                      <td className="py-1 pl-8 pr-3 text-left">{p}</td>
                      {xs.map((x, i) => <td key={i} className="px-3 py-1"><C x={x} /></td>)}
                      <td className="border-l border-slate-100 px-3 py-1"><C x={sumRow(xs)} /></td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
            {!cities.length && <tr><td colSpan={defs.length + 2} className="py-6 text-center text-slate-400">No open sites</td></tr>}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="px-3 py-2 text-left">Total</td>
            {tot.map((x, i) => <td key={i} className="px-3 py-2"><C x={x} /></td>)}
            <td className="border-l border-slate-100 px-3 py-2"><C x={sumRow(tot)} /></td>
          </tr></tfoot>
        </table>
      </div>
    </section>
  )
}

function Productivity({ v }) {
  const per = (x, n) => (n ? r1(x / n) : 0)
  const team = v.prod.reduce((a, p) => a + p.n, 0)
  const allM = v.prodMonths.map((m, i) => v.prod.reduce((a, p) => ({ hoQ: a.hoQ + p.months[i].hoQ, hoS: a.hoS + p.months[i].hoS }), { hoQ: 0, hoS: 0 }))
  const label = (m, i) => mLabel(m) + (i === v.prodMonths.length - 1 ? ' (MTD)' : '')
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="font-bold text-navy-900">Team productivity · Acquisition (Franchise + Private)</h2>
        <p className="text-xs text-slate-500">Handovers (sites and QIS) in each city ÷ people working that city (Delhi NCR = Delhi, Gurugram, Noida, Ghaziabad, Faridabad). Zonal heads are split equally across the cities they cover. SPP team not counted.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1" colSpan={2} />
              {v.prodMonths.map((m, i) => <th key={m} colSpan={2} className="border-l border-slate-100 px-3 py-1 text-center">{label(m, i)}</th>)}
            </tr>
            <tr className="border-b border-slate-200 text-xs text-slate-600">
              <th className="px-3 py-1.5 text-left">Team</th><th className="px-3 py-1.5">People</th>
              {v.prodMonths.map(m => <Fragment key={m}><th className="border-l border-slate-100 px-3 py-1.5 font-semibold">HO sites / person</th><th className="px-3 py-1.5 font-semibold">HO QIS / person</th></Fragment>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {v.prod.map(p => (
              <tr key={p.base}>
                <td className="px-3 py-1.5 text-left"><div className="font-semibold text-slate-800">{p.base}</div><div className="text-[10px] text-slate-400">{p.names}</div></td>
                <td className="px-3 py-1.5 font-semibold">{fmtPeople(p.n)}</td>
                {p.months.map((x, i) => <ProdCell key={i} x={x} n={p.n} per={per} />)}
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="px-3 py-2 text-left">All teams</td><td className="px-3 py-2">{fmtPeople(Math.round(team * 10) / 10)}</td>
            {allM.map((x, i) => <ProdCell key={i} x={x} n={team} per={per} />)}
          </tr></tfoot>
        </table>
      </div>

      <ByPerson v={v} label={label} />
    </section>
  )
}

function ProdCell({ x, n, per }) {
  return <>
    <td className="border-l border-slate-100 px-3 py-1.5"><span className="font-semibold text-slate-700">{n ? (x.hoS / n).toFixed(1) : '0'}</span><div className="whitespace-nowrap text-[10px] text-slate-400">{x.hoS} site{x.hoS === 1 ? '' : 's'}</div></td>
    <td className="px-3 py-1.5"><span className="font-bold text-navy-900">{fmtNum(per(x.hoQ, n))}</span><div className="whitespace-nowrap text-[10px] text-slate-400">{fmtNum(r1(x.hoQ))} QIS</div></td>
  </>
}

function ByPerson({ v, label }) {
  const groups = []
  for (const p of v.personRows) { let g = groups.find(x => x.name === p.group); if (!g) groups.push(g = { name: p.group, rows: [] }); g.rows.push(p) }
  groups.sort((a, b) => (a.name === 'Zonal heads' ? -1 : b.name === 'Zonal heads' ? 1 : b.rows.length - a.rows.length || a.name.localeCompare(b.name)))
  const shade = i => (i % 2 ? 'bg-slate-50/60' : '')
  const num = (n, strong) => (n ? <span className={strong ? 'font-bold text-navy-900' : 'font-semibold text-slate-700'}>{fmtNum(r1(n))}</span> : <span className="text-slate-300">–</span>)
  const sumG = (rows, i, k) => rows.reduce((a, p) => a + p.months[i][k], 0)
  const cells = (ms, sub) => ms.map((x, i) => (
    <Fragment key={i}>
      <td className={`border-l border-slate-200 px-3 py-1.5 ${shade(i)}`}>{sub ? <span className="font-semibold text-slate-500">{fmtNum(x.added)}</span> : num(x.added)}</td>
      <td className={`px-3 py-1.5 ${shade(i)}`}>{sub ? <span className="font-semibold text-slate-500">{fmtNum(x.hoS)}</span> : num(x.hoS)}</td>
      <td className={`px-3 py-1.5 ${shade(i)}`}>{sub ? <span className="font-bold text-slate-600">{fmtNum(r1(x.hoQ))}</span> : num(x.hoQ, true)}</td>
    </Fragment>
  ))
  return (
    <>
      <div className="border-t border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-navy-900">By person</h3>
        <p className="text-xs text-slate-500">Sites added = new sites the person brought in that month. Handovers are credited to the site owner; older sites sit under zonal heads, so heads' numbers include earlier team work.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 bg-white px-3 py-1" />
              {v.prodMonths.map((m, i) => <th key={m} colSpan={3} className={`border-l border-slate-200 px-3 py-1.5 text-center ${shade(i)}`}>{label(m, i)}</th>)}
            </tr>
            <tr className="border-b border-slate-200 text-xs text-slate-600">
              <th className="sticky left-0 bg-white px-3 py-1.5 text-left">Person</th>
              {v.prodMonths.map((m, i) => (
                <Fragment key={m}>
                  <th className={`border-l border-slate-200 px-3 py-1.5 font-semibold ${shade(i)}`}>Sites added</th>
                  <th className={`px-3 py-1.5 font-semibold ${shade(i)}`}>Sites HO</th>
                  <th className={`px-3 py-1.5 font-semibold ${shade(i)}`}>QIS HO</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          {groups.map(g => (
            <tbody key={g.name} className="divide-y divide-slate-100 border-b border-slate-200">
              <tr className="bg-slate-100/80 text-xs">
                <td className="sticky left-0 bg-slate-100 px-3 py-1 text-left font-bold uppercase tracking-wide text-slate-600">{g.name}{g.rows.length > 1 && <span className="ml-1 font-normal normal-case text-slate-400">· {g.rows.length} people</span>}</td>
                {g.rows.length > 1 ? cells(v.prodMonths.map((_, i) => ({ added: sumG(g.rows, i, 'added'), hoS: sumG(g.rows, i, 'hoS'), hoQ: sumG(g.rows, i, 'hoQ') })), true) : v.prodMonths.map(m => <td key={m} colSpan={3} className="border-l border-slate-200" />)}
              </tr>
              {g.rows.map(p => (
                <tr key={p.name} className="hover:bg-slate-50">
                  <td className="sticky left-0 whitespace-nowrap bg-white py-1.5 pl-6 pr-3 text-left font-semibold text-slate-800">{p.name}{g.name === 'Zonal heads' && <span className="ml-2 text-[11px] font-normal text-slate-400">{p.base}</span>}</td>
                  {cells(p.months)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  )
}
