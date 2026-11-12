import { useEffect, useMemo, useState } from 'react'
import { isBulkImport, isTrackerSite } from '../lib/deals'
import { REGIONS } from '../lib/config'
import { addDays, fmtDay, fetchVisits } from '../lib/visits'
import { haversine } from '../lib/geo'
import { fmtNum } from '../lib/format'

/** Working days = Mon–Fri between from and to (inclusive). */
export const workingDays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) out.push(d); return out }
const day10 = d => String(d || '').slice(0, 10)
const qisOf = d => Number(d.extra?.qis_count) || 0
const NEAR_M = 300 // a visit within 300 m of the site counts as a field visit

const TYPES = [['new_site', 'New site'], ['follow_up', 'Follow-up'], ['franchisee_meeting', 'Franchisee'], ['discom', 'Discom'], ['other', 'Other']]

/**
 * Two small, shareable tables for a week or month:
 *  1. Where the time goes — visits per person by type.
 *  2. Leads & deals created — how many were backed by a logged field visit, and how many were not.
 */
export default function TeamSummary({ label, from, to, visits, deals, team, people, colorOf }) {
  const [tab, setTab] = useState('time')
  const [open, setOpen] = useState(null)
  // Visits from 60 days before the period, to check whether a site was visited before it was created
  const [history, setHistory] = useState(null)
  useEffect(() => { setHistory(null); fetchVisits(addDays(from, -60), to).then(setHistory).catch(() => setHistory([])) }, [from, to])

  const m = useMemo(() => {
    const wd = workingDays(from, to)
    // Field team only: zonal heads, the SPP team and Sneh are left out
    const excluded = new Set(team.filter(t => t.is_lead || t.region === 'SPP' || /^sneh\b/i.test(t.name)).map(t => t.name))
    const active = team.filter(t => t.is_active && !excluded.has(t.name))
    let names = [...new Set([...active.map(t => t.name), ...visits.map(v => v.member)])].filter(n => !excluded.has(n) && !/^sneh\b/i.test(n))
    if (people.length) names = names.filter(n => people.includes(n))
    const regionOf = Object.fromEntries(team.map(t => [t.name, t.region]))
    const order = n => { const i = REGIONS.indexOf(regionOf[n]); return i < 0 ? 9 : i }

    // 1. Where the time goes
    const time = names.map(n => {
      const vs = visits.filter(v => v.member === n)
      const days = new Set(vs.map(v => v.visit_date))
      const ns = vs.filter(v => v.visit_type === 'new_site')
      return { nsLead: ns.filter(v => v.lead_created).length, nsNo: ns.filter(v => !v.lead_created).length, name: n, region: regionOf[n] || '—', visits: vs.length, days: wd.filter(d => days.has(d)).length, byType: Object.fromEntries(TYPES.map(([k]) => [k, vs.filter(v => v.visit_type === k).length])) }
    }).sort((a, b) => order(a.name) - order(b.name) || b.visits - a.visits || a.name.localeCompare(b.name))

    // 2. Leads & deals created in the period (not imports / tracker), by owner — backed by a field visit or not
    const all = history || visits
    const created = deals.filter(d => !isBulkImport(d) && !isTrackerSite(d) && d.stage_category !== 'dropped' && day10(d.created_at) >= from && day10(d.created_at) <= to)
    const visitedBy = (d, n) => {
      const until = addDays(day10(d.created_at), 3)
      return all.some(v => v.member === n && v.visit_date <= until && (
        v.site_id === d.id ||
        (d.latitude != null && v.latitude != null && haversine(v.latitude, v.longitude, d.latitude, d.longitude) <= NEAR_M)))
    }
    const made = names.map(n => {
      const mine = created.filter(d => d.owner === n)
      const ok = mine.filter(d => visitedBy(d, n))
      const no = mine.filter(d => !ok.includes(d))
      const skipped = visits.filter(v => v.member === n && v.visit_type === 'new_site' && !v.lead_created)
      const reasons = {}; skipped.forEach(v => { const k = v.no_lead_reason || 'No reason'; reasons[k] = (reasons[k] || 0) + 1 })
      return { skipped: skipped.length, reasons: Object.entries(reasons).map(([k, c]) => `${k}: ${c}`).join('\n'), name: n, region: regionOf[n] || '—', total: mine.length, leads: mine.filter(d => d.record_type === 'lead').length, dealsN: mine.filter(d => d.record_type !== 'lead').length, ok: ok.length, no: no.length, noQis: no.reduce((a, d) => a + qisOf(d), 0), noList: no }
    }).filter(r => r.total || r.skipped || people.length).sort((a, b) => b.no - a.no || b.total - a.total || a.name.localeCompare(b.name))

    return { wd: wd.length, time, made }
  }, [from, to, visits, deals, team, people, history])

  const tTot = k => m.time.reduce((a, r) => a + (k in r.byType ? r.byType[k] : r[k]), 0)
  const cTot = k => m.made.reduce((a, r) => a + r[k], 0)

  return (
    <div className="card mx-auto max-w-5xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-base font-extrabold text-navy-900">Team summary · {label}</p>
          <p className="text-xs text-slate-500">{fmtDay(from)} – {fmtDay(to)} · {m.wd} working days (Mon–Fri)</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold">
          {[['time', 'Where the time goes'], ['made', 'Leads & deals created']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'time' ? (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2 text-left">Person</th><th className="px-2 text-center">Days out</th><th className="px-2 text-right">Visits</th>
              {TYPES.map(([k, l]) => <th key={k} className="px-2 text-right">{l}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {m.time.map(r => (
              <tr key={r.name}>
                <td className="px-4 py-1.5 font-semibold text-slate-800"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: colorOf[r.name] }} />{r.name}<span className="ml-1.5 text-[11px] font-normal text-slate-400">{r.region}</span></td>
                <td className={`px-2 text-center text-xs font-semibold ${r.days / Math.max(1, m.wd) >= 0.8 ? 'text-emerald-700' : r.days / Math.max(1, m.wd) >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>{r.days}/{m.wd}</td>
                <td className={`px-2 text-right font-extrabold ${r.visits ? 'text-navy-900' : 'text-red-600'}`}>{r.visits}</td>
                {TYPES.map(([k]) => (
                  <td key={k} className={`px-2 text-right ${r.byType[k] ? 'text-slate-700' : 'text-slate-300'}`}>{r.byType[k] || '—'}
                    {k === 'new_site' && r.byType[k] > 0 && <p className="text-[10px] font-semibold leading-tight"><span className="text-violet-600">{r.nsLead} lead</span> · <span className={r.nsNo ? 'text-amber-600' : 'text-slate-400'}>{r.nsNo} no lead</span></p>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
            <tr><td className="px-4 py-2">Team</td><td /><td className="px-2 text-right">{tTot('visits')}</td>
              {TYPES.map(([k]) => <td key={k} className="px-2 text-right">{tTot(k)}{k === 'new_site' && tTot(k) > 0 && <p className="text-[10px] leading-tight"><span className="text-violet-600">{tTot('nsLead')} lead</span> · <span className="text-amber-600">{tTot('nsNo')} no lead</span></p>}</td>)}</tr>
            <tr className="text-[11px] font-semibold text-slate-500"><td className="px-4 pb-2">Share of visits</td><td /><td />
              {TYPES.map(([k]) => <td key={k} className="px-2 pb-2 text-right">{tTot('visits') ? Math.round((100 * tTot(k)) / tTot('visits')) : 0}%</td>)}</tr>
          </tfoot>
        </table>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2 text-left">Person</th><th className="px-2 text-right">Created</th><th className="px-2 text-right">Leads</th><th className="px-2 text-right">Deals</th>
                <th className="px-2 text-right text-emerald-700">With field visit</th><th className="px-2 text-right text-red-600">No field visit</th><th className="px-2 text-right text-red-600">QIS, no visit</th><th className="px-2 text-right text-amber-600" title="New-site visits logged with 'Don't create a lead yet'">Scouted, no lead</th><th className="px-4 text-right">% backed by visit</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {m.made.map(r => {
                const pct = r.total ? Math.round((100 * r.ok) / r.total) : 0
                return (
                  <tr key={r.name} className={r.no ? 'bg-red-50/40' : ''}>
                    <td className="px-4 py-1.5 font-semibold text-slate-800"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: colorOf[r.name] }} />{r.name}<span className="ml-1.5 text-[11px] font-normal text-slate-400">{r.region}</span></td>
                    <td className="px-2 text-right font-extrabold text-navy-900">{r.total}</td>
                    <td className="px-2 text-right text-slate-600">{r.leads || '—'}</td><td className="px-2 text-right text-slate-600">{r.dealsN || '—'}</td>
                    <td className="px-2 text-right font-semibold text-emerald-700">{r.ok || '—'}</td>
                    <td className="px-2 text-right">{r.no ? <button onClick={() => setOpen(open === r.name ? null : r.name)} className="font-extrabold text-red-600 underline decoration-dotted">{r.no}</button> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 text-right text-red-600">{r.noQis ? fmtNum(r.noQis) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 text-right" title={r.reasons}>{r.skipped ? <span className="cursor-help font-semibold text-amber-600 underline decoration-dotted">{r.skipped}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 text-right"><span className={`rounded px-1.5 py-0.5 text-xs font-bold ${pct >= 80 ? 'bg-emerald-50 text-emerald-700' : pct >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-100 text-red-700'}`}>{r.total ? `${pct}%` : '—'}</span></td>
                  </tr>
                )
              })}
              {!m.made.length && <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">No leads or deals created in this period.</td></tr>}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
              <tr><td className="px-4 py-2">Team</td><td className="px-2 text-right">{cTot('total')}</td><td className="px-2 text-right">{cTot('leads')}</td><td className="px-2 text-right">{cTot('dealsN')}</td>
                <td className="px-2 text-right text-emerald-700">{cTot('ok')}</td><td className="px-2 text-right text-red-600">{cTot('no')}</td><td className="px-2 text-right text-red-600">{fmtNum(cTot('noQis'))}</td><td className="px-2 text-right text-amber-600">{cTot('skipped')}</td>
                <td className="px-4 text-right">{cTot('total') ? `${Math.round((100 * cTot('ok')) / cTot('total'))}%` : '—'}</td></tr>
            </tfoot>
          </table>
          {open && (
            <div className="border-t border-red-100 bg-red-50/50 px-4 py-2">
              <p className="mb-1 text-xs font-bold text-red-700">{open} · created without a field visit</p>
              <ul className="grid gap-x-4 text-xs text-slate-700 sm:grid-cols-2">
                {m.made.find(r => r.name === open)?.noList.map(d => (
                  <li key={d.id} className="truncate"><a href={`/app/deals/${d.id}`} className="font-mono text-slate-400 hover:underline">{d.site_code}</a> {d.name} · {d.city} · {fmtDay(day10(d.created_at))}{qisOf(d) ? ` · ${fmtNum(qisOf(d))} QIS` : ''}{d.latitude == null ? <span className="text-amber-600"> · no location</span> : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        {tab === 'time' ? 'Field team only (zonal heads, SPP team and Sneh not shown). Days out = working days with at least one visit logged. New site: "lead" = the visit created a lead, "no lead" = logged with Don\'t create a lead yet.'
          : `By site owner. "With field visit" = created from Log visit, or the owner logged a visit within ${NEAR_M} m of the site up to 3 days after it was created. Imports left out. Click a red number to see the sites. "Scouted, no lead" = new-site visits where the person chose not to create a lead (hover for reasons).`}
      </p>
    </div>
  )
}
