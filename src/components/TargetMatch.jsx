import { Link } from 'react-router-dom'
import { Crosshair } from 'lucide-react'
import { PRIORITIES, monthLabel } from '../lib/acquisition'
import { fmtNum } from '../lib/format'

/** Shows which priority location (P0–P4) a point falls in. */
export default function TargetMatch({ match, hasLocation = true, compact = false }) {
  if (!hasLocation) return compact ? null : <p className="text-xs text-slate-400">Add a location to see which priority location this site falls in.</p>
  if (!match) return compact ? <span className="text-xs text-slate-400">Not in a priority location</span>
    : <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"><Crosshair className="h-4 w-4 text-slate-400" />Not inside any priority location (P0–P4).</div>
  const chip = <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${PRIORITIES[match.priority]?.cls}`}>{match.priority}</span>
  if (compact) return <Link to="/app/acquisition" className="inline-flex items-center gap-1.5 text-sm hover:underline">{chip}<span className="font-semibold">{match.name}</span><span className="text-xs text-slate-500">· {monthLabel(match.target_month)}</span></Link>
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: PRIORITIES[match.priority]?.color, background: PRIORITIES[match.priority]?.color + '12' }}>
      <Crosshair className="h-4 w-4" style={{ color: PRIORITIES[match.priority]?.color }} />
      <span>Inside priority location</span>{chip}<b>{match.name}</b>
      <span className="text-slate-600">{match.city ? `${match.city} · ` : ''}month of acquisition <b>{monthLabel(match.target_month)}</b> · {fmtNum(match.distance_m)} m from centre</span>
    </div>
  )
}
