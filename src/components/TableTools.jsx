import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, SlidersHorizontal, GripVertical, RotateCcw } from 'lucide-react'

/** Column visibility + order, remembered per table in this browser. */
export function useColumns(storageKey, columns) {
  const defaults = columns.filter(c => !c.hidden).map(c => c.key)
  const [visible, setVisible] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (Array.isArray(saved)) return saved.filter(k => columns.some(c => c.key === k))
    } catch { /* ignore */ }
    return defaults
  })
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(visible)) } catch { /* ignore */ } }, [storageKey, visible])
  const shown = visible.map(k => columns.find(c => c.key === k)).filter(Boolean)
  return { shown, visible, setVisible, reset: () => setVisible(defaults) }
}

/** "Columns" button: tick to show/hide, drag or arrows to reorder. */
export function ColumnPicker({ columns, visible, setVisible, reset }) {
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState(null)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const ordered = [...visible.map(k => columns.find(c => c.key === k)).filter(Boolean), ...columns.filter(c => !visible.includes(c.key))]
  const toggle = k => setVisible(v => (v.includes(k) ? v.filter(x => x !== k) : [...v, k]))
  const move = (from, to) => setVisible(v => { if (to < 0 || to >= v.length) return v; const n = [...v]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n })

  return (
    <div className="relative" ref={box}>
      <button className="btn-secondary" onClick={() => setOpen(o => !o)}>
        <SlidersHorizontal className="h-4 w-4" />Columns<span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-bold text-slate-500">{visible.length}/{columns.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Show columns</span>
            <button className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline" onClick={reset}><RotateCcw className="h-3 w-3" />Reset</button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {ordered.map(c => {
              const on = visible.includes(c.key)
              const i = visible.indexOf(c.key)
              return (
                <div key={c.key} draggable={on}
                  onDragStart={() => setDrag(i)} onDragOver={e => { if (on) e.preventDefault() }}
                  onDrop={() => { if (on && drag !== null) move(drag, i); setDrag(null) }}
                  className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 ${drag === i && on ? 'opacity-50' : ''}`}>
                  <GripVertical className={`h-3.5 w-3.5 shrink-0 ${on ? 'cursor-grab text-slate-300' : 'text-transparent'}`} />
                  <label className="flex flex-1 cursor-pointer items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={on} disabled={c.locked} onChange={() => toggle(c.key)} />
                    <span className={on ? 'font-medium text-slate-800' : 'text-slate-500'}>{c.label}</span>
                  </label>
                  {on && (
                    <span className="hidden gap-0.5 group-hover:flex">
                      <button className="rounded px-1 text-slate-400 hover:bg-slate-200" title="Move left" onClick={() => move(i, i - 1)}>↑</button>
                      <button className="rounded px-1 text-slate-400 hover:bg-slate-200" title="Move right" onClick={() => move(i, i + 1)}>↓</button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Horizontal scroller with ◀ ▶ buttons (and edge shadows) when the table is wider than the screen. */
export function useHScroll() {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  })
  const by = dir => ref.current?.scrollBy({ left: dir * Math.max(300, ref.current.clientWidth * 0.7), behavior: 'smooth' })
  return { ref, edge, by }
}

export function ScrollButtons({ edge, by }) {
  if (!edge.left && !edge.right) return null
  const cls = on => `flex h-9 w-9 items-center justify-center rounded-lg border bg-white ${on ? 'border-slate-300 text-slate-700 hover:bg-slate-50' : 'border-slate-200 text-slate-300'}`
  return (
    <div className="flex gap-1">
      <button className={cls(edge.left)} disabled={!edge.left} onClick={() => by(-1)} title="Scroll left"><ChevronLeft className="h-4 w-4" /></button>
      <button className={cls(edge.right)} disabled={!edge.right} onClick={() => by(1)} title="Scroll right"><ChevronRight className="h-4 w-4" /></button>
    </div>
  )
}

/** Floating side arrows that stay on screen while you scroll down a long table. */
export function EdgeArrows({ edge, by }) {
  const btn = 'pointer-events-auto sticky top-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg hover:bg-white'
  return (
    <>
      {edge.left && <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-10 bg-gradient-to-r from-white to-transparent" />}
      {edge.right && <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-10 bg-gradient-to-l from-white to-transparent" />}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
        {edge.left && <button className={btn} onClick={() => by(-1)} title="Scroll left"><ChevronLeft className="h-5 w-5" /></button>}
        {edge.right && <button className={btn} onClick={() => by(1)} title="Scroll right"><ChevronRight className="h-5 w-5" /></button>}
      </div>
    </>
  )
}
