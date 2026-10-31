import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, ArrowRightLeft, Trash2, MapPin, Phone, Mail, AlertTriangle, MessageSquare, History, ExternalLink, Radar, Check } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { permissions } from '../lib/deals'
import { StageBadge, PageLoader, Empty, Pill, Modal, useToast } from '../components/ui'
import { BaseMap, pinIcon } from '../components/maps'
import { Marker } from 'react-leaflet'
import StageChangeModal from '../components/StageChangeModal'
import DealForm from '../components/DealForm'
import { fmtDateTime, fmtINR, fmtNum, daysLabel, timeAgo, POWER_FEASIBILITY } from '../lib/format'

export default function DealDetail() {
  const { id } = useParams()
  const { profile, isAdmin } = useAuth()
  const { stages = [], users = [] } = useConfig()
  const toast = useToast()
  const nav = useNavigate()
  const [deal, setDeal] = useState(undefined)
  const [history, setHistory] = useState([])
  const [comments, setComments] = useState([])
  const [stageModal, setStageModal] = useState(null) // null | {preset}
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [comment, setComment] = useState('')

  const load = useCallback(async () => {
    const [d, h, c] = await Promise.all([
      supabase.from('site_overview').select('*').eq('id', id).maybeSingle(),
      supabase.from('stage_history_overview').select('*').eq('site_id', id).order('changed_at', { ascending: false }),
      supabase.from('site_comments').select('*, author:profiles(full_name)').eq('site_id', id).order('created_at', { ascending: false }),
    ])
    setDeal(d.data || null); setHistory(h.data || []); setComments(c.data || [])
  }, [id])
  useEffect(() => { load() }, [load])

  if (deal === undefined) return <PageLoader />
  if (deal === null) return <div className="p-6"><Empty title="Deal not found"><Link className="text-brand-700" to="/app/deals">Back to deals</Link></Empty></div>

  const perm = permissions(deal, profile)
  const activeStages = stages.filter(s => s.is_active && s.category !== 'dropped')
  const curIdx = activeStages.findIndex(s => s.id === deal.stage_id)

  const update = async (patch, msg) => {
    const { error } = await supabase.from('sites').update(patch).eq('id', id)
    if (error) { toast(errMsg(error), 'error'); return false }
    toast(msg); await load(); return true
  }

  const saveEdit = async payload => {
    setSaving(true)
    delete payload.stage_id
    if (!isAdmin) delete payload.assigned_to
    const ok = await update(payload, 'Deal updated')
    setSaving(false)
    if (ok) setEditing(false)
  }

  const addComment = async e => {
    e.preventDefault()
    if (!comment.trim()) return
    const { error } = await supabase.from('site_comments').insert({ site_id: id, body: comment.trim(), author_id: profile.id })
    if (error) return toast(errMsg(error), 'error')
    setComment(''); load()
  }

  const remove = async () => {
    if (!window.confirm(`Delete ${deal.site_code} "${deal.name}" permanently? This also deletes its history and comments.`)) return
    const { error } = await supabase.from('sites').delete().eq('id', id)
    if (error) return toast(errMsg(error), 'error')
    toast('Deal deleted'); nav('/app/deals', { replace: true })
  }

  // merge stage changes + comments into one activity feed
  const feed = [
    ...history.map(h => ({ type: 'stage', at: h.changed_at, h })),
    ...comments.map(c => ({ type: 'comment', at: c.created_at, c })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))

  return (
    <div className="p-4 sm:p-6">
      <Link to="/app/deals" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Deals</Link>

      {/* Header */}
      <div className="card mb-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-slate-400">{deal.site_code}</p>
            <h1 className="text-2xl font-extrabold text-navy-900">{deal.name}</h1>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-3.5 w-3.5" />{[deal.address, deal.city, deal.pincode].filter(Boolean).join(', ')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StageBadge name={deal.stage_name} color={deal.stage_color} />
              <span className={`text-sm ${deal.is_overdue ? 'font-semibold text-red-600' : 'text-slate-600'}`}>
                {deal.is_overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                {daysLabel(deal.days_in_stage)} in stage{deal.stage_sla_days ? ` (SLA ${deal.stage_sla_days}d)` : ''}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {perm.canChangeStage && <button className="btn-primary" onClick={() => setStageModal({})}><ArrowRightLeft className="h-4 w-4" />Change stage</button>}
            {perm.canEdit && <button className="btn-secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</button>}
            <Link className="btn-secondary" to={`/app/planning?lat=${deal.latitude}&lng=${deal.longitude}&deal=${deal.id}`}><Radar className="h-4 w-4" />Feasibility</Link>
            {perm.canDelete && <button className="btn-ghost text-red-600" onClick={remove} title="Delete"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>

        {/* Stage path (HubSpot-style) */}
        {deal.stage_category !== 'dropped' ? (
          <div className="mt-4 flex overflow-x-auto pb-1">
            {activeStages.map((s, i) => {
              const done = i < curIdx, cur = i === curIdx
              return (
                <button key={s.id} disabled={!perm.canChangeStage || cur || (s.admin_only && !isAdmin)}
                  onClick={() => setStageModal({ preset: s.id })}
                  title={s.admin_only && !isAdmin ? 'Admin only' : `Move to ${s.name}`}
                  className={`relative flex min-w-[110px] flex-1 items-center justify-center gap-1 px-3 py-2 text-xs font-semibold transition first:rounded-l-lg last:rounded-r-lg
                    ${cur ? 'text-white' : done ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-500 enabled:hover:bg-slate-200'}`}
                  style={{ ...(cur ? { background: s.color } : {}), clipPath: i === activeStages.length - 1 ? undefined : 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)', marginRight: 2 }}>
                  {done && <Check className="h-3 w-3" />}{s.name}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <b>Dropped:</b> {deal.drop_reason}{deal.drop_notes ? ` — ${deal.drop_notes}` : ''}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: details */}
        <div className="space-y-4 lg:col-span-2">
          <InfoCard title="Site">
            <Info label="Site type" value={deal.site_type} />
            <Info label="Area" value={deal.area_sqft ? `${fmtNum(deal.area_sqft)} sq ft` : null} />
            <Info label="Coordinates" value={`${deal.latitude.toFixed(6)}, ${deal.longitude.toFixed(6)}`} />
            <Info label="Location source" value={`${deal.location_source}${deal.location_accuracy_m ? ` (±${deal.location_accuracy_m} m)` : ''}`} />
            <Info label="Observations" value={deal.observations} wide />
          </InfoCard>
          <InfoCard title="Landlord / contact">
            <Info label="Name" value={deal.landlord_name} />
            <Info label="Phone" value={deal.landlord_phone && <a className="inline-flex items-center gap-1 text-brand-700" href={`tel:${deal.landlord_phone}`}><Phone className="h-3.5 w-3.5" />{deal.landlord_phone}</a>} />
            <Info label="Email" value={deal.landlord_email && <a className="inline-flex items-center gap-1 text-brand-700" href={`mailto:${deal.landlord_email}`}><Mail className="h-3.5 w-3.5" />{deal.landlord_email}</a>} />
            <Info label="Notes" value={deal.landlord_notes} />
          </InfoCard>
          <InfoCard title="Commercials">
            <Info label="Rent expectation" value={deal.rent_expectation !== null ? `${fmtINR(deal.rent_expectation)} / month` : null} />
            <Info label="Deposit" value={deal.deposit_expectation !== null ? fmtINR(deal.deposit_expectation) : null} />
            <Info label="Negotiable" value={deal.rent_negotiable === null ? null : deal.rent_negotiable ? 'Yes' : 'No'} />
          </InfoCard>
          <InfoCard title="Electricity">
            <Info label="Connection available" value={deal.power_available === null ? null : deal.power_available ? 'Yes' : 'No'} />
            <Info label="Phase" value={deal.power_phase && (deal.power_phase === 'three' ? 'Three phase' : 'Single phase')} />
            <Info label="Sanctioned load" value={deal.sanctioned_load_kw !== null ? `${deal.sanctioned_load_kw} kW` : null} />
            <Info label="Feasibility" value={<Pill className={POWER_FEASIBILITY[deal.power_feasibility]?.cls}>{POWER_FEASIBILITY[deal.power_feasibility]?.label}</Pill>} />
            <Info label="Notes" value={deal.power_notes} wide />
          </InfoCard>
          {deal.remarks && <InfoCard title="Remarks"><Info value={deal.remarks} wide /></InfoCard>}

          {/* Activity */}
          <div className="card p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Activity</h3>
            <form onSubmit={addComment} className="mb-4 flex gap-2">
              <input className="input" placeholder="Add a comment or update…" value={comment} onChange={e => setComment(e.target.value)} />
              <button className="btn-primary" disabled={!comment.trim()}>Post</button>
            </form>
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {feed.map(item => item.type === 'stage' ? (
                <li key={'h' + item.h.id} className="relative">
                  <span className="absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2" style={{ '--tw-ring-color': item.h.to_stage_color }}><History className="h-2.5 w-2.5 text-slate-500" /></span>
                  <p className="text-sm">
                    <b>{item.h.changed_by_name || 'System'}</b>{' '}
                    {item.h.from_stage_name ? <>moved from <b>{item.h.from_stage_name}</b> to </> : <>created in </>}
                    <StageBadge name={item.h.to_stage_name} color={item.h.to_stage_color} />
                  </p>
                  <p className="text-xs text-slate-500">{fmtDateTime(item.h.changed_at)}{item.h.days_in_from_stage !== null && item.h.from_stage_name ? ` · ${fmtNum(item.h.days_in_from_stage, 1)} days in ${item.h.from_stage_name}` : ''}</p>
                  {item.h.drop_reason && <p className="mt-1 text-sm text-red-700">Reason: {item.h.drop_reason}</p>}
                  {item.h.note && <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{item.h.note}</p>}
                </li>
              ) : (
                <li key={'c' + item.c.id} className="relative">
                  <span className="absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-sky-400"><MessageSquare className="h-2.5 w-2.5 text-sky-500" /></span>
                  <p className="text-sm"><b>{item.c.author?.full_name || 'Someone'}</b> <span className="text-xs text-slate-500">{timeAgo(item.c.created_at)}</span></p>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-sky-50 px-3 py-2 text-sm text-slate-700">{item.c.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Right: map + meta */}
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="h-64"><BaseMap center={[deal.latitude, deal.longitude]} zoom={16}><Marker position={[deal.latitude, deal.longitude]} icon={pinIcon(deal.stage_color)} /></BaseMap></div>
            <a className="flex items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-sm font-semibold text-brand-700 hover:bg-slate-50" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${deal.latitude},${deal.longitude}`}>Open in Google Maps <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <div className="card space-y-3 p-4 text-sm">
            <Meta label="Owner">
              {perm.canReassign ? (
                <select className="input py-1" value={deal.assigned_to || ''} onChange={e => update({ assigned_to: e.target.value || null }, 'Owner updated')}>
                  <option value="">Unassigned</option>
                  {users.filter(u => u.is_active || u.id === deal.assigned_to).map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </select>
              ) : (deal.assigned_to_name || '—')}
            </Meta>
            <Meta label="Scouted by">{deal.created_by_name || '—'}</Meta>
            <Meta label="Created">{fmtDateTime(deal.created_at)}</Meta>
            <Meta label="In current stage since">{fmtDateTime(deal.stage_entered_at)}</Meta>
            <Meta label="Last updated">{fmtDateTime(deal.updated_at)}</Meta>
            <Meta label="Total age">{daysLabel((Date.now() - new Date(deal.created_at)) / 86400000)}</Meta>
          </div>
          <TimeInStages history={history} />
        </div>
      </div>

      <StageChangeModal open={!!stageModal} presetStageId={stageModal?.preset} onClose={() => setStageModal(null)} deal={deal}
        onSave={patch => update(patch, 'Stage updated')} />

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${deal.site_code}`} wide>
        {editing && <DealForm mode="edit" excludeId={deal.id} submitting={saving} onSubmit={saveEdit}
          initial={Object.fromEntries(Object.entries(deal).map(([k, v]) => [k, v ?? '']).concat([['rent_negotiable', deal.rent_negotiable], ['power_available', deal.power_available]]))}
          initialLoc={{ lat: deal.latitude, lng: deal.longitude, source: deal.location_source, accuracy: deal.location_accuracy_m }} />}
      </Modal>
    </div>
  )
}

function TimeInStages({ history }) {
  const rows = [...history].reverse().filter(h => h.from_stage_name)
  if (!rows.length) return null
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-bold text-slate-900">Time spent per stage</h3>
      <ul className="space-y-1.5 text-sm">
        {rows.map(h => (
          <li key={h.id} className="flex justify-between"><span className="text-slate-600">{h.from_stage_name}</span><span className="font-semibold">{fmtNum(h.days_in_from_stage, 1)} d</span></li>
        ))}
      </ul>
    </div>
  )
}

const InfoCard = ({ title, children }) => (
  <div className="card p-4 sm:p-5"><h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3><dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl></div>
)
const Info = ({ label, value, wide }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    {label && <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>}
    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{value === null || value === undefined || value === '' ? <span className="text-slate-300">—</span> : value}</dd>
  </div>
)
const Meta = ({ label, children }) => (<div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><div className="mt-0.5 text-slate-800">{children}</div></div>)
