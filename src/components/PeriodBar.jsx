import { CalendarClock } from 'lucide-react'
/** Time-horizon toggle shared by Dashboard and Leads & Deals (Indian FY = Apr–Mar). */
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function periodRange({ kind, from, to }) {
  const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999)
  if (kind === 'all') return [new Date(2000, 0, 1), end]
  if (kind === 'custom') {
    return [from ? new Date(from + 'T00:00:00') : new Date(2000, 0, 1), to ? new Date(to + 'T23:59:59') : end]
  }
  if (kind === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end]
  if (kind === 'next') return [new Date(now.getFullYear(), now.getMonth() + 1, 1), new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999)]
  if (kind === 'lastMonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)]
  if (kind === 'lastQuarter') { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q - 3, 1), new Date(now.getFullYear(), q, 0, 23, 59, 59, 999)] }
  if (kind === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q, 1), end] }
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1 // Indian FY: Apr–Mar
  return [new Date(fy, 3, 1), end]
}
export function periodLabel({ kind }, a, b) {
  const f = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  if (kind === 'all') return 'all time'
  if (kind === 'next') return `expected in ${a.toLocaleDateString('en-IN', { month: 'long', ...(a.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}`
  if (kind === 'month' || kind === 'lastMonth') return `in ${a.toLocaleDateString('en-IN', { month: 'long', ...(a.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}`
  if (kind === 'lastQuarter') { const fyq = ((Math.floor(a.getMonth() / 3) + 3) % 4) + 1; return `in Q${fyq} (${a.toLocaleDateString('en-IN', { month: 'short' })}–${b.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})` }
  if (kind === 'quarter') { const fyq = ((Math.floor(a.getMonth() / 3) + 3) % 4) + 1; return `in Q${fyq} (${a.toLocaleDateString('en-IN', { month: 'short' })}–now)` }
  if (kind === 'fy') { const y = a.getFullYear(); return `in FY${String(y + 1).slice(2)} (Apr ${y}–now)` }
  return `${f(a)} – ${f(b)}`
}
export default function PeriodBar({ value, onChange, label, allTime = false, future = false, prefix = 'Showing activity' }) {
  const opt = [...(allTime ? [['all', 'All time']] : []), ['month', 'This month'], ['lastMonth', 'Last month'], ['quarter', 'This quarter'], ['lastQuarter', 'Last quarter'], ['fy', 'This FY'], ['custom', 'Custom']]
  const nextName = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() + 1, 1).toLocaleDateString('en-IN', { month: 'long' }) })()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
        {opt.map(([k, l]) => (
          <button key={k} onClick={() => onChange({ ...value, kind: k })} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${value.kind === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>
      {future && (
        <button onClick={() => onChange({ ...value, kind: 'next' })} title={`What's expected in ${nextName}: handovers and energisations by expected date`}
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${value.kind === 'next' ? 'border-sky-700 bg-sky-700 text-white shadow-sm' : 'border-dashed border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-500'}`}>
          <CalendarClock className="h-4 w-4" />{nextName}
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${value.kind === 'next' ? 'bg-white/20 text-white' : 'bg-sky-200/70 text-sky-800'}`}>Upcoming</span>
        </button>
      )}
      {value.kind === 'custom' && (
        <div className="flex items-center gap-1">
          <input type="date" className="input w-auto" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} />
          <span className="text-slate-400">–</span>
          <input type="date" className="input w-auto" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} />
        </div>
      )}
      <span className="text-sm text-slate-500">{prefix} <b>{label}</b></span>
    </div>
  )
}
