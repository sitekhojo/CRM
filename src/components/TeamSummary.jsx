import { useEffect, useMemo, useState } from 'react'
import { isBulkImport } from '../lib/deals'
import { REGIONS, useConfig } from '../lib/config'
import { supabase, fetchAll } from '../lib/supabase'
import { VISIT_TYPES, addDays, fmtDay, fetchVisits, istDay } from '../lib/visits'
import { fmtNum } from '../lib/format'

/** Working days = Mon–Sat between from and to (inclusive). */
export const workingDays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (new Date(d + 'T12:00:00Z').getUTCDay() !== 0) out.push(d); return out }
const inRange = (d, from, to) => { const x = String(d || '').slice(0, 10); return x >= from && x <= to }
const qisOf = d => Number(d.extra?.qis_count) || 0

/**
 * Week / month accountability: per person — days in the field vs working days, visits by type,
 * leads & QIS added, handovers, last visit — with team totals and the same stretch before it for comparison.
 */
export default function TeamSummary({ label, from, to, visits, deals, team, people, colorOf, onOpenDay }) {
  const len = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -len)
  const [prev, setPrev] = useState(null)
  useEffect(() => { setPrev(null); fetchVisits(prevFrom, prevTo).then(setPrev).catch(() => setPrev([])) }, [prevFrom, prevTo])
  const { stages = [] } = useConfig()
  const [moves, setMoves] = useState([])
  useEffect(() => {
    fetchAll(() => supabase.from('site_stage_history').select('site_id, from_stage_id, to_stage_id, changed_at').gte('changed_at', from + 'T00:00:00+05:30').lte('changed_at', to + 'T23:59:59+05:30'))
      .then(setMoves).catch(() => setMoves([]))
  }, [from, to])

  const m = useMemo(() => {
    const wd = workingDays(from, to)
    const today = istDay()
    const active = team.filter(t => t.is_active)
    // SPP team does not do field scouting: only shown if they logged visits
    let names = [...new Set([...active.filter(t => t.region !== 'SPP').map(t => t.name), ...visits.map(v => v.member)])]
    if (people.length) names = names.filter(n => people.includes(n))
    const regionOf = Object.fromEntries(team.map(t => [t.name, t.region]))
    const leadOf = Object.fromEntries(team.map(t => [t.name, t.is_lead]))
    const made = deals.filter(d => !isBulkImport(d) && inRange(d.created_at, from, to))
    const hos = deals.filter(d => inRange(d.extra?.ho_date, from, to))
    const stageById = Object.fromEntries(stages.map(st => [st.id, st]))
    const dealById = Object.fromEntries(deals.map(d => [d.id, d]))
    // Stage moves in the period on manually-worked sites: forward = to a later stage (not dropped), dropped = to a dropped stage
    const mv = moves.map(x => ({ ...x, site: dealById[x.site_id], to: stageById[x.to_stage_id], fromSt: stageById[x.from_stage_id] }))
      .filter(x => x.site && !isBulkImport(x.site) && x.to)
    const openLead = d => d.record_type === 'lead' && !['dropped', 'live'].includes(d.stage_category)
    const rows = names.map(n => {
      const vs = visits.filter(v => v.member === n)
      const days = new Set(vs.map(v => v.visit_date))
      const fieldDays = wd.filter(d => days.has(d)).length
      const missed = wd.filter(d => d <= today && !days.has(d))
      const mine = made.filter(d => d.owner === n)
      const ho = hos.filter(d => d.owner === n)
      const myMv = mv.filter(x => x.site.owner === n)
      const ahead = new Set(myMv.filter(x => x.to.category !== 'dropped' && (x.to.sort_order ?? 0) > (x.fromSt?.sort_order ?? 0)).map(x => x.site_id))
      const dropped = new Set(myMv.filter(x => x.to.category === 'dropped').map(x => x.site_id))
      const open = deals.filter(d => d.owner === n && openLead(d) && !isBulkImport(d))
      return {
        ahead: ahead.size, dropped: dropped.size, open: open.length, openQis: open.reduce((a, d) => a + qisOf(d), 0),
        stale: open.filter(d => (d.days_in_stage || 0) > 30).length, leadQis: mine.filter(d => d.record_type === 'lead').reduce((a, d) => a + qisOf(d), 0),
        name: n, region: regionOf[n] || '—', lead: leadOf[n], color: colorOf[n],
        visits: vs.length, fieldDays, missed, perDay: fieldDays ? vs.length / fieldDays : 0,
        byType: Object.fromEntries(Object.keys(VISIT_TYPES).map(k => [k, vs.filter(v => v.visit_type === k).length])),
        leads: mine.filter(d => d.record_type === 'lead').length, deals: mine.filter(d => d.record_type !== 'lead').length,
        qisAdded: mine.reduce((a, d) => a + qisOf(d), 0), hoQis: ho.reduce((a, d) => a + qisOf(d), 0), hoSites: ho.length,
        last: vs.map(v => v.visit_date).sort().pop(),
      }
    })
    const order = r => { const i = REGIONS.indexOf(r.region); return i < 0 ? 9 : i }
    rows.sort((a, b) => order(a) - order(b) || (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || b.visits - a.visits || a.name.localeCompare(b.name))
    const sum = k => rows.reduce((a, r) => a + (typeof k === 'function' ? k(r) : r[k]), 0)
    const prevVisits = prev ? prev.filter(v => names.includes(v.member)) : null
    const prevMade = deals.filter(d => !isBulkImport(d) && inRange(d.created_at, prevFrom, prevTo) && names.includes(d.owner))
    return {
      rows, wd: wd.filter(d => d <= today), wdAll: wd.length,
      tot: { ahead: sum('ahead'), dropped: sum('dropped'), open: sum('open'), stale: sum('stale'), leadQis: sum('leadQis'), visits: sum('visits'), newSite: sum(r => r.byType.new_site), leads: sum('leads'), deals: sum('deals'), qis: sum('qisAdded'), ho: sum('hoQis'), missedPeople: rows.filter(r => r.missed.length).length, missedDays: sum(r => r.missed.length) },
      prev: prevVisits && { visits: prevVisits.length, newSite: prevVisits.filter(v => v.visit_type === 'new_site').length, leads: prevMade.filter(d => d.record_type === 'lead').length, qis: prevMade.reduce((a, d) => a + qisOf(d), 0) },
    }
  }, [from, to, visits, deals, team, people, colorOf, prev, prevFrom, prevTo, moves, stages])

  const delta = (now, before) => {
    if (before === undefined || before === null) return null
    const d = now - before
    return <span className={`ml-1 text-xs font-semibold ${d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-slate-400'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '='} {fmtNum(Math.abs(d))}</span>
  }
  const T = m.tot, P = m.prev
  const Card = ({ l, v, p, sub, cls = 'text-navy-900' }) => (
    <div className="card p-4"><p className="text-xs font-semibold text-slate-500">{l}</p>
      <p className={`text-2xl font-extrabold ${cls}`}>{fmtNum(v)}{P && p !== undefined && delta(v, p)}</p>
      <p className="text-xs text-slate-500">{sub}</p></div>
  )

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card l={`Visits ${label}`} v={T.visits} p={P?.visits} sub={`${T.newSite} new-site visits · ${m.wd.length}/${m.wdAll} working days`} />
        <Card l="Leads added" v={T.leads} p={P?.leads} sub={`${fmtNum(T.leadQis)} QIS · + ${T.deals} deals created`} cls="text-violet-700" />
        <Card l="Leads moved ahead" v={T.ahead} sub={`${T.dropped} dropped in this period`} cls="text-sky-700" />
        <Card l="Open leads now" v={T.open} sub={<span className={T.stale ? 'font-semibold text-red-600' : ''}>{T.stale} stuck 30+ days in a stage</span>} />
        <Card l="Handed over" v={T.ho} sub="QIS with HO date in this period" cls="text-teal-700" />
        <div className={`card p-4 ${T.missedPeople ? 'bg-red-50' : ''}`}><p className="text-xs font-semibold text-red-700">Missed field days</p>
          <p className="text-2xl font-extrabold text-red-700">{T.missedDays}</p><p className="text-xs text-red-600">{T.missedPeople} people with a working day without a visit</p></div>
      </div>
      {P && <p className="-mt-2 mb-3 text-xs text-slate-500">▲▼ compared with the {len} days before ({fmtDay(prevFrom)} – {fmtDay(prevTo)}).</p>}

      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="th" rowSpan={2}>Person</th>
              <th className="th border-l border-slate-200 text-center" colSpan={3}>Field</th>
              <th className="th border-l border-slate-200 bg-violet-50 text-center text-violet-700" colSpan={6}>Leads</th>
              <th className="th border-l border-slate-200 text-right" rowSpan={2}>Handed over</th>
              <th className="th border-l border-slate-200" rowSpan={2}>Missed days</th><th className="th" rowSpan={2}>Last visit</th>
            </tr>
            <tr>
              <th className="th border-l border-slate-200">Field days</th><th className="th text-right">Visits</th><th className="th text-right">New site</th>
              <th className="th border-l border-slate-200 bg-violet-50 text-right">Added</th><th className="th bg-violet-50 text-right">QIS</th><th className="th bg-violet-50 text-right">Moved ahead</th>
              <th className="th bg-violet-50 text-right">Dropped</th><th className="th bg-violet-50 text-right">Open now</th><th className="th bg-violet-50 text-right">Stuck 30d+</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {m.rows.map((r, i) => {
              const pct = m.wd.length ? r.fieldDays / m.wd.length : 1
              const newZone = i === 0 || m.rows[i - 1].region !== r.region
              return [
                newZone && <tr key={r.region + 'h'} className="bg-slate-50/60"><td colSpan={13} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{r.region}</td></tr>,
                <tr key={r.name} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap font-semibold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}{r.lead && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700">head</span>}</td>
                  <td className="td whitespace-nowrap">
                    <div className="flex items-center gap-2"><div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${pct >= 0.8 ? 'bg-emerald-500' : pct >= 0.5 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${pct * 100}%` }} /></div>
                      <span className="text-xs font-semibold text-slate-600">{r.fieldDays}/{m.wd.length}</span></div>
                  </td>
                  <td className="td text-right font-bold" title={Object.entries(r.byType).filter(([, c]) => c).map(([k, c]) => `${VISIT_TYPES[k].label}: ${c}`).join('\n')}>{r.visits || <span className="text-red-500">0</span>}</td>
                  <td className="td text-right text-emerald-700">{r.byType.new_site || <span className="text-slate-300">—</span>}</td>
                  <td className={`td border-l border-slate-100 text-right font-bold ${r.leads ? 'text-violet-700' : 'text-slate-300'}`}>{r.leads || '—'}</td>
                  <td className="td text-right text-violet-600">{r.leadQis ? fmtNum(r.leadQis) : <span className="text-slate-300">—</span>}</td>
                  <td className={`td text-right ${r.ahead ? 'font-semibold text-sky-700' : 'text-slate-300'}`}>{r.ahead || '—'}</td>
                  <td className={`td text-right ${r.dropped ? 'text-slate-600' : 'text-slate-300'}`}>{r.dropped || '—'}</td>
                  <td className="td text-right">{r.open ? <>{r.open} <span className="text-[11px] text-slate-400">({fmtNum(r.openQis)})</span></> : <span className="text-slate-300">—</span>}</td>
                  <td className={`td text-right ${r.stale ? 'font-bold text-red-600' : 'text-slate-300'}`}>{r.stale || '—'}</td>
                  <td className="td border-l border-slate-100 text-right text-teal-700">{r.hoQis ? <>{fmtNum(r.hoQis)} <span className="text-[11px] text-slate-400">({r.hoSites})</span></> : <span className="text-slate-300">—</span>}</td>
                  <td className="td">
                    {r.missed.length ? (
                      <span className="flex items-center gap-1.5 whitespace-nowrap" title={`No visit on: ${r.missed.map(d => fmtDay(d)).join(', ')}`}>
                        <b className="text-red-600">{r.missed.length}</b>
                        <button onClick={() => onOpenDay(r.missed[r.missed.length - 1], r.name)} className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-100">last {fmtDay(r.missed[r.missed.length - 1]).replace(/^\w+, /, '')}</button>
                      </span>
                    ) : <span className="text-xs font-semibold text-emerald-600">✓ none</span>}
                  </td>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{r.last ? fmtDay(r.last) : <span className="text-red-500">no visit</span>}</td>
                </tr>,
              ]
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
            <tr>
              <td className="td">Team</td><td className="td" /><td className="td text-right">{T.visits}</td><td className="td text-right text-emerald-700">{T.newSite}</td>
              <td className="td text-right text-violet-700">{T.leads}</td><td className="td text-right text-violet-600">{fmtNum(T.leadQis)}</td><td className="td text-right text-sky-700">{T.ahead}</td>
              <td className="td text-right">{T.dropped}</td><td className="td text-right">{T.open}</td><td className="td text-right text-red-600">{T.stale}</td><td className="td text-right text-teal-700">{fmtNum(T.ho)}</td>
              <td className="td text-red-600">{T.missedDays} days</td><td className="td" />
            </tr>
          </tfoot>
        </table>
        <p className="p-3 text-xs text-slate-500">Working days are Mon–Sat up to today. Field days = working days with at least one visit logged. Leads are counted by site owner (bulk imports left out). Moved ahead = a lead or deal moved to a later stage in this period; Stuck 30d+ = open leads 30+ days in the same stage. Hover visits for the split by type. Hover missed days for the dates; click to open the latest one.</p>
      </div>
    </div>
  )
}
