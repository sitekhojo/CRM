/** Time-horizon toggle shared by Dashboard and Leads & Deals (Indian FY = Apr–Mar). */
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function periodRange({ kind, from, to }) {
  const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999)
  if (kind === 'all') return [new Date(2000, 0, 1), end]
  if (kind === 'custom') {
    return [from ? new Date(from + 'T00:00:00') : new Date(2000, 0, 1), to ? new Date(to + 'T23:59:59') : end]
  }
  if (kind === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end]
  if (kind === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q, 1), end] }
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1 // Indian FY: Apr–Mar
  return [new Date(fy, 3, 1), end]
}
export function periodLabel({ kind }, a, b) {
  const f = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  if (kind === 'all') return 'all time'
  if (kind === 'month') return `in ${a.toLocaleDateString('en-IN', { month: 'long' })}`
  if (kind === 'quarter') { const fyq = ((Math.floor(a.getMonth() / 3) + 3) % 4) + 1; return `in Q${fyq} (${a.toLocaleDateString('en-IN', { month: 'short' })}–now)` }
  if (kind === 'fy') { const y = a.getFullYear(); return `in FY${String(y + 1).slice(2)} (Apr ${y}–now)` }
  return `${f(a)} – ${f(b)}`
}
export default function PeriodBar({ value, onChange, label, allTime = false, prefix = 'Showing activity' }) {
  const opt = [...(allTime ? [['all', 'All time']] : []), ['month', 'This month'], ['quarter', 'This quarter'], ['fy', 'This FY'], ['custom', 'Custom']]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
        {opt.map(([k, l]) => (
          <button key={k} onClick={() => onChange({ ...value, kind: k })} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${value.kind === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>
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
