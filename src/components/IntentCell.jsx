import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useToast } from './ui'
import { useAuth } from '../lib/auth'
import { permissions } from '../lib/deals'
import { supabase, errMsg } from '../lib/supabase'
import { INTENTS } from '../lib/format'

/** Hot / Warm / Cold chip that opens a dropdown to change intent in place (list rows). */
export default function IntentCell({ deal, onChanged }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const can = permissions(deal, profile).canEdit
  const cur = deal.extra?.intent || ''

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const t = setTimeout(() => { window.addEventListener('scroll', close, true); window.addEventListener('resize', close) }, 250)
    return () => { clearTimeout(t); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [pos])

  const pick = async (e, v) => {
    e.stopPropagation(); setPos(null)
    if (v === cur) return
    const extra = { ...(deal.extra || {}) }
    if (v) extra.intent = v; else delete extra.intent
    const { error } = await supabase.from('sites').update({ extra }).eq('id', deal.id)
    if (error) return toast(errMsg(error), 'error')
    toast(`${deal.site_code} → ${v ? INTENTS[v].label : 'intent cleared'}`); onChanged?.()
  }

  const t = INTENTS[cur]
  return (
    <>
      <button ref={btn} type="button" title={can ? 'Change intent' : undefined}
        onClick={e => { e.stopPropagation(); if (!can) return; const r = btn.current.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 4 }) }}
        className={`group inline-flex items-center gap-0.5 rounded-full ${can ? 'cursor-pointer hover:ring-2 hover:ring-slate-200' : 'cursor-default'}`}>
        {t ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.cls}`}>{t.label}</span> : <span className="px-1 text-xs text-slate-400">Set</span>}
        {can && <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700" />}
      </button>
      {pos && createPortal(
        <div className="fixed inset-0 z-[1500]" onClick={e => { e.stopPropagation(); setPos(null) }}>
          <div className="fixed w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-xl" style={{ left: pos.left, top: pos.top }} onClick={e => e.stopPropagation()}>
            {Object.entries(INTENTS).map(([k, x]) => (
              <button key={k} type="button" onClick={e => pick(e, k)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${k === cur ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}`}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${x.cls}`}>{x.label}</span><span className="text-xs text-slate-500">{x.hint}</span>
              </button>
            ))}
            {cur && <button type="button" onClick={e => pick(e, '')} className="mt-1 w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50">Clear</button>}
          </div>
        </div>, document.body)}
    </>
  )
}
