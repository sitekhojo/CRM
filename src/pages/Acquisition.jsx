import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Upload, Download, Map as MapIcon, ChevronDown, ChevronRight, Trash2, Crosshair } from 'lucide-react'
import { useDeals } from '../lib/deals'
import { useAuth } from '../lib/auth'
import { supabase, errMsg } from '../lib/supabase'
import { readSheet, normaliseRow, toNum, downloadTemplate, exportRows } from '../lib/excel'
import { useTargets, matchAll, locationStatus, STATUS, PRIORITIES, PRIORITY_KEYS, monthLabel, parseMonth, normPriority, TARGET_FIELDS, DEFAULT_RADIUS_M } from '../lib/acquisition'
import { validLatLng } from '../lib/geo'
import { fmtNum } from '../lib/format'
import { Modal, PageLoader, Empty, StageBadge, useToast } from '../components/ui'
import MultiSelect, { SingleSelect } from '../components/MultiSelect'
import Forecast from '../components/Forecast'

export const PriorityChip = ({ p, className = '' }) => (
  <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${PRIORITIES[p]?.cls || 'bg-slate-200'} ${className}`}>{p}</span>
)
const StatusChip = ({ s }) => <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s].cls}`}>{STATUS[s].label}</span>

const ALIASES = [...TARGET_FIELDS, ['name', 'Name'], ['name', 'Location'], ['name', 'Micro market'], ['latitude', 'Lat'], ['longitude', 'Long'], ['longitude', 'Lng'],
  ['priority', 'Priority zone'], ['priority', 'P0/P1'], ['target_month', 'Month'], ['target_month', 'Acquisition month'], ['target_month', 'Target month'], ['radius_m', 'Radius']]

