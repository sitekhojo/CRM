import { useEffect, createContext, useContext, useState, useCallback } from 'react'
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

export function StageBadge({ name, color, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
      style={{ background: hexA(color, 0.14), color: darken(color) }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{name}
    </span>
  )
}

export function Pill({ className = '', children }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>
}

export function Field({ label, children, hint, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Spinner({ className = '' }) {
  return <Loader2 className={`h-5 w-5 animate-spin text-brand-600 ${className}`} />
}

export function PageLoader() {
  return <div className="flex h-64 items-center justify-center"><Spinner className="h-7 w-7" /></div>
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 h-10 w-10 text-slate-300" />}
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return
    const k = e => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={`max-h-[92vh] w-full overflow-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        onMouseDown={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Stat({ label, value, sub, tone = 'slate', icon: Icon, onClick }) {
  const tones = { slate: 'text-slate-900', green: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', blue: 'text-sky-600', teal: 'text-teal-600' }
  return (
    <div className={`card p-4 ${onClick ? 'cursor-pointer transition hover:border-brand-500' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <p className={`mt-1.5 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

// ---- toasts ----
const ToastCtx = createContext(() => {})
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((msg, type = 'success') => {
    const id = Math.random()
    setItems(x => [...x, { id, msg, type }])
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[2000] flex flex-col gap-2">
        {items.map(t => (
          <div key={t.id} className={`flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${t.type === 'error' ? 'bg-red-600' : 'bg-navy-900'}`}>
            {t.type === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />}
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// ---- colour helpers ----
function hexA(hex = '#64748b', a) {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
function darken(hex = '#64748b') {
  const n = parseInt(hex.replace('#', ''), 16)
  const f = c => Math.round(c * 0.6)
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}
