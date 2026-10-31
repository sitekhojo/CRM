import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap, useMapEvents, LayersControl } from 'react-leaflet'
import L from 'leaflet'
import { Link } from 'react-router-dom'
import { Crosshair, Loader2 } from 'lucide-react'
import { StageBadge } from './ui'
import { daysLabel, fmtINR } from '../lib/format'
import { parseLatLng, validLatLng, hasLoc } from '../lib/geo'

export const INDIA_CENTER = [22.5, 79]

export function BaseMap({ center = INDIA_CENTER, zoom = 5, className = 'h-full w-full', children }) {
  return (
    <MapContainer center={center} zoom={zoom} className={className} scrollWheelZoom>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Streets">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Light">
          <TileLayer attribution='&copy; OpenStreetMap &copy; CARTO' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" maxZoom={19} />
        </LayersControl.BaseLayer>
      </LayersControl>
      {children}
    </MapContainer>
  )
}

/** Zoom the map to fit a set of [lat,lng] points whenever `key` changes. */
export function FitBounds({ points, fitKey, maxZoom = 15 }) {
  const map = useMap()
  useEffect(() => {
    if (!points?.length) return
    if (points.length === 1) map.setView(points[0], Math.min(maxZoom, 15))
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])
  return null
}

export function DealPopup({ d }) {
  return (
    <div className="min-w-[220px] space-y-1.5 text-sm">
      <div className="text-xs font-semibold text-slate-400">{d.site_code}</div>
      <div className="font-bold text-slate-900">{d.name}</div>
      <StageBadge name={d.stage_name} color={d.stage_color} />
      <div className="text-xs text-slate-600">{d.address || d.city}{d.pincode ? ` · ${d.pincode}` : ''}</div>
      <div className="grid grid-cols-2 gap-x-3 text-xs text-slate-600">
        <span>Days in stage</span><span className={`font-semibold ${d.is_overdue ? 'text-red-600' : ''}`}>{daysLabel(d.days_in_stage)}</span>
        <span>Rent</span><span className="font-semibold">{fmtINR(d.rent_expectation)}</span>
        <span>Owner</span><span className="font-semibold">{d.assigned_to_name || '—'}</span>
      </div>
      <Link to={`/app/deals/${d.id}`} className="mt-1 inline-block font-semibold !text-brand-700">Open deal →</Link>
    </div>
  )
}

export function DealMarkers({ deals, radius = 8 }) {
  return deals.filter(hasLoc).map(d => (
    <CircleMarker key={d.id} center={[d.latitude, d.longitude]} radius={radius}
      pathOptions={{ color: '#fff', weight: 2, fillColor: d.stage_color, fillOpacity: 0.95 }}>
      <Popup><DealPopup d={d} /></Popup>
    </CircleMarker>
  ))
}

export const pinIcon = (color = '#059669') => L.divIcon({
  className: '',
  html: `<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.5 0 14.6 0 25.5 15 40 15 40s15-14.5 15-25.4C30 6.5 23.3 0 15 0z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.5" r="5.5" fill="#fff"/></svg>`,
  iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36],
})

function ClickToSet({ onPick }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng, 'map') })
  return null
}
function Recenter({ lat, lng }) {
  const map = useMap()
  useEffect(() => { if (validLatLng(lat, lng)) map.setView([lat, lng], Math.max(map.getZoom(), 16)) }, [lat, lng]) // eslint-disable-line
  return null
}

/** GPS + click-on-map + manual entry. value = {lat, lng, source, accuracy} */
export function LocationPicker({ value, onChange, height = 'h-72', children }) {
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsErr, setGpsErr] = useState('')
  const [paste, setPaste] = useState('')
  const [recenterKey, setRecenterKey] = useState(0)
  const has = validLatLng(value?.lat, value?.lng)

  const set = (lat, lng, source, accuracy = null, recenter = false) => {
    onChange({ lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), source, accuracy })
    if (recenter) setRecenterKey(k => k + 1)
  }

  const gps = () => {
    if (!navigator.geolocation) return setGpsErr('GPS not available on this device')
    setGpsBusy(true); setGpsErr('')
    navigator.geolocation.getCurrentPosition(
      p => { setGpsBusy(false); set(p.coords.latitude, p.coords.longitude, 'gps', Math.round(p.coords.accuracy), true) },
      e => { setGpsBusy(false); setGpsErr(e.code === 1 ? 'Location permission denied — allow it in browser settings' : 'Could not get location, try again or pin on map') },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className="btn-primary" onClick={gps} disabled={gpsBusy}>
          {gpsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} Use my current location
        </button>
        <div className="min-w-[200px] flex-1">
          <input className="input" placeholder="…or paste 'lat, long' / Google Maps link" value={paste}
            onChange={e => { setPaste(e.target.value); const p = parseLatLng(e.target.value); if (p) set(p.lat, p.lng, 'manual', null, true) }} />
        </div>
      </div>
      {gpsErr && <p className="text-sm text-red-600">{gpsErr}</p>}
      <div className={`${height} overflow-hidden rounded-xl border border-slate-200`}>
        <BaseMap center={has ? [value.lat, value.lng] : INDIA_CENTER} zoom={has ? 16 : 5}>
          <ClickToSet onPick={(a, b, s) => set(a, b, s)} />
          {has && <Marker position={[value.lat, value.lng]} icon={pinIcon()} draggable
            eventHandlers={{ dragend: e => { const ll = e.target.getLatLng(); set(ll.lat, ll.lng, 'map') } }} />}
          {has && <Recenter key={recenterKey} lat={value.lat} lng={value.lng} />}
          {children}
        </BaseMap>
      </div>
      <p className="text-xs text-slate-500">Tap the map to drop the pin, drag it to fine-tune.</p>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="label">Latitude</span>
          <input className="input" type="number" step="any" value={value?.lat ?? ''} onChange={e => onChange({ ...value, lat: e.target.value === '' ? null : +e.target.value, source: 'manual' })} /></label>
        <label><span className="label">Longitude</span>
          <input className="input" type="number" step="any" value={value?.lng ?? ''} onChange={e => onChange({ ...value, lng: e.target.value === '' ? null : +e.target.value, source: 'manual' })} /></label>
      </div>
      {has && <p className="text-xs text-slate-500">Source: <b>{value.source}</b>{value.accuracy ? ` · accuracy ±${value.accuracy} m` : ''}</p>}
    </div>
  )
}
