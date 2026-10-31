export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const fmtINR = n => (n === null || n === undefined || n === '') ? '—' : '₹' + Number(n).toLocaleString('en-IN')
export const fmtNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d })
export const fmtDist = m => m === null || m === undefined || !Number.isFinite(m) ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
export const daysLabel = d => d === null || d === undefined ? '—' : `${Number(d).toFixed(d < 10 ? 1 : 0)} d`

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

export const SITE_TYPES = ['Petrol pump', 'Parking lot', 'Shop front', 'Open plot', 'Mall / Commercial complex', 'Metro / Transit hub', 'Residential society', 'Dhaba / Restaurant', 'Other']

export function startOfWeek(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7 // Monday start
  x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x
}
export function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
