import { useEffect, useRef, useState } from 'react'
import { CalendarClock, ChevronDown } from 'lucide-react'
/** Time-horizon toggle shared by Dashboard and Leads & Deals (Indian FY = Apr–Mar). */
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ymOf = d => isoDay(d).slice(0, 7)
const monthDate = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1)
const mName = (ym, opts = {}) => monthDate(ym).toLocaleDateString('en-IN', { month: 'short', ...opts })
/** Upcoming months to choose from: next month to the end of that financial year (Mar). */
export function upcomingMonths() {
  const n = new Date(); const first = new Date(n.getFullYear(), n.getMonth() + 1, 1)
  const fyEnd = new Date(first.getMonth() >= 3 ? first.getFullYear() + 1 : first.getFullYear(), 2, 1)
  const out = []
  for (let d = new Date(first); d <= fyEnd; d.setMonth(d.getMonth() + 1)) out.push(ymOf(d))
  return out
}
const fyName = ym => { const d = monthDate(ym); const y = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear(); return `FY${String(y).slice(2)}` }
/** Selected upcoming months (defaults to next month). */
export const nextMonths = value => (value.months?.length ? [...value.months].sort() : upcomingMonths().slice(0, 1))
export function upcomingLabel(months) {
  const all = upcomingMonths()
  if (months.length === all.length && all.length > 1) return `rest of ${fyName(all[0])} (${mName(all[0])}–${mName(all[all.length - 1])})`
  const contiguous = months.every((m, i) => i === 0 || all.indexOf(m) === all.indexOf(months[i - 1]) + 1)
  if (months.length === 1) return mName(months[0], { month: 'long' })
  return contiguous ? `${mName(months[0])}–${mName(months[months.length - 1])}` : months.map(m => mName(m)).join(', ')
}

export function periodRange({ kind, from, to, months }) {
  const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999)
  if (kind === 'all') return [new Date(2000, 0, 1), end]
  if (kind === 'custom') {
    return [from ? new Date(from + 'T00:00:00') : new Date(2000, 0, 1), to ? new Date(to + 'T23:59:59') : end]
  }
  if (kind === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end]
  if (kind === 'next') { const ms = nextMonths({ months }); const a = monthDate(ms[0]); const b = monthDate(ms[ms.length - 1]); return [a, new Date(b.getFullYear(), b.getMonth() + 1, 0, 23, 59, 59, 999)] }
  if (kind === 'lastMonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)]
  if (kind === 'lastQuarter') { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q - 3, 1), new Date(now.getFullYear(), q, 0, 23, 59, 59, 999)] }
  if (kind === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q, 1), end] }
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1 // Indian FY: Apr–Mar
  return [new Date(fy, 3, 1), end]
}
export function periodLabel({ kind, months }, a, b) {
  const f = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  if (kind === 'all') return 'all time'
  if (kind === 'next') return `expected in ${upcomingLabel(nextMonths({ months }))}`
  if (kind === 'month' || kind === 'lastMonth') return `in ${a.toLocaleDateString('en-IN', { month: 'long', ...(a.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}`
  if (kind === 'lastQuarter') { const fyq = ((Math.floor(a.getMonth() / 3) + 3) % 4) + 1; return `in Q${fyq} (${a.toLocaleDateString('en-IN', { month: 'short' })}–${b.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})` }
  if (kind === 'quarter') { const fyq = ((Math.floor(a.getMonth() / 3) + 3) % 4) + 1; return `in Q${fyq} (${a.toLocaleDateString('en-IN', { month: 'short' })}–now)` }
  if (kind === 'fy') { const y = a.getFullYear(); return `in FY${String(y + 1).slice(2)} (Apr ${y}–now)` }
  return `${f(a)} – ${f(b)}`
}
export default function PeriodBar({ value, onChange, label, allTime = false, future = false, prefix = 'Showing activity' }) {
  const opt = [...(allTime ? [['all', 'All time']] : []), ['month', 'This month'], ['lastMonth', 'Last month'], ['quarter', 'This quarter'], ['lastQuarter', 'Last quarter'], ['fy', 'This FY'], ['custom', 'Custom']]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
        {opt.map(([k, l]) => (
          <button key={k} onClick={() => onChange({ ...value, kind: k })} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${value.kind === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>
      {future && <UpcomingPicker value={value} onChange={onChange} />}
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

/** "Upcoming" dropdown: pick one or more future months (to the end of the FY) by expected dates. */
function UpcomingPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const all = upcomingMonths()
  const on = value.kind === 'next'
  const sel = on ? nextMonths(value) : []
  const set = ms => onChange({ ...value, kind: 'next', months: [...ms].sort() })
  const toggle = m => { const n = sel.includes(m) ? sel.filter(x => x !== m) : [...sel, m]; if (n.length) set(n) }
  const allOn = sel.length === all.length
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(o => !o)} title="What's expected ahead: handovers and energisations by expected date"
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${on ? 'border-sky-700 bg-sky-700 text-white shadow-sm' : 'border-dashed border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-500'}`}>
        <CalendarClock className="h-4 w-4" />
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${on ? 'bg-white/20 text-white' : 'bg-sky-200/70 text-sky-800'}`}>Upcoming</span>
        {on ? upcomingLabel(sel) : 'Pick months'}
        <ChevronDown className="h-4 w-4 opacity-70" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {all.length > 1 && (
            <button onClick={() => set(all)} className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${on && allOn ? 'bg-sky-50 text-sky-800' : 'text-slate-700 hover:bg-slate-50'}`}>
              Rest of {fyName(all[0])}<span className="text-xs font-normal text-slate-500">{mName(all[0])}–{mName(all[all.length - 1])}</span>
            </button>
          )}
          <div className="border-t border-slate-100 pt-1">
            {all.map(m => (
              <label key={m} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-sky-700" checked={sel.includes(m)} onChange={() => (on ? toggle(m) : set([m]))} />
                <span className={sel.includes(m) ? 'font-semibold text-slate-900' : 'text-slate-600'}>{mName(m, { month: 'long', year: 'numeric' })}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
