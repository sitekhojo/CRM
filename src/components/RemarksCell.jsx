import { useEffect, useState } from 'react'
import { MessageSquarePlus, MessageSquare, Trash2 } from 'lucide-react'
import { supabase, fetchAll, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useConfig, ownerOptions } from '../lib/config'
import { Modal, useToast } from './ui'

export const fmtWhen = d => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
const fmtShort = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })

/** Load remarks for a set of site ids → { site_id: [newest first] }. */
export async function fetchRemarks(ids) {
  const out = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const rows = await fetchAll(() => supabase.from('site_comments').select('*, author:profiles(full_name)').in('site_id', part).order('created_at', { ascending: false }))
    for (const c of rows) (out[c.site_id] = out[c.site_id] || []).push(c)
  }
  return out
}
export const latestRemark = list => list?.[0] ? `${fmtShort(list[0].created_at)}${list[0].said_by ? ` · ${list[0].said_by}` : ''}: ${list[0].body}` : ''

/** Latest remark + click to see the full history and add a new one. */
export default function RemarksCell({ deal, list = [], onChanged }) {
  const [open, setOpen] = useState(false)
  const last = list[0]
  return (
    <>
      <button onClick={() => setOpen(true)} className="group w-full max-w-[280px] rounded-md px-1.5 py-1 text-left hover:bg-slate-100" title="Open remarks history">
        {last ? (
          <>
            <div className="line-clamp-2 text-xs text-slate-700">{last.body}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
              <MessageSquare className="h-3 w-3" />{fmtShort(last.created_at)}{last.said_by ? ` · ${last.said_by}` : ''}{list.length > 1 ? ` · ${list.length} remarks` : ''}
            </div>
          </>
        ) : <span className="flex items-center gap-1 text-xs text-slate-400 group-hover:text-brand-700"><MessageSquarePlus className="h-3.5 w-3.5" />Add remark</span>}
      </button>
      {open && <RemarksModal deal={deal} list={list} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  )
}

export function RemarksModal({ deal, list, onClose, onChanged }) {
  const { profile, isAdmin } = useAuth()
  const { team = [] } = useConfig()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [saidBy, setSaidBy] = useState(deal.owner || '')
  const [sync, setSync] = useState(true)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState(list)
  useEffect(() => setItems(list), [list])

  const add = async e => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    const { data, error } = await supabase.from('site_comments').insert({ site_id: deal.id, body: body.trim(), author_id: profile.id, said_by: saidBy || null, kind: sync ? 'sync' : 'comment' })
      .select('*, author:profiles(full_name)').single()
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    setItems(x => [data, ...x]); setBody(''); toast(`Remark saved · ${deal.site_code}`); onChanged?.()
  }
  const del = async c => {
    if (!confirm('Delete this remark?')) return
    const { error } = await supabase.from('site_comments').delete().eq('id', c.id)
    if (error) return toast(errMsg(error), 'error')
    setItems(x => x.filter(y => y.id !== c.id)); onChanged?.()
  }

  return (
    <Modal open onClose={onClose} wide title={`Remarks · ${deal.name}`} footer={<button className="btn-primary" onClick={onClose}>Close</button>}>
      <form onSubmit={add} className="mb-4 space-y-2 rounded-xl border border-slate-200 p-3">
        <textarea autoFocus className="input min-h-[70px]" placeholder="What did the team convey? e.g. Owner agreed on 45k, agreement next week" value={body} onChange={e => setBody(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-xs font-semibold text-slate-500">Conveyed by</label>
          <select className="input w-auto py-1.5" value={saidBy} onChange={e => setSaidBy(e.target.value)}>
            <option value="">—</option>
            {ownerOptions(team, null, deal.owner).map(g => <optgroup key={g.region} label={g.region}>{g.members.map(t => <option key={t.name}>{t.name}</option>)}</optgroup>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />From sync-up call</label>
          <button className="btn-primary ml-auto" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Save remark'}</button>
        </div>
      </form>
      <ol className="relative max-h-[50vh] space-y-3 overflow-auto border-l border-slate-200 pl-5">
        {items.map(c => (
          <li key={c.id} className="group relative">
            <span className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ${c.kind === 'sync' ? 'bg-brand-500' : 'bg-sky-400'}`} />
            <p className="text-xs text-slate-500">
              <b className="text-slate-700">{fmtWhen(c.created_at)}</b>
              {c.said_by && <> · conveyed by <b className="text-slate-700">{c.said_by}</b></>}
              {c.kind === 'sync' && <span className="ml-1 rounded bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700">sync-up call</span>}
              <span className="text-slate-400"> · noted by {c.author?.full_name || '—'}</span>
              {(isAdmin || c.author_id === profile?.id) && <button className="ml-2 align-middle text-slate-300 opacity-0 hover:text-red-600 group-hover:opacity-100" title="Delete" onClick={() => del(c)}><Trash2 className="inline h-3.5 w-3.5" /></button>}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">{c.body}</p>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-slate-400">No remarks yet. Add what the team said on today's call.</li>}
      </ol>
    </Modal>
  )
}
