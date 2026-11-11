import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Circle, CircleMarker, Marker, Tooltip as LTooltip, useMapEvents } from 'react-leaflet'
import { Plus, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { useDeals, fetchNetworkPoints } from '../lib/deals'
import { useConfig } from '../lib/config'
import { BaseMap, FitBounds, pinIcon, DealMarkers, LocationPicker } from '../components/maps'
import { PageLoader, StageBadge } from '../components/ui'
import { evaluateFeasibility, validLatLng, VERDICT, haversine } from '../lib/geo'
import { fmtDist, fmtNum } from '../lib/format'

export const NETWORK_TYPES = {
  own_station: { label: 'Own station', color: '#16a34a' },
  competitor: { label: 'Competitor', color: '#dc2626' },
  demand_hotspot: { label: 'Demand hotspot', color: '#2563eb' },
  restricted: { label: 'Restricted zone', color: '#111827' },
}
const ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle, info: Info }
const ICON_CLS = { pass: 'text-emerald-600', warn: 'text-amber-500', fail: 'text-red-600', info: 'text-slate-400' }

export default function Planning() {
  const { deals, loading } = useDeals()
  const { rules } = useConfig()
  const [params] = useSearchParams()
  const [network, setNetwork] = useState(null)
  const lat0 = parseFloat(params.get('lat')), lng0 = parseFloat(params.get('lng'))
  const [loc, setLoc] = useState(validLatLng(lat0, lng0) ? { lat: lat0, lng: lng0, source: 'link' } : { lat: null, lng: null })
  const excludeId = params.get('deal') || undefined

  useEffect(() => { fetchNetworkPoints().then(setNetwork).catch(() => setNetwork([])) }, [])
  const has = validLatLng(loc.lat, loc.lng)
  const res = useMemo(() => (has && deals && network && rules) ? evaluateFeasibility(loc, deals, network, rules, excludeId) : null, [has, loc, deals, network, rules, excludeId])

  if (loading || !network || !rules) return <PageLoader />

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-extrabold text-navy-900">Network Planning</h1>
      <p className="mb-4 text-sm text-slate-500">Enter any location to check whether it fits the network. Rules and reference data are managed by admins under Settings.</p>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold">Location to check</h3>
            <LocationPicker value={loc} onChange={setLoc} height="h-56" />
          </div>
          {res && (
            <div className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verdict</p>
                  <span className={`mt-1 inline-block rounded-lg border px-3 py-1 text-lg font-extrabold ${VERDICT[res.verdict].cls}`}>{VERDICT[res.verdict].label}</span>
                </div>
                {res.score !== null && <div className="text-right"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Score</p><p className="text-3xl font-extrabold text-navy-900">{res.score}<span className="text-base text-slate-400">/100</span></p></div>}
              </div>
              <ul className="mt-4 space-y-3">
                {res.checks.map(c => { const I = ICON[c.status]; return (
                  <li key={c.key} className="flex gap-2.5"><I className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${ICON_CLS[c.status]}`} />
                    <div><p className="text-sm font-semibold">{c.label}</p><p className="text-sm text-slate-600">{c.detail}</p></div></li>
                ) })}
              </ul>
              <Link to={`/app/deals/new?lat=${loc.lat}&lng=${loc.lng}`} className="btn-primary mt-4 w-full"><Plus className="h-4 w-4" />Create deal at this location</Link>
            </div>
          )}
        </div>

        <div className="space-y-4 xl:col-span-3">
          <div className="card h-[460px] overflow-hidden">
            <BaseMap>
              <PickOnMap onPick={(lat, lng) => setLoc({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), source: 'map' })} />
              {has && <>
                <FitBounds points={[[loc.lat, loc.lng]]} fitKey={`${loc.lat},${loc.lng}`} maxZoom={14} />
                <Circle center={[loc.lat, loc.lng]} radius={rules.search_radius_m} pathOptions={{ color: '#64748b', weight: 1, dashArray: '4 6', fillOpacity: 0.03 }} />
                <Circle center={[loc.lat, loc.lng]} radius={rules.min_distance_own_station_m} pathOptions={{ color: '#16a34a', weight: 1.5, fillOpacity: 0.06 }} />
                <Marker position={[loc.lat, loc.lng]} icon={pinIcon('#0f1f33')} />
              </>}
              {network.map(p => (
                <CircleMarker key={'n' + p.id} center={[p.latitude, p.longitude]} radius={6}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: NETWORK_TYPES[p.point_type].color, fillOpacity: 0.9 }}>
                  <LTooltip>{NETWORK_TYPES[p.point_type].label}{p.site_type ? ` (${p.site_type})` : ''}: {p.name}{p.weight > 1 ? ` · ${fmtNum(p.weight)} QIS` : ''}{has ? ` · ${fmtDist(distanceTo(loc, p))}` : ''}</LTooltip>
                </CircleMarker>
              ))}
              {res && <DealMarkers deals={res.nearby.pipeline} radius={6} />}
            </BaseMap>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            {Object.entries(NETWORK_TYPES).map(([k, t]) => <span key={k} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: t.color }} />{t.label}</span>)}
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-green-600 bg-green-100" />Min-distance ring ({fmtDist(rules.min_distance_own_station_m)})</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-dashed border-slate-500" />Search radius ({fmtDist(rules.search_radius_m)})</span>
          </div>

          {res && (
            <div className="card overflow-x-auto p-4">
              <h3 className="mb-2 text-sm font-bold">Within {fmtDist(rules.search_radius_m)}</h3>
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-100"><th className="th">Type</th><th className="th">Name</th><th className="th text-right">Distance</th></tr></thead>
                <tbody>
                  {[...res.nearby.own.map(x => ({ ...x, t: 'own_station' })), ...res.nearby.competitors.map(x => ({ ...x, t: 'competitor' })),
                    ...res.nearby.demand.map(x => ({ ...x, t: 'demand_hotspot' })), ...res.nearby.restricted.map(x => ({ ...x, t: 'restricted' })),
                    ...res.nearby.pipeline.map(x => ({ ...x, t: 'deal' }))]
                    .sort((a, b) => a.distance - b.distance).slice(0, 40).map(x => (
                      <tr key={x.t + (x.id)} className="border-b border-slate-50">
                        <td className="td">{x.t === 'deal' ? <StageBadge name={x.stage_name} color={x.stage_color} /> : <span className="font-semibold" style={{ color: NETWORK_TYPES[x.t].color }}>{NETWORK_TYPES[x.t].label}</span>}</td>
                        <td className="td">{x.t === 'deal' ? <Link className="text-brand-700 hover:underline" to={`/app/deals/${x.id}`}>{x.site_code} · {x.name}</Link> : x.name}</td>
                        <td className="td text-right font-semibold">{fmtDist(x.distance)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {Object.values(res.nearby).every(a => a.length === 0) && <p className="py-3 text-center text-sm text-slate-400">Nothing nearby</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PickOnMap({ onPick }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}
const distanceTo = (a, p) => haversine(a.lat, a.lng, p.latitude, p.longitude)
