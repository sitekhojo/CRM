import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Plus, Trash2, Wallet } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints } from '../lib/deals'
import { supabase, fetchAll, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { haversine, hasLoc } from '../lib/geo'
import { fmtINR, fmtNum, fmtDate } from '../lib/format'
import { exportWorkbook } from '../lib/excel'
import { Modal, PageLoader, useToast, Field } from './ui'
import EditCell from './EditCell'
import StageCell from './StageCell'
import { SingleSelect } from './MultiSelect'
import DealFilters from './DealFilters'

export const COMPONENTS = [['ff', 'FF', 'Franchise fee'], ['sd', 'SD', 'Security deposit'], ['ic', 'IC', 'Infra cost']]
const compLabel = k => COMPONENTS.find(c => c[0] === k)?.[1] || 'Other'
const MODES = ['Opening balance', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash', 'Adjustment']
const fyStart = () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return `${y}-04-01` }
const fyLabel = () => { const y = Number(fyStart().slice(0, 4)); return `FY${String(y + 1).slice(2)}` }
const short = n => { const v = Number(n) || 0; return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : fmtINR(v) }

/**
 * Franchise payments: every Franchise site with QIS energized this FY (from the QIS tracker),
 * proposed amount (admin-entered) vs received (sum of logged payments).
 */
export default function FranchisePayments({ filters: extFilters, compact = false }) {
  const { deals, loading, reload } = useDeals()
  const { isAdmin, profile } = useAuth()
  const canPay = !!profile?.is_active
  const { cities = [], users = [] } = useConfig()
  const [network, setNetwork] = useState(null)
  const [payments, setPayments] = useState(null)
  const [ownFilters, setOwnFilters] = useState(EMPTY_FILTERS)
  const [status, setStatus] = useState('')
  const [stageSel, setStageSel] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // row for the payments modal
  const filters = extFilters || ownFilters

  const loadPayments = useCallback(() => fetchAll(() => supabase.from('site_payments').select('*').order('paid_on')).then(setPayments).catch(() => setPayments([])), [])
  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => setNetwork([])); loadPayments() }, [loadPayments])

  const m = useMemo(() => {
    if (!deals || !network || !payments) return null
    const from = fyStart()
    const regionOf = Object.fromEntries(cities.map(c => [c.name.toLowerCase(), c.region]))
    const live = deals.filter(d => d.stage_category === 'live')
    const paidBy = {}
    for (const p of payments) (paidBy[p.site_id] = paidBy[p.site_id] || []).push(p)
    const rows = network.filter(n => n.point_type === 'own_station' && n.site_type === 'Franchise').map(n => {
      const fy = Object.entries(n.energized_dates || {}).filter(([d]) => d >= from)
      if (!fy.length) return null
      const deal = live.find(d => d.extra?.network_point_id === n.id)
        || live.filter(hasLoc).map(d => ({ d, m: haversine(n.latitude, n.longitude, d.latitude, d.longitude) })).filter(x => x.m <= 100).sort((a, b) => a.m - b.m)[0]?.d
      return makeRow(n.id, deal, n.name, n.city, fy.reduce((a, [, c]) => a + (Number(c) || 0), 0), fy.map(([d]) => d).sort()[0], true)
    }).filter(Boolean)
    // Every other franchise deal with a proposed amount or a payment (any stage).
    const seen = new Set(rows.map(r => r.deal?.id).filter(Boolean))
    for (const d of deals) {
      if (d.site_type !== 'Franchise' || seen.has(d.id)) continue
      if (!paidBy[d.id] && !COMPONENTS.some(([k]) => Number(d.extra?.[`${k}_proposed`]))) continue
      rows.push(makeRow('d' + d.id, d, d.name, d.city, Number(d.extra?.qis_count) || 0, d.extra?.energized_on || null, false))
    }
    function makeRow(key, deal, name, city, qis, enDate, fyEnergized) {
      const pays = deal ? paidBy[deal.id] || [] : []
      const comp = Object.fromEntries(COMPONENTS.map(([k]) => [k, {
        proposed: Number(deal?.extra?.[`${k}_proposed`]) || 0,
        received: pays.filter(p => p.component === k).reduce((a, p) => a + Number(p.amount), 0),
      }]))
      const proposed = COMPONENTS.reduce((a, [k]) => a + comp[k].proposed, 0)
      const received = pays.reduce((a, p) => a + Number(p.amount), 0)
      return {
        key, deal, name, city, region: regionOf[String(city || '').toLowerCase()] || null, fyEnergized,
        stage: deal?.stage_name || (fyEnergized ? 'Energized' : '—'), stageColor: deal?.stage_color, stageId: deal?.stage_id,
        owner: deal?.owner || null, qis, enDate,
        comp, proposed, received, outstanding: Math.max(0, proposed - received), pays,
        lastPaid: pays.map(p => p.paid_on).sort().pop() || null,
        status: !proposed ? 'noproposal' : received >= proposed ? 'paid' : received > 0 ? 'partial' : 'none',
      }
    }
    const qq = q.trim().toLowerCase()
    const scoped = applyFiltersRows(rows, filters).filter(r => (!status || r.status === status) && (!stageSel || r.stage === stageSel) && (!qq || [r.name, r.deal?.name, r.deal?.site_code, r.city, r.owner].some(v => v && String(v).toLowerCase().includes(qq))))
    const tot = xs => ({ proposed: xs.reduce((a, r) => a + r.proposed, 0), received: xs.reduce((a, r) => a + r.received, 0), qis: xs.reduce((a, r) => a + r.qis, 0), sites: xs.length,
      comp: Object.fromEntries(COMPONENTS.map(([k]) => [k, { proposed: xs.reduce((a, r) => a + r.comp[k].proposed, 0), received: xs.reduce((a, r) => a + r.comp[k].received, 0) }])) })
    const all = tot(applyFiltersRows(rows, filters))
    const thisMonth = new Date().toISOString().slice(0, 7)
    const collectedMonth = applyFiltersRows(rows, filters).flatMap(r => r.pays).filter(p => p.paid_on && String(p.paid_on).slice(0, 7) === thisMonth).reduce((a, p) => a + Number(p.amount), 0)
    const counts = Object.fromEntries(['paid', 'partial', 'none', 'noproposal'].map(k => [k, applyFiltersRows(rows, filters).filter(r => r.status === k).length]))
    const stageCounts = {}
    for (const r of applyFiltersRows(rows, filters)) stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1
    return { stageCounts, rows: scoped.sort((a, b) => b.outstanding - a.outstanding || b.qis - a.qis), all, counts, collectedMonth, tot }
  }, [deals, network, payments, filters, status, stageSel, cities, q])

  if (loading || !m) return <PageLoader />
  const pct = m.all.proposed ? Math.round((100 * m.all.received) / m.all.proposed) : 0
  const refresh = () => { reload(); loadPayments() }
  const userName = id => users.find(u => u.id === id)?.full_name || ''
  const payLine = p => [p.paid_on ? fmtDate(p.paid_on) : 'Before CRM', compLabel(p.component), fmtINR(p.amount), p.mode, p.reference].filter(Boolean).join(' · ')
  const exportX = () => exportWorkbook([
    { name: 'Franchise payments', rows: m.rows.map(r => ({ site: r.name, code: r.deal?.site_code || '', city: r.city, region: r.region, stage: r.stage, fy_en: r.fyEnergized ? 'Yes' : '', owner: r.owner, qis: r.qis, energized: r.enDate,
        ...Object.fromEntries(COMPONENTS.flatMap(([k]) => [[`${k}_p`, r.comp[k].proposed], [`${k}_r`, r.comp[k].received], [`${k}_d`, Math.max(0, r.comp[k].proposed - r.comp[k].received)]])),
        proposed: r.proposed, received: r.received, outstanding: r.outstanding, pct: r.proposed ? Math.round((100 * r.received) / r.proposed) : '', last_paid: r.lastPaid || '',
        n_pays: r.pays.length, utrs: [...new Set(r.pays.map(p => p.reference).filter(Boolean))].join('; '),
        details: r.pays.map(payLine).join('\n'), remarks: r.pays.map(p => p.notes).filter(Boolean).join('; ') })),
      columns: [['site', 'Site'], ['code', 'CRM ID'], ['city', 'City'], ['region', 'Region'], ['stage', 'Stage'], ['fy_en', `Energized in ${fyLabel()}`], ['owner', 'Owner'], ['qis', 'QIS'], ['energized', 'First energized'],
        ...COMPONENTS.flatMap(([k, l]) => [[`${k}_p`, `${l} proposed (₹)`], [`${k}_r`, `${l} received (₹)`], [`${k}_d`, `${l} due (₹)`]]),
        ['proposed', 'Total proposed (₹)'], ['received', 'Total received (₹)'], ['outstanding', 'Outstanding (₹)'], ['pct', '% collected'], ['last_paid', 'Last payment'],
        ['n_pays', 'No. of payments'], ['utrs', 'UTR / references'], ['details', 'Payment details'], ['remarks', 'Remarks']] },
    { name: 'Payment log', rows: m.rows.flatMap(r => r.pays.map(p => ({ site: r.name, code: r.deal?.site_code || '', city: r.city, owner: r.owner, component: compLabel(p.component), paid_on: p.paid_on || 'Before CRM', amount: Number(p.amount), mode: p.mode, reference: p.reference, notes: p.notes, by: userName(p.created_by), logged_at: p.created_at }))),
      columns: [['site', 'Site'], ['code', 'CRM ID'], ['city', 'City'], ['owner', 'Owner'], ['component', 'Component'], ['paid_on', 'Paid on'], ['amount', 'Amount (₹)'], ['mode', 'Mode'], ['reference', 'UTR / reference'], ['notes', 'Remarks'], ['by', 'Logged by'], ['logged_at', 'Logged on']] },
  ], `sitekhojo-franchise-payments-${fyLabel()}`, { team: true })

  return (
    <div className="space-y-3">
      {!extFilters && <DealFilters value={ownFilters} onChange={setOwnFilters} show={['region', 'city', 'owner']} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Proposed', short(m.all.proposed), `${m.all.sites} franchise sites · ${fmtNum(m.all.qis)} QIS`, 'text-slate-900'],
          ['Received', short(m.all.received), `${pct}% collected`, 'text-emerald-600'],
          ['Outstanding', short(Math.max(0, m.all.proposed - m.all.received)), `${m.counts.partial} part paid · ${m.counts.none} nothing yet`, 'text-red-600'],
          ['Collected this month', short(m.collectedMonth), new Date().toLocaleDateString('en-IN', { month: 'long' }), 'text-sky-600'],
          ['Proposal missing', String(m.counts.noproposal), 'sites with no proposed amount', 'text-amber-600']].map(([l, v, sub, cls]) => (
          <div key={l} className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l}</p><p className={`mt-1 text-2xl font-extrabold ${cls}`}>{v}</p><p className="text-xs text-slate-500">{sub}</p></div>
        ))}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-2 bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COMPONENTS.map(([k, l, full]) => { const c = m.all.comp[k]; const q = c.proposed ? Math.round((100 * c.received) / c.proposed) : 0; return (
          <div key={k} className="card flex items-center gap-3 p-3">
            <span className="rounded bg-navy-900 px-1.5 py-0.5 text-xs font-bold text-white">{l}</span>
            <div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{full}</p>
              <p className="text-sm"><b className="text-emerald-700">{short(c.received)}</b> <span className="text-slate-400">of</span> <b>{short(c.proposed)}</b> <span className="text-xs text-red-600">· {short(Math.max(0, c.proposed - c.received))} due</span></p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-1.5 ${q >= 100 ? 'bg-emerald-500' : q >= 50 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${Math.min(100, q)}%` }} /></div></div>
            <span className="text-sm font-bold">{q}%</span>
          </div>) })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-full sm:w-64" placeholder="Search site, SK code, city, owner" value={q} onChange={e => setQ(e.target.value)} />
        <SingleSelect value={status} onChange={setStatus} options={[{ value: '', label: 'All payment statuses' }, { value: 'paid', label: `Fully paid (${m.counts.paid})` }, { value: 'partial', label: `Part paid (${m.counts.partial})` }, { value: 'none', label: `Nothing received (${m.counts.none})` }, { value: 'noproposal', label: `No proposed amount (${m.counts.noproposal})` }]} />
        <SingleSelect value={stageSel} onChange={setStageSel} options={[{ value: '', label: 'All stages' }, ...Object.entries(m.stageCounts).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ value: k, label: `${k} (${c})` }))]} />
        <span className="text-sm text-slate-500">Franchise sites energized in {fyLabel()} (QIS tracker) plus every franchise deal with a proposal or payment, any stage{canPay ? ' · click a proposed amount to edit, “+ Payment” to log money received' : ''}</span>
        {canPay && <button className="btn-secondary ml-auto" onClick={exportX}><Download className="h-4 w-4" />Excel</button>}
      </div>

      <div className={`card overflow-auto ${compact ? 'max-h-[520px]' : ''}`}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Site</th><th className="px-2 py-2">City</th><th className="px-2 py-2">Stage</th><th className="px-2 py-2">Owner</th><th className="px-2 py-2 text-right" title={`Energized in ${fyLabel()} (QIS tracker); for other stages, the deal's QIS`}>QIS</th><th className="px-2 py-2">Energized</th>
              {COMPONENTS.map(([k, l, full]) => <th key={k} className="px-2 py-2 text-right" title={`${full}: received / proposed`}>{l} <span className="normal-case text-slate-400">rec / prop</span></th>)}
              <th className="px-2 py-2 text-right">Total proposed</th><th className="px-2 py-2 text-right">Received</th><th className="px-2 py-2 text-right">Outstanding</th><th className="w-32 px-2 py-2">Collected</th><th className="px-2 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {m.rows.map(r => {
              const p = r.proposed ? Math.round((100 * r.received) / r.proposed) : null
              return (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="max-w-[260px] px-3 py-2">{r.deal ? <Link className="block truncate font-semibold text-slate-900 hover:text-brand-700" to={`/app/deals/${r.deal.id}`}>{r.name}</Link> : <span className="font-semibold">{r.name}</span>}<div className="font-mono text-[10px] text-slate-400">{r.deal?.site_code || 'no CRM deal'}</div></td>
                  <td className="px-2 py-2">{r.city}<div className="text-[10px] text-slate-400">{r.region}</div></td>
                  <td className="whitespace-nowrap px-2 py-2">{r.deal ? <StageCell deal={r.deal} onChanged={refresh} /> : <span className="text-xs text-slate-500">{r.stage}</span>}{r.fyEnergized && <div className="text-[10px] font-semibold text-emerald-700">energized {fyLabel()}</div>}</td>
                  <td className="px-2 py-2">{r.owner || '—'}</td>
                  <td className="px-2 py-2 text-right font-semibold">{r.qis}</td>
                  <td className="whitespace-nowrap px-2 py-2">{fmtDate(r.enDate)}</td>
                  {COMPONENTS.map(([k, l]) => { const c = r.comp[k]; return (
                    <td key={k} className="whitespace-nowrap px-2 py-2 text-right">
                      <div className={`font-semibold ${!c.proposed ? 'text-slate-400' : c.received >= c.proposed ? 'text-emerald-700' : c.received > 0 ? 'text-amber-700' : 'text-red-600'}`}>{c.received ? short(c.received) : '—'}</div>
                      <div className="text-[11px] text-slate-500">of {r.deal ? <EditCell deal={r.deal} field={`${k}_proposed`} type="number" label={`${l} proposed`} format={v => short(v)} onChanged={refresh} /> : '—'}</div>
                    </td>) })}
                  <td className="px-2 py-2 text-right">{r.proposed ? fmtINR(r.proposed) : '—'}</td>
                  <td className="px-2 py-2 text-right font-semibold text-emerald-700">{r.received ? fmtINR(r.received) : '—'}</td>
                  <td className={`px-2 py-2 text-right font-semibold ${r.outstanding ? 'text-red-600' : 'text-slate-300'}`}>{r.proposed ? fmtINR(r.outstanding) : '—'}</td>
                  <td className="px-2 py-2">{p === null ? <span className="text-xs text-amber-600">no proposal</span> : (
                    <div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 ${p >= 100 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${Math.min(100, p)}%` }} /></div><span className="w-9 text-right text-xs font-semibold">{p}%</span></div>)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{r.deal && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(r)}><Wallet className="h-3.5 w-3.5" />{canPay ? '+ Payment' : 'Payments'}{r.pays.length ? ` (${r.pays.length})` : ''}</button>}</td>
                </tr>
              )
            })}
            {m.rows.length === 0 && <tr><td colSpan={14} className="p-6 text-center text-slate-400">No sites match.</td></tr>}
          </tbody>
          {m.rows.length > 0 && (() => { const t = { p: m.rows.reduce((a, r) => a + r.proposed, 0), r: m.rows.reduce((a, r) => a + r.received, 0), q: m.rows.reduce((a, r) => a + r.qis, 0) }; return (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold"><tr><td className="px-3 py-2">Total · {m.rows.length} sites</td><td /><td /><td /><td className="px-2 py-2 text-right">{t.q}</td><td />{COMPONENTS.map(([k]) => { const c = m.tot(m.rows).comp[k]; return <td key={k} className="whitespace-nowrap px-2 py-2 text-right text-xs"><span className="text-emerald-700">{short(c.received)}</span><div className="font-normal text-slate-500">of {short(c.proposed)}</div></td> })}<td className="px-2 py-2 text-right">{fmtINR(t.p)}</td><td className="px-2 py-2 text-right text-emerald-700">{fmtINR(t.r)}</td><td className="px-2 py-2 text-right text-red-600">{fmtINR(Math.max(0, t.p - t.r))}</td><td className="px-2 py-2 text-xs">{t.p ? Math.round((100 * t.r) / t.p) : 0}%</td><td /></tr></tfoot>) })()}
        </table>
      </div>
      <PaymentsModal row={open} onClose={() => setOpen(null)} onChanged={refresh} isAdmin={isAdmin} canPay={canPay} />
    </div>
  )
}

function applyFiltersRows(rows, f) {
  return rows.filter(r => (!f.city?.length || f.city.includes(r.city)) && (!f.region?.length || f.region.includes(r.region)) && (!f.owner?.length || f.owner.includes(r.owner || ''))
    && (!f.stage?.length || f.stage.map(String).includes(String(r.stageId))))
}

function PaymentsModal({ row, onClose, onChanged, isAdmin, canPay }) {
  const toast = useToast()
  const blank = { component: 'ff', paid_on: new Date().toISOString().slice(0, 10), amount: '', mode: 'NEFT', reference: '', notes: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setF(blank) }, [row?.key]) // eslint-disable-line
  if (!row) return null
  const add = async e => {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.from('site_payments').insert({ site_id: row.deal.id, component: f.component, paid_on: f.paid_on || null, amount: Number(f.amount), mode: f.mode, reference: f.reference || null, notes: f.notes || null })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast(`${compLabel(f.component)} ₹${Number(f.amount).toLocaleString('en-IN')} recorded · ${row.deal.site_code}`); setF(blank); onChanged()
  }
  const del = async p => {
    if (!confirm(`Delete ${compLabel(p.component)} payment of ${fmtINR(p.amount)}${p.paid_on ? ` on ${fmtDate(p.paid_on)}` : ''}?`)) return
    const { error } = await supabase.from('site_payments').delete().eq('id', p.id)
    if (error) return toast(errMsg(error), 'error')
    toast('Payment deleted'); onChanged()
  }
  return (
    <Modal open={!!row} onClose={onClose} wide title={`${row.name} · payments`} footer={<button className="btn-primary" onClick={onClose}>Close</button>}>
      <div className="space-y-4 text-sm">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1" /><th className="text-right">Proposed</th><th className="text-right">Received</th><th className="text-right">Due</th></tr></thead>
          <tbody>{COMPONENTS.map(([k, l, full]) => { const c = row.comp[k]; return (
            <tr key={k} className="border-t border-slate-100"><td className="py-1.5"><b>{l}</b> <span className="text-xs text-slate-500">{full}</span></td><td className="text-right">{c.proposed ? fmtINR(c.proposed) : '—'}</td>
              <td className="text-right font-semibold text-emerald-700">{c.received ? fmtINR(c.received) : '—'}</td><td className="text-right font-semibold text-red-600">{c.proposed ? fmtINR(Math.max(0, c.proposed - c.received)) : '—'}</td></tr>) })}</tbody>
        </table>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Proposed</p><p className="text-lg font-bold">{row.proposed ? fmtINR(row.proposed) : '—'}</p></div>
          <div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-slate-500">Received</p><p className="text-lg font-bold text-emerald-700">{fmtINR(row.received)}</p></div>
          <div className="rounded-lg bg-red-50 p-3"><p className="text-xs text-slate-500">Outstanding</p><p className="text-lg font-bold text-red-600">{row.proposed ? fmtINR(row.outstanding) : '—'}</p></div>
        </div>
        <table className="w-full">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Date</th><th>For</th><th className="text-right">Amount</th><th className="pl-3">Mode</th><th>UTR / reference</th><th>Remarks</th><th /></tr></thead>
          <tbody>
            {row.pays.map(p => (
              <tr key={p.id} className="border-t border-slate-100"><td className="py-1.5">{p.paid_on ? fmtDate(p.paid_on) : <span className="text-xs text-slate-400">before CRM</span>}</td><td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold">{compLabel(p.component)}</span></td><td className="text-right font-semibold">{fmtINR(p.amount)}</td><td className="pl-3">{p.mode || '—'}</td><td>{p.reference || '—'}</td><td className="text-slate-500">{p.notes || ''}</td>
                <td className="text-right">{isAdmin && <button className="btn-ghost p-1 text-slate-400 hover:text-red-600" title="Delete" onClick={() => del(p)}><Trash2 className="h-4 w-4" /></button>}</td></tr>
            ))}
            {row.pays.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-slate-400">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
        {canPay && (
          <form onSubmit={add} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-6">
            <Field label="For"><select className="input" value={f.component} onChange={e => setF({ ...f, component: e.target.value })}>{COMPONENTS.map(([k, l, full]) => <option key={k} value={k}>{l} · {full}</option>)}</select></Field>
            <Field label="Date"><input className="input" type="date" required value={f.paid_on} onChange={e => setF({ ...f, paid_on: e.target.value })} /></Field>
            <Field label="Amount (₹)"><input className="input" type="number" step="0.01" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Mode"><select className="input" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}>{MODES.map(x => <option key={x}>{x}</option>)}</select></Field>
            <Field label="UTR / reference"><input className="input" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
            <Field label="Remarks"><input className="input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
            <div className="sm:col-span-6"><button className="btn-primary" disabled={busy || !f.amount}><Plus className="h-4 w-4" />{busy ? 'Saving…' : 'Add payment'}</button>
              <span className="ml-2 text-xs text-slate-500">Use a negative amount for a refund or reversal.{!isAdmin && ' Only an admin can delete a payment, so check before saving.'}</span></div>
          </form>
        )}
      </div>
    </Modal>
  )
}
