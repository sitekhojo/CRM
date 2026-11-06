import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints, exitOf, isTrackerSite, addedDay, isBulkImport } from '../lib/deals'
import { useConfig } from '../lib/config'
import { useAuth } from '../lib/auth'
import { fmtNum, fmtDate, INTENTS } from '../lib/format'
import DealFilters from './DealFilters'
import { Modal, PageLoader } from './ui'
import EditCell from './EditCell'
import DateCell from './DateCell'
import IntentCell from './IntentCell'
import StageCell from './StageCell'
import OwnerCell from './OwnerCell'
import RemarksCell, { fetchRemarks, latestRemark } from './RemarksCell'
import { SingleSelect } from './MultiSelect'
import { Download } from 'lucide-react'
import { exportWorkbook } from '../lib/excel'

const ym = d => String(d || '').slice(0, 7)
const monthName = k => new Date(k + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const qisOf = r => Number(r.extra?.qis_count) || 0
const sum = xs => ({ qis: xs.reduce((a, r) => a + qisOf(r), 0), sites: xs.length, list: xs })
export const SITE_TYPE_CHIPS = {
  Franchise: { short: 'FRN', cls: 'bg-indigo-100 text-indigo-800' },
  Private: { short: 'PVT', cls: 'bg-teal-100 text-teal-800' },
  SPP: { short: 'SPP', cls: 'bg-orange-100 text-orange-800' },
}
const typeKey = r => r.site_type || 'Not set'
const typeChip = t => SITE_TYPE_CHIPS[t] || { short: t === 'Not set' ? '?' : t.slice(0, 4), cls: 'bg-slate-100 text-slate-600' }
/** QIS and site count per site type, biggest first. */
export const byType = xs => Object.values(xs.reduce((o, r) => { const k = typeKey(r); o[k] = o[k] || { type: k, qis: 0, sites: 0 }; o[k].qis += qisOf(r); o[k].sites++; return o }, {})).sort((a, b) => b.qis - a.qis || b.sites - a.sites)
export const SiteTypeChip = ({ t, children, className = '' }) => <span className={`rounded px-1 text-[10px] font-semibold ${typeChip(t).cls} ${className}`} title={t}>{typeChip(t).short}{children}</span>
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

export default function Forecast({ view = 'table' }) {
  const { deals, loading, reload } = useDeals()
  const { cities = [] } = useConfig()
  const { isAdmin } = useAuth()
  const [network, setNetwork] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [detail, setDetail] = useState(null) // { title, pick: m => rows }
  const [scope, setScope] = useState('both')
  const [chipBy, setChipBy] = useState('intent')
  const [typeFilter, setTypeFilter] = useState('')
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
    const sc = { done: sum(rows.filter(r => !isBulkImport(r) && ym(addedDay(r)) === cur)) }
    const tot = o => sum(months.flatMap(k => o.est[k].list))
    return { months, cur, today, ho: { ...ho, total: tot(ho) }, en: { ...en, total: tot(en) }, sc, openPipe, notLive }
  }, [deals, filters, network, cities])

  if (loading || !m) return <PageLoader />

  if (view === 'list') {
    const [c, n] = m.months
    const inM = (d, k) => ym(d) === k && d >= m.today
    const pick = {
      both: r => inM(r.extra?.expected_ho, c) || inM(r.extra?.expected_ho, n) || inM(r.extra?.expected_en, c) || inM(r.extra?.expected_en, n),
      this: r => inM(r.extra?.expected_ho, c) || inM(r.extra?.expected_en, c),
      next: r => inM(r.extra?.expected_ho, n) || inM(r.extra?.expected_en, n),
      slipped: r => (r.stage_category === 'active' && r.extra?.expected_ho && r.extra.expected_ho < m.today) || (r.extra?.expected_en && r.extra.expected_en < m.today),
      nodate: r => (r.stage_category === 'active' && !r.extra?.expected_ho) || !r.extra?.expected_en,
      all: () => true,
    }[scope]
    const list = m.notLive.filter(pick)
    return (
      <div className="space-y-3">
        <DealFilters value={filters} onChange={setFilters} show={['q', 'region', 'city', 'owner', 'stage', 'siteType', 'format']}
          prefix={<SingleSelect value={scope} allValue="__" onChange={setScope} options={[
            { value: 'both', label: `Due ${monthName(c)} + ${monthName(n)}` }, { value: 'this', label: `Due this month (${monthName(c)})` },
            { value: 'next', label: `Due next month (${monthName(n)})` }, { value: 'slipped', label: 'Slipped (date passed)' },
            { value: 'nodate', label: 'Missing expected dates' }, { value: 'all', label: 'All open pipeline' },
          ]} />}
          extra={isAdmin && <button className="btn-secondary" onClick={async () => { const rem = await fetchRemarks(list.map(r => r.id)); exportWorkbook([{ name: 'Pipeline list', rows: list.map(r => planRow(r, scope, rem)), columns: PLAN_COLS }], `sitekhojo-pipeline-list-${m.today}`) }}><Download className="h-4 w-4" />Excel</button>} />
        <p className="text-sm text-slate-500"><b className="text-slate-700">{list.length} sites · {fmtNum(sum(list).qis)} QIS</b> · open pipeline and Handover Done (not yet energized). Click a date, QIS, intent, stage or owner to change it — the forecast updates instantly.</p>
        <TypeSplit rows={list} value={typeFilter} onChange={setTypeFilter} />
        <div className="card overflow-x-auto"><PlanTable rows={list.filter(r => !typeFilter || typeKey(r) === typeFilter)} onChanged={reload} today={m.today} /></div>
      </div>
    )
  }

  const Cell = ({ v, pick, title, tone = 'text-slate-900', intents = true }) => (
    <td className="px-2 py-2 text-right align-top">
      {v && v.sites ? (
        <button className="w-full rounded-md px-2 py-1 text-right hover:bg-slate-100" onClick={() => v.list && setDetail({ title, pick })} disabled={!v.list}>
          <div className={`text-base font-bold ${tone}`}>{fmtNum(v.qis)}</div>
          <div className="text-[11px] text-slate-400">{v.sites} sites</div>
          {intents && v.list && chipBy === 'type' && (
            <div className="mt-0.5 flex flex-wrap justify-end gap-1">{byType(v.list).map(x => <SiteTypeChip key={x.type} t={x.type}> {x.qis}</SiteTypeChip>)}</div>)}
          {intents && v.list && chipBy === 'intent' && (() => { const b = byIntent(v.list); return (
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
      <div className="flex flex-wrap items-end gap-2">
        <DealFilters value={filters} onChange={setFilters} show={['region', 'city', 'owner', 'stage', 'siteType', 'format']} />
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold" title="What the small chips under each number show">
          <span className="bg-slate-50 px-2 py-1.5 text-xs font-normal text-slate-500">Split by</span>
          {[['intent', 'Intent'], ['type', 'Site type']].map(([k, l]) => <button key={k} onClick={() => setChipBy(k)} className={`px-3 py-1.5 ${chipBy === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600'}`}>{l}</button>)}
        </div>
        {isAdmin && <button className="btn-secondary ml-auto" onClick={() => {
          const line = (metric, kind, o) => ({ metric, kind, slipped: o.slipped?.qis ?? '', ...Object.fromEntries(m.months.map(k => [monthName(k), o.est?.[k]?.qis ?? (k === m.cur ? o.done?.qis ?? '' : '')])), fy_total: o.total?.qis ?? '', no_date: o.noDate?.qis ?? '' })
          const summary = [
            { metric: 'Scouted', kind: 'Done (this month)', [monthName(m.cur)]: m.sc.done.qis },
            { metric: 'Handover', kind: 'Done (this month)', [monthName(m.cur)]: m.ho.done.qis },
            line('Handover', 'Estimate', m.ho),
            { metric: 'Energisation', kind: 'Done (this month, QIS tracker)', [monthName(m.cur)]: m.en.done.qis },
            line('Energisation', 'Estimate', m.en),
          ]
          const cols = [['metric', 'Metric'], ['kind', 'Row'], ['slipped', 'Slipped'], ...m.months.map(k => [monthName(k), monthName(k)]), ['fy_total', 'FY total'], ['no_date', 'No date']]
          const sites = [
            ...m.ho.slipped.list.map(r => planRow(r, 'HO slipped')), ...m.months.flatMap(k => m.ho.est[k].list.map(r => planRow(r, `HO ${monthName(k)}`))), ...m.ho.noDate.list.map(r => planRow(r, 'HO no date')),
            ...m.en.slipped.list.map(r => planRow(r, 'Energisation slipped')), ...m.months.flatMap(k => m.en.est[k].list.map(r => planRow(r, `Energisation ${monthName(k)}`))), ...m.en.noDate.list.map(r => planRow(r, 'Energisation no date')),
          ]
          exportWorkbook([{ name: 'Forecast (QIS)', rows: summary, columns: cols }, { name: 'Sites by bucket', rows: sites, columns: PLAN_COLS }], `sitekhojo-forecast-${m.today}`)
        }}><Download className="h-4 w-4" />Excel</button>}
      </div>
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
            <tr><Lbl sub="leads/deals added">Done</Lbl><td />{[<Cell key="d" v={m.sc.done} pick={x => x.sc.done.list} title={`Scouted in ${curName}`} tone="text-sky-700" intents={false} />]}{blank(m.months.length - 1)}<td /><td /></tr>
            <tr><Lbl sub="you'll add these">Target</Lbl><td />{blank(m.months.length + 1)}<td /></tr>

            <tr className="bg-slate-50/60"><td colSpan={m.months.length + 4} className="px-3 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Handover</td></tr>
            <tr><Lbl sub="actually handed over">Done</Lbl><td />{[<Cell key="d" v={m.ho.done} pick={x => x.ho.done.list} title={`Handed over in ${curName}`} tone="text-amber-700" intents={false} />]}{blank(m.months.length - 1)}<td /><td /></tr>
            <tr><Lbl sub="by Expected HO date">Estimate</Lbl>
              <Cell v={m.ho.slipped} pick={x => x.ho.slipped.list} title="Handover slipped (expected HO date passed)" tone="text-red-600" />
              {m.months.map(k => <Cell key={k} v={m.ho.est[k]} pick={x => x.ho.est[k].list} title={`Expected handover · ${monthName(k)}`} tone="text-amber-700" />)}
              <Cell v={m.ho.total} pick={x => x.ho.total.list} title="Expected handover · rest of FY" tone="text-amber-800" />
              <Cell v={m.ho.noDate} pick={x => x.ho.noDate.list} title="Open pipeline with no Expected HO date" tone="text-slate-500" />
            </tr>
            <tr><Lbl sub="you'll add these">Target</Lbl><td />{blank(m.months.length + 1)}<td /></tr>

            <tr className="bg-slate-50/60"><td colSpan={m.months.length + 4} className="px-3 pt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Energisation</td></tr>
            <tr><Lbl sub="QIS tracker">Done</Lbl><td />{[<Cell key="d" v={m.en.done} title={`Energized in ${curName}`} tone="text-emerald-700" intents={false} />]}{blank(m.months.length - 1)}<td /><td /></tr>
            <tr><Lbl sub="by Expected energisation date">Estimate</Lbl>
              <Cell v={m.en.slipped} pick={x => x.en.slipped.list} title="Energisation slipped (expected date passed)" tone="text-red-600" />
              {m.months.map(k => <Cell key={k} v={m.en.est[k]} pick={x => x.en.est[k].list} title={`Expected energisation · ${monthName(k)}`} tone="text-emerald-700" />)}
              <Cell v={m.en.total} pick={x => x.en.total.list} title="Expected energisation · rest of FY" tone="text-emerald-800" />
              <Cell v={m.en.noDate} pick={x => x.en.noDate.list} title="Not yet energized, no Expected energisation date" tone="text-slate-500" />
            </tr>
            <tr><Lbl sub="you'll add these">Target</Lbl><td />{blank(m.months.length + 1)}<td /></tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Estimates use each lead/deal's <b>Expected HO date</b> and <b>Expected energisation date</b> (set them on the deal or via import). Handover estimate = open pipeline (Scouting → Agreement, Hold excluded); energisation estimate = everything not yet energized, including Handover Done.
        <b className="text-red-600"> Slipped</b> = expected date already passed. {chipBy === 'intent' ? <>Chips show QIS by intent: <span className={`rounded px-1 ${INTENTS.hot.cls}`}>H</span> hot · <span className={`rounded px-1 ${INTENTS.warm.cls}`}>W</span> warm · <span className={`rounded px-1 ${INTENTS.cold.cls}`}>C</span> cold.</>
          : <>Chips show QIS by site type: {Object.keys(SITE_TYPE_CHIPS).map(t => <span key={t}><SiteTypeChip t={t} /> {t} · </span>)}<SiteTypeChip t="Not set" /> not set.</>} Click a number to see the sites.
      </p>

      <Modal open={!!detail} onClose={() => { setDetail(null); setTypeFilter('') }} wide="xl" title={detail ? `${detail.title} · ${fmtNum(sum(detail.pick(m)).qis)} QIS · ${detail.pick(m).length} sites` : ''}
        footer={<button className="btn-primary" onClick={() => { setDetail(null); setTypeFilter('') }}>Close</button>}>
        {detail && <TypeSplit rows={detail.pick(m)} value={typeFilter} onChange={setTypeFilter} />}
        {detail && <div className="max-h-[60vh] overflow-auto"><PlanTable rows={detail.pick(m).filter(r => !typeFilter || typeKey(r) === typeFilter)} onChanged={reload} /></div>}
      </Modal>
    </div>
  )
}

const PLAN_COLS = [['site_code', 'ID'], ['name', 'Site'], ['record_type', 'Type'], ['city', 'City'], ['region', 'Region'], ['site_type', 'Site type'], ['stage_name', 'Stage'],
  ['intent', 'Intent'], ['qis', 'QIS'], ['expected_ho', 'Expected HO'], ['expected_en', 'Expected energisation'], ['ho_date', 'Handover date'], ['energized_on', 'Energization date'], ['owner', 'Owner'], ['bucket', 'Forecast bucket'], ['latest_remark', 'Latest remark'], ['remark_history', 'Remarks history']]
const remarkLine = c => `${new Date(c.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}${c.said_by ? ` (${c.said_by})` : ''}: ${c.body}`
const planRow = (r, bucket, rem = {}) => ({ ...r, latest_remark: latestRemark(rem[r.id]), remark_history: (rem[r.id] || []).map(remarkLine).join('\n'), intent: INTENTS[r.extra?.intent]?.label || '', qis: qisOf(r), expected_ho: r.extra?.expected_ho || '', expected_en: r.extra?.expected_en || '', ho_date: r.extra?.ho_date || '', energized_on: r.extra?.energized_on || '', bucket })

/** Site-type split of a set of sites; click a type to show only those. */
export function TypeSplit({ rows, value, onChange }) {
  const xs = byType(rows)
  if (!xs.length) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Site type</span>
      <button onClick={() => onChange('')} className={`rounded-lg border px-2.5 py-1 ${!value ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 hover:bg-slate-50'}`}>
        Total <b>{fmtNum(xs.reduce((a, x) => a + x.qis, 0))}</b> QIS <span className={!value ? 'text-slate-300' : 'text-slate-400'}>· {rows.length} {rows.length === 1 ? 'site' : 'sites'}</span>
      </button>
      {xs.map(x => (
        <button key={x.type} onClick={() => onChange(value === x.type ? '' : x.type)}
          className={`rounded-lg border px-2.5 py-1 ${value === x.type ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50'}`}>
          <SiteTypeChip t={x.type} className="mr-1.5" /><b>{fmtNum(x.qis)}</b> QIS <span className="text-slate-400">· {x.sites} {x.sites === 1 ? 'site' : 'sites'}</span>
        </button>
      ))}
    </div>
  )
}

/** Editable planning table: stage, intent, QIS, expected HO / energisation dates, owner. */
export function PlanTable({ rows, onChanged, today }) {
  const t = today || todayIso()
  const [remarks, setRemarks] = useState({})
  const idsKey = rows.map(r => r.id).sort().join(',')
  const loadRemarks = () => fetchRemarks(rows.map(r => r.id)).then(setRemarks).catch(() => {})
  useEffect(() => { loadRemarks() }, [idsKey]) // eslint-disable-line
  const sorted = [...rows].sort((a, b) => String(a.extra?.expected_ho || a.extra?.expected_en || '9').localeCompare(String(b.extra?.expected_ho || b.extra?.expected_en || '9')))
  const late = (d, active = true) => active && d && d < t
  if (!rows.length) return <p className="p-6 text-center text-sm text-slate-400">No sites here.</p>
  return (
    <table className="min-w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr><th className="px-3 py-2">Site</th><th className="px-2 py-2">City</th><th className="px-2 py-2">Site type</th><th className="px-2 py-2">Stage</th><th className="px-2 py-2">Intent</th>
          <th className="px-2 py-2 text-right">QIS</th><th className="px-2 py-2">Expected HO / HO date</th><th className="px-2 py-2">Expected energisation</th><th className="px-2 py-2">Owner</th><th className="px-2 py-2">Remarks <span className="normal-case text-slate-400">(latest)</span></th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {sorted.map(r => (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="max-w-[260px] px-3 py-2"><Link className="block truncate font-semibold text-slate-900 hover:text-brand-700" to={`/app/deals/${r.id}`}>{r.name}</Link><div className="font-mono text-[10px] text-slate-400">{r.site_code} · {r.record_type === 'lead' ? 'Lead' : 'Deal'}</div></td>
            <td className="px-2 py-2">{r.city}</td>
            <td className="whitespace-nowrap px-2 py-2">{r.site_type ? <><SiteTypeChip t={r.site_type} /> <span className="text-xs text-slate-600">{r.site_type}</span></> : <span className="text-slate-300">—</span>}</td>
            <td className="px-2 py-2"><StageCell deal={r} onChanged={onChanged} /></td>
            <td className="px-2 py-2"><IntentCell deal={r} onChanged={onChanged} /></td>
            <td className="px-2 py-2 text-right font-semibold"><EditCell deal={r} field="qis_count" type="number" label="QIS" onChanged={onChanged} /></td>
            <td className="px-2 py-2">{['approved', 'live'].includes(r.stage_category)
              ? <div><DateCell deal={r} field="ho_date" label="Handover date" onChanged={onChanged} /><div className="text-[10px] font-semibold uppercase text-cyan-700">handed over</div></div>
              : <EditCell deal={r} field="expected_ho" label="Expected HO" onChanged={onChanged} className={late(r.extra?.expected_ho) ? 'font-semibold text-red-600' : ''} />}</td>
            <td className="px-2 py-2"><EditCell deal={r} field="expected_en" label="Expected energisation" onChanged={onChanged} className={late(r.extra?.expected_en) ? 'font-semibold text-red-600' : ''} /></td>
            <td className="px-2 py-2"><OwnerCell deal={r} onChanged={onChanged} /></td>
            <td className="px-2 py-1"><RemarksCell deal={r} list={remarks[r.id]} onChanged={loadRemarks} /></td>
          </tr>
        ))}
      </tbody>
      <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
        <tr><td className="px-3 py-2" colSpan={5}>Total · {rows.length} {rows.length === 1 ? 'site' : 'sites'}</td><td className="px-2 py-2 text-right">{fmtNum(rows.reduce((a, r) => a + qisOf(r), 0))}</td><td colSpan={4} /></tr>
      </tfoot>
    </table>
  )
}
