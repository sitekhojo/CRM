import { X } from 'lucide-react'
import { useConfig } from '../lib/config'
import { EMPTY_FILTERS } from '../lib/deals'

/** Shared filter bar: search, city, stage, team member, date range, beyond-SLA. */
export default function DealFilters({ value, onChange, show = ['q', 'city', 'stage', 'member', 'date', 'overdue'], extra }) {
  const { cities = [], stages = [], users = [] } = useConfig()
  const set = (k, v) => onChange({ ...value, [k]: v })
  const active = Object.entries(value).some(([k, v]) => v && v !== EMPTY_FILTERS[k])
  return (
    <div className="flex flex-wrap items-end gap-2">
      {show.includes('q') && <input className="input w-full sm:w-56" placeholder="Search…" value={value.q} onChange={e => set('q', e.target.value)} />}
      {show.includes('city') && (
        <select className="input w-auto" value={value.city} onChange={e => set('city', e.target.value)}>
          <option value="">All cities</option>
          {cities.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      )}
      {show.includes('stage') && (
        <select className="input w-auto" value={value.stage} onChange={e => set('stage', e.target.value)}>
          <option value="">All stages</option>
          {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {show.includes('member') && (
        <select className="input w-auto" value={value.member} onChange={e => set('member', e.target.value)}>
          <option value="">All team members</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
      )}
      {show.includes('date') && (
        <div className="flex items-center gap-1">
          <input type="date" className="input w-auto" value={value.from} onChange={e => set('from', e.target.value)} title="Created from" />
          <span className="text-slate-400">–</span>
          <input type="date" className="input w-auto" value={value.to} onChange={e => set('to', e.target.value)} title="Created to" />
        </div>
      )}
      {show.includes('overdue') && (
        <label className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <input type="checkbox" checked={value.overdue} onChange={e => set('overdue', e.target.checked)} className="accent-red-600" /> Beyond SLA
        </label>
      )}
      {extra}
      {active && <button className="btn-ghost" onClick={() => onChange(EMPTY_FILTERS)}><X className="h-4 w-4" />Clear</button>}
    </div>
  )
}
