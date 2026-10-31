import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)
export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

/** Fetch every row of a query, paging past Supabase's 1000-row API limit. */
export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) return rows
  }
}

/** Turn a Postgres / PostgREST error into a readable message. */
export function errMsg(e) {
  if (!e) return 'Something went wrong'
  const m = e.message || String(e)
  if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.'
  return m.replace(/^.*?ERROR:\s*/, '')
}
