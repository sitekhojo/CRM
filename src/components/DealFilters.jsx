import { X } from 'lucide-react'
import { useConfig, stagesFor, REGIONS } from '../lib/config'
import { EMPTY_FILTERS } from '../lib/deals'
import { SITE_TYPES } from '../lib/format'
import MultiSelect, { SingleSelect } from './MultiSelect'

/** Shared filter bar: search, region, city, owner, lead/deal, stage, site type, date range. */
export default function DealFilters({ value, onChange, show = ['q', 'region', 'city', 'owner', 'type', 'stage', 'siteType', 'date'], extra, prefix, qPlaceholder = 'Search…' }) {
  const { cities = [], stages = [], team = [] } = useConfig()
  const cityOpts = cities.filter(c => c.is_active && (!value.region?.length || value.region.includes(c.region)))
  const ownerOpts = team.filter(t => t.is_active && (!value.region?.length || value.region.includes(t.region)))
  const set = (k, v) => onChange({ ...value, [k]: v })
  const active = Object.entries(value).some(([k, v]) => !(k === 'recordType' && !show.includes('type')) && (Array.isArray(v) ? v.length > 0 : !!v && v !== EMPTY_FILTERS[k]))
  return (
    <div className="flex flex-wrap items-end gap-2">
      {prefix}
      {show.includes('q') && <input className="input w-full sm:w-56" placeholder={qPlaceholder} value={value.q} onChange={e => set('q', e.target.value)} />}
      {show.includes('region') && (
        <MultiSelect allLabel="All regions" noun="regions" value={value.region || []} onChange={v => set('region', v)}
          options={REGIONS.map(r => ({ value: r, label: r }))} />
      )}
      {show.includes('city') && (
        <MultiSelect allLabel="All cities" noun="cities" value={value.city} onChange={v => set('city', v)}
          options={cityOpts.map(c => ({ value: c.name, label: c.name }))} />
      )}
      {show.includes('owner') && (
        <MultiSelect allLabel="All owners" noun="owners" value={value.owner || []} onChange={v => set('owner', v)}
          options={ownerOpts.map(t => ({ value: t.name, label: `${t.name} · ${t.region}` }))} />
      )}
      {show.includes('type') && (
        <SingleSelect value={value.recordType} onChange={v => set('recordType', v)}
          options={[{ value: '', label: 'Leads & deals' }, { value: 'lead', label: 'Leads only' }, { value: 'deal', label: 'Deals only' }]} />
      )}
      {show.includes('stage') && (
        <MultiSelect allLabel="All stages" noun="stages" value={value.stage} onChange={v => set('stage', v)}
          options={stagesFor(stages, value.siteType).map(s => ({ value: String(s.id), label: s.name, color: s.color }))} />
      )}
      {show.includes('siteType') && (
        <MultiSelect allLabel="All site types" noun="site types" value={value.siteType} onChange={v => set('siteType', v)}
          options={SITE_TYPES.map(t => ({ value: t, label: t }))} />
      )}
      {show.includes('format') && (
        <SingleSelect value={value.format || ''} onChange={v => set('format', v)}
          options={[{ value: '', label: 'Open & closed' }, { value: 'open', label: 'Open sites' }, { value: 'closed', label: 'Closed sites' }, { value: 'none', label: 'Format not set' }]} />
      )}
      {show.includes('date') && (
        <div className="flex items-center gap-1">
          <input type="date" className="input w-auto" value={value.from} onChange={e => set('from', e.target.value)} title="Created from" />
          <span className="text-slate-400">–</span>
          <input type="date" className="input w-auto" value={value.to} onChange={e => set('to', e.target.value)} title="Created to" />
        </div>
      )}
      {extra}
      {active && <button className="btn-ghost" onClick={() => onChange(EMPTY_FILTERS)}><X className="h-4 w-4" />Clear</button>}
    </div>
  )
}
