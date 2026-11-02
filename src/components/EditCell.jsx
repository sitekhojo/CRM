import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { permissions } from '../lib/deals'
import { supabase, errMsg } from '../lib/supabase'
import { useToast } from './ui'
import { fmtDate, fmtNum } from '../lib/format'

/** Click-to-edit value stored in sites.extra (planning fields: expected dates, QIS). */
export default function EditCell({ deal, field, type = 'date', label, onChanged, className = '', adminOnly = false, format }) {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const can = adminOnly ? isAdmin : permissions(deal, profile).canEdit
  const raw = deal.extra?.[field]
  const value = raw === undefined || raw === null ? '' : String(raw)

  const save = async v => {
    setEditing(false)
    v = (v ?? '').trim()
    if (v === value) return
    const extra = { ...(deal.extra || {}) }
    if (v === '') delete extra[field]
    else extra[field] = type === 'number' ? Number(v) : v
    const { error } = await supabase.from('sites').update({ extra }).eq('id', deal.id)
    if (error) return toast(errMsg(error), 'error')
    toast(`${label} ${v ? 'updated' : 'cleared'} · ${deal.site_code}`); onChanged?.()
  }

  if (editing) {
    return (
      <input type={type} autoFocus min={type === 'number' ? 0 : undefined} className={`input py-1 text-sm ${type === 'number' ? 'w-20 text-right' : 'w-36'}`} defaultValue={value}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Enter') save(e.currentTarget.value); if (e.key === 'Escape') setEditing(false) }}
        onBlur={e => save(e.currentTarget.value)} />
    )
  }
  const shown = value === '' ? '—' : format ? format(value) : type === 'date' ? fmtDate(value) : type === 'number' ? fmtNum(Number(value)) : value
  return (
    <button type="button" disabled={!can} title={can ? `Edit ${label.toLowerCase()}` : undefined}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      className={`group inline-flex items-center gap-1 whitespace-nowrap rounded px-1 -mx-1 ${can ? 'hover:bg-slate-100' : 'cursor-default'} ${className}`}>
      {shown}{can && <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />}
    </button>
  )
}
