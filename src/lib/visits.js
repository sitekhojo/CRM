// Field visits logged by the ground team.
import { supabase, fetchAll } from './supabase'

export const VISIT_TYPES = {
  new_site: { label: 'New site scouted', short: 'New site', cls: 'bg-emerald-100 text-emerald-800' },
  follow_up: { label: 'Follow-up', short: 'Follow-up', cls: 'bg-sky-100 text-sky-800' },
  franchisee_meeting: { label: 'Franchisee meeting', short: 'Franchisee', cls: 'bg-violet-100 text-violet-800' },
  discom: { label: 'Discom', short: 'Discom', cls: 'bg-amber-100 text-amber-800' },
  other: { label: 'Other', short: 'Other', cls: 'bg-slate-200 text-slate-700' },
}
export const NO_LEAD_REASONS = ['Owner details not available', 'In discussion', 'Not feasible', 'Other']
export const VISIT_TYPE_KEYS = Object.keys(VISIT_TYPES)

/** Distinct colours for people on the map. */
export const PERSON_COLORS = ['#7c3aed', '#059669', '#ea580c', '#2563eb', '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#65a30d', '#9333ea', '#0d9488']

/** Today's date in India as YYYY-MM-DD. */
export const istDay = (d = new Date()) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10)
export const addDays = (day, n) => { const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
export const fmtTime = d => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
export const fmtDay = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })

export const fetchVisits = (from, to) =>
  fetchAll(() => supabase.from('site_visits').select('*').gte('visit_date', from).lte('visit_date', to).order('visited_at'))

export const fetchSiteVisits = siteId =>
  supabase.from('site_visits').select('*').eq('site_id', siteId).order('visited_at', { ascending: false }).then(r => r.data || [])

/** Read the phone's GPS. Resolves {lat,lng,accuracy}. */
export function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot read GPS'))
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      e => reject(new Error(e.code === 1 ? 'Location permission denied. Allow location for sitekojo.in in your browser settings.' : e.code === 3 ? 'GPS timed out. Step outside and try again.' : 'Could not read GPS. Turn on location and try again.')),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    )
  })
}
