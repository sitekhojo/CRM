import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crosshair, Loader2, MapPin, RefreshCw, Search, X, CheckCircle2 } from 'lucide-react'
import { useDeals } from '../lib/deals'
import { useConfig, ownerOptions } from '../lib/config'
import { supabase, errMsg } from '../lib/supabase'
import { haversine, hasLoc } from '../lib/geo'
import { SITE_TYPES, fmtDist } from '../lib/format'
import { VISIT_TYPES, VISIT_TYPE_KEYS, NO_LEAD_REASONS, getGps, fmtTime, istDay, fetchVisits } from '../lib/visits'
import { useToast } from '../components/ui'

const LS = { member: 'sk_visit_member', city: 'sk_visit_city' }
const ls = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }
const NEARBY_M = 300
const WEAK_GPS_M = 100

export default function LogVisit() {
  const { deals, reload } = useDeals()
  const { team = [], cities = [] } = useConfig()
  const toast = useToast()
  const [member, setMember] = useState(ls(LS.member))
  const [gps, setGps] = useState(null)
  const [gpsErr, setGpsErr] = useState('')
  const [locating, setLocating] = useState(false)
  const [type, setType] = useState('new_site')
  const [site, setSite] = useState(null)
  const [q, setQ] = useState('')
  const [newSite, setNewSite] = useState({ name: '', city: ls(LS.city), site_type: '' })
  const [remarks, setRemarks] = useState('')
  const [noLead, setNoLead] = useState(false)
  const [noLeadReason, setNoLeadReason] = useState(NO_LEAD_REASONS[0])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  const [today, setToday] = useState([])

  const locate = async () => {
    setLocating(true); setGpsErr('')
    try { setGps(await getGps()) } catch (e) { setGps(null); setGpsErr(e.message) } finally { setLocating(false) }
  }
  useEffect(() => { locate() }, [])
  const loadToday = () => member && fetchVisits(istDay(), istDay()).then(v => setToday(v.filter(x => x.member === member))).catch(() => {})
  useEffect(() => { loadToday() }, [member]) // eslint-disable-line

  const open = useMemo(() => (deals || []).filter(d => d.stage_category !== 'dropped'), [deals])
  const nearby = useMemo(() => !gps ? [] : open.filter(hasLoc)
    .map(d => ({ ...d, dist: haversine(gps.lat, gps.lng, d.latitude, d.longitude) }))
    .filter(d => d.dist <= NEARBY_M).sort((a, b) => a.dist - b.dist).slice(0, 4), [open, gps])
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    return open.filter(d => [d.site_code, d.name, d.address, d.city, d.landlord_name].some(v => v && String(v).toLowerCase().includes(s))).slice(0, 8)
  }, [open, q])

  const newNoSite = type === 'new_site' && !site
  const autoLead = newNoSite && !noLead
  const members = ownerOptions(team.filter(t => t.is_active), null)

  const save = async () => {
    setErr('')
    if (!member) return setErr('Pick your name first')
    if (!gps) return setErr('Capture your GPS location first')
    if (autoLead && !newSite.name.trim()) return setErr('Give the new site a name')
    if (autoLead && !newSite.city) return setErr('Pick the city')
    setBusy(true)
    const { data, error } = await supabase.rpc('log_site_visit', {
      p_member: member, p_lat: gps.lat, p_lng: gps.lng, p_accuracy: gps.accuracy, p_type: type,
      p_site: site?.id || null, p_remarks: remarks || null,
      p_new_name: autoLead ? newSite.name : null, p_new_city: autoLead ? newSite.city : null, p_new_site_type: autoLead ? newSite.site_type : null,
      p_no_lead_reason: newNoSite && noLead ? noLeadReason : null,
    })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    lsSet(LS.member, member)
    if (autoLead) lsSet(LS.city, newSite.city)
    setDone(data)
    toast(data.lead_created ? `Visit saved · lead ${data.site_code} created` : 'Visit saved')
    setNoLead(false)
    setSite(null); setQ(''); setRemarks(''); setNewSite(s => ({ ...s, name: '', site_type: '' })); setGps(null)
    loadToday(); if (data.lead_created) reload?.()
  }

  const chip = (on, label, onClick) => (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600'}`}>{label}</button>
  )

  return (
    <div className="mx-auto max-w-md p-4 pb-10">
      <h1 className="text-xl font-extrabold text-navy-900">Log visit</h1>
      <p className="mb-4 text-sm text-slate-500">Log every location you visit, at the location. Time and GPS are captured automatically.</p>

      {done && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">Visit saved.{done.lead_created && <> New lead <Link className="font-bold underline" to={`/app/deals/${done.site_id}`}>{done.site_code}</Link> created. Add landlord and rent details there when you can.</>}</div>
          <button onClick={() => { setDone(null); locate() }} className="text-emerald-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Who are you</label>
          <select className="input" value={member} onChange={e => setMember(e.target.value)}>
            <option value="">Pick your name…</option>
            {members.map(g => <optgroup key={g.region} label={g.region}>{g.members.map(t => <option key={t.name}>{t.name}</option>)}</optgroup>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Location (GPS)</label>
          {gps ? (
            <div className={`rounded-xl border p-3 ${gps.accuracy > WEAK_GPS_M ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <div className="flex items-center gap-2">
                <MapPin className={`h-5 w-5 ${gps.accuracy > WEAK_GPS_M ? 'text-amber-600' : 'text-emerald-600'}`} />
                <span className={`font-semibold ${gps.accuracy > WEAK_GPS_M ? 'text-amber-800' : 'text-emerald-800'}`}>{gps.accuracy > WEAK_GPS_M ? 'Weak GPS signal' : 'Location captured'}</span>
                <button className="ml-auto flex items-center gap-1 text-xs font-semibold text-slate-600" onClick={locate} disabled={locating}><RefreshCw className={`h-3.5 w-3.5 ${locating ? 'animate-spin' : ''}`} />Refresh</button>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-600">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · ±{gps.accuracy} m</p>
              {gps.accuracy > WEAK_GPS_M && <p className="mt-1 text-xs text-amber-700">Step into the open and tap Refresh for a better fix.</p>}
            </div>
          ) : (
            <button type="button" onClick={locate} disabled={locating} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-400 bg-brand-50 p-4 font-semibold text-brand-700">
              {locating ? <><Loader2 className="h-5 w-5 animate-spin" />Reading GPS…</> : <><Crosshair className="h-5 w-5" />Use my location</>}
            </button>
          )}
          {gpsErr && <p className="mt-1 text-xs text-red-600">{gpsErr}</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Visit type</label>
          <div className="flex flex-wrap gap-2">{VISIT_TYPE_KEYS.map(k => chip(type === k, VISIT_TYPES[k].label, () => setType(k)))}</div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Linked lead / deal {autoLead ? '(leave empty to create a new lead)' : '(optional)'}</label>
          {site ? (
            <div className="flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm">
              <span className="font-mono text-xs text-slate-500">{site.site_code}</span>
              <span className="flex-1 truncate font-semibold">{site.name}</span>
              <span className="text-xs text-slate-500">{site.record_type === 'lead' ? 'Lead' : 'Deal'} · {site.stage_name}</span>
              <button onClick={() => setSite(null)} className="text-slate-500" aria-label="Remove"><X className="h-4 w-4" /></button>
            </div>
          ) : <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Search name or SK code" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {matches.length > 0 && (
              <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
                {matches.map(d => <li key={d.id}><button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setSite(d); setQ('') }}>
                  <span className="font-mono text-xs text-slate-400">{d.site_code}</span><span className="flex-1 truncate">{d.name}</span><span className="text-xs text-slate-500">{d.city}</span></button></li>)}
              </ul>
            )}
            {nearby.length > 0 && (
              <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
                <p className="mb-1 font-semibold text-slate-500">Already in SiteKhojo nearby</p>
                {nearby.map(d => <button key={d.id} onClick={() => setSite(d)} className="block w-full truncate py-0.5 text-left text-brand-700">
                  {d.site_code} · {d.name} · {fmtDist(d.dist)}</button>)}
              </div>
            )}
          </>}
        </div>

        {newNoSite && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-sm"><span className="font-semibold text-slate-800">Don't create a lead yet</span><span className="block text-xs text-slate-500">Owner details not available, still in discussion, etc.</span></span>
            <button type="button" role="switch" aria-checked={noLead} onClick={() => setNoLead(v => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${noLead ? 'bg-brand-600' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${noLead ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </label>
        )}
        {newNoSite && noLead && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Reason</label>
            <div className="flex flex-wrap gap-2">{NO_LEAD_REASONS.map(r => chip(noLeadReason === r, r, () => setNoLeadReason(r)))}</div>
            <p className="mt-1 text-xs text-slate-500">The visit is saved with its GPS point. Create the lead later from the site, or link it on your next visit.</p>
          </div>
        )}
        {autoLead && (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <p className="text-xs font-semibold text-emerald-800">A new lead will be created at this GPS point, with you as owner</p>
            <input className="input" placeholder="Site name, e.g. HP pump Sector 62" value={newSite.name} onChange={e => setNewSite({ ...newSite, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={newSite.city} onChange={e => setNewSite({ ...newSite, city: e.target.value })}>
                <option value="">City…</option>
                {cities.filter(c => c.is_active).map(c => <option key={c.id}>{c.name}</option>)}
              </select>
              <select className="input" value={newSite.site_type} onChange={e => setNewSite({ ...newSite, site_type: e.target.value })}>
                <option value="">Site type…</option>
                {SITE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
          <textarea className="input min-h-[70px]" placeholder="Owner wants 45k rent, meeting Thursday" value={remarks} onChange={e => setRemarks(e.target.value)} />
        </div>

        {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
        <button className="btn-primary w-full justify-center py-3 text-base" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save visit'}</button>
        <p className="text-center text-xs text-slate-400">Time is stamped automatically</p>
      </div>

      {member && today.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold text-slate-700">Your visits today ({today.length})</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {today.slice().reverse().map(v => {
              const s = v.site_id && (deals || []).find(d => d.id === v.site_id)
              return <li key={v.id} className="px-3 py-2">
                <span className="text-xs text-slate-400">{fmtTime(v.visited_at)}</span> · <span className="font-semibold">{VISIT_TYPES[v.visit_type]?.label}</span>
                {s && <> · <Link className="text-brand-700" to={`/app/deals/${s.id}`}>{s.site_code}</Link></>}
                {v.remarks && <div className="text-xs text-slate-500">{v.remarks}</div>}
              </li>
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
