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
    const [st, ci, dr, pr, se] = await Promise.all([
      supabase.from('stages').select('*').order('sort_order'),
      supabase.from('cities').select('*').order('name'),
      supabase.from('drop_reasons').select('*').order('label'),
      supabase.from('profiles').select('id,full_name,email,role,is_active,phone,created_at').order('full_name'),
      supabase.from('app_settings').select('*'),
    ])
    const settings = Object.fromEntries((se.data || []).map(r => [r.key, r.value]))
    setCfg({
      stages: st.data || [],
      cities: ci.data || [],
      dropReasons: dr.data || [],
      users: pr.data || [],
      rules: { ...DEFAULT_RULES, ...(settings.feasibility_rules || {}) },
    })
  }, [])

  useEffect(() => { load() }, [load])

  return <ConfigCtx.Provider value={{ ...(cfg || {}), ready: !!cfg, reload: load }}>{children}</ConfigCtx.Provider>
}

export const useConfig = () => useContext(ConfigCtx)

/** Active stages that apply to a site type (stages with no site_types apply to all). */
export function stagesFor(stages = [], siteType) {
  return stages.filter(s => s.is_active && (!s.site_types?.length || !siteType || s.site_types.includes(siteType)))
}
