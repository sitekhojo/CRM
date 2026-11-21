import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, X, ArrowDownToLine, ClipboardPaste, Check } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useConfig, stagesFor } from '../lib/config'
import { useAuth } from '../lib/auth'
import { SITE_TYPES, INTENTS, normIntent } from '../lib/format'
import { parseLatLng } from '../lib/geo'
import { useToast } from './ui'

/** Columns of the grid. kind: text | number | date | select. Selects only accept known values, so the data stays clean. */
const COLS = [
  { k: 'name', l: 'Site name', req: true, w: 'w-56' },
  { k: 'city', l: 'City', req: true, kind: 'select', w: 'w-36', fill: true },
  { k: 'site_type', l: 'Site type', req: true, kind: 'select', w: 'w-28', fill: true },
  { k: 'stage_id', l: 'Stage', kind: 'select', w: 'w-44', fill: true },
  { k: 'owner', l: 'Owner', kind: 'select', w: 'w-40', fill: true },
  { k: 'qis', l: 'QIS', kind: 'number', w: 'w-16' },
  { k: 'intent', l: 'Intent', kind: 'select', w: 'w-24', fill: true },
  { k: 'expected_ho', l: 'Expected HO', kind: 'date', w: 'w-36' },
  { k: 'location', l: 'Location (lat, long or Maps link)', w: 'w-56' },
  { k: 'landlord_name', l: 'Landlord / owner', w: 'w-40' },
  { k: 'landlord_phone', l: 'Phone', w: 'w-32' },
  { k: 'rent', l: 'Rent ₹/month', kind: 'number', w: 'w-28' },
  { k: 'address', l: 'Address', w: 'w-56' },
  { k: 'remarks', l: 'Remarks', w: 'w-56' },
]
const blankRow = (siteType = '') => ({ ...Object.fromEntries(COLS.map(c => [c.k, ''])), site_type: siteType || '' })
const isEmpty = r => COLS.every(c => !String(r[c.k] ?? '').trim())

/**
 * Bulk add leads or deals: a spreadsheet-like grid. Type or paste rows from Excel;
 * every non-empty row becomes its own lead/deal. Pick-lists (city, type, stage, owner, intent) stop bad values.
 */
