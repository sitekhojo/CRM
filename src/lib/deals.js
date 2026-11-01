import { supabase, fetchAll } from './supabase'
import { useCallback, useEffect, useState } from 'react'

export const fetchDeals = () =>
  fetchAll(() => supabase.from('site_overview').select('*').order('created_at', { ascending: false }))

export const fetchNetworkPoints = () =>
  fetchAll(() => supabase.from('network_points').select('*').order('id'))

export function useDeals() {
  const [deals, setDeals] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(async () => {
    try { setDeals(await fetchDeals()); setError(null) } catch (e) { setError(e) }
  }, [])
  useEffect(() => { reload() }, [reload])
  return { deals, error, reload, loading: deals === null && !error }
}

/**
 * Pipeline for a period: added on/before `to`, and not Dropped or Energized
 * (Scouting → Handover Done, plus Hold).
 */
export function inPipeline(d, from, to) {
  if (to && String(d.created_at).slice(0, 10) > to) return false
  return d.stage_category !== 'dropped' && d.stage_category !== 'live'
}

const localDay = v => { if (!v) return null; const s = String(v); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const addedDay = d => localDay(d.created_at)

/**
 * When and how a site left the pipeline (pipeline = Scouting → Agreement, plus Hold).
 * Handed over = first exit for sites now at Handover Done / Energized (or dropped after handover).
 */
export function exitOf(d) {
  const ho = d.extra?.ho_date || d.extra?.energized_on
  let x = null
  if (['approved', 'live'].includes(d.stage_category)) x = { kind: 'ho', date: localDay(ho || d.stage_entered_at) }
  else if (d.stage_category === 'dropped') x = ho ? { kind: 'ho', date: localDay(ho) } : { kind: 'dropped', date: localDay(d.stage_entered_at) }
  if (!x) return null
  const a = addedDay(d) // a site can't leave before it was added
  if (!x.date || (a && x.date < a)) x.date = a
  return x
}
/** In the pipeline at the end of `day` (ISO)? */
export function inPipeAt(d, day) {
  const a = addedDay(d); if (!a || a > day) return false
  const x = exitOf(d)
  return !x || !x.date || x.date > day
}
export const dayBefore = day => { const t = new Date(day + 'T12:00:00'); t.setDate(t.getDate() - 1); return localDay(t) }

export const EMPTY_FILTERS = { q: '', city: [], recordType: '', stage: [], siteType: [], region: [], owner: [], member: '', from: '', to: '', overdue: false, mine: false, age: '', ho: '', en: '', openOnly: false, inPipe: '', pipeAt: '', exit: '' }

/** Apply the shared filter bar to a list of deals. */
export function applyFilters(deals, f, userId) {
  const q = f.q.trim().toLowerCase()
  const from = f.from ? new Date(f.from + 'T00:00:00') : null
  const to = f.to ? new Date(f.to + 'T23:59:59') : null
  return deals.filter(d => {
    if (f.city?.length && !f.city.includes(d.city)) return false
    if (f.recordType && (d.record_type || 'deal') !== f.recordType) return false
    if (f.siteType?.length && !f.siteType.includes(d.site_type)) return false
    if (f.stage?.length && !f.stage.map(String).includes(String(d.stage_id))) return false
    if (f.region?.length && !f.region.includes(d.region || '')) return false
    if (f.owner?.length && !f.owner.includes(d.owner || '')) return false
    if (f.member && d.created_by !== f.member && d.assigned_to !== f.member) return false
    if (f.mine && d.assigned_to !== userId && d.created_by !== userId) return false
    if (f.overdue && !d.is_overdue) return false
    if (f.openOnly && d.stage_category === 'dropped') return false
    if (f.pipeAt && !inPipeAt(d, f.pipeAt)) return false
    if (f.exit) { const [k, a, b] = f.exit.split(','); const x = exitOf(d); if (!x || x.kind !== k || !x.date || x.date < a || x.date > b) return false }
    if (f.inPipe) { const [a, b] = f.inPipe.split(','); if (!inPipeline(d, a, b)) return false }
    if (f.ho) { const [a, b] = f.ho.split(','); const x = d.extra?.ho_date; if (!x || x < a || x > b) return false }
    if (f.en) { const [a, b] = f.en.split(','); const x = d.extra?.energized_on; if (!x || x < a || x > b) return false }
    if (f.age) {
      const [lo, hi] = f.age.split('-').map(v => (v === '' ? Infinity : Number(v)))
      if (+d.days_in_stage < lo || +d.days_in_stage > hi) return false
    }
    const c = new Date(d.created_at)
    if (from && c < from) return false
    if (to && c > to) return false
    if (q && ![d.name, d.site_code, d.address, d.city, d.pincode, d.landlord_name, d.landlord_phone, d.created_by_name, d.assigned_to_name, d.owner]
      .some(v => v && String(v).toLowerCase().includes(q))) return false
    return true
  })
}

/** Which actions the current user may take on a deal (mirrors the database rules). */
export function permissions(deal, profile) {
  const admin = profile?.role === 'admin'
  const uid = profile?.id
  return {
    canEdit: admin || deal.created_by === uid || deal.assigned_to === uid,
    canChangeStage: admin || deal.assigned_to === uid,
    canReassign: admin,
    canDelete: admin,
  }
}
