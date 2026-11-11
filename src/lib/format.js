export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const fmtINR = n => (n === null || n === undefined || n === '') ? '—' : '₹' + Number(n).toLocaleString('en-IN')
/** Whole numbers everywhere, rounded up (2.2 → 3); tiny float noise is ignored. */
export const roundUp = n => { const v = Number(n) || 0; const a = Math.ceil(Math.abs(v) - 1e-6); return v < 0 ? -a : a }
export const fmtNum = n => (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) ? '—' : roundUp(n).toLocaleString('en-IN')
export const fmtDist = m => m === null || m === undefined || !Number.isFinite(m) ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
export const daysLabel = d => {
  if (d === null || d === undefined || isNaN(d)) return '—'
  const n = Math.floor(Number(d))
  return n < 1 ? '< 1 day' : n === 1 ? '1 day' : `${n} days`
}

/** Days-in-stage buckets and colours (no SLA). */
export const AGE_TONES = [
  { lo: 0, hi: 7, cls: 'bg-emerald-100 text-emerald-800', label: '0–7' },
  { lo: 8, hi: 15, cls: 'bg-lime-100 text-lime-800', label: '8–15' },
  { lo: 16, hi: 30, cls: 'bg-amber-100 text-amber-800', label: '16–30' },
  { lo: 31, hi: 60, cls: 'bg-orange-200 text-orange-900', label: '31–60' },
  { lo: 61, hi: Infinity, cls: 'bg-red-500 text-white', label: '61+' },
]
export const daysInt = d => (d === null || d === undefined || isNaN(d) ? null : Math.floor(Number(d)))
export function stageAgeTone(days, category) {
  if (['dropped', 'live'].includes(category)) return { cls: 'bg-slate-100 text-slate-500', label: 'Closed stage' }
  const d = daysInt(days) ?? 0
  const t = AGE_TONES.find(x => d >= x.lo && d <= x.hi) || AGE_TONES[0]
  return { cls: t.cls, label: `${t.label} days in stage` }
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

export const SITE_TYPES = ['Franchise', 'Private', 'SPP']

/** Match free text (e.g. from Excel) to a known site type. */
export function normaliseSiteType(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'pvt') return 'Private'
  // IOCL, Metro and Railways are clubbed into SPP
  if (['iocl', 'metro', 'railways', 'railway', 'metro & railways', 'metro/railways', 'indian railways', 'dmrc', 'bmrcl'].includes(s)) return 'SPP'
  return SITE_TYPES.find(t => t.toLowerCase() === s) || String(v).trim()
}

/** Pipeline attributes kept in sites.extra (no DB change needed to add more). */
export const EXTRA_FIELDS = [
  ['qis_count', 'No. of QIS', 'number'],
  ['expected_ho', 'Expected HO date', 'date'],
  ['priority_zone', 'Priority zone (P0/P1)', 'text'],
  ['intent', 'Intent', 'intent'],
  ['site_format', 'Open / Closed site', 'format'],
  ['expected_en', 'Expected energisation date', 'date'],
  ['ho_date', 'Handover date', 'date'],
  ['energized_on', 'Energization date', 'date'],
]

/** Deal temperature (replaces probability %). */
export const INTENTS = {
  hot: { label: 'Hot', hint: 'High intent', cls: 'bg-red-100 text-red-700', dot: '#dc2626' },
  warm: { label: 'Warm', hint: 'Medium intent', cls: 'bg-amber-100 text-amber-800', dot: '#d97706' },
  cold: { label: 'Cold', hint: 'Low intent', cls: 'bg-sky-100 text-sky-700', dot: '#0284c7' },
}
export const normIntent = v => {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/hot|high/.test(s)) return 'hot'
  if (/warm|med/.test(s)) return 'warm'
  if (/cold|low/.test(s)) return 'cold'
  const n = Number(s.replace('%', '')); if (!isNaN(n)) return n >= 80 ? 'hot' : n >= 50 ? 'warm' : 'cold'
  return null
}
/** Physical site format. */
export const SITE_FORMATS = { open: 'Open', closed: 'Closed' }
export const normFormat = v => { const s = String(v ?? '').trim().toLowerCase(); return s.startsWith('open') ? 'open' : s.startsWith('close') ? 'closed' : null }

/** Fields only an admin edits, from the list (not in the edit form). */
export const ADMIN_LIST_DATES = ['ho_date', 'energized_on']

export const RECORD_TYPES = {
  lead: { label: 'Lead', cls: 'bg-sky-100 text-sky-700' },
  deal: { label: 'Deal', cls: 'bg-violet-100 text-violet-700' },
}

export function startOfWeek(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7 // Monday start
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x
}
export function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
