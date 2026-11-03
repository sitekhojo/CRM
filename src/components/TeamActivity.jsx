import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Marker, Polyline, Popup, Circle } from 'react-leaflet'
import L from 'leaflet'
import { ChevronLeft, ChevronRight, Download, MapPin, Pencil, Trash2, Footprints } from 'lucide-react'
import { useDeals } from '../lib/deals'
import { useConfig } from '../lib/config'
import { useAuth } from '../lib/auth'
import { supabase, errMsg } from '../lib/supabase'
import { useTargets, matchPoint } from '../lib/acquisition'
import { haversine } from '../lib/geo'
import { exportWorkbook } from '../lib/excel'
import { VISIT_TYPES, VISIT_TYPE_KEYS, PERSON_COLORS, istDay, addDays, fmtTime, fmtDay, fetchVisits } from '../lib/visits'
import { BaseMap, FitBounds } from './maps'
import MultiSelect from './MultiSelect'
import { Modal, PageLoader, Empty, Field, useToast } from './ui'
import { PriorityChip } from '../pages/Acquisition'

const numIcon = (n, color) => L.divIcon({
  className: '',
  html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid #fff;color:#fff;font:700 11px/20px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)">${n}</div>`,
  iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
})
const TypeChip = ({ t }) => <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${VISIT_TYPES[t]?.cls}`}>{VISIT_TYPES[t]?.short}</span>
const km = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)

export default function TeamActivity() {
  const { deals, loading } = useDeals()
  const { team = [] } = useConfig()
  const { targets } = useTargets()
  const { isAdmin } = useAuth()
  const toast = useToast()
  const today = istDay()
  const [day, setDay] = useState(today)
  const [mode, setMode] = useState('day')
  const [people, setPeople] = useState([])
  const [visits, setVisits] = useState(null)
  const [edit, setEdit] = useState(null)
  const [missingOpen, setMissingOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState({})

  const from = mode === 'week' ? addDays(day, -6) : day
  const load = useCallback(() => { setVisits(null); fetchVisits(from, day).then(setVisits).catch(e => { toast(errMsg(e), 'error'); setVisits([]) }) }, [from, day]) // eslint-disable-line
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!missingOpen) return
    fetchVisits(addDays(day, -60), day).then(vs => {
      const o = {}; vs.forEach(v => { if (!o[v.member] || v.visit_date > o[v.member]) o[v.member] = v.visit_date }); setLastSeen(o)
    }).catch(() => {})
  }, [missingOpen, day])

  const m = useMemo(() => {
    if (!deals || !visits) return null
    const byId = Object.fromEntries(deals.map(d => [d.id, d]))
    const active = team.filter(t => t.is_active)
    const names = [...new Set([...active.map(t => t.name), ...visits.map(v => v.member)])]
    const colorOf = Object.fromEntries(names.map((n, i) => [n, PERSON_COLORS[i % PERSON_COLORS.length]]))
    const regionOf = Object.fromEntries(team.map(t => [t.name, t.region]))
    const shown = people.length ? names.filter(n => people.includes(n)) : names
    const vs = visits.filter(v => shown.includes(v.member)).map(v => ({ ...v, site: v.site_id ? byId[v.site_id] : null }))
    const inDay = vs.filter(v => v.visit_date === day)
    const leadsBy = n => deals.filter(d => d.owner === n && d.record_type === 'lead' && istDay(d.created_at) === day)
    const cards = shown.map(n => {
      const xs = inDay.filter(v => v.member === n)
      let dist = 0
      for (let i = 1; i < xs.length; i++) dist += haversine(xs[i - 1].latitude, xs[i - 1].longitude, xs[i].latitude, xs[i].longitude)
      const cityCounts = {}; xs.forEach(v => { const c = v.site?.city; if (c) cityCounts[c] = (cityCounts[c] || 0) + 1 })
      return {
        name: n, color: colorOf[n], region: regionOf[n], visits: xs, n: xs.length, dist,
        city: Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0],
        newLeads: leadsBy(n).length,
        byType: Object.fromEntries(VISIT_TYPE_KEYS.map(k => [k, xs.filter(v => v.visit_type === k).length])),
      }
    }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    const days = []; for (let d = from; d <= day; d = addDays(d, 1)) days.push(d)
    const grid = shown.map(n => ({ name: n, color: colorOf[n], counts: days.map(d => vs.filter(v => v.member === n && v.visit_date === d).length) }))
      .sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0))
    const targetHits = targets.map(t => ({ ...t, hit: inDay.some(v => matchPoint(v.latitude, v.longitude, [t])) }))
    return { cards, inDay, all: vs, colorOf, days, grid, targetHits, missing: cards.filter(c => !c.n), names }
  }, [deals, visits, team, people, day, from, targets])

  if (loading || !m) return <PageLoader />

  const working = m.cards.filter(c => c.n)
  const focus = people.length === 1 ? m.cards[0] : null
  const points = m.inDay.map(v => [v.latitude, v.longitude])

  const remove = async v => {
    if (!confirm(`Delete ${v.member}'s visit at ${fmtTime(v.visited_at)}? A lead created by it stays.`)) return
    const { error } = await supabase.from('site_visits').delete().eq('id', v.id)
    if (error) return toast(errMsg(error), 'error')
    toast('Visit deleted'); load()
  }
  const exportXlsx = () => exportWorkbook([{
    name: 'Visits',
    columns: [['visit_date', 'Date'], ['time', 'Time'], ['member', 'Person'], ['type', 'Visit type'], ['site_code', 'Lead / deal'], ['site_name', 'Site name'], ['stage', 'Stage'], ['lead_created', 'Lead created by visit'], ['no_lead_reason', 'No lead reason'], ['remarks', 'Remarks'], ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['accuracy_m', 'GPS accuracy (m)']],
    rows: m.all.map(v => ({ ...v, time: fmtTime(v.visited_at), type: VISIT_TYPES[v.visit_type]?.label, site_code: v.site?.site_code || '', site_name: v.site?.name || '', stage: v.site?.stage_name || '', lead_created: v.lead_created ? 'Yes' : '' })),
  }, {
    name: 'Summary',
    columns: [['name', 'Person'], ...m.days.map((d, i) => [`d${i}`, d]), ['total', 'Total']],
    rows: m.grid.map(g => ({ name: g.name, ...Object.fromEntries(g.counts.map((c, i) => [`d${i}`, c])), total: g.counts.reduce((a, b) => a + b, 0) })),
  }], `sitekhojo-field-visits-${from}${from !== day ? `-to-${day}` : ''}`)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-slate-300 bg-white">
          <button className="px-2 py-1.5 text-slate-500 hover:text-slate-900" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" className="border-0 bg-transparent px-1 py-1 text-sm font-semibold focus:ring-0" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} />
          <button className="px-2 py-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {day !== today && <button className="btn-ghost text-sm" onClick={() => setDay(today)}>Today</button>}
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold">
          {[['day', 'Day'], ['week', 'Last 7 days']].map(([k, l]) => <button key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 ${mode === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600'}`}>{l}</button>)}
        </div>
        <MultiSelect allLabel="All people" noun="people" value={people} onChange={setPeople} options={m.names.map(n => ({ value: n, label: n, color: m.colorOf[n] }))} />
        <div className="flex-1" />
        <Link to="/app/visit" className="btn-secondary"><MapPin className="h-4 w-4" />Log visit</Link>
        {isAdmin && <button className="btn-secondary" onClick={exportXlsx}><Download className="h-4 w-4" />Excel</button>}
      </div>

      {mode === 'week' ? (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Person</th>{m.days.map(d => <th key={d} className="th text-center">{fmtDay(d)}</th>)}<th className="th text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {m.grid.map(g => (
                <tr key={g.name}>
                  <td className="td font-semibold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />{g.name}</td>
                  {g.counts.map((c, i) => (
                    <td key={i} className="td text-center">
                      <button onClick={() => { setDay(m.days[i]); setPeople([g.name]); setMode('day') }} title="Open this day"
                        className={`min-w-[2.25rem] rounded px-2 py-1 font-bold ${!c ? 'bg-red-50 text-red-400' : c < 3 ? 'bg-amber-100 text-amber-800' : c < 6 ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-600 text-white'}`}>{c}</button>
                    </td>
                  ))}
                  <td className="td text-right font-bold">{g.counts.reduce((a, b) => a + b, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-xs text-slate-500">Visits per day. Click a cell to open that person's day on the map. <span className="rounded bg-red-50 px-1 text-red-500">0</span> no visits · <span className="rounded bg-amber-100 px-1 text-amber-800">1–2</span> · <span className="rounded bg-emerald-100 px-1 text-emerald-800">3–5</span> · <span className="rounded bg-emerald-600 px-1 text-white">6+</span></p>
        </div>
      ) : <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Visits {day === today ? 'today' : fmtDay(day)}</p><p className="text-2xl font-extrabold text-navy-900">{m.inDay.length}</p>
            <p className="text-xs text-slate-500">{working.length} of {m.cards.length} people in the field</p></div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">New sites scouted</p><p className="text-2xl font-extrabold text-emerald-700">{m.inDay.filter(v => v.visit_type === 'new_site').length}</p>
            <p className="text-xs text-slate-500">{m.cards.reduce((a, c) => a + c.newLeads, 0)} new leads added</p></div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Follow-ups</p><p className="text-2xl font-extrabold text-sky-700">{m.inDay.filter(v => v.visit_type === 'follow_up').length}</p></div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Franchisee / Discom</p><p className="text-2xl font-extrabold text-violet-700">{m.inDay.filter(v => v.visit_type === 'franchisee_meeting').length} <span className="text-slate-300">/</span> <span className="text-amber-700">{m.inDay.filter(v => v.visit_type === 'discom').length}</span></p></div>
          <button disabled={!m.missing.length} onClick={() => setMissingOpen(true)} className={`card p-4 text-left ${m.missing.length ? 'bg-red-50 transition hover:shadow-md' : ''}`} title={m.missing.length ? 'See who has not logged a visit' : ''}>
            <p className="text-xs font-semibold text-red-700">No visits logged</p><p className="text-2xl font-extrabold text-red-700">{m.missing.length}</p>
            <p className="truncate text-xs text-red-600">{m.missing.length ? 'Click to see names' : 'Everyone checked in'}</p></button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {working.map(c => (
            <button key={c.name} onClick={() => setPeople(p => (p.length === 1 && p[0] === c.name ? [] : [c.name]))}
              className={`card border-t-4 p-3 text-left transition hover:shadow-md ${focus?.name === c.name ? 'ring-2 ring-brand-500' : ''}`} style={{ borderTopColor: c.color }}>
              <div className="flex items-baseline justify-between"><span className="font-bold text-slate-900">{c.name}</span><span className="text-xs text-slate-400">{[c.region, c.city].filter(Boolean).join(' · ')}</span></div>
              <p className="mt-1 text-2xl font-extrabold text-navy-900">{c.n} <span className="text-sm font-semibold text-slate-400">visits</span></p>
              <div className="mt-1 flex flex-wrap gap-1">{VISIT_TYPE_KEYS.filter(k => c.byType[k]).map(k => <span key={k} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${VISIT_TYPES[k].cls}`}>{c.byType[k]} {VISIT_TYPES[k].short}</span>)}</div>
              <p className="mt-1.5 text-xs text-slate-500">{c.newLeads} new lead{c.newLeads === 1 ? '' : 's'} · {fmtTime(c.visits[0].visited_at)}–{fmtTime(c.visits[c.n - 1].visited_at)}{c.n > 1 ? ` · ${km(c.dist)} covered` : ''}</p>
            </button>
          ))}
        </div>

        {m.inDay.length === 0 ? (
          <div className="card"><Empty icon={Footprints} title={`No visits logged ${day === today ? 'yet today' : 'on this day'}`}>The team logs visits from the Log visit page on their phones. Each visit shows up here with its route.</Empty></div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-5">
            <div className="card h-[460px] overflow-hidden xl:col-span-3">
              <BaseMap>
                <FitBounds points={points} fitKey={`${day}|${people.join(',')}|${points.length}`} />
                {m.targetHits.map(t => (
                  <Circle key={t.id} center={[t.latitude, t.longitude]} radius={t.radius_m}
                    pathOptions={{ color: t.hit ? '#059669' : '#dc2626', weight: 1.5, dashArray: '5 4', fillOpacity: 0.06 }}>
                    <Popup><div className="text-sm"><PriorityChip p={t.priority} /> <b>{t.name}</b><div className="text-xs">{t.hit ? 'Visited on this day' : 'Not visited on this day'}</div></div></Popup>
                  </Circle>
                ))}
                {m.cards.filter(c => c.n).map(c => [
                  c.n > 1 && <Polyline key={c.name + 'l'} positions={c.visits.map(v => [v.latitude, v.longitude])} pathOptions={{ color: c.color, weight: 3, opacity: 0.8 }} />,
                  ...c.visits.map((v, i) => (
                    <Marker key={v.id} position={[v.latitude, v.longitude]} icon={numIcon(i + 1, c.color)}>
                      <Popup><VisitLine v={v} n={i + 1} /></Popup>
                    </Marker>
                  )),
                ])}
              </BaseMap>
            </div>
            <div className="card max-h-[460px] overflow-auto xl:col-span-2">
              {m.cards.filter(c => c.n).map(c => (
                <div key={c.name}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2 text-sm font-bold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.name}'s day<span className="ml-auto text-xs font-normal text-slate-400">{c.n} visits</span></div>
                  <ul className="divide-y divide-slate-50">
                    {c.visits.map((v, i) => (
                      <li key={v.id} className="group flex gap-2 px-3 py-2 text-sm">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: c.color }}>{i + 1}</span>
                        <div className="min-w-0 flex-1"><VisitLine v={v} /></div>
                        <div className="flex shrink-0 items-start gap-1 opacity-0 group-hover:opacity-100">
                          {(isAdmin || v.visit_date === today) && <button className="text-slate-400 hover:text-slate-700" title="Edit" onClick={() => setEdit(v)}><Pencil className="h-3.5 w-3.5" /></button>}
                          {isAdmin && <button className="text-slate-400 hover:text-red-600" title="Delete" onClick={() => remove(v)}><Trash2 className="h-3.5 w-3.5" /></button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
        {targets.length > 0 && m.inDay.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Priority locations on the map: <span className="font-semibold text-emerald-700">green</span> = visited on this day ({m.targetHits.filter(t => t.hit).length}), <span className="font-semibold text-red-600">red</span> = not visited ({m.targetHits.filter(t => !t.hit).length}).</p>
        )}
      </>}
      <Modal open={missingOpen} onClose={() => setMissingOpen(false)} title={`No visits logged · ${day === today ? 'today' : fmtDay(day)} (${m.missing.length})`}
        footer={<button className="btn-ghost" onClick={() => setMissingOpen(false)}>Close</button>}>
        <div className="space-y-3 text-sm">
          {[...new Set(m.missing.map(c => c.region || 'Other'))].sort().map(r => (
            <div key={r}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">{r}</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {m.missing.filter(c => (c.region || 'Other') === r).map(c => {
                  const ls = lastSeen[c.name]
                  return <li key={c.name} className="flex items-center gap-2 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 font-semibold text-slate-900">{c.name}</span>
                    <span className="text-xs text-slate-500">{ls ? <>Last visit {fmtDay(ls)}{' '}<button className="font-semibold text-brand-700 hover:underline" onClick={() => { setMissingOpen(false); setDay(ls); setPeople([c.name]) }}>Open</button></> : 'No visit in the last 60 days'}</span>
                  </li>
                })}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
      <EditVisit v={edit} deals={deals} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />
    </div>
  )
}

function VisitLine({ v, n }) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {n && <b>#{n}</b>}<span className="text-xs text-slate-400">{fmtTime(v.visited_at)}</span><TypeChip t={v.visit_type} />
        {v.site ? <Link to={`/app/deals/${v.site.id}`} className="font-semibold !text-brand-700 hover:underline">{v.site.site_code}</Link> : v.no_lead_reason ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">No lead · {v.no_lead_reason}</span> : <span className="text-xs text-slate-400">Visit only</span>}
        {v.lead_created && <span className="text-[11px] font-semibold text-emerald-700">new lead</span>}
      </div>
      {v.site && <div className="truncate text-xs text-slate-600">{v.site.name} · {v.site.record_type === 'lead' ? 'Lead' : 'Deal'} · {v.site.stage_name}</div>}
      {v.remarks && <div className="text-xs text-slate-500">{v.remarks}</div>}
      {v.accuracy_m > 100 && <div className="text-[11px] text-amber-600">Weak GPS (±{Math.round(v.accuracy_m)} m)</div>}
    </div>
  )
}

function EditVisit({ v, deals, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { if (v) { setF({ visit_type: v.visit_type, site_id: v.site_id, remarks: v.remarks || '' }); setQ('') } }, [v])
  if (!v || !f) return null
  const site = f.site_id && deals.find(d => d.id === f.site_id)
  const s = q.trim().toLowerCase()
  const matches = s.length < 2 ? [] : deals.filter(d => [d.site_code, d.name].some(x => x && x.toLowerCase().includes(s))).slice(0, 6)
  const save = async () => {
    const { error } = await supabase.from('site_visits').update({ visit_type: f.visit_type, site_id: f.site_id || null, remarks: f.remarks || null }).eq('id', v.id)
    if (error) return toast(errMsg(error), 'error')
    toast('Visit updated'); onSaved()
  }
  return (
    <Modal open onClose={onClose} title={`Edit ${v.member}'s visit · ${fmtTime(v.visited_at)}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <div className="space-y-3 text-sm">
        <Field label="Visit type"><select className="input" value={f.visit_type} onChange={e => setF({ ...f, visit_type: e.target.value })}>{VISIT_TYPE_KEYS.map(k => <option key={k} value={k}>{VISIT_TYPES[k].label}</option>)}</select></Field>
        <Field label="Linked lead / deal">
          {site ? <div className="flex items-center gap-2"><span className="font-mono text-xs">{site.site_code}</span><span className="flex-1">{site.name}</span><button className="text-xs text-red-600" onClick={() => setF({ ...f, site_id: null })}>Remove</button></div>
            : <><input className="input" placeholder="Search name or SK code" value={q} onChange={e => setQ(e.target.value)} />
              {matches.map(d => <button key={d.id} className="block w-full px-1 py-1 text-left hover:bg-slate-50" onClick={() => { setF({ ...f, site_id: d.id }); setQ('') }}>{d.site_code} · {d.name}</button>)}</>}
        </Field>
        <Field label="Remarks"><textarea className="input min-h-[70px]" value={f.remarks} onChange={e => setF({ ...f, remarks: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">Person, time and GPS can't be changed.{' '}The team login can edit only on the same day.</p>
      </div>
    </Modal>
  )
}
