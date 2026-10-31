// Distance + feasibility engine for Network Planning.
// Kept pure (no React / Supabase) so rules can grow into a server-side function later.

const R = 6371000
const toRad = d => (d * Math.PI) / 180

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Parse "28.4595, 77.0266" or a Google Maps URL (@lat,lng / q=lat,lng). */
export function parseLatLng(text) {
  if (!text) return null
  const s = String(text)
  const m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/)
    || s.match(/(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/)
  if (!m) return null
  const lat = parseFloat(m[1]), lng = parseFloat(m[2])
  return validLatLng(lat, lng) ? { lat, lng } : null
}

/** Does a site/deal row have a usable location? */
export const hasLoc = d => d && d.latitude !== null && d.latitude !== undefined && d.longitude !== null && d.longitude !== undefined

export const validLatLng = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/**
 * Evaluate a candidate location.
 * @param point   {lat,lng}
 * @param deals   rows from site_overview
 * @param network rows from network_points
 * @param rules   feasibility rules
 * @param excludeId  deal id to ignore (when checking an existing deal)
 */
export function evaluateFeasibility(point, deals, network, rules, excludeId) {
  const withDist = (arr, latK, lngK) => arr
    .map(x => ({ ...x, distance: haversine(point.lat, point.lng, x[latK], x[lngK]) }))
    .sort((a, b) => a.distance - b.distance)

  deals = deals.filter(hasLoc)
  const liveDeals = deals.filter(d => d.stage_category === 'live' && d.id !== excludeId)
    .map(d => ({ id: d.id, name: d.name, city: d.city, latitude: d.latitude, longitude: d.longitude, point_type: 'own_station', source: 'deal' }))
  const ownStations = withDist([...network.filter(n => n.point_type === 'own_station'), ...liveDeals], 'latitude', 'longitude')
  const competitors = withDist(network.filter(n => n.point_type === 'competitor'), 'latitude', 'longitude')
  const demand = withDist(network.filter(n => n.point_type === 'demand_hotspot'), 'latitude', 'longitude')
  const restricted = withDist(network.filter(n => n.point_type === 'restricted'), 'latitude', 'longitude')
  const pipeline = withDist(deals.filter(d => d.id !== excludeId && d.stage_category !== 'dropped' && d.stage_category !== 'live'), 'latitude', 'longitude')

  const within = (arr, r) => arr.filter(x => x.distance <= r)
  const nearestOwn = ownStations[0] || null
  const compIn = within(competitors, rules.competitor_radius_m)
  const demandIn = within(demand, rules.demand_radius_m)
  const restrictedIn = within(restricted, rules.restricted_radius_m)
  const dupes = within(pipeline, rules.duplicate_radius_m)

  const checks = []
  // 1. Cannibalisation of own network
  if (!nearestOwn) checks.push({ key: 'cannibal', label: 'Distance from own stations', status: 'info', detail: 'No own stations loaded yet — add them under Settings → Network data.' })
  else if (nearestOwn.distance < rules.min_distance_own_station_m)
    checks.push({ key: 'cannibal', label: 'Distance from own stations', status: 'fail', detail: `Nearest own station "${nearestOwn.name}" is only ${fmt(nearestOwn.distance)} away (min ${fmt(rules.min_distance_own_station_m)}).` })
  else checks.push({ key: 'cannibal', label: 'Distance from own stations', status: 'pass', detail: `Nearest own station "${nearestOwn.name}" is ${fmt(nearestOwn.distance)} away.` })

  // 2. Network connectivity / coverage
  if (nearestOwn) {
    if (nearestOwn.distance > rules.ideal_max_distance_own_station_m)
      checks.push({ key: 'coverage', label: 'Network connectivity', status: 'warn', detail: `More than ${fmt(rules.ideal_max_distance_own_station_m)} from the network — isolated site, check standalone demand.` })
    else checks.push({ key: 'coverage', label: 'Network connectivity', status: 'pass', detail: `Within ${fmt(rules.ideal_max_distance_own_station_m)} of the network — fills a coverage gap.` })
  }

  // 3. Competition
  checks.push(compIn.length > rules.max_competitors_in_radius
    ? { key: 'competition', label: 'Competition', status: 'warn', detail: `${compIn.length} competitor stations within ${fmt(rules.competitor_radius_m)} (max ${rules.max_competitors_in_radius}).` }
    : { key: 'competition', label: 'Competition', status: 'pass', detail: `${compIn.length} competitor stations within ${fmt(rules.competitor_radius_m)}.` })

  // 4. Demand
  if (demand.length === 0) checks.push({ key: 'demand', label: 'Demand hotspots', status: 'info', detail: 'No demand hotspots loaded yet.' })
  else checks.push(demandIn.length >= rules.min_demand_points
    ? { key: 'demand', label: 'Demand hotspots', status: 'pass', detail: `${demandIn.length} demand hotspots within ${fmt(rules.demand_radius_m)}.` }
    : { key: 'demand', label: 'Demand hotspots', status: 'warn', detail: `Only ${demandIn.length} demand hotspots within ${fmt(rules.demand_radius_m)} (min ${rules.min_demand_points}).` })

  // 5. Restricted zones
  checks.push(restrictedIn.length
    ? { key: 'restricted', label: 'Restricted zones', status: 'fail', detail: `Inside a restricted zone: ${restrictedIn.map(r => r.name).join(', ')}.` }
    : { key: 'restricted', label: 'Restricted zones', status: 'pass', detail: 'Not near any restricted zone.' })

  // 6. Duplicate scouting
  checks.push(dupes.length
    ? { key: 'duplicate', label: 'Already in pipeline', status: 'warn', detail: `${dupes.length} deal(s) within ${fmt(rules.duplicate_radius_m)}: ${dupes.slice(0, 3).map(d => `${d.site_code} ${d.name}`).join(', ')}.` }
    : { key: 'duplicate', label: 'Already in pipeline', status: 'pass', detail: `No other deal within ${fmt(rules.duplicate_radius_m)}.` })

  const fails = checks.filter(c => c.status === 'fail').length
  const warns = checks.filter(c => c.status === 'warn').length
  const scored = checks.filter(c => c.status !== 'info')
  const score = scored.length ? Math.round(100 * scored.reduce((s, c) => s + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0) / scored.length) : null
  const verdict = fails ? 'not_feasible' : warns >= 2 ? 'review' : 'feasible'

  return {
    verdict, score, checks, nearestOwn,
    nearby: {
      own: within(ownStations, rules.search_radius_m),
      competitors: within(competitors, rules.search_radius_m),
      demand: within(demand, rules.search_radius_m),
      restricted: within(restricted, rules.search_radius_m),
      pipeline: within(pipeline, rules.search_radius_m),
    },
  }
}

export const VERDICT = {
  feasible: { label: 'Feasible', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  review: { label: 'Needs review', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  not_feasible: { label: 'Not feasible', cls: 'bg-red-100 text-red-800 border-red-200' },
}

const fmt = m => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)