export default function Acquisition() {
  const { deals, loading } = useDeals()
  const { targets, loading: tl, reload } = useTargets()
  const { isAdmin } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [f, setF] = useState({ q: '', priority: [], city: [], month: '', status: [] })
  const [open, setOpen] = useState({})
  const [upOpen, setUpOpen] = useState(false)
  const [tab, setTab] = useState('forecast')

  const m = useMemo(() => {
    if (!deals) return null
    const { bySite, byTarget } = matchAll(deals, targets)
    const rows = targets.map(t => {
      const sites = (byTarget[t.id] || []).sort((a, b) => (b.stage_order || 0) - (a.stage_order || 0))
      const live = sites.filter(s => s.stage_category !== 'dropped')
      return { ...t, sites, status: locationStatus(sites), qis: live.reduce((a, s) => a + (Number(s.extra?.qis_count) || 0), 0), leads: live.filter(s => s.record_type === 'lead').length, dealsN: live.filter(s => s.record_type !== 'lead').length }
    })
    const now = new Date().toISOString().slice(0, 7)
    const filtered = rows.filter(r =>
      (!f.priority.length || f.priority.includes(r.priority)) && (!f.city.length || f.city.includes(r.city || '')) &&
      (!f.month || String(r.target_month || '').slice(0, 7) === f.month) && (!f.status.length || f.status.includes(r.status)) &&
      (!f.q || [r.name, r.city, r.notes].some(v => v && String(v).toLowerCase().includes(f.q.toLowerCase()))))
    const summary = PRIORITY_KEYS.map(p => {
      const xs = filtered.filter(r => r.priority === p)
      return { p, total: xs.length, started: xs.filter(r => STATUS[r.status].rank >= 2).length, acquired: xs.filter(r => STATUS[r.status].rank >= 3).length, energized: xs.filter(r => r.status === 'energized').length, qis: xs.reduce((a, r) => a + r.qis, 0) }
    }).filter(x => x.total)
    return {
      rows: filtered, all: rows, summary, now,
      unmatched: deals.filter(d => d.latitude !== null && !bySite[d.id] && d.stage_category !== 'dropped').length,
      cities: [...new Set(rows.map(r => r.city).filter(Boolean))].sort(),
      months: [...new Set(rows.map(r => String(r.target_month || '').slice(0, 7)).filter(Boolean))].sort(),
    }
  }, [deals, targets, f])

  if (loading || tl || !m) return <PageLoader />

  const remove = async t => {
    if (!confirm(`Remove ${t.priority} location "${t.name}"? Sites are not affected.`)) return
    const { error } = await supabase.from('target_locations').delete().eq('id', t.id)
    if (error) return toast(errMsg(error), 'error')
    toast('Location removed'); reload()
  }
  const exportXlsx = () => exportRows(m.rows.map(r => ({ ...r, target_month: monthLabel(r.target_month), status: STATUS[r.status].label, sites_n: r.sites.length, site_list: r.sites.map(s => `${s.site_code} ${s.name} (${s.stage_name})`).join('; ') })),
    [...TARGET_FIELDS, ['status', 'Status'], ['leads', 'Leads'], ['dealsN', 'Deals'], ['qis', 'QIS (excl. dropped)'], ['site_list', 'Sites']], 'sitekhojo-acquisition-desk')

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-navy-900">Acquisition Desk</h1>
          <p className="text-sm text-slate-500">{tab !== 'locations' ? 'Handover and energisation outlook · this month to the end of the FY' : `${m.rows.length} of ${m.all.length} priority locations · a lead/deal counts against a location when it lies within its radius`}</p>
        </div>
        <div className="flex-1" />
        {tab === 'locations' && <>
          <button className="btn-secondary" onClick={() => nav('/app/map?targets=1')}><MapIcon className="h-4 w-4" />View on map</button>
          {m.all.length > 0 && <button className="btn-secondary" onClick={exportXlsx}><Download className="h-4 w-4" />Excel</button>}
          {isAdmin && <button className="btn-primary" onClick={() => setUpOpen(true)}><Upload className="h-4 w-4" />Upload locations</button>}
        </>}
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {[['forecast', 'Forecast'], ['list', 'Pipeline list'], ['locations', `Priority locations${m.all.length ? ` (${m.all.length})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>

      {tab === 'forecast' ? <Forecast /> : tab === 'list' ? <Forecast view="list" /> : m.all.length === 0 ? (
        <div className="card"><Empty icon={Crosshair} title="No priority locations yet">
          Upload your P0–P4 list (name, lat/long, priority, month of acquisition). Every lead and deal is then tagged to the location it falls in.
          {isAdmin && <div className="mt-3 flex justify-center gap-2"><button className="btn-primary" onClick={() => setUpOpen(true)}><Upload className="h-4 w-4" />Upload locations</button>
            <button className="btn-secondary" onClick={() => downloadTemplate(TARGET_FIELDS, 'sitekhojo-priority-locations-template')}><Download className="h-4 w-4" />Template</button></div>}
        </Empty></div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {m.summary.map(s => (
              <button key={s.p} onClick={() => setF(x => ({ ...x, priority: x.priority.length === 1 && x.priority[0] === s.p ? [] : [s.p] }))}
                className={`card p-4 text-left transition hover:shadow-md ${f.priority.length === 1 && f.priority[0] === s.p ? 'ring-2 ring-brand-500' : ''}`}>
                <div className="flex items-center justify-between"><PriorityChip p={s.p} /><span className="text-xs text-slate-400">{s.total} {s.total === 1 ? 'location' : 'locations'}</span></div>
                <p className="mt-2 text-2xl font-extrabold text-navy-900">{s.acquired}<span className="text-base font-semibold text-slate-400"> / {s.total}</span></p>
                <p className="text-xs text-slate-500">acquired (deal or beyond)</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(100 * s.acquired) / s.total}%` }} /></div>
                <p className="mt-2 text-xs text-slate-500">{s.started} with activity · {s.energized} energized · {fmtNum(s.qis)} QIS</p>
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-end gap-2">
            <input className="input w-full sm:w-56" placeholder="Search locations…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
            <MultiSelect allLabel="All priorities" noun="priorities" value={f.priority} onChange={v => setF({ ...f, priority: v })} options={PRIORITY_KEYS.map(p => ({ value: p, label: p, color: PRIORITIES[p].color }))} />
            <MultiSelect allLabel="All cities" noun="cities" value={f.city} onChange={v => setF({ ...f, city: v })} options={m.cities.map(c => ({ value: c, label: c }))} />
            <SingleSelect value={f.month} onChange={v => setF({ ...f, month: v })}
              options={[{ value: '', label: 'All months' }, ...m.months.map(x => ({ value: x, label: monthLabel(x + '-01') }))]} />
            <MultiSelect allLabel="All statuses" noun="statuses" value={f.status} onChange={v => setF({ ...f, status: v })} options={Object.entries(STATUS).sort((a, b) => b[1].rank - a[1].rank).map(([k, s]) => ({ value: k, label: s.label }))} />
            <span className="ml-auto text-xs text-slate-500">{m.unmatched} open sites with a location are outside every priority location</span>
          </div>

          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50"><tr>
                <th className="th w-8" /><th className="th">Priority</th><th className="th">Location</th><th className="th">City</th><th className="th">Month of acquisition</th>
                <th className="th">Status</th><th className="th text-right">Leads</th><th className="th text-right">Deals</th><th className="th text-right">QIS</th><th className="th text-right">Target QIS</th><th className="th text-right">Radius</th>{isAdmin && <th className="th" />}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {m.rows.map(r => {
                  const late = r.target_month && String(r.target_month).slice(0, 7) < m.now && STATUS[r.status].rank < 3
                  const exp = open[r.id]
                  return [
                    <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))}>
                      <td className="td text-slate-400">{r.sites.length ? (exp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}</td>
                      <td className="td"><PriorityChip p={r.priority} /></td>
                      <td className="td font-semibold text-slate-900">{r.name}{r.notes && <div className="text-xs font-normal text-slate-500">{r.notes}</div>}</td>
                      <td className="td">{r.city || '—'}</td>
                      <td className={`td whitespace-nowrap ${late ? 'font-semibold text-red-600' : ''}`} title={late ? 'Month has passed and no deal yet' : ''}>{monthLabel(r.target_month)}</td>
                      <td className="td"><StatusChip s={r.status} /></td>
                      <td className="td text-right">{r.leads || '—'}</td>
                      <td className="td text-right">{r.dealsN || '—'}</td>
                      <td className="td text-right font-semibold">{r.qis || '—'}</td>
                      <td className="td text-right text-slate-500">{r.target_qis ?? '—'}</td>
                      <td className="td text-right text-slate-500">{fmtNum(r.radius_m)} m</td>
                      {isAdmin && <td className="td text-right" onClick={e => e.stopPropagation()}><button className="btn-ghost p-1 text-slate-400 hover:text-red-600" title="Remove location" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button></td>}
                    </tr>,
                    exp && r.sites.length > 0 && (
                      <tr key={r.id + 's'} className="bg-slate-50/60"><td /><td colSpan={isAdmin ? 11 : 10} className="px-3 pb-3">
                        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                          {r.sites.map(s => (
                            <li key={s.id}><Link to={`/app/deals/${s.id}`} className="flex flex-wrap items-center gap-3 px-3 py-2 hover:bg-slate-50">
                              <span className="font-mono text-xs text-slate-400">{s.site_code}</span>
                              <span className="font-semibold text-slate-900">{s.name}</span>
                              <span className="text-xs text-slate-500">{s.record_type === 'lead' ? 'Lead' : 'Deal'}</span>
                              <StageBadge name={s.stage_name} color={s.stage_color} />
                              <span className="text-xs text-slate-500">{s.extra?.qis_count ? `${s.extra.qis_count} QIS · ` : ''}{fmtNum(s.distance_m)} m from centre · {s.owner || 'Unassigned'}</span>
                            </Link></li>
                          ))}
                        </ul>
                      </td></tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
            {m.rows.length === 0 && <Empty title="No locations match these filters" />}
          </div>
          <p className="mt-2 text-xs text-slate-500">Status = furthest any lead/deal inside the location has got: Not started → Lead → Deal → Handed over → Energized (dropped sites don't count). A month in <span className="font-semibold text-red-600">red</span> has passed without a deal.</p>
        </>
      )}
      <UploadModal open={upOpen} onClose={() => setUpOpen(false)} onDone={() => { setUpOpen(false); reload() }} existing={m.all.length} />
    </div>
  )
}

function UploadModal({ open, onClose, onDone, existing }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [mode, setMode] = useState('add')
  const [busy, setBusy] = useState(false)

  const parse = async file => {
    const raw = await readSheet(file)
    setRows(raw.map((x, i) => {
      const o = normaliseRow(x, ALIASES)
      const lat = toNum(o.latitude), lng = toNum(o.longitude), pr = normPriority(o.priority), mo = parseMonth(o.target_month)
      const errors = []
      if (!o.name) errors.push('name missing')
      if (!validLatLng(lat, lng)) errors.push('bad lat/long')
      if (!pr) errors.push('priority must be P0–P4')
      if (o.target_month && !mo) errors.push(`can't read month "${o.target_month}"`)
      return { line: i + 2, errors, payload: { name: String(o.name || ''), city: o.city || null, latitude: lat, longitude: lng, priority: pr, target_month: mo, radius_m: toNum(o.radius_m) || DEFAULT_RADIUS_M, target_qis: toNum(o.target_qis), notes: o.notes || null } }
    }))
  }
  const good = (rows || []).filter(r => !r.errors.length)
  const save = async () => {
    setBusy(true)
    try {
      if (mode === 'replace') { const { error } = await supabase.from('target_locations').delete().gt('id', 0); if (error) throw error }
      for (let i = 0; i < good.length; i += 500) {
        const { error } = await supabase.from('target_locations').insert(good.slice(i, i + 500).map(r => r.payload))
        if (error) throw error
      }
      toast(`${good.length} priority locations ${mode === 'replace' ? 'loaded (replaced old list)' : 'added'}`); setRows(null); onDone()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={() => { setRows(null); onClose() }} title="Upload priority locations" wide
      footer={<><button className="btn-ghost" onClick={() => { setRows(null); onClose() }}>Cancel</button><button className="btn-primary" disabled={!good.length || busy} onClick={save}>{busy ? 'Saving…' : `Save ${good.length} locations`}</button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Columns: <b>Location name, Latitude, Longitude, Priority</b> (P0–P4), <b>Month of acquisition</b> (e.g. Nov-26, Nov 2026, 2026-11). Optional: City, Radius (m) — default {fmtNum(DEFAULT_RADIUS_M)} m, Target QIS, Notes.
          <button className="ml-1 font-semibold text-brand-700 hover:underline" onClick={() => downloadTemplate(TARGET_FIELDS, 'sitekhojo-priority-locations-template')}>Download template</button></p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-slate-500 hover:border-brand-500">
          <Upload className="h-6 w-6" /><span>Choose .xlsx or .csv</span>
          <input type="file" accept=".xlsx,.csv" className="hidden" onChange={e => e.target.files[0] && parse(e.target.files[0])} />
        </label>
        {rows && (
          <>
            <p><b className="text-emerald-700">{good.length} ready</b>{rows.length - good.length > 0 && <> · <b className="text-red-600">{rows.length - good.length} with errors</b> (skipped)</>}</p>
            {rows.some(r => r.errors.length) && (
              <ul className="max-h-32 overflow-auto rounded-lg bg-red-50 p-2 text-xs text-red-700">
                {rows.filter(r => r.errors.length).map(r => <li key={r.line}>Row {r.line}: {r.errors.join(', ')}</li>)}
              </ul>
            )}
            {existing > 0 && (
              <div className="flex gap-4">
                <label className="flex items-center gap-2"><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} />Add to the existing {existing}</label>
                <label className="flex items-center gap-2"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />Replace the existing list</label>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
