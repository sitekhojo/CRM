import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { permissions } from '../lib/deals'
import { supabase, errMsg } from '../lib/supabase'
import { useToast } from './ui'
import { fmtDate } from '../lib/format'

/** Click-to-edit milestone date (extra.ho_date / extra.energized_on) in the Leads & Deals list. */
export default function DateCell({ deal, field, label, onChanged }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const can = permissions(deal, profile).canEdit
  const value = deal.extra?.[field] || ''

  const save = async v => {
    setEditing(false)
    if ((v || '') === value) return
    const extra = { ...(deal.extra || {}) }
    if (v) extra[field] = v; else delete extra[field]
    const { error } = await supabase.from('sites').update({ extra }).eq('id', deal.id)
    if (error) return toast(errMsg(error), 'error')
    toast(`${label} ${v ? 'set to ' + fmtDate(v) : 'cleared'} · ${deal.site_code}`); onChanged?.()
  }

  if (editing) {
    return (
      <input type="date" autoFocus className="input w-36 py-1 text-sm" defaultValue={value}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Enter') save(e.currentTarget.value); if (e.key === 'Escape') setEditing(false) }}
        onBlur={e => save(e.currentTarget.value)} />
    )
  }
  return (
    <button type="button" disabled={!can} title={can ? `Edit ${label.toLowerCase()}` : undefined}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      className={`group inline-flex items-center gap-1 rounded px-1 -mx-1 text-slate-600 ${can ? 'hover:bg-slate-100' : 'cursor-default'}`}>
      {value ? fmtDate(value) : '—'}
      {can && <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />}
    </button>
  )
}
