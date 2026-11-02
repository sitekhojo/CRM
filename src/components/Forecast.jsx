import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints, exitOf, isTrackerSite, addedDay } from '../lib/deals'
import { useConfig } from '../lib/config'
import { fmtNum, fmtDate, INTENTS } from '../lib/format'
import DealFilters from './DealFilters'
import { Modal, PageLoader, StageBadge } from './ui'

const ym = d => String(d || '').slice(0, 7)
const monthName = k => new Date(k + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const qisOf = r => Number(r.extra?.qis_count) || 0
const sum = xs => ({ qis: xs.reduce((a, r) => a + qisOf(r), 0), sites: xs.length, list: xs })
const byIntent = xs => Object.fromEntries(['hot', 'warm', 'cold', ''].map(k => [k, xs.filter(r => (r.extra?.intent || '') === k).reduce((a, r) => a + qisOf(r), 0)]))

/** Forward-looking: this month → end of the financial year (Apr–Mar). */
function horizon() {
  const now = new Date()
  const fyEnd = new Date(now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear(), 2, 1) // March
  const out = []
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d <= fyEnd; d.setMonth(d.getMonth() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  return out
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function Forecast() {
  const { deals, loading } = useDeals()
  const { cities = [] } = useConfig()
  const [network, setNetwork] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [detail, setDetail] = useState(null)
  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => {}) }, [])

  const m = useMemo(() => {
    if (!deals) return null
    const months = horizon(), cur = months[0], today = todayIso()
    const rows = applyFilters(deals, filters).filter(r => !isTrackerSite(r))
    const regionOf = Object.fromEntries(cities.map(c => [c.name.toLowerCase(), c.region]))
    const net = network.filter(n => n.point_type === 'own_station' && (!filters.city.length || filters.city.includes(n.city))
      && (!filters.siteType.length || filters.siteType.includes(n.site_type)) && (!filters.region.length || filters.region.includes(regionOf[String(n.city || '').toLowerCase()])))

    const openPipe = rows.filter(r => r.stage_category === 'active')           // still to hand over (Hold excluded)
    const notLive = rows.filter(r => ['active', 'approved'].includes(r.stage_category)) // still to energize
    const ho = {
      done: sum(rows.filter(r => { const x = exitOf(r); return x?.kind === 'ho' && ym(x.date) === cur })),
      slipped: sum(openPipe.filter(r => r.extra?.expected_ho && r.extra.expected_ho < today)),
      noDate: sum(openPipe.filter(r => !r.extra?.expected_ho)),
      est: Object.fromEntries(months.map(k => [k, sum(openPipe.filter(r => ym(r.extra?.expected_ho) === k && r.extra.expected_ho >= today))])),
    }
    const en = {
      done: (() => { let q = 0, s = 0; for (const n of net) { const c = Object.entries(n.energized_dates || {}).filter(([d]) => ym(d) === cur).reduce((a, [, v]) => a + (Number(v) || 0), 0); if (c) { q += c; s++ } } return { qis: q, sites: s, list: null } })(),
      slipped: sum(notLive.filter(r => r.extra?.expected_en && r.extra.expected_en < today)),
      noDate: sum(notLive.filter(r => !r.extra?.expected_en)),
      est: Object.fromEntries(months.map(k => [k, sum(notLive.filter(r => ym(r.extra?.expected_en) === k && r.extra.expected_en >= today))])),
    }
    const sc = { done: sum(rows.filter(r => ym(addedDay(r)) === cur)) }
    const tot = o => sum(months.flatMap(k => o.est[k].list))
    return { months, cur, ho: { ...ho, total: tot(ho) }, en: { ...en, total: tot(en) }, sc }
  }, [deals, filters, network, cities])

  if (loading || !m) return <PageLoader />

  const Cell = ({ v, title, tone = 'text-slate-900', intents = true }) => (
    <td className="px-2 py-2 text-right align-top">
      {v && v.sites ? (
        <button className="w-full rounded-md px-2 py-1 text-right hover:bg-slate-100" onClick={() => v.list && setDetail({ title, list: v.list })} disabled={!v.list}>
          <div className={`text-base font-bold ${tone}`}>{fmtNum(v.qis)}</div>
          <div className="text-[11px] text-slate-400">{v.sites} sites</div>
          {intents && v.list && (() => { const b = byIntent(v.list); return (
            <div className="mt-0.5 flex justify-end gap-1">
              {['hot', 'warm', 'cold'].filter(k => b[k]).map(k => <span key={k} className={`rounded px-1 text-[10px] font-semibold ${INTENTS[k].cls}`} title={INTENTS[k].hint}>{INTENTS[k].label[0]} {b[k]}</span>)}
              {b[''] > 0 && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500" title="Intent not set">? {b['']}</span>}
            </div>) })()}
        </button>
      ) : <span className="text-slate-300">—</span>}
    </td>
  )
  const Lbl = ({ children, sub }) => <td className="whitespace-nowrap px-3 py-2 align-top"><div className="font-semibold text-slate-800">{children}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</td>
  const blank = n => Array.from({ length: n }, (_, i) => <td key={i} className="px-2 py-2 text-right text-slate-300">—</td>)
  const curName = monthName(m.cur)

  return (
    <div className="space-y-3">
      <DealFilters value={filters} onChange={setFilters} show={['region', 'city', 'owner', 'siteType']} />
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">QIS</th>
              <th className="px-2 py-2 text-right text-red-600">Slipped<div className="text-[10px] normal-case text-slate-400">date passed</div></th>
              {m.months.map((k, i) => <th key={k} className={`px-2 py-2 text-right ${i === 0 ? 'text-brand-700' : ''}`}>{monthName(k)}{i === 0 && <div className="text-[10px] normal-case">this month</div>}{i === 1 && <div className="text-[10px] normal-case text-slate-400">next month</div>}</th>)}
              <th className="px-2 py-2 text-right">FY total<div className="text-[10px] normal-case text-slate-400">{monthName(m.cur)} – {monthName(m.months[m.months.length - 1])}</div></th>
              <th className="px-2 py-2 text-right text-slate-400">No date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/60"><td colSpan={m.months.length + 4} className="px-3 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Scouted</td></tr>
            <tr><Lbl sub="leads/deals added">Done</Lbl><td />{[<Cell key="d" v={m.sc.done} title={`Scouted in ${curName}`} tone="text-sky-700" intents={false} />]}{blank(m.months.length - 1)}<td /><td /></tr>
            <tr><Lbl sub="you'll add these">Target</Lbl><td />{blank(m.months.length + 1)}<td /></tr>

            <tr className="bg-slate-50/60"><td colSpan={m.months.length + 4} className="px-3 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Handover</td></tr>
            <tr><Lbl sub="actually handed over">Done</Lbl><td />{[<Cell key="d" v={m.ho.done} title={`Handed over in ${curName}`} tone="text-amber-700" intents={false} />]}{blank(m.months.length - 1)}<td /><td /></tr>
            <tr><Lbl sub="by Expected HO date">Estimate</Lbl>
              <Cell v={m.ho.slipped} title="Handover slipped (expected HO date passed)" tone="text-red-600" />
              {m.months.map(k => <Cell key={k} v={m.ho.est[k]} title={`Expected handover · ${monthName(k)}`} tone="text-amber-700" />)}
              <Cell v={m.ho.total} title="Expected handover · rest of FY" tone="text-amber-800" />
              <Cell v={m.ho.noDate} title="Open pipeline with no Expected HO date" tone="text-slate-500" />
            </tr>
            <tr><Lbl sub="you'll add these">Target</Lbl><td />{blank(m.months.length + 1)}<td /></tr>

            <tr className="bg-slate-50/60"><td colSpan={m.months.length + 4} className="px-3 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Energisation</td></tr>
            <tr><Lbl sub="QIS tracker">Done</Lbl><td />{[<Cell key="d" v={m.en.done} title={`Energized in ${curName}`} tone="text-emerald-700" intents={false} />]}{blank(m.months.length - 1)}<td /><td /></tr>
            <tr><Lbl sub="by Expected energisation date">Estimate</Lbl>
              <Cell v={m.en.slipped} title="Energisation slipped (expected date passed)" tone="text-red-600" />
              {m.months.map(k => <Cell key={k} v={m.en.est[k]} title={`Expected energisation · ${monthName(k)}`} tone="text-emerald-700" />)}
              <Cell v={m.en.total} title="Expected energisation · rest of FY" tone="text-emerald-800" />
              <Cell v={m.en.noDate} title="Not yet energized, no Expected energisation date" tone="text-slate-500" />
            </tr>
            <tr><Lbl sub="you'll add these">Target</Lbl><td />{blank(m.months.length + 1)}<td /></tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Estimates use each lead/deal's <b>Expected HO date</b> and <b>Expected energisation date</b> (set them on the deal or via import). Handover estimate = open pipeline (Scouting → Agreement, Hold excluded); energisation estimate = everything not yet energized, including Handover Done.
        <b className="text-red-600"> Slipped</b> = expected date already passed. Chips show QIS by intent: <span className={`rounded px-1 ${INTENTS.hot.cls}`}>H</span> hot · <span className={`rounded px-1 ${INTENTS.warm.cls}`}>W</span> warm · <span className={`rounded px-1 ${INTENTS.cold.cls}`}>C</span> cold. Click a number to see the sites.
      </p>

      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={detail ? `${detail.title} · ${fmtNum(sum(detail.list).qis)} QIS · ${detail.list.length} sites` : ''}
        footer={<button className="btn-primary" onClick={() => setDetail(null)}>Close</button>}>
        {detail && (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2 pr-2">Site</th><th className="pr-2">City</th><th className="pr-2">Stage</th><th className="pr-2">Intent</th><th className="pr-2 text-right">QIS</th><th className="pr-2">Exp. HO</th><th className="pr-2">Exp. energisation</th><th>Owner</th></tr></thead>
              <tbody>
                {[...detail.list].sort((a, b) => String(a.extra?.expected_ho || a.extra?.expected_en || '').localeCompare(String(b.extra?.expected_ho || b.extra?.expected_en || ''))).map(r => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 pr-2"><Link className="font-semibold text-slate-900 hover:text-brand-700" to={`/app/deals/${r.id}`}>{r.name}</Link><div className="font-mono text-[10px] text-slate-400">{r.site_code}</div></td>
                    <td className="pr-2">{r.city}</td>
                    <td className="pr-2"><StageBadge name={r.stage_name} color={r.stage_color} /></td>
                    <td className="pr-2">{INTENTS[r.extra?.intent] ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${INTENTS[r.extra.intent].cls}`}>{INTENTS[r.extra.intent].label}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="pr-2 text-right font-semibold">{qisOf(r) || '—'}</td>
                    <td className="whitespace-nowrap pr-2">{r.extra?.expected_ho ? fmtDate(r.extra.expected_ho) : '—'}</td>
                    <td className="whitespace-nowrap pr-2">{r.extra?.expected_en ? fmtDate(r.extra.expected_en) : '—'}</td>
                    <td>{r.owner || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
