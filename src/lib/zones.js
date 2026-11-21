// Network-plan zones: Z0 build first · Z1 add capacity · Z2 add coverage · ZN no build (Zx, gated, restricted).
import { supabase } from './supabase'

export const ZONES = {
  Z0: { label: 'Z0', desc: 'Build first', cls: 'bg-emerald-600 text-white' },
  Z1: { label: 'Z1', desc: 'Add capacity', cls: 'bg-sky-600 text-white' },
  Z2: { label: 'Z2', desc: 'Add coverage', cls: 'bg-amber-500 text-white' },
  ZN: { label: 'ZN', desc: 'No build', cls: 'bg-slate-400 text-white' },
}
export const ZONE_KEYS = Object.keys(ZONES)
export const zoneOfClass = c => (/^Z0/.test(c) ? 'Z0' : /^Z1/.test(c) ? 'Z1' : c === 'Z2' || c === 'Z2c' ? 'Z2' : 'ZN')

/** Read zones from the Indofast network map (.html) or a GeoJSON file → upload rows. */
export function parseZoneFile(text) {
  const t = text.trimStart()
  if (t.startsWith('{')) return fromGeoJson(JSON.parse(t))
  return fromMapHtml(text)
}

function fromMapHtml(s) {
  const out = new Map()
  const re = /\{"id":"[A-Z]{2,5}_\d+"/g
  let m
  while ((m = re.exec(s))) {
    const o = readJsonAt(s, m.index)
    if (!o || !o.g || !o.cl || out.has(o.id)) continue
    // map stores [[[[lat, lon], …]]] (polygons → rings → points); GeoJSON wants lon/lat
    const coords = o.g.map(poly => poly.map(ring => ring.map(([lat, lon]) => [lon, lat])))
    out.set(o.id, { id: o.id, name: o.n || o.id, city: o.c || null, cls: o.cl, label: o.pw || null, score: o.sc ?? null, geojson: JSON.stringify({ type: 'MultiPolygon', coordinates: coords }) })
    re.lastIndex = m.index + 1
  }
  return [...out.values()]
}

/** Parse the JSON object starting at s[i] (brace matching, string-aware). */
function readJsonAt(s, i) {
  let depth = 0, inStr = false
  for (let j = i; j < s.length; j++) {
    const ch = s[j]
    if (inStr) { if (ch === '\\') j++; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, j + 1)) } catch { return null } }
  }
  return null
}

function fromGeoJson(fc) {
  return (fc.features || []).filter(f => f.geometry && /Polygon/.test(f.geometry.type)).map((f, i) => {
    const p = f.properties || {}
    const cls = p.cls || p.cl || p.zone_class || p.zone || p.Zone || 'ZN'
    return { id: String(p.id || p.zone_id || `Z_${i + 1}`), name: p.name || p.n || String(p.id || i + 1), city: p.city || p.c || null, cls, label: p.label || p.pw || null, score: p.score ?? null, geojson: JSON.stringify(f.geometry) }
  })
}

/** Upload in batches; the first batch replaces every existing zone. */
export async function uploadZones(rows, version, onProgress) {
  const size = 150
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.rpc('zones_upload', { rows: rows.slice(i, i + size), replace_all: i === 0, map_version: version || null })
    if (error) throw error
    onProgress?.(Math.min(i + size, rows.length), rows.length)
  }
}

/** Zone at a point, or null. */
export async function zoneAt(lat, lng) {
  const { data, error } = await supabase.rpc('zone_at', { lat, lng })
  if (error) return null
  return data?.[0] || null
}
