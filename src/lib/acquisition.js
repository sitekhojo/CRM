// Acquisition Desk: priority target locations (P0–P4) and matching sites to them.
import { useCallback, useEffect, useState } from 'react'
import { supabase, fetchAll } from './supabase'
import { haversine, hasLoc, validLatLng } from './geo'

export const PRIORITIES = {
  P0: { color: '#dc2626', cls: 'bg-red-600 text-white' },
  P1: { color: '#ea580c', cls: 'bg-orange-500 text-white' },
  P2: { color: '#ca8a04', cls: 'bg-yellow-400 text-yellow-950' },
  P3: { color: '#2563eb', cls: 'bg-blue-600 text-white' },
  P4: { color: '#64748b', cls: 'bg-slate-500 text-white' },
}
export const PRIORITY_KEYS = Object.keys(PRIORITIES)
export const DEFAULT_RADIUS_M = 1000

export const fetchTargets = () =>
  fetchAll(() => supabase.from('target_locations').select('*').eq('is_active', true).order('priority').order('target_month').order('id'))

export function useTargets() {
  const [targets, setTargets] = useState(null)
  const reload = useCallback(() => fetchTargets().then(setTargets).catch(() => setTargets([])), [])
  useEffect(() => { reload() }, [reload])
  return { targets: targets || [], loading: targets === null, reload }
}

/** Nearest priority location whose radius contains the point (ties → higher priority). */
export function matchPoint(lat, lng, targets = []) {
  if (!validLatLng(Number(lat), Number(lng))) return null
  let best = null
  for (const t of targets) {
    const d = haversine(Number(lat), Number(lng), t.latitude, t.longitude)
    if (d > (t.radius_m || DEFAULT_RADIUS_M)) continue
    if (!best || t.priority < best.t.priority || (t.priority === best.t.priority && d < best.d)) best = { t, d }
  }
  return best ? { ...best.t, distance_m: Math.round(best.d) } : null
}

export const matchSite = (site, targets) => (hasLoc(site) ? matchPoint(site.latitude, site.longitude, targets) : null)

/** Map of site id → matched target, and target id → matched sites. */
export function matchAll(sites = [], targets = []) {
  const bySite = {}, byTarget = {}
  for (const s of sites) {
    const t = matchSite(s, targets)
    if (!t) continue
    bySite[s.id] = t
    ;(byTarget[t.id] = byTarget[t.id] || []).push({ ...s, distance_m: t.distance_m })
  }
  return { bySite, byTarget }
}

/** Acquisition status of a location from the sites created against it. */
export const STATUS = {
  energized: { label: 'Energized', cls: 'bg-emerald-600 text-white', rank: 5 },
  handover: { label: 'Handed over', cls: 'bg-cyan-600 text-white', rank: 4 },
  deal: { label: 'Deal', cls: 'bg-violet-600 text-white', rank: 3 },
  lead: { label: 'Lead', cls: 'bg-sky-100 text-sky-800', rank: 2 },
  dropped: { label: 'Only dropped', cls: 'bg-slate-200 text-slate-600', rank: 1 },
  open: { label: 'Not started', cls: 'bg-white text-slate-500 ring-1 ring-slate-300', rank: 0 },
}
export function locationStatus(sites = []) {
  const live = sites.filter(s => s.stage_category !== 'dropped')
  if (sites.some(s => s.stage_category === 'live')) return 'energized'
  if (sites.some(s => s.stage_category === 'approved')) return 'handover'
  if (live.some(s => (s.record_type || 'deal') === 'deal')) return 'deal'
  if (live.length) return 'lead'
  if (sites.length) return 'dropped'
  return 'open'
}

/** "2026-11-01" → "Nov 2026" */
export const monthLabel = d => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—')

/** Parse "Nov-26", "November 2026", "2026-11", "11/2026", Excel dates → "YYYY-MM-01". */
export function parseMonth(v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-01`
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`
  m = s.match(/^([A-Za-z]{3,9})[\s\-'’,]*(\d{2,4})$/)
  if (m) {
    const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) { const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]); return `${y}-${String(mi + 1).padStart(2, '0')}-01` }
  }
  const d = new Date(s)
  return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export const normPriority = v => { const m = String(v ?? '').toUpperCase().match(/P?\s*([0-4])/); return m ? `P${m[1]}` : null }

export const TARGET_FIELDS = [
  ['name', 'Location name'], ['city', 'City'], ['latitude', 'Latitude'], ['longitude', 'Longitude'],
  ['priority', 'Priority'], ['target_month', 'Month of acquisition'], ['radius_m', 'Radius (m)'], ['target_qis', 'Target QIS'], ['notes', 'Notes'],
]