export default function BulkAddModal({ open, onClose, type = 'deal', deals = [], onDone, siteType = '' }) {
  const blank = () => blankRow(siteType)
  const { stages = [], cities = [], team = [] } = useConfig()
  const { isAdmin } = useAuth()
  const toast = useToast()
  const label = type === 'lead' ? 'lead' : 'deal'
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, blank))
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState({}) // row index → server error
  const grid = useRef(null)
  useEffect(() => { if (open) { setRows(Array.from({ length: 5 }, blank)); setErrs({}) } }, [open])

  const cityList = useMemo(() => cities.map(c => c.name).sort(), [cities])
  const cityOwner = c => cities.find(x => x.name === c)?.owner || ''
  const activeTeam = useMemo(() => team.filter(t => t.is_active).map(t => t.name).sort(), [team])
  const stageOpts = st => stagesFor(stages, st || undefined).filter(s => (isAdmin || !s.admin_only) && s.category !== 'dropped' && s.category !== 'live')
  const optsFor = (k, r) => k === 'city' ? cityList.map(v => [v, v])
    : k === 'site_type' ? SITE_TYPES.map(v => [v, v])
      : k === 'stage_id' ? stageOpts(r.site_type).map(s => [String(s.id), s.name])
        : k === 'owner' ? activeTeam.map(v => [v, v])
          : k === 'intent' ? Object.entries(INTENTS).map(([v, x]) => [v, x.label]) : []

  /** Match pasted / typed text to a pick-list value (case-insensitive, by value or label). */
  const matchOpt = (k, r, text) => {
    const t = String(text ?? '').trim().toLowerCase()
    if (!t) return ''
    if (k === 'intent') return normIntent(t) || ''
    const hit = optsFor(k, r).find(([v, l]) => v.toLowerCase() === t || String(l).toLowerCase() === t)
    return hit ? hit[0] : `?${text}`
  }

  const setCell = (i, k, v) => setRows(rs => rs.map((r, j) => {
    if (j !== i) return r
    const n = { ...r, [k]: v }
    if (k === 'city' && (!r.owner || r.owner === cityOwner(r.city))) n.owner = cityOwner(v)
    if (k === 'site_type' && n.stage_id && !stageOpts(v).some(s => String(s.id) === n.stage_id)) n.stage_id = ''
    return n
  }))
  // Copy row 1's value to every other row that has something in it
  const fillDown = k => setRows(rs => { const v = rs[0][k]; return rs.map((r, j) => {
    if (j === 0 || isEmpty(r)) return r
    const n = { ...r, [k]: v }
    if (k === 'city' && (!r.owner || r.owner === cityOwner(r.city))) n.owner = cityOwner(v)
    return n
  }) })
  const addRows = n => setRows(rs => [...rs, ...Array.from({ length: n }, blank)])

  /** Paste a block from Excel / Sheets into the grid starting at this cell. */
  const onPaste = (i, ci) => e => {
    const text = e.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter((l, idx, a) => l.length || idx < a.length - 1).map(l => l.split('\t'))
    setRows(rs => {
      const out = [...rs]
      while (out.length < i + lines.length) out.push(blank())
      lines.forEach((cells, di) => {
        const r = { ...out[i + di] }
        cells.forEach((val, dc) => {
          const col = COLS[ci + dc]
          if (!col) return
          r[col.k] = col.kind === 'select' ? matchOpt(col.k, r, val) : col.kind === 'date' ? normDate(val) : String(val).trim()
        })
        if (!r.owner && r.city && !r.city.startsWith('?')) r.owner = cityOwner(r.city) // default owner = city owner
        out[i + di] = r
      })
      return out
    })
  }

  /** Enter → same column, next row (adds a row at the end). */
  const onKey = (i, ci) => e => {
    if (e.key !== 'Enter' || e.target.tagName === 'SELECT') return
    e.preventDefault()
    if (i === rows.length - 1) addRows(1)
    setTimeout(() => grid.current?.querySelector(`[data-cell="${i + 1}-${ci}"]`)?.focus(), 0)
  }

  // Validation per row
  const existing = useMemo(() => new Set(deals.map(d => `${String(d.name).trim().toLowerCase()}|${String(d.city).toLowerCase()}`)), [deals])
  const checks = rows.map(r => {
    if (isEmpty(r)) return { empty: true, errors: [], warns: [] }
    const errors = [], warns = []
    for (const c of COLS) if (c.req && !String(r[c.k]).trim()) errors.push(`${c.l} missing`)
    for (const c of COLS) if (c.kind === 'select' && String(r[c.k]).startsWith('?')) errors.push(`${c.l}: "${r[c.k].slice(1)}" not in list`)
    if (r.location && !parseLatLng(r.location)) errors.push('Location not readable')
    if (r.qis && !(Number(r.qis) >= 0)) errors.push('QIS must be a number')
    if (r.rent && !(Number(String(r.rent).replace(/,/g, '')) >= 0)) errors.push('Rent must be a number')
    if (r.landlord_phone && String(r.landlord_phone).replace(/\D/g, '').length < 10) warns.push('Phone looks short')
    if (r.name && r.city && existing.has(`${r.name.trim().toLowerCase()}|${r.city.toLowerCase()}`)) warns.push('Same name already exists in this city')
    if (!r.location) warns.push('No location — won’t show on the map')
    return { errors, warns }
  })
  const filled = checks.filter(c => !c.empty)
  const bad = filled.filter(c => c.errors.length).length

  const save = async () => {
    if (!filled.length) return toast('Add at least one site', 'error')
    if (bad) return toast(`Fix ${bad} row${bad > 1 ? 's' : ''} marked in red first`, 'error')
    setBusy(true)
    const firstStage = st => stageOpts(st)[0]?.id ?? null
    const idx = rows.map((r, i) => i).filter(i => !checks[i].empty)
    const payload = i => {
      const r = rows[i], loc = parseLatLng(r.location)
      const extra = {}
      if (r.qis !== '') extra.qis_count = Number(r.qis)
      if (r.intent) extra.intent = r.intent
      if (r.expected_ho) extra.expected_ho = r.expected_ho
      return {
        name: r.name.trim(), city: r.city, site_type: r.site_type, record_type: label,
        stage_id: r.stage_id ? Number(r.stage_id) : firstStage(r.site_type), owner: r.owner || cityOwner(r.city) || null,
        latitude: loc?.lat ?? null, longitude: loc?.lng ?? null, location_source: loc ? 'manual' : 'none',
        landlord_name: r.landlord_name.trim() || null, landlord_phone: r.landlord_phone.trim() || null,
        rent_expectation: r.rent ? Number(String(r.rent).replace(/,/g, '')) : null,
        address: r.address.trim() || null, remarks: r.remarks.trim() || null, extra,
      }
    }
    const done = [], failed = {}
    for (const i of idx) {
      const { data, error } = await supabase.from('sites').insert(payload(i)).select('site_code').single()
      if (error) failed[i] = errMsg(error); else done.push(data.site_code)
    }
    setBusy(false)
    setErrs(failed)
    setRows(rs => { const keep = rs.filter((r, i) => failed[i]); return keep.length ? keep : Array.from({ length: 5 }, blank) })
    if (done.length) { toast(`${done.length} ${label}${done.length > 1 ? 's' : ''} created (${done[0]}${done.length > 1 ? ` – ${done[done.length - 1]}` : ''})`); onDone?.() }
    if (Object.keys(failed).length) toast(`${Object.keys(failed).length} row(s) could not be saved — see red rows`, 'error')
    else onClose()
  }

  if (!open) return null
  const cell = 'h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500'
  return (
    <div className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-slate-900/40 p-0 sm:p-4" onMouseDown={onClose}>
      <div className="flex w-full max-w-[96rem] flex-col overflow-hidden bg-white shadow-xl sm:rounded-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Bulk add {label}s</h3>
            <p className="text-xs text-slate-500">One row = one {label}. Type, or copy rows from Excel and paste into the first cell (<ClipboardPaste className="inline h-3 w-3" /> Ctrl+V). Enter moves down. <b>↓</b> copies the first row's value to every row.</p>
          </div>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div ref={grid} className="flex-1 overflow-auto">
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="sticky left-0 z-20 w-10 border-b border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">#</th>
                {COLS.map(c => (
                  <th key={c.k} className={`${c.w} border-b border-slate-200 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500`}>
                    <span className="flex items-center gap-1">{c.l}{c.req && <span className="text-red-500">*</span>}
                      {c.fill && <button title="Copy row 1 to all rows" onClick={() => fillDown(c.k)} className="ml-auto rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><ArrowDownToLine className="h-3.5 w-3.5" /></button>}</span>
                  </th>
                ))}
                <th className="w-10 border-b border-slate-200" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ch = checks[i]
                const tone = errs[i] || ch.errors.length ? 'bg-red-50' : ch.empty ? '' : ch.warns.length ? 'bg-amber-50/40' : 'bg-emerald-50/30'
                return (
                  <tr key={i} className={tone}>
                    <td className="sticky left-0 border-b border-slate-100 bg-inherit px-2 text-center text-xs text-slate-400" title={[errs[i], ...ch.errors, ...ch.warns].filter(Boolean).join('\n')}>
                      {ch.empty ? i + 1 : errs[i] || ch.errors.length ? <span className="font-bold text-red-600">!</span> : <Check className="mx-auto h-3.5 w-3.5 text-emerald-600" />}
                    </td>
                    {COLS.map((c, ci) => {
                      const v = r[c.k]
                      const invalid = c.kind === 'select' && String(v).startsWith('?')
                      return (
                        <td key={c.k} className={`border-b border-l border-slate-100 p-0.5 ${invalid || (c.req && !ch.empty && !String(v).trim()) ? 'bg-red-100' : ''}`}>
                          {c.kind === 'select' ? (
                            <select data-cell={`${i}-${ci}`} className={cell} value={invalid ? '' : v} onChange={e => setCell(i, c.k, e.target.value)} onPaste={onPaste(i, ci)}>
                              <option value="">{invalid ? `✗ ${v.slice(1)}` : c.k === 'stage_id' ? `(first stage)` : '—'}</option>
                              {optsFor(c.k, r).map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                            </select>
                          ) : (
                            <input data-cell={`${i}-${ci}`} className={cell} type={c.kind === 'date' ? 'date' : 'text'} inputMode={c.kind === 'number' ? 'decimal' : undefined}
                              value={v} onChange={e => setCell(i, c.k, e.target.value)} onPaste={onPaste(i, ci)} onKeyDown={onKey(i, ci)} />
                          )}
                        </td>
                      )
                    })}
                    <td className="border-b border-slate-100 px-1 text-center">
                      <button title="Remove row" onClick={() => setRows(rs => (rs.length > 1 ? rs.filter((x, j) => j !== i) : [blank()]))} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-secondary" onClick={() => addRows(5)}><Plus className="h-4 w-4" />Add 5 rows</button>
          <p className="text-xs text-slate-500">
            <b className="text-slate-700">{filled.length}</b> {label}{filled.length === 1 ? '' : 's'} ready
            {bad > 0 && <span className="font-semibold text-red-600"> · {bad} with errors (hover the ! for details)</span>}
            {filled.some(c => c.warns.length) && <span className="text-amber-700"> · {filled.filter(c => c.warns.length).length} with warnings</span>}
          </p>
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !filled.length || bad > 0} onClick={save}>{busy ? 'Creating…' : `Create ${filled.length || ''} ${label}${filled.length === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Accept 2026-11-30, 30/11/2026, 30-11-2026, 30 Nov 2026 → yyyy-mm-dd. */
function normDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
