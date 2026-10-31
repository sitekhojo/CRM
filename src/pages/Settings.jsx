import { useEffect, useState } from 'react'
import { Plus, Upload, Trash2, Save, Download } from 'lucide-react'
import { supabase, errMsg, fetchAll } from '../lib/supabase'
import { useConfig, DEFAULT_RULES } from '../lib/config'
import { useToast, Field, StageBadge } from '../components/ui'
import { readSheet, normaliseRow, toNum, downloadTemplate, exportRows } from '../lib/excel'
import { NETWORK_TYPES } from './Planning'
import { SITE_TYPES } from '../lib/format'

const TABS = [['stages', 'Pipeline stages'], ['cities', 'Cities'], ['drops', 'Drop reasons'], ['rules', 'Feasibility rules'], ['network', 'Network data']]

export default function Settings() {
  const [tab, setTab] = useState('stages')
  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-extrabold text-navy-900">Settings</h1>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}
      </div>
      {tab === 'stages' && <Stages />}
      {tab === 'cities' && <SimpleList table="cities" col="name" extra="state" title="Cities" />}
      {tab === 'drops' && <SimpleList table="drop_reasons" col="label" title="Drop reasons" />}
      {tab === 'rules' && <Rules />}
      {tab === 'network' && <Network />}
    </div>
  )
}

function useSave() {
  const toast = useToast(); const { reload } = useConfig()
  return async (promise, msg = 'Saved') => {
    const { error } = await promise
    if (error) { toast(errMsg(error), 'error'); return false }
    toast(msg); reload(); return true
  }
}

