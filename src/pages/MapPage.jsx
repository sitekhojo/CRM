import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleMarker, Tooltip as LTooltip } from 'react-leaflet'
import { Map as MapIcon, List } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS, fetchNetworkPoints } from '../lib/deals'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { BaseMap, DealMarkers, FitBounds } from '../components/maps'
import { PageLoader, StageBadge } from '../components/ui'
import { daysLabel } from '../lib/format'
import { NETWORK_TYPES } from './Planning'

export default function MapPage() {
  const { deals, loading } = useDeals()
  const { user } = useAuth()
  const { stages = [] } = useConfig()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [view, setView] = useState('map')
  const [network, setNetwork] = useState([])
  const [showNet, setShowNet] = useState(() => new URLSearchParams(window.location.search).get('network') === '1')

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
          <span className="text-sm text-slate-500">{rows.length} sites</span>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={showNet} onChange={e => setShowNet(e.target.checked)} />Show network layers</label>
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            {[['map', MapIcon, 'Map'], ['list', List, 'List']].map(([v, Icon, l]) => (
              <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? 'bg-navy-900 text-white' : 'text-slate-600'}`}><Icon className="h-4 w-4" />{l}</button>
            ))}
          </div>
        </div>
        <DealFilters value={filters} onChange={setFilters} show={['q', 'city', 'type', 'stage', 'siteType', 'overdue']} />
      </div>

      {view === 'map' ? (
        <div className="relative min-h-[420px] flex-1">
          <BaseMap>
            <FitBounds points={rows.map(r => [r.latitude, r.longitude])} fitKey={fitKey} />
            {showNet && network.filter(p => !filters.siteType.length || p.point_type !== 'own_station' || filters.siteType.includes(p.site_type)).filter(p => !filters.city.length || filters.city.includes(p.city)).map(p => (
              <CircleMarker key={'n' + p.id} center={[p.latitude, p.longitude]} radius={5}
                pathOptions={{ color: NETWORK_TYPES[p.point_type].color, weight: 2, fillColor: '#fff', fillOpacity: 1 }}>
                <LTooltip>{NETWORK_TYPES[p.point_type].label}{p.site_type ? ` (${p.site_type})` : ''}: {p.name}{p.weight > 1 ? ` · ${p.weight} QIS` : ''}</LTooltip>
              </CircleMarker>
            ))}
            <DealMarkers deals={rows} />
          </BaseMap>
          <div className="absolute bottom-3 left-3 z-[400] max-w-[calc(100%-24px)] rounded-xl bg-white/95 p-3 shadow-lg">
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
                <p className="text-xs text-slate-500">{d.city} · {d.latitude.toFixed(5)}, {d.longitude.toFixed(5)}</p>
                <div className="mt-2 flex items-center justify-between"><StageBadge name={d.stage_name} color={d.stage_color} />
                  <span className={`text-xs font-semibold ${d.is_overdue ? 'text-red-600' : 'text-slate-500'}`}>{daysLabel(d.days_in_stage)}</span></div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
