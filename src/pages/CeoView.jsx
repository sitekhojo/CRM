import { useMemo } from 'react'
import { Printer } from 'lucide-react'
import { useDeals } from '../lib/deals'
import { useConfig, REGIONS } from '../lib/config'
import { PageLoader } from '../components/ui'
import { fmtNum } from '../lib/format'

/**
 * CEO View: everything on one page, no filters.
 * Handovers and energizations by city and month (actuals for past months, expected dates for the coming months),
 * where the pipeline sits by stage, and per-person productivity.
 * Dropped sites are never counted.
 */
const NCR = ['Delhi', 'Gurugram', 'Noida', 'Ghaziabad', 'Faridabad']
const teamCity = c => (NCR.includes(c) ? 'Delhi NCR' : c)
const ym = d => (d ? String(d).slice(0, 7) : null)
const q = r => Number(r.extra?.qis_count) || 0
const r1 = n => (n ? Math.round(n * 10) / 10 : 0)
const sitesL = n => `${n} site${n === 1 ? '' : 's'}`
const mLabel = m => new Date(m + '-15').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const addMonths = (m, k) => { const d = new Date(m + '-15'); d.setMonth(d.getMonth() + k); return d.toISOString().slice(0, 7) }

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

  const v = useMemo(() => {
    if (!deals || !ready) return null
    const keyOf = Object.fromEntries(stages.map(s => [s.id, s.key]))
    const regionOf = Object.fromEntries(cities.map(c => [c.name, c.region]))
    const now = new Date()
    const cur = now.toISOString().slice(0, 7)
    const past = [-5, -4, -3, -2, -1].map(k => addMonths(cur, k))
    const future = [1, 2, 3, 4, 5].map(k => addMonths(cur, k))
    const fyStart = (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1) + '-04'

    const alive = deals.filter(d => d.stage_category !== 'dropped')
    const handedOver = d => ['ho_done', 'energized'].includes(keyOf[d.stage_id]) || d.stage_category === 'live'
    const hoDate = d => (handedOver(d) ? d.extra?.ho_date || (keyOf[d.stage_id] === 'ho_done' ? d.stage_entered_at : null) : null)
    const enDate = d => (d.stage_category === 'live' ? d.extra?.energized_on : null)
    const firstHo = alive.map(d => ym(d.extra?.ho_date)).filter(Boolean).sort()[0] || cur

    // metric: 'ho' | 'en'  →  { city → { month|'over' → {qis, sites, due} } }
    const grid = kind => {
      const out = {}
      const add = (city, key, d, due) => {
        const c = (out[city || 'Not set'] ||= {}); const x = (c[key] ||= { qis: 0, sites: 0, dueQ: 0, dueS: 0 })
        if (due) { x.dueQ += q(d); x.dueS++ } else { x.qis += q(d); x.sites++ }
      }
      for (const d of alive) {
        const done = kind === 'ho' ? hoDate(d) : enDate(d)
        if (done) { add(d.city, ym(done), d, false); continue }
        if (kind === 'ho' && handedOver(d)) continue // handed over earlier, date unknown
        const exp = ym(kind === 'ho' ? d.extra?.expected_ho : d.extra?.expected_en)
        if (!exp) continue
        add(d.city, exp < cur ? 'over' : exp, d, true)
      }
      return out
    }
    const ho = grid('ho'), en = grid('en')

    const cityList = [...new Set([...Object.keys(ho), ...Object.keys(en), ...alive.filter(d => d.stage_category !== 'live').map(d => d.city || 'Not set')])]
    const regionRank = c => { const i = REGIONS.indexOf(regionOf[c]); return i < 0 ? 9 : i }
    const rowTotal = (g, c) => Object.entries(g[c] || {}).filter(([k]) => k >= cur || k === 'over').reduce((a, [, x]) => a + x.qis + x.dueQ, 0)
    const sortCities = g => cityList.filter(c => g[c]).sort((a, b) => regionRank(a) - regionRank(b) || rowTotal(g, b) - rowTotal(g, a) || a.localeCompare(b))

    // stage snapshot (open pipeline)
    const stageGrid = (types, defs) => {
      const rows = alive.filter(d => types.includes(d.site_type) && d.stage_category !== 'live')
      const by = {}
      for (const d of rows) {
        const i = defs.findIndex(([, keys]) => keys.includes(keyOf[d.stage_id]))
        if (i < 0) continue
        const c = (by[d.city || 'Not set'] ||= defs.map(() => ({ qis: 0, sites: 0 })))
        c[i].qis += q(d); c[i].sites++
      }
      return by
    }
    const acq = stageGrid(['Franchise', 'Private'], ACQ_STAGES)
    const spp = stageGrid(['SPP'], SPP_STAGES)

    // productivity: acquisition team (Franchise + Private), by team base city
    const prodMonths = [-2, -1, 0].map(k => addMonths(cur, k)).filter(m => m >= firstHo)
    const people = team.filter(t => t.is_active && t.base_city)
    const bases = [...new Set(people.map(t => t.base_city))]
    const acqSites = alive.filter(d => ['Franchise', 'Private'].includes(d.site_type) && !['qis_tracker', 'payment_tracker', 'spp_pipeline'].includes(d.extra?.source))
    const acqAll = alive.filter(d => ['Franchise', 'Private'].includes(d.site_type))
    const prod = bases.map(b => {
      const n = people.filter(t => t.base_city === b).length
      const months = prodMonths.map(m => {
        const h = acqAll.filter(d => teamCity(d.city) === b && ym(hoDate(d)) === m)
        const added = acqSites.filter(d => teamCity(d.city) === b && ym(d.created_at) === m)
        return { m, hoQ: h.reduce((a, d) => a + q(d), 0), hoS: h.length, added: added.length }
      })
      return { base: b, n, names: people.filter(t => t.base_city === b).map(t => t.name.split(' ')[0]).join(', '), months }
    }).sort((a, b) => b.n - a.n || a.base.localeCompare(b.base))
    const personRows = people.map(t => ({
      name: t.name, base: t.base_city, lead: t.is_lead,
      months: prodMonths.map(m => {
        const h = acqAll.filter(d => d.owner === t.name && ym(hoDate(d)) === m)
        return { hoQ: h.reduce((a, d) => a + q(d), 0), hoS: h.length, added: acqSites.filter(d => d.owner === t.name && ym(d.created_at) === m).length }
      }),
    })).sort((a, b) => a.base.localeCompare(b.base) || (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.name.localeCompare(b.name))

    // headline numbers
    const live = alive.filter(d => d.stage_category === 'live')
    const sum = xs => xs.reduce((a, d) => a + q(d), 0)
    const kpi = {
      liveQ: sum(live), liveS: live.length,
      fyEnQ: sum(live.filter(d => ym(enDate(d)) >= fyStart)),
      hoMtdQ: sum(alive.filter(d => ym(hoDate(d)) === cur)),
      hoDueQ: sum(alive.filter(d => !handedOver(d) && ym(d.extra?.expected_ho) === cur)),
      enMtdQ: sum(live.filter(d => ym(enDate(d)) === cur)),
      enDueQ: sum(alive.filter(d => d.stage_category !== 'live' && ym(d.extra?.expected_en) === cur)),
      acqPipeQ: sum(alive.filter(d => ['Franchise', 'Private'].includes(d.site_type) && !['live'].includes(d.stage_category) && keyOf[d.stage_id] !== 'ho_done')),
      sppPipeQ: sum(alive.filter(d => d.site_type === 'SPP' && d.stage_category !== 'live' && keyOf[d.stage_id] !== 'ho_done')),
      awaitingEnQ: sum(alive.filter(d => keyOf[d.stage_id] === 'ho_done')),
    }
    return { cur, past, future, firstHo, ho, en, sortCities, acq, spp, prod, prodMonths, personRows, kpi, regionOf, asOf: now }
  }, [deals, ready, stages, team, cities])

  if (loading || !v) return <PageLoader />
  const { kpi } = v

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-navy-900">CEO View</h1>
          <p className="text-sm text-slate-500">All cities and site types on one page · QIS (sites in grey) · dropped sites never counted · as of {v.asOf.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        </div>
        <div className="flex-1" />
        <button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / PDF</button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Live network" value={fmtNum(kpi.liveQ)} sub={`${fmtNum(kpi.liveS)} energized sites`} />
        <Kpi label="Energized this FY" value={fmtNum(kpi.fyEnQ)} sub="QIS since 1 April" />
        <Kpi label={`Handover · ${mLabel(v.cur)}`} value={fmtNum(kpi.hoMtdQ)} sub={`done · ${fmtNum(r1(kpi.hoDueQ))} more expected`} tone="emerald" />
        <Kpi label={`Energization · ${mLabel(v.cur)}`} value={fmtNum(kpi.enMtdQ)} sub={`done · ${fmtNum(r1(kpi.enDueQ))} more expected`} tone="emerald" />
        <Kpi label="Handed over, not live" value={fmtNum(kpi.awaitingEnQ)} sub="QIS awaiting energization" tone="amber" />
        <Kpi label="Open pipeline" value={fmtNum(r1(kpi.acqPipeQ + kpi.sppPipeQ))} sub={`Acquisition ${fmtNum(r1(kpi.acqPipeQ))} · SPP ${fmtNum(r1(kpi.sppPipeQ))}`} />
      </div>

      <MonthGrid title="Handovers by city" note={`Past months: actual handover dates (Site Khojo has these from ${mLabel(v.firstHo)}). Coming months: expected handover date of sites not yet handed over. "Overdue" = expected date already passed, not handed over.`}
        g={v.ho} v={v} minMonth={v.firstHo} />
      <MonthGrid title="Energizations by city" note='Past months: actual energization dates. Coming months: expected energization date of sites not yet live. "Overdue" = expected date already passed, not live yet.'
        g={v.en} v={v} />

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <StageTable title="Where the pipeline is · Acquisition (Franchise + Private)" defs={ACQ_STAGES} by={v.acq} regionOf={v.regionOf} />
        <StageTable title="Where the pipeline is · Strategic Partnerships" defs={SPP_STAGES} by={v.spp} regionOf={v.regionOf} />
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

function Cell({ x, muted, dueOnly }) {
  if (!x || (!x.qis && !x.dueQ)) return <span className="text-slate-300">·</span>
  if (dueOnly) return <><div className="font-semibold text-sky-800">{fmtNum(r1(x.dueQ))}</div><div className="whitespace-nowrap text-[10px] text-slate-400">{sitesL(x.dueS)}</div></>
  return (
    <>
      <div className={`font-semibold ${muted ? 'text-slate-500' : 'text-slate-900'}`}>{fmtNum(r1(x.qis))}{x.dueQ ? <span className="ml-1 text-[11px] font-semibold text-sky-700">+{fmtNum(r1(x.dueQ))}</span> : null}</div>
      <div className="whitespace-nowrap text-[10px] text-slate-400">{x.dueS ? `${x.sites} + ${sitesL(x.dueS)}` : sitesL(x.sites)}</div>
    </>
  )
}

function MonthGrid({ title, note, g, v, minMonth }) {
  const cities = v.sortCities(g)
  const cols = [...v.past.map(m => ({ k: m, kind: 'past' })), { k: 'over', kind: 'over' }, { k: v.cur, kind: 'cur' }, ...v.future.map(m => ({ k: m, kind: 'fut' }))]
  const tot = k => cities.reduce((a, c) => { const x = g[c]?.[k]; if (x) { a.qis += x.qis; a.sites += x.sites; a.dueQ += x.dueQ; a.dueS += x.dueS } return a }, { qis: 0, sites: 0, dueQ: 0, dueS: 0 })
  const ahead = c => cols.filter(x => x.kind !== 'past').reduce((a, x) => { const y = g[c]?.[x.k]; return a + (y ? y.qis + y.dueQ : 0) }, 0)
  const head = (x) => x.kind === 'over' ? 'Overdue' : mLabel(x.k)
  const bg = x => (x.kind === 'cur' ? 'bg-emerald-50' : x.kind === 'fut' ? 'bg-sky-50/60' : x.kind === 'over' ? 'bg-amber-50' : '')
  const renderCell = (x, c) => {
    if (x.kind === 'past' && minMonth && x.k < minMonth) return <span className="text-slate-300">–</span>
    const y = c ? g[c]?.[x.k] : tot(x.k)
    return <Cell x={y} dueOnly={x.kind === 'fut' || x.kind === 'over'} muted={x.kind === 'past'} />
  }
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="font-bold text-navy-900">{title}</h2>
        <p className="text-xs text-slate-500">{note} Current month: done <span className="font-semibold text-sky-700">+ still expected</span>.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 bg-white px-3 py-2 text-left">City</th>
              <th colSpan={v.past.length} className="border-l border-slate-100 px-2 py-1 text-center">Trend (actual)</th>
              <th className="border-l border-slate-100 bg-amber-50 px-2 py-1 text-center">Slipped</th>
              <th className="bg-emerald-50 px-2 py-1 text-center">This month</th>
              <th colSpan={v.future.length} className="bg-sky-50/60 px-2 py-1 text-center">Expected</th>
              <th className="border-l border-slate-100 px-2 py-1">Ahead</th>
            </tr>
            <tr className="border-b border-slate-200 text-xs text-slate-600">
              <th className="sticky left-0 bg-white px-3 py-1.5" />
              {cols.map(x => <th key={x.k} className={`px-3 py-1.5 font-semibold ${bg(x)}`}>{head(x)}</th>)}
              <th className="border-l border-slate-100 px-3 py-1.5 font-semibold" title="This month (done + expected) + overdue + coming months">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cities.map(c => (
              <tr key={c}>
                <td className="sticky left-0 bg-white px-3 py-1.5 text-left font-semibold text-slate-800">{c}<span className="ml-1 text-[10px] font-normal text-slate-400">{v.regionOf[c] || ''}</span></td>
                {cols.map(x => <td key={x.k} className={`px-3 py-1.5 ${bg(x)}`}>{renderCell(x, c)}</td>)}
                <td className="border-l border-slate-100 px-3 py-1.5 font-bold text-navy-900">{fmtNum(r1(ahead(c))) || '·'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
              <td className="sticky left-0 bg-slate-50 px-3 py-2 text-left">Total</td>
              {cols.map(x => <td key={x.k} className={`px-3 py-2 ${bg(x)}`}>{renderCell(x, null)}</td>)}
              <td className="border-l border-slate-100 px-3 py-2 text-navy-900">{fmtNum(r1(cities.reduce((a, c) => a + ahead(c), 0)))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function StageTable({ title, defs, by, regionOf }) {
  const cities = Object.keys(by).sort((a, b) => {
    const ra = REGIONS.indexOf(regionOf[a]), rb = REGIONS.indexOf(regionOf[b])
    return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || by[b].reduce((s, x) => s + x.qis, 0) - by[a].reduce((s, x) => s + x.qis, 0)
  })
  const tot = defs.map((_, i) => cities.reduce((a, c) => ({ qis: a.qis + by[c][i].qis, sites: a.sites + by[c][i].sites }), { qis: 0, sites: 0 }))
  const rowSum = c => by[c].reduce((a, x) => ({ qis: a.qis + x.qis, sites: a.sites + x.sites }), { qis: 0, sites: 0 })
  const C = ({ x }) => (x.sites ? <><div className="font-semibold">{fmtNum(r1(x.qis))}</div><div className="whitespace-nowrap text-[10px] text-slate-400">{sitesL(x.sites)}</div></> : <span className="text-slate-300">·</span>)
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3"><h2 className="font-bold text-navy-900">{title}</h2><p className="text-xs text-slate-500">Open sites by current stage (energized and dropped excluded)</p></div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead><tr className="border-b border-slate-200 text-xs text-slate-600">
            <th className="px-3 py-2 text-left">City</th>
            {defs.map(([l]) => <th key={l} className="px-3 py-2 font-semibold">{l}</th>)}
            <th className="border-l border-slate-100 px-3 py-2 font-semibold">Total</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {cities.map(c => (
              <tr key={c}>
                <td className="px-3 py-1.5 text-left font-semibold text-slate-800">{c}</td>
                {by[c].map((x, i) => <td key={i} className="px-3 py-1.5"><C x={x} /></td>)}
                <td className="border-l border-slate-100 px-3 py-1.5 font-bold"><C x={rowSum(c)} /></td>
              </tr>
            ))}
            {!cities.length && <tr><td colSpan={defs.length + 2} className="py-6 text-center text-slate-400">No open sites</td></tr>}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="px-3 py-2 text-left">Total</td>
            {tot.map((x, i) => <td key={i} className="px-3 py-2"><C x={x} /></td>)}
            <td className="border-l border-slate-100 px-3 py-2"><C x={tot.reduce((a, x) => ({ qis: a.qis + x.qis, sites: a.sites + x.sites }), { qis: 0, sites: 0 })} /></td>
          </tr></tfoot>
        </table>
      </div>
    </section>
  )
}

function Productivity({ v }) {
  const per = (x, n) => (n ? r1(x / n) : 0)
  const team = v.prod.reduce((a, p) => a + p.n, 0)
  const allM = v.prodMonths.map((m, i) => v.prod.reduce((a, p) => ({ hoQ: a.hoQ + p.months[i].hoQ, hoS: a.hoS + p.months[i].hoS, added: a.added + p.months[i].added }), { hoQ: 0, hoS: 0, added: 0 }))
  const label = (m, i) => mLabel(m) + (i === v.prodMonths.length - 1 ? ' (MTD)' : '')
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="font-bold text-navy-900">Team productivity · Acquisition (Franchise + Private)</h2>
        <p className="text-xs text-slate-500">Handovers in each city ÷ people based there (Delhi NCR = Delhi, Gurugram, Noida, Ghaziabad, Faridabad). SPP team not counted. Per-person month-on-month starts {mLabel(v.prodMonths[0] || v.cur)}, when handover dates begin.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1 text-left" colSpan={2} />
              {v.prodMonths.map((m, i) => <th key={m} colSpan={3} className="border-l border-slate-100 px-2 py-1 text-center">{label(m, i)}</th>)}
            </tr>
            <tr className="border-b border-slate-200 text-xs text-slate-600">
              <th className="px-3 py-1.5 text-left">Team</th><th className="px-3 py-1.5">People</th>
              {v.prodMonths.map(m => <FragmentHead key={m} />)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {v.prod.map(p => (
              <tr key={p.base}>
                <td className="px-3 py-1.5 text-left"><div className="font-semibold text-slate-800">{p.base}</div><div className="whitespace-nowrap text-[10px] text-slate-400">{p.names}</div></td>
                <td className="px-3 py-1.5 font-semibold">{p.n}</td>
                {p.months.map((x, i) => <ProdCells key={i} x={x} n={p.n} per={per} />)}
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="px-3 py-2 text-left">All teams</td><td className="px-3 py-2">{team}</td>
            {allM.map((x, i) => <ProdCells key={i} x={x} n={team} per={per} />)}
          </tr></tfoot>
        </table>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-navy-900">By person</h3>
        <p className="text-xs text-slate-500">Handovers credited to the site owner. Older sites sit under zonal heads, so their numbers include their team's earlier work.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead><tr className="border-b border-slate-200 text-xs text-slate-600">
            <th className="px-3 py-1.5 text-left">Person</th><th className="px-3 py-1.5 text-left">Base</th>
            {v.prodMonths.map((m, i) => <th key={m} className="border-l border-slate-100 px-3 py-1.5 font-semibold">{label(m, i)}<div className="text-[10px] font-normal text-slate-400">HO QIS · sites · added</div></th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {v.personRows.map(p => (
              <tr key={p.name}>
                <td className="px-3 py-1.5 text-left font-semibold text-slate-800">{p.name}{p.lead && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">lead</span>}</td>
                <td className="px-3 py-1.5 text-left text-slate-500">{p.base}</td>
                {p.months.map((x, i) => (
                  <td key={i} className="border-l border-slate-100 px-3 py-1.5">
                    <span className={x.hoQ ? 'font-bold text-navy-900' : 'text-slate-300'}>{x.hoQ ? fmtNum(r1(x.hoQ)) : '0'}</span>
                    <span className="text-slate-400"> · {x.hoS} · {x.added}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const FragmentHead = () => <>
  <th className="border-l border-slate-100 px-3 py-1.5 font-semibold" title="Handover QIS per person">HO QIS / person</th>
  <th className="px-3 py-1.5 font-semibold" title="Sites handed over per person">HO sites / person</th>
  <th className="px-3 py-1.5 font-semibold" title="New sites added per person">Added / person</th>
</>

function ProdCells({ x, n, per }) {
  return <>
    <td className="border-l border-slate-100 px-3 py-1.5"><span className="font-bold text-navy-900">{fmtNum(per(x.hoQ, n))}</span><div className="whitespace-nowrap text-[10px] text-slate-400">{fmtNum(r1(x.hoQ))} total</div></td>
    <td className="px-3 py-1.5">{fmtNum(per(x.hoS, n))}<div className="whitespace-nowrap text-[10px] text-slate-400">{x.hoS} total</div></td>
    <td className="px-3 py-1.5">{fmtNum(per(x.added, n))}<div className="whitespace-nowrap text-[10px] text-slate-400">{x.added} total</div></td>
  </>
}