function Stages() {
  const { stages = [] } = useConfig()
  const save = useSave()
  const [rows, setRows] = useState(stages)
  const [showRetired, setShowRetired] = useState(false)
  useEffect(() => setRows(stages), [stages])
  const retired = rows.filter(s => !s.is_active).length
  const set = (i, k, v) => setRows(r => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  const persist = async () => {
    for (const s of rows) {
      const { id, ...rest } = s
      const ok = await save(supabase.from('stages').update({ ...rest, site_types: rest.site_types?.length ? rest.site_types : null, sla_days: rest.sla_days === '' || rest.sla_days === null ? null : Number(rest.sla_days), sort_order: Number(rest.sort_order) }).eq('id', id), 'Stages saved')
      if (!ok) return
    }
  }
  const add = () => save(supabase.from('stages').insert({ key: 'stage_' + Date.now(), name: 'New stage', sort_order: Math.max(0, ...stages.map(s => s.sort_order)) + 1, color: '#64748b', sla_days: 7 }), 'Stage added')

  return (
    <div className="card overflow-x-auto p-4">
      <p className="mb-3 text-sm text-slate-500">Order, rename, colour and set SLA days for each stage. <b>Admin only</b> = only admins can move a deal into that stage. <b>Applies to</b> = which site types use this stage (none ticked = all). Deals beyond SLA are flagged on the dashboard. Deactivate instead of deleting stages that have history.</p>
      <table className="min-w-full text-sm">
        <thead><tr><th className="th">Order</th><th className="th">Name</th><th className="th">Colour</th><th className="th">SLA (days)</th><th className="th">Type</th><th className="th">Applies to</th><th className="th">Admin only</th><th className="th">Active</th><th className="th">Preview</th></tr></thead>
        <tbody>
          {rows.map((s, i) => (!s.is_active && !showRetired) ? null : (
            <tr key={s.id} className={`border-t border-slate-100 ${s.is_active ? '' : 'opacity-50'}`}>
              <td className="td"><input className="input w-16 py-1" type="number" value={s.sort_order} onChange={e => set(i, 'sort_order', e.target.value)} /></td>
              <td className="td"><input className="input w-52 py-1" value={s.name} onChange={e => set(i, 'name', e.target.value)} /></td>
              <td className="td"><input type="color" className="h-8 w-12 cursor-pointer rounded border border-slate-300" value={s.color} onChange={e => set(i, 'color', e.target.value)} /></td>
              <td className="td"><input className="input w-20 py-1" type="number" min="1" placeholder="none" value={s.sla_days ?? ''} onChange={e => set(i, 'sla_days', e.target.value)} /></td>
              <td className="td"><select className="input w-auto py-1" value={s.category} onChange={e => set(i, 'category', e.target.value)}>
                <option value="active">Pipeline</option><option value="approved">Post-agreement</option><option value="live">Live</option><option value="hold">Hold</option><option value="dropped">Dropped</option></select></td>
              <td className="td">
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {SITE_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" className="accent-brand-600" checked={!!s.site_types?.includes(t)}
                        onChange={e => set(i, 'site_types', e.target.checked ? [...(s.site_types || []), t] : (s.site_types || []).filter(x => x !== t))} />{t}
                    </label>
                  ))}
                </div>
                {!s.site_types?.length && <span className="text-[11px] text-slate-400">All site types</span>}
              </td>
              <td className="td text-center"><input type="checkbox" className="accent-brand-600" checked={s.admin_only} onChange={e => set(i, 'admin_only', e.target.checked)} /></td>
              <td className="td text-center"><input type="checkbox" className="accent-brand-600" checked={s.is_active} onChange={e => set(i, 'is_active', e.target.checked)} /></td>
              <td className="td"><StageBadge name={s.name} color={s.color} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={persist}><Save className="h-4 w-4" />Save stages</button><button className="btn-secondary" onClick={add}><Plus className="h-4 w-4" />Add stage</button>
        {retired > 0 && <button className="btn-ghost" onClick={() => setShowRetired(v => !v)}>{showRetired ? 'Hide' : 'Show'} {retired} retired stages</button>}</div>
    </div>
  )
}

function SimpleList({ table, col, extra, title }) {
  const cfg = useConfig()
  const items = table === 'cities' ? cfg.cities : cfg.dropReasons
  const save = useSave()
  const [v, setV] = useState(''); const [x, setX] = useState('')
  return (
    <div className="card max-w-2xl p-4">
      <form className="mb-4 flex gap-2" onSubmit={async e => { e.preventDefault(); if (await save(supabase.from(table).insert({ [col]: v.trim(), ...(extra ? { [extra]: x || null } : {}) }), 'Added')) { setV(''); setX('') } }}>
        <input className="input" required placeholder={`New ${title.toLowerCase().replace(/s$/, '')}`} value={v} onChange={e => setV(e.target.value)} />
        {extra && <input className="input w-48" placeholder="State" value={x} onChange={e => setX(e.target.value)} />}
        <button className="btn-primary"><Plus className="h-4 w-4" />Add</button>
      </form>
      <ul className="divide-y divide-slate-100">
        {items.map(i => (
          <li key={i.id} className="flex items-center justify-between py-2 text-sm">
            <span className={i.is_active ? '' : 'text-slate-400 line-through'}>{i[col]}{extra && i[extra] ? <span className="text-slate-400"> · {i[extra]}</span> : ''}</span>
            <button className="btn-ghost py-1 text-xs" onClick={() => save(supabase.from(table).update({ is_active: !i.is_active }).eq('id', i.id))}>{i.is_active ? 'Hide' : 'Restore'}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const RULE_FIELDS = [
  ['min_distance_own_station_m', 'Minimum distance from own station (m)', 'Closer than this = cannibalisation → Not feasible'],
  ['ideal_max_distance_own_station_m', 'Max distance to stay connected to network (m)', 'Further than this = isolated site → warning'],
  ['competitor_radius_m', 'Competitor check radius (m)', ''],
  ['max_competitors_in_radius', 'Max competitors allowed in that radius', 'More than this → warning'],
  ['demand_radius_m', 'Demand hotspot radius (m)', ''],
  ['min_demand_points', 'Min demand hotspots in that radius', 'Fewer → warning'],
  ['restricted_radius_m', 'Restricted zone buffer (m)', 'Inside → Not feasible'],
  ['duplicate_radius_m', 'Duplicate deal radius (m)', 'Another deal this close → warning'],
  ['search_radius_m', 'Search / display radius (m)', 'Area shown around the point'],
]

function Rules() {
  const { rules } = useConfig()
  const save = useSave()
  const [r, setR] = useState(rules)
  useEffect(() => setR(rules), [rules])
  return (
    <div className="card max-w-3xl p-4">
      <p className="mb-4 text-sm text-slate-500">These rules drive the Network Planning verdict. <b>Not feasible</b> if any hard rule fails; <b>Needs review</b> if two or more warnings.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {RULE_FIELDS.map(([k, l, h]) => (
          <Field key={k} label={l} hint={h}><input className="input" type="number" min="0" value={r?.[k] ?? ''} onChange={e => setR({ ...r, [k]: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-primary" onClick={() => save(supabase.from('app_settings').upsert({ key: 'feasibility_rules', value: r, updated_at: new Date().toISOString() }), 'Rules saved')}><Save className="h-4 w-4" />Save rules</button>
        <button className="btn-secondary" onClick={() => setR(DEFAULT_RULES)}>Reset to defaults</button>
      </div>
    </div>
  )
}

const NET_FIELDS = [['point_type', 'Type'], ['name', 'Name'], ['city', 'City'], ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['weight', 'Weight'], ['notes', 'Notes']]

function Network() {
  const toast = useToast()
  const [points, setPoints] = useState(null)
  const [type, setType] = useState('own_station')
  const [busy, setBusy] = useState(false)
  const load = () => fetchAll(() => supabase.from('network_points').select('*').order('id')).then(setPoints)
  useEffect(() => { load() }, [])

  const importFile = async file => {
    setBusy(true)
    try {
      const raw = await readSheet(file)
      const typeBy = Object.fromEntries(Object.entries(NETWORK_TYPES).flatMap(([k, t]) => [[k, k], [t.label.toLowerCase(), k]]))
      const rows = []; const bad = []
      raw.forEach((x, i) => {
        const o = normaliseRow(x, NET_FIELDS)
        const t = typeBy[String(o.point_type || type).toLowerCase()] || type
        const lat = toNum(o.latitude), lng = toNum(o.longitude)
        if (!o.name || lat === null || lng === null) return bad.push(i + 2)
        rows.push({ point_type: t, name: String(o.name), city: o.city || null, latitude: lat, longitude: lng, weight: toNum(o.weight) ?? 1, notes: o.notes || null })
      })
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('network_points').insert(rows.slice(i, i + 500))
        if (error) throw error
      }
      toast(`Imported ${rows.length} points${bad.length ? `, skipped rows ${bad.slice(0, 10).join(', ')}` : ''}`)
      load()
    } catch (e) { toast(errMsg(e), 'error') }
    setBusy(false)
  }

  const clearType = async t => {
    if (!window.confirm(`Delete ALL "${NETWORK_TYPES[t].label}" points?`)) return
    const { error } = await supabase.from('network_points').delete().eq('point_type', t)
    if (error) return toast(errMsg(error), 'error')
    toast('Deleted'); load()
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="mb-3 text-sm text-slate-500">Upload the reference layers used by Network Planning: your existing stations, competitor stations, demand hotspots (fleet hubs, markets, EV clusters) and restricted zones. Deals in a <b>Live</b> stage are automatically treated as own stations.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Default type (if file has no Type column)">
            <select className="input w-auto" value={type} onChange={e => setType(e.target.value)}>{Object.entries(NETWORK_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select>
          </Field>
          <label className={`btn-primary cursor-pointer ${busy ? 'opacity-50' : ''}`}><Upload className="h-4 w-4" />{busy ? 'Importing…' : 'Upload Excel / CSV'}
            <input type="file" accept=".xlsx,.csv" className="hidden" disabled={busy} onChange={e => { e.target.files[0] && importFile(e.target.files[0]); e.target.value = '' }} /></label>
          <button className="btn-secondary" onClick={() => downloadTemplate(NET_FIELDS, 'sitekhojo-network-template')}><Download className="h-4 w-4" />Template</button>
          {points?.length > 0 && <button className="btn-secondary" onClick={() => exportRows(points, NET_FIELDS, 'sitekhojo-network-points')}><Download className="h-4 w-4" />Export</button>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Columns: Type (own_station / competitor / demand_hotspot / restricted), Name, City, Latitude, Longitude, Weight (optional), Notes (optional).</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(NETWORK_TYPES).map(([k, t]) => {
          const n = points?.filter(p => p.point_type === k).length ?? '…'
          return (
            <div key={k} className="card p-4">
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: t.color }} /><span className="text-sm font-semibold">{t.label}</span></div>
              <p className="mt-1 text-2xl font-bold">{n}</p>
              {n > 0 && <button className="mt-1 flex items-center gap-1 text-xs text-red-600 hover:underline" onClick={() => clearType(k)}><Trash2 className="h-3 w-3" />Delete all</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
