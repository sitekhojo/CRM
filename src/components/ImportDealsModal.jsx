import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Modal } from './ui'
import { useConfig } from '../lib/config'
import { supabase, errMsg } from '../lib/supabase'
import { readSheet, normaliseRow, IMPORT_FIELDS, toBool, toNum, downloadTemplate } from '../lib/excel'
import { useToast } from './ui'

/** Admin bulk import of deals from Excel / CSV. */
export default function ImportDealsModal({ open, onClose, onDone }) {
  const { stages = [], users = [], cities = [] } = useConfig()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const parse = async file => {
    setResult(null)
    const raw = await readSheet(file)
    const stageBy = Object.fromEntries(stages.map(s => [s.name.toLowerCase(), s.id]))
    const userBy = Object.fromEntries(users.map(u => [String(u.email).toLowerCase(), u.id]))
    const cityBy = Object.fromEntries(cities.map(c => [c.name.toLowerCase(), c.name]))
    setRows(raw.map((r, i) => {
      const o = normaliseRow(r, IMPORT_FIELDS)
      const errors = []
      const lat = toNum(o.latitude), lng = toNum(o.longitude)
      if (!o.name) errors.push('name missing')
      if (!o.city) errors.push('city missing')
      if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push('bad lat/long')
      const stage_id = o.stage ? stageBy[String(o.stage).toLowerCase()] : null
      if (o.stage && !stage_id) errors.push(`unknown stage "${o.stage}"`)
      const assigned_to = o.owner_email ? userBy[String(o.owner_email).toLowerCase()] : null
      if (o.owner_email && !assigned_to) errors.push(`unknown owner "${o.owner_email}"`)
      const pf = String(o.power_feasibility || 'unknown').toLowerCase().replace(/\s+/g, '_')
      return {
        line: i + 2, errors,
        payload: {
          name: o.name, city: cityBy[String(o.city || '').toLowerCase()] || o.city, address: o.address || null, pincode: o.pincode ? String(o.pincode) : null,
          latitude: lat, longitude: lng, location_source: 'import', site_type: o.site_type || null, area_sqft: toNum(o.area_sqft),
          landlord_name: o.landlord_name || null, landlord_phone: o.landlord_phone ? String(o.landlord_phone) : null, landlord_email: o.landlord_email || null,
          rent_expectation: toNum(o.rent_expectation), deposit_expectation: toNum(o.deposit_expectation),
          power_available: toBool(o.power_available), power_phase: ['single', 'three'].includes(String(o.power_phase).toLowerCase()) ? String(o.power_phase).toLowerCase() : null,
          sanctioned_load_kw: toNum(o.sanctioned_load_kw),
          power_feasibility: ['feasible', 'upgrade_required', 'not_feasible', 'unknown'].includes(pf) ? pf : 'unknown',
          observations: o.observations || null, remarks: o.remarks || null,
          ...(stage_id ? { stage_id } : {}), ...(assigned_to ? { assigned_to } : {}),
          stage_note: 'Imported',
        },
      }
    }))
  }

  const run = async () => {
    setBusy(true)
    const good = rows.filter(r => !r.errors.length)
    let ok = 0; const failed = []
    for (let i = 0; i < good.length; i += 200) {
      const chunk = good.slice(i, i + 200)
      const { error } = await supabase.from('sites').insert(chunk.map(r => r.payload))
      if (!error) ok += chunk.length
      else { // fall back to one-by-one to find the bad rows
        for (const r of chunk) {
          const { error: e } = await supabase.from('sites').insert(r.payload)
          if (e) failed.push(`Row ${r.line}: ${errMsg(e)}`); else ok++
        }
      }
    }
    setBusy(false)
    setResult({ ok, failed })
    if (ok) { toast(`Imported ${ok} deals`); onDone?.() }
  }

  const close = () => { setRows(null); setResult(null); onClose() }
  const bad = rows?.filter(r => r.errors.length) || []

  return (
    <Modal open={open} onClose={close} title="Import deals from Excel / CSV" wide
      footer={<>
        <button className="btn-secondary" onClick={close}>Close</button>
        {rows && !result && <button className="btn-primary" disabled={busy || rows.length === bad.length} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length - bad.length} deals`}</button>}
      </>}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">Required columns: <b>Site name, City, Latitude, Longitude</b>. Optional: Stage (by name), Owner email and all other deal fields.
          <button className="ml-1 font-semibold text-brand-700 hover:underline" onClick={() => downloadTemplate(IMPORT_FIELDS, 'sitekhojo-import-template')}>Download template</button></p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-slate-500 hover:border-brand-500">
          <FileSpreadsheet className="h-8 w-8" />Choose .xlsx or .csv file
          <input type="file" accept=".xlsx,.csv" className="hidden" onChange={e => e.target.files[0] && parse(e.target.files[0])} />
        </label>
        {rows && <p><b>{rows.length}</b> rows read · <span className="text-emerald-700">{rows.length - bad.length} ready</span>{bad.length > 0 && <> · <span className="text-red-600">{bad.length} with errors (skipped)</span></>}</p>}
        {bad.length > 0 && <ul className="max-h-40 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-700">{bad.map(r => <li key={r.line}>Row {r.line}: {r.errors.join(', ')}</li>)}</ul>}
        {result && <div className="rounded-lg bg-brand-50 p-3 text-brand-800">Imported {result.ok} deals.{result.failed.length > 0 && <ul className="mt-2 text-xs text-red-700">{result.failed.map(f => <li key={f}>{f}</li>)}</ul>}</div>}
      </div>
    </Modal>
  )
}
