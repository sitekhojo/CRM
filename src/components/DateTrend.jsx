import { supabase, fetchAll } from '../lib/supabase'

/** History of date changes for these sites: { siteId: { expected_ho: [...], expected_en: [...] } }, oldest first. */
export async function fetchDateChanges(ids) {
  const out = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const rows = await fetchAll(() => supabase.from('site_date_changes').select('*, author:profiles(full_name)').in('site_id', part).order('changed_at'))
    for (const c of rows) ((out[c.site_id] = out[c.site_id] || {})[c.field] = out[c.site_id][c.field] || []).push(c)
  }
  return out
}

const short = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'blank')
const days = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)

/**
 * How a date has moved: "Moved 2× · +12 days" with the earlier dates (oldest → latest).
 * Only real moves count (a first-time fill from blank is not a slip).
 */
export default function DateTrend({ list = [] }) {
  const moves = list.filter(c => c.old_value && c.new_value)
  if (!moves.length) return <span className="text-xs text-slate-300">{list.length ? 'set once' : 'no change'}</span>
  const first = moves[0].old_value
  const last = moves[moves.length - 1].new_value
  const net = days(first, last)
  const tone = net > 0 ? 'bg-red-50 text-red-700' : net < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
  const chain = [first, ...moves.map(m => m.new_value)]
  const tip = list.map(c => `${new Date(c.changed_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}: ${short(c.old_value)} → ${short(c.new_value)}${c.author?.full_name ? ` (${c.author.full_name})` : ''}`).join('\n')
  return (
    <div title={tip} className="cursor-help">
      <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>
        Moved {moves.length}× · {net > 0 ? '+' : ''}{net} {Math.abs(net) === 1 ? 'day' : 'days'}
      </span>
      <div className="mt-0.5 whitespace-nowrap text-[10px] text-slate-400">
        {chain.length > 4 ? <>{short(chain[0])} → … → </> : null}
        {(chain.length > 4 ? chain.slice(-3) : chain).map((d, i, a) => <span key={i} className={i === a.length - 1 ? 'font-semibold text-slate-600' : 'line-through decoration-slate-300'}>{short(d)}{i < a.length - 1 ? ' → ' : ''}</span>)}
      </div>
    </div>
  )
}
