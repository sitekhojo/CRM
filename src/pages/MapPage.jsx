import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleMarker, Circle, Tooltip as LTooltip } from 'react-leaflet'
import { useTargets, PRIORITIES, PRIORITY_KEYS, monthLabel } from '../lib/acquisition'
import { Map as MapIcon, List } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints } from '../lib/deals'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { BaseMap, DealMarkers, FitBounds } from '../components/maps'
import { PageLoader, StageBadge } from '../components/ui'
import { daysInt, stageAgeTone } from '../lib/format'
import { NETWORK_TYPES } from './Planning'
import { hasLoc } from '../lib/geo'

export default function MapPage() {
  const { deals, loading } = useDeals()
  const { user } = useAuth()
  const { stages = [] } = useConfig()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [view, setView] = useState('map')
  const [network, setNetwork] = useState([])
  const [showNet, setShowNet] = useState(() => new URLSearchParams(window.location.search).get('network') === '1')
  const [showTargets, setShowTargets] = useState(() => new URLSearchParams(window.location.search).get('targets') === '1')
  const [tPri, setTPri] = useState(PRIORITY_KEYS)
  const { targets } = useTargets()
  const fitTargets = new URLSearchParams(window.location.search).get('targets') === '1'

  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => {}) }, [])
  const rows = useMemo(() => (deals ? applyFilters(deals, filters, user?.id) : []), [deals, filters, user])
  const fitKey = `${filters.city.join()}|${filters.stage.join()}|${filters.recordType}|${filters.siteType.join()}|${rows.length}`

  if (loading) return <PageLoader />
  const counts = stages.map(s => ({ ...s, n: rows.filter(r => r.stage_id === s.id).length })).filter(s => s.n)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-slate-200 bg-white p-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-xl font-extrabold text-navy-900">Map</h1>
          <span className="text-sm text-slate-500">{rows.filter(hasLoc).length} sites on map{rows.some(r => !hasLoc(r)) ? ` · ${rows.filter(r => !hasLoc(r)).length} without location` : ''}</span>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-red-600" checked={showTargets} onChange={e => setShowTargets(e.target.checked)} />Priority locations{targets.length ? ` (${targets.length})` : ''}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={showNet} onChange={e => setShowNet(e.target.checked)} />Show network layers</label>
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            {[['map', MapIcon, 'Map'], ['list', List, 'List']].map(([v, Icon, l]) => (
              <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? 'bg-navy-900 text-white' : 'text-slate-600'}`}><Icon className="h-4 w-4" />{l}</button>
            ))}
          </div>
        </div>
        <DealFilters value={filters} onChange={setFilters} show={['q', 'region', 'city', 'owner', 'type', 'stage', 'siteType']} />
      </div>

      {view === 'map' ? (
        <div className="relative min-h-[420px] flex-1">
          <BaseMap>
            <FitBounds points={rows.filter(hasLoc).map(r => [r.latitude, r.longitude])} fitKey={fitKey} />
            {showNet && network.filter(p => !filters.siteType.length || p.point_type !== 'own_station' || filters.siteType.includes(p.site_type)).filter(p => !filters.city.length || filters.city.includes(p.city)).map(p => (
              <CircleMarker key={'n' + p.id} center={[p.latitude, p.longitude]} radius={5}
                pathOptions={{ color: NETWORK_TYPES[p.point_type].color, weight: 2, fillColor: '#fff', fillOpacity: 1 }}>
                <LTooltip>{NETWORK_TYPES[p.point_type].label}{p.site_type ? ` (${p.site_type})` : ''}: {p.name}{p.weight > 1 ? ` · ${p.weight} QIS` : ''}</LTooltip>
              </CircleMarker>
            ))}
            {showTargets && targets.filter(t => tPri.includes(t.priority) && (!filters.city.length || !t.city || filters.city.includes(t.city))).map(t => (
              <Circle key={'t' + t.id} center={[t.latitude, t.longitude]} radius={t.radius_m || 1000}
                pathOptions={{ color: PRIORITIES[t.priority].color, weight: 2, fillColor: PRIORITIES[t.priority].color, fillOpacity: 0.12, dashArray: '6 4' }}>
                <LTooltip>{t.priority} · {t.name}{t.city ? ` (${t.city})` : ''} · acquire by {monthLabel(t.target_month)}</LTooltip>
              </Circle>
            ))}
            {showTargets && targets.filter(t => tPri.includes(t.priority) && (!filters.city.length || !t.city || filters.city.includes(t.city))).map(t => (
              <CircleMarker key={'tc' + t.id} center={[t.latitude, t.longitude]} radius={6}
                pathOptions={{ color: PRIORITIES[t.priority].color, weight: 3, fillColor: '#fff', fillOpacity: 1 }}>
                <LTooltip>{t.priority} · {t.name}{t.city ? ` (${t.city})` : ''} · acquire by {monthLabel(t.target_month)}</LTooltip>
              </CircleMarker>
            ))}
            {showTargets && fitTargets && <FitBounds points={targets.filter(t => tPri.includes(t.priority)).map(t => [t.latitude, t.longitude])} fitKey={'targets' + targets.length + tPri.join()} />}
            <DealMarkers deals={rows} />
          </BaseMap>
          <div className="absolute bottom-3 left-3 z-[400] max-w-[calc(100%-24px)] rounded-xl bg-white/95 p-3 shadow-lg">
            {showTargets && targets.length > 0 && (<>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Priority locations</p>
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
                {PRIORITY_KEYS.filter(p => targets.some(t => t.priority === p)).map(p => (
                  <button key={p} onClick={() => setTPri(x => x.includes(p) ? x.filter(y => y !== p) : [...x, p])} className={`flex items-center gap-1.5 text-xs ${tPri.includes(p) ? '' : 'opacity-40'}`}>
                    <span className="h-3 w-3 rounded-full border-2 border-dashed" style={{ borderColor: PRIORITIES[p].color, background: PRIORITIES[p].color + '33' }} />{p} <b>{targets.filter(t => t.priority === p).length}</b>
                  </button>
                ))}
              </div>
            </>)}
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Stages</p>
            <div className="flex max-w-md flex-wrap gap-x-3 gap-y-1">
              {counts.map(s => (
                <button key={s.id} onClick={() => setFilters(f => ({ ...f, stage: f.stage.includes(String(s.id)) ? f.stage.filter(x => x !== String(s.id)) : [...f.stage, String(s.id)] }))} className="flex items-center gap-1.5 text-xs">
                  <span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: s.color }} />{s.name} <b>{s.n}</b>
                </button>
              ))}
              {counts.length === 0 && <span className="text-xs text-slate-400">No sites match</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map(d => (
              <Link key={d.id} to={`/app/deals/${d.id}`} className="card block p-4 transition hover:border-brand-500">
                <div className="flex justify-between gap-2"><b className="text-slate-900">{d.name}</b><span className="font-mono text-[10px] text-slate-400">{d.site_code}</span></div>
                <p className="text-xs text-slate-500">{d.city} · {hasLoc(d) ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}` : 'no location'}</p>
                <div className="mt-2 flex items-center justify-between"><StageBadge name={d.stage_name} color={d.stage_color} />
                  <span title="Days in stage" className={`rounded px-1.5 text-xs font-bold ${stageAgeTone(d.days_in_stage, d.stage_category).cls}`}>{daysInt(d.days_in_stage) ?? '—'}</span></div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
