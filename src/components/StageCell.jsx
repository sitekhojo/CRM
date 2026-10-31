import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Lock } from 'lucide-react'
import { StageBadge, useToast } from './ui'
import { useConfig, stagesFor } from '../lib/config'
import { useAuth } from '../lib/auth'
import { permissions } from '../lib/deals'
import { supabase, errMsg } from '../lib/supabase'
import StageChangeModal from './StageChangeModal'

/** Stage badge that opens a dropdown to change the stage in place (table rows). */
export default function StageCell({ deal, onChanged }) {
  const { stages = [] } = useConfig()
  const { profile, isAdmin } = useAuth()
  const toast = useToast()
  const [pos, setPos] = useState(null)
  const [dropTo, setDropTo] = useState(null)
  const btn = useRef(null)
  const perm = permissions(deal, profile)

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [pos])

  const open = e => {
    e.stopPropagation()
    if (!perm.canChangeStage) return
    const r = btn.current.getBoundingClientRect()
    setPos({ left: r.left, top: r.bottom + 4, up: r.bottom + 360 > window.innerHeight })
  }

  const pick = async (e, s) => {
    e.stopPropagation(); setPos(null)
    if (s.category === 'dropped') { setDropTo(s.id); return } // needs a reason
    const { error } = await supabase.from('sites').update({ stage_id: s.id, stage_note: 'Changed from Leads & Deals list' }).eq('id', deal.id)
    if (error) return toast(errMsg(error), 'error')
    toast(`${deal.site_code} → ${s.name}`); onChanged?.()
  }

  const options = stagesFor(stages, deal.site_type)
  return (
    <>
      <button ref={btn} type="button" onClick={open} title={perm.canChangeStage ? 'Change stage' : 'Only the owner or an admin can change the stage'}
        className={`group inline-flex items-center gap-0.5 rounded-full ${perm.canChangeStage ? 'cursor-pointer hover:ring-2 hover:ring-slate-200' : 'cursor-default'}`}>
        <StageBadge name={deal.stage_name} color={deal.stage_color} />
        {perm.canChangeStage && <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700" />}
      </button>
      {pos && createPortal(
        <div className="fixed inset-0 z-[1500]" onClick={e => { e.stopPropagation(); setPos(null) }}>
          <div className="fixed w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
            style={pos.up ? { left: pos.left, bottom: window.innerHeight - pos.top + 34 } : { left: pos.left, top: pos.top }}
            onClick={e => e.stopPropagation()}>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Move {deal.site_code} to</p>
            {options.map(s => {
              const locked = s.admin_only && !isAdmin
              const current = s.id === deal.stage_id
              return (
                <button key={s.id} type="button" disabled={current || locked} onClick={e => pick(e, s)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${current ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'} disabled:cursor-not-allowed ${locked ? 'opacity-50' : ''}`}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}
                  {current && <span className="ml-auto text-[10px] text-slate-400">current</span>}
                  {locked && <Lock className="ml-auto h-3 w-3" />}
                </button>
              )
            })}
          </div>
        </div>, document.body)}
      <StageChangeModal open={!!dropTo} presetStageId={dropTo} deal={deal} onClose={() => setDropTo(null)}
        onSave={async patch => {
          const { error } = await supabase.from('sites').update(patch).eq('id', deal.id)
          if (error) { toast(errMsg(error), 'error'); return false }
          toast(`${deal.site_code} dropped`); onChanged?.(); return true
        }} />
    </>
  )
}
