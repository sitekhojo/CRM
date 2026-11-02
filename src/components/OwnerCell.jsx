import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useToast } from './ui'
import { useConfig, ownerOptions, leadLabel } from '../lib/config'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/** Owner name that opens a dropdown (team grouped by region) to reassign in place. */
export default function OwnerCell({ deal, onChanged, className = '' }) {
  const { team = [] } = useConfig()
  const toast = useToast()
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const { profile } = useAuth()

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const t = setTimeout(() => { window.addEventListener('scroll', close, true); window.addEventListener('resize', close) }, 250)
    return () => { clearTimeout(t); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [pos])

  const pick = async (e, name) => {
    e.stopPropagation(); setPos(null)
    if (name === (deal.owner || null)) return
    const { error } = await supabase.from('sites').update({ owner: name }).eq('id', deal.id)
    if (error) return toast(errMsg(error), 'error')
    toast(name ? `${deal.name} → ${name}` : 'Owner cleared'); onChanged?.()
  }

  const open = e => {
    e.stopPropagation()
    const r = btn.current.getBoundingClientRect()
    const h = Math.min(420, window.innerHeight - 16)
    setPos({ left: Math.min(r.left, window.innerWidth - 230), top: r.bottom + h + 4 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4, h })
  }

  if (!profile) return <span className={`${deal.owner ? '' : 'text-slate-400'} ${className}`}>{deal.owner || 'Unassigned'}</span>
  return (
    <>
      <button ref={btn} type="button" onClick={open} title="Change owner"
        className={`group inline-flex items-center gap-0.5 rounded px-1 -mx-1 hover:bg-slate-100 ${className}`}>
        <span className={deal.owner ? '' : 'text-slate-400'}>{deal.owner || 'Unassigned'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700" />
      </button>
      {pos && createPortal(
        <div className="fixed inset-0 z-[1500]" onClick={e => { e.stopPropagation(); setPos(null) }}>
          <div className="fixed w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl" style={{ left: pos.left, top: pos.top, maxHeight: pos.h }} onClick={e => e.stopPropagation()}>
            {ownerOptions(team, deal.region, deal.owner).map(g => (
              <div key={g.region}>
                <div className="px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{g.region}{g.region === deal.region ? ' · this site' : ''}</div>
                {g.members.map(t => (
                  <button key={t.name} type="button" onClick={e => pick(e, t.name)}
                    className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${t.name === deal.owner ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}`}>
                    {t.name}{t.is_lead && <span className="ml-1 text-[10px] text-slate-400">{leadLabel(t.region)}</span>}
                    {t.name === deal.owner && <span className="ml-auto text-[10px] text-slate-400">current</span>}
                  </button>
                ))}
              </div>
            ))}
            {deal.owner && <button type="button" onClick={e => pick(e, null)} className="mt-1 w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50">Clear owner</button>}
          </div>
        </div>, document.body)}
    </>
  )
}
