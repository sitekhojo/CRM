export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const fmtINR = n => (n === null || n === undefined || n === '') ? '—' : '₹' + Number(n).toLocaleString('en-IN')
export const fmtNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d })
export const fmtDist = m => m === null || m === undefined || !Number.isFinite(m) ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
export const daysLabel = d => {
  if (d === null || d === undefined || isNaN(d)) return '—'
  const n = Math.floor(Number(d))
  return n < 1 ? '< 1 day' : n === 1 ? '1 day' : `${n} days`
}

/** Colour for time spent in a stage vs its SLA: green ≤ half, amber ≤ SLA, red beyond, dark red > 2× SLA. */
export function stageAgeTone(days, sla, category) {
  if (['dropped', 'live'].includes(category)) return { cls: 'bg-slate-100 text-slate-500', key: 'closed', label: 'Closed stage' }
  const d = Number(days) || 0
  if (!sla) return { cls: 'bg-slate-100 text-slate-600', key: 'nosla', label: 'No SLA for this stage' }
  if (d > 2 * sla) return { cls: 'bg-red-600 text-white', key: 'critical', label: `More than 2× SLA (${sla} days)` }
  if (d > sla) return { cls: 'bg-red-100 text-red-700', key: 'over', label: `Beyond SLA (${sla} days)` }
  if (d > sla / 2) return { cls: 'bg-amber-100 text-amber-800', key: 'near', label: `Over half of SLA (${sla} days)` }
  return { cls: 'bg-emerald-100 text-emerald-700', key: 'ok', label: `Within SLA (${sla} days)` }
}

export function timeAgo(d) {
  if (!d) return ''
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return fmtDate(d)
}

export const POWER_FEASIBILITY = {
  feasible: { label: 'Feasible', cls: 'bg-emerald-100 text-emerald-700' },
  upgrade_required: { label: 'Upgrade required', cls: 'bg-amber-100 text-amber-700' },
  not_feasible: { label: 'Not feasible', cls: 'bg-red-100 text-red-700' },
  unknown: { label: 'Unknown', cls: 'bg-slate-100 text-slate-600' },
}

export const SITE_TYPES = ['Franchise', 'Private', 'SPP', 'IOCL', 'Metro & Railways']

/** Match free text (e.g. from Excel) to a known site type. */
export function normaliseSiteType(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'pvt') return 'Private'
  if (['metro', 'railways', 'railway', 'metro & railways', 'metro/railways'].includes(s)) return 'Metro & Railways'
  return SITE_TYPES.find(t => t.toLowerCase() === s) || String(v).trim()
}

/** Pipeline attributes kept in sites.extra (no DB change needed to add more). */
export const EXTRA_FIELDS = [
  ['qis_count', 'No. of QIS', 'number'],
  ['expected_ho', 'Expected HO date', 'date'],
  ['priority_zone', 'Priority zone (P0/P1)', 'text'],
  ['probability', 'Probability %', 'number'],
  ['ho_date', 'Handover date', 'date'],
  ['energized_on', 'Energization date', 'date'],
]

export const RECORD_TYPES = {
  lead: { label: 'Lead', cls: 'bg-sky-100 text-sky-700' },
  deal: { label: 'Deal', cls: 'bg-violet-100 text-violet-700' },
}

export function startOfWeek(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7 // Monday start
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x
}
export function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
