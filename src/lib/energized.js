// One definition of "energized", shared by the Dashboard and the CEO View so their numbers always match.
//
// Energized QIS = QIS tracker energisations (Settings → Network data)
//               + sites energized in Site Khojo that the tracker doesn't have yet
//               − tracker stations whose Site Khojo site has been Dropped (dropped never counts).
import { haversine, hasLoc } from './geo'
import { normaliseSiteType } from './format'

const nm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const TRACKER_SOURCES = ['qis_tracker', 'payment_tracker']
export const isTrackerCopy = d => TRACKER_SOURCES.includes(d.extra?.source)

/**
 * Every energisation as an event: { key, date (YYYY-MM-DD), qis, city, siteType, name, source, siteId }.
 * deals = all sites (site_overview rows), network = network_points.
 */
export function energizationEvents(deals, network) {
  const stations = (network || []).filter(n => n.point_type === 'own_station')
  const droppedStation = new Set(
    (deals || []).filter(d => d.stage_category === 'dropped' && d.extra?.network_point_id).map(d => String(d.extra.network_point_id)),
  )
  const names = new Set(stations.map(n => nm(n.name)))
  const near = (d, n) => hasLoc(d) && haversine(d.latitude, d.longitude, n.latitude, n.longitude) <= 100
  const ev = []
  for (const n of stations) {
    if (droppedStation.has(String(n.id))) continue
    for (const [date, c] of Object.entries(n.energized_dates || {})) {
      ev.push({ key: `n${n.id}:${date}`, date: date.slice(0, 10), qis: Number(c) || 0, city: n.city, siteType: normaliseSiteType(n.site_type) || 'Not set', name: n.name, source: 'QIS tracker', stationId: n.id })
    }
  }
  for (const d of deals || []) {
    if (d.stage_category !== 'live' || isTrackerCopy(d)) continue
    if (names.has(nm(d.name)) || stations.some(n => near(d, n))) continue // already in the tracker
    const date = String(d.extra?.energized_on || d.stage_entered_at || '').slice(0, 10)
    ev.push({ key: `d${d.id}`, date, qis: Number(d.extra?.qis_count) || 0, city: d.city, siteType: d.site_type || 'Not set', name: d.name, source: 'Site Khojo (not in tracker yet)', siteId: d.id })
  }
  return ev
}

/** Tracker station ids whose Site Khojo site is Dropped (excluded from energized totals). */
export const droppedTrackerStations = deals =>
  (deals || []).filter(d => d.stage_category === 'dropped' && d.extra?.network_point_id)
