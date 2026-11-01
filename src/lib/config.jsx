// Shared reference data: stages, cities, drop reasons, users, feasibility rules.
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const ConfigCtx = createContext(null)

export const DEFAULT_RULES = {
  search_radius_m: 3000,
  min_distance_own_station_m: 1500,
  ideal_max_distance_own_station_m: 5000,
  duplicate_radius_m: 150,
  competitor_radius_m: 1000,
  max_competitors_in_radius: 2,
  demand_radius_m: 2000,
  min_demand_points: 1,
  restricted_radius_m: 200,
}

export function ConfigProvider({ children }) {
  const [cfg, setCfg] = useState(null)

  const load = useCallback(async () => {
    const [st, ci, dr, pr, se, tm] = await Promise.all([
      supabase.from('stages').select('*').order('sort_order'),
      supabase.from('cities').select('*').order('name'),
      supabase.from('drop_reasons').select('*').order('label'),
      supabase.from('profiles').select('id,full_name,email,role,is_active,phone,created_at').order('full_name'),
      supabase.from('app_settings').select('*'),
      supabase.from('team_members').select('*').order('sort_order').order('name'),
    ])
    const settings = Object.fromEntries((se.data || []).map(r => [r.key, r.value]))
    setCfg({
      stages: st.data || [],
      cities: ci.data || [],
      dropReasons: dr.data || [],
      users: pr.data || [],
      team: tm.data || [],
      rules: { ...DEFAULT_RULES, ...(settings.feasibility_rules || {}) },
    })
  }, [])

  useEffect(() => { load() }, [load])

  return <ConfigCtx.Provider value={{ ...(cfg || {}), ready: !!cfg, reload: load }}>{children}</ConfigCtx.Provider>
}

export const useConfig = () => useContext(ConfigCtx)

/** Active stages that apply to a site type (stages with no site_types apply to all). */
export function stagesFor(stages = [], siteType) {
  const types = Array.isArray(siteType) ? siteType : siteType ? [siteType] : []
  return stages.filter(s => s.is_active && (!s.site_types?.length || !types.length || types.some(t => s.site_types.includes(t))))
}

export const REGIONS = ['North', 'South', 'West', 'East']

/** Region of a city name (from the cities table). */
export const regionOf = (cities = [], city) => cities.find(c => c.name?.toLowerCase() === String(city || '').toLowerCase())?.region || null

/** Team members grouped by region, the given region first. */
export function ownerOptions(team = [], region, current) {
  const act = team.filter(t => t.is_active || t.name === current)
  const order = [region, ...REGIONS.filter(r => r !== region)].filter(Boolean)
  const groups = order.map(r => ({ region: r, members: act.filter(t => t.region === r) })).filter(g => g.members.length)
  const other = act.filter(t => !REGIONS.includes(t.region))
  if (other.length) groups.push({ region: 'Other', members: other })
  if (current && !act.some(t => t.name === current)) groups.push({ region: 'Former', members: [{ name: current }] })
  return groups
}

/** Badge for a team lead: zonal head for North/South/West, "lead" elsewhere (e.g. East). */
export const leadLabel = region => (['North', 'South', 'West'].includes(region) ? 'Zonal head' : 'lead')
