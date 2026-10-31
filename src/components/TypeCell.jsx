import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { Pill, useToast } from './ui'
import { useAuth } from '../lib/auth'
import { permissions } from '../lib/deals'
import { supabase, errMsg } from '../lib/supabase'
import { RECORD_TYPES } from '../lib/format'

/** Lead/Deal pill that opens a dropdown to switch the type in place (table rows). */
export default function TypeCell({ deal, onChanged }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const can = permissions(deal, profile).canEdit
  const cur = deal.record_type || 'deal'

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [pos])

  const pick = async (e, t) => {
    e.stopPropagation(); setPos(null)
    if (t === cur) return
    const { error } = await supabase.from('sites').update({ record_type: t }).eq('id', deal.id)
    if (error) return toast(errMsg(error), 'error')
    toast(`${deal.site_code} is now a ${RECORD_TYPES[t].label}`); onChanged?.()
  }

  return (
    <>
      <button ref={btn} type="button" title={can ? 'Change Lead / Deal' : 'Only the owner or an admin can change this'}
        onClick={e => { e.stopPropagation(); if (!can) return; const r = btn.current.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 4 }) }}
        className={`group inline-flex items-center gap-0.5 rounded-full ${can ? 'cursor-pointer hover:ring-2 hover:ring-slate-200' : 'cursor-default'}`}>
        <Pill className={RECORD_TYPES[cur].cls}>{RECORD_TYPES[cur].label}</Pill>
        {can && <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700" />}
      </button>
      {pos && createPortal(
        <div className="fixed inset-0 z-[1500]" onClick={e => { e.stopPropagation(); setPos(null) }}>
          <div className="fixed w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-xl" style={{ left: pos.left, top: pos.top }} onClick={e => e.stopPropagation()}>
            {Object.entries(RECORD_TYPES).map(([k, t]) => (
              <button key={k} type="button" disabled={k === cur} onClick={e => pick(e, k)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${k === cur ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}`}>
                <Pill className={t.cls}>{t.label}</Pill>{k === cur && <span className="ml-auto text-[10px] text-slate-400">current</span>}
              </button>
            ))}
          </div>
        </div>, document.body)}
    </>
  )
}
