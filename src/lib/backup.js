// Full backup: every table in SiteKhojo into one Excel workbook (admin only).
import { supabase, fetchAll } from './supabase'
import { exportWorkbook, DEAL_COLUMNS } from './excel'

export const FULL_SITE_COLUMNS = [['id', 'Record UUID'], ...DEAL_COLUMNS, ['region', 'Region'], ['source', 'Source'], ['stage_note', 'Stage note'], ['extra_json', 'All extra fields (JSON)'], ['updated_at', 'Updated at']]
export const BACKUP_DUE_DAYS = 7

/** Download the full backup and record when it was taken. Returns counts for the toast. */
export async function runFullBackup(byName) {
  const get = (t, order = 'id') => fetchAll(() => supabase.from(t).select('*').order(order))
  const [sites, history, comments, network, targets, team, cities, stages, drops, users, visits, payments, logins, settings] = await Promise.all([
    get('site_overview', 'created_at'), get('stage_history_overview'), get('site_comments'), get('network_points'),
    get('target_locations'), get('team_members'), get('cities'), get('stages', 'sort_order'), get('drop_reasons'),
    fetchAll(() => supabase.from('profiles').select('id,email,full_name,role,is_active,phone,created_at').order('created_at')),
    get('site_visits'), get('site_payments'), get('login_events'), fetchAll(() => supabase.from('app_settings').select('*').order('key')),
  ])
  const flat = sites.map(r => ({ ...r, ...(r.extra || {}), source: r.extra?.source === 'qis_tracker' ? 'QIS tracker import' : r.extra?.source === 'payment_tracker' ? 'Payment tracker import' : 'CRM', extra_json: r.extra }))
  const codeOf = Object.fromEntries(sites.map(s => [s.id, s.site_code]))
  const withCode = xs => xs.map(x => ({ site_code: codeOf[x.site_id] || '', ...x }))
  const now = new Date()
  const stamp = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  await exportWorkbook([
    { name: 'Leads & Deals', rows: flat, columns: FULL_SITE_COLUMNS },
    { name: 'Stage history', rows: history },
    { name: 'Comments', rows: withCode(comments) },
    { name: 'Franchise payments', rows: withCode(payments) },
    { name: 'Field visits', rows: withCode(visits) },
    { name: 'Network (QIS tracker)', rows: network },
    { name: 'Priority locations', rows: targets },
    { name: 'Team', rows: team },
    { name: 'Cities', rows: cities },
    { name: 'Stages', rows: stages },
    { name: 'Drop reasons', rows: drops },
    { name: 'Users', rows: users },
    { name: 'Login activity', rows: logins },
    { name: 'Settings', rows: settings },
    { name: 'About', rows: [{ exported_at: now.toISOString(), exported_by: byName || '', leads_and_deals: sites.length, stage_changes: history.length, comments: comments.length, payments: payments.length, field_visits: visits.length, network_points: network.length, priority_locations: targets.length, login_events: logins.length }] },
  ], `sitekhojo-full-backup-${stamp}`)
  await supabase.from('app_settings').upsert({ key: 'last_backup', value: { at: now.toISOString(), by: byName || null }, updated_at: now.toISOString() })
  return { sites: sites.length, history: history.length, payments: payments.length, visits: visits.length }
}

export async function fetchLastBackup() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'last_backup').maybeSingle()
  return data?.value || null
}

export const daysSince = iso => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
