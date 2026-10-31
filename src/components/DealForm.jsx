import { useEffect, useMemo, useState } from 'react'
import { useConfig, stagesFor } from '../lib/config'
import { useAuth } from '../lib/auth'
import { Field } from './ui'
import { LocationPicker, DealMarkers } from './maps'
import { SITE_TYPES } from '../lib/format'
import { evaluateFeasibility, validLatLng, VERDICT } from '../lib/geo'
import { fetchDeals, fetchNetworkPoints } from '../lib/deals'

export const blankDeal = {
  name: '', address: '', city: '', pincode: '', site_type: '', area_sqft: '',
  landlord_name: '', landlord_phone: '', landlord_email: '', landlord_notes: '',
  rent_expectation: '', deposit_expectation: '', rent_negotiable: null, observations: '',
  power_available: null, power_phase: '', sanctioned_load_kw: '', power_feasibility: 'unknown', power_notes: '',
  remarks: '', stage_id: '', assigned_to: '', record_type: 'deal',
}

const NUMS = ['area_sqft', 'rent_expectation', 'deposit_expectation', 'sanctioned_load_kw']

/** Convert form state into a DB payload. */
export function toPayload(f, loc) {
  const p = Object.fromEntries(Object.keys(blankDeal).map(k => [k, f[k] ?? blankDeal[k]]))
  for (const k of NUMS) p[k] = p[k] === '' || p[k] === null ? null : Number(p[k])
  for (const k of ['power_phase', 'site_type', 'pincode', 'landlord_email', 'assigned_to']) if (p[k] === '') p[k] = null
  p.stage_id = p.stage_id ? Number(p.stage_id) : null
  p.record_type = p.record_type === 'lead' ? 'lead' : 'deal'
  if (loc) { p.latitude = loc.lat; p.longitude = loc.lng; p.location_source = loc.source || 'manual'; p.location_accuracy_m = loc.accuracy ?? null }
  return p
}

