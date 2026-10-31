import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

/** Dropdown with checkboxes. value = array of selected option values ([] = all). */
export default function MultiSelect({ allLabel, noun, options, value = [], onChange, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [])
  const sel = new Set(value.map(String))
  const toggle = v => onChange(sel.has(String(v)) ? value.filter(x => String(x) !== String(v)) : [...value, String(v)])
  const label = value.length === 0 ? allLabel
    : value.length === 1 ? (options.find(o => String(o.value) === String(value[0]))?.label ?? allLabel)
    : `${value.length} ${noun}`
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`input flex w-auto min-w-[150px] items-center justify-between gap-2 text-left ${value.length ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800' : ''}`}>
        <span className="truncate">{label}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 z-[700] mt-1 max-h-80 min-w-[220px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          <button type="button" onClick={() => onChange([])} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <span className={`flex h-4 w-4 items-center justify-center rounded border ${value.length === 0 ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}>{value.length === 0 && <Check className="h-3 w-3" />}</span>{allLabel}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {options.map(o => (
            <button type="button" key={o.value} onClick={() => toggle(o.value)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${sel.has(String(o.value)) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}>{sel.has(String(o.value)) && <Check className="h-3 w-3" />}</span>
              {o.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
