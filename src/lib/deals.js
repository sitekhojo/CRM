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

export const EMPTY_FILTERS = { q: '', city: [], recordType: '', stage: [], siteType: [], member: '', from: '', to: '', overdue: false, mine: false }

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
    if (f.member && d.created_by !== f.member && d.assigned_to !== f.member) return false
    if (f.mine && d.assigned_to !== userId && d.created_by !== userId) return false
    if (f.overdue && !d.is_overdue) return false
    const c = new Date(d.created_at)
    if (from && c < from) return false
    if (to && c > to) return false
    if (q && ![d.name, d.site_code, d.address, d.city, d.pincode, d.landlord_name, d.landlord_phone, d.created_by_name, d.assigned_to_name]
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