function Section({ title, desc, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {desc && <p className="mb-3 text-xs text-slate-500">{desc}</p>}
      <div className={desc ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

function YesNo({ value, onChange }) {
  const opt = (v, l) => (
    <button type="button" onClick={() => onChange(value === v ? null : v)}
      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${value === v ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600'}`}>{l}</button>
  )
  return <div className="flex gap-2">{opt(true, 'Yes')}{opt(false, 'No')}</div>
}

export default function DealForm({ initial, initialLoc, onSubmit, submitting, mode = 'create', excludeId, submitLabel }) {
  const { stages = [], cities = [], users = [], rules } = useConfig()
  const { isAdmin } = useAuth()
  const [f, setF] = useState({ ...blankDeal, ...initial })
  const [loc, setLoc] = useState(initialLoc || { lat: null, lng: null, source: 'gps' })
  const [ctx, setCtx] = useState(null) // deals + network for live feasibility check
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  useEffect(() => { Promise.all([fetchDeals(), fetchNetworkPoints()]).then(([d, n]) => setCtx({ deals: d, network: n })).catch(() => {}) }, [])

  const startStages = stagesFor(stages, f.site_type).filter(s => (isAdmin || !s.admin_only) && s.category !== 'dropped')
  useEffect(() => {
    if (mode !== 'create' || !startStages.length) return
    if (!startStages.some(s => String(s.id) === String(f.stage_id))) set('stage_id', startStages[0].id)
  }, [stages, f.site_type]) // eslint-disable-line

  const check = useMemo(() => (ctx && rules && validLatLng(loc.lat, loc.lng))
    ? evaluateFeasibility({ lat: loc.lat, lng: loc.lng }, ctx.deals, ctx.network, rules, excludeId) : null, [ctx, rules, loc, excludeId])

  const submit = e => {
    e.preventDefault()
    onSubmit(toPayload(f, loc))
  }
  const locOk = validLatLng(loc.lat, loc.lng)

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section title="1. Location" desc="Pin the exact spot — GPS when you're on site, or tap the map / paste coordinates.">
        <LocationPicker value={loc} onChange={setLoc}>
          {check && <DealMarkers deals={check.nearby.pipeline.slice(0, 50)} radius={6} />}
        </LocationPicker>
        {check && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${VERDICT[check.verdict].cls}`}>
            <b>Network check: {VERDICT[check.verdict].label}</b>
            {check.checks.filter(c => c.status === 'fail' || c.status === 'warn').map(c => <div key={c.key} className="text-xs">• {c.detail}</div>)}
          </div>
        )}
      </Section>

      <Section title="2. Site details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Site name *" className="sm:col-span-2"><input className="input" required value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. HP Petrol Pump, Sohna Road" /></Field>
          <Field label="Address" className="sm:col-span-2"><textarea className="input" rows={2} value={f.address || ''} onChange={e => set('address', e.target.value)} /></Field>
          <Field label="City *">
            <select className="input" required value={f.city} onChange={e => set('city', e.target.value)}>
              <option value="">Select city</option>
              {cities.filter(c => c.is_active || c.name === f.city).map(c => <option key={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Pincode"><input className="input" inputMode="numeric" pattern="[0-9]{6}" title="6-digit pincode" value={f.pincode || ''} onChange={e => set('pincode', e.target.value)} /></Field>
          <Field label="Site type *" hint="Decides which pipeline stages apply">
            <select className="input" required value={f.site_type || ''} onChange={e => set('site_type', e.target.value)}>
              <option value="">Select</option>{SITE_TYPES.map(t => <option key={t}>{t}</option>)}
              {f.site_type && !SITE_TYPES.includes(f.site_type) && <option>{f.site_type}</option>}
            </select>
          </Field>
          {mode === 'edit' && (
            <Field label="Lead / Deal">
              <select className="input" value={f.record_type || 'deal'} onChange={e => set('record_type', e.target.value)}>
                <option value="lead">Lead</option><option value="deal">Deal</option>
              </select>
            </Field>
          )}
          <Field label="Usable area (sq ft)"><input className="input" type="number" min="0" value={f.area_sqft ?? ''} onChange={e => set('area_sqft', e.target.value)} /></Field>
          {mode === 'create' && (
            <Field label="Starting stage">
              <select className="input" value={f.stage_id} onChange={e => set('stage_id', e.target.value)}>
                {startStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {isAdmin && (
            <Field label="Deal owner">
              <select className="input" value={f.assigned_to || ''} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">{mode === 'create' ? 'Me' : 'Unassigned'}</option>
                {users.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </Field>
          )}
        </div>
      </Section>

      <Section title="3. Landlord / contact">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><input className="input" value={f.landlord_name || ''} onChange={e => set('landlord_name', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" type="tel" value={f.landlord_phone || ''} onChange={e => set('landlord_phone', e.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.landlord_email || ''} onChange={e => set('landlord_email', e.target.value)} /></Field>
          <Field label="Contact notes" className="sm:col-span-3"><input className="input" value={f.landlord_notes || ''} onChange={e => set('landlord_notes', e.target.value)} placeholder="Best time to call, decision maker, broker…" /></Field>
        </div>
      </Section>

      <Section title="4. Commercials">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Rent expectation (₹ / month)"><input className="input" type="number" min="0" value={f.rent_expectation ?? ''} onChange={e => set('rent_expectation', e.target.value)} /></Field>
          <Field label="Security deposit (₹)"><input className="input" type="number" min="0" value={f.deposit_expectation ?? ''} onChange={e => set('deposit_expectation', e.target.value)} /></Field>
          <Field label="Rent negotiable?"><YesNo value={f.rent_negotiable} onChange={v => set('rent_negotiable', v)} /></Field>
          <Field label="Site observations" className="sm:col-span-3"><textarea className="input" rows={3} value={f.observations || ''} onChange={e => set('observations', e.target.value)} placeholder="Footfall, visibility, access for 2W/3W, parking, nearby EV fleets…" /></Field>
        </div>
      </Section>

      <Section title="5. Electricity">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Power connection available?"><YesNo value={f.power_available} onChange={v => set('power_available', v)} /></Field>
          <Field label="Phase">
            <select className="input" value={f.power_phase || ''} onChange={e => set('power_phase', e.target.value)}>
              <option value="">Unknown</option><option value="single">Single phase</option><option value="three">Three phase</option>
            </select>
          </Field>
          <Field label="Sanctioned load (kW)"><input className="input" type="number" min="0" step="any" value={f.sanctioned_load_kw ?? ''} onChange={e => set('sanctioned_load_kw', e.target.value)} /></Field>
          <Field label="Feasibility">
            <select className="input" value={f.power_feasibility} onChange={e => set('power_feasibility', e.target.value)}>
              <option value="unknown">Unknown</option><option value="feasible">Feasible</option>
              <option value="upgrade_required">Upgrade required</option><option value="not_feasible">Not feasible</option>
            </select>
          </Field>
          <Field label="Power notes" className="sm:col-span-2"><input className="input" value={f.power_notes || ''} onChange={e => set('power_notes', e.target.value)} placeholder="DISCOM, meter location, transformer distance…" /></Field>
        </div>
      </Section>

      <Section title="6. Remarks">
        <textarea className="input" rows={3} value={f.remarks || ''} onChange={e => set('remarks', e.target.value)} />
      </Section>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        {!locOk && <span className="mr-auto self-center text-sm text-amber-600">Pin the location to continue</span>}
        <button className="btn-primary min-w-32" disabled={submitting || !locOk}>{submitting ? 'Saving…' : mode === 'create' ? (submitLabel || 'Create deal') : 'Save changes'}</button>
      </div>
    </form>
  )
}
