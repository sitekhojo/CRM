import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom'
import { LayoutDashboard, Handshake, Target, Crosshair, Map as MapIcon, Radar, Users, Settings, Plus, LogOut, Menu, X, Search, KeyRound, MapPinPlus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { Modal, Field, useToast } from './ui'

const NAV = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/leads', label: 'Leads', icon: Target },
  { to: '/app/deals', label: 'Deals', icon: Handshake },
  { to: '/app/acquisition', label: 'Acquisition Desk', icon: Crosshair },
  { to: '/app/visit', label: 'Log visit', icon: MapPinPlus },
  { to: '/app/map', label: 'Map', icon: MapIcon },
  { to: '/app/planning', label: 'Network Planning', icon: Radar },
]
const ADMIN_NAV = [
  { to: '/app/admin/users', label: 'Users', icon: Users },
  { to: '/app/admin/settings', label: 'Settings', icon: Settings },
]

export function Logo({ light = false }) {
  return (
    <span className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className={`text-lg font-extrabold tracking-tight ${light ? 'text-white' : 'text-navy-900'}`}>Site<span className="text-brand-500">Khojo</span></span>
    </span>
  )
}

export default function AppLayout() {
  const { profile, isAdmin, signOut, recovery, clearRecovery } = useAuth()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [q, setQ] = useState('')
  const nav = useNavigate()

  const link = ({ to, label, icon: Icon }) => (
    <NavLink key={to} to={to} end={to === '/app/deals'} onClick={() => setOpen(false)}
      className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
      <Icon className="h-4.5 w-4.5" />{label}
    </NavLink>
  )

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 px-3 py-4">
      <Link to="/app" className="mb-6 px-2"><Logo light /></Link>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.filter(n => !n.admin || isAdmin).map(link)}
        {isAdmin && <>
          <p className="mb-1 mt-5 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Admin</p>
          {ADMIN_NAV.map(link)}
        </>}
      </nav>
      <div className="mt-4 rounded-lg bg-white/5 p-3">
        <p className="truncate text-sm font-semibold text-white">{profile?.full_name}</p>
        <p className="truncate text-xs text-slate-400">{profile?.email}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${isAdmin ? 'bg-brand-500 text-white' : 'bg-slate-600 text-slate-100'}`}>{profile?.role}</span>
          <span className="flex gap-3">
            <button onClick={() => setPwOpen(true)} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white" title="Change password"><KeyRound className="h-3.5 w-3.5" /></button>
            <button onClick={signOut} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-[1100] flex lg:hidden">
          <div className="w-64">{sidebar}</div>
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)}>
            <button className="m-3 rounded-full bg-white p-1.5"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[500] flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
          <button className="btn-ghost p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <form className="relative max-w-md flex-1" onSubmit={e => { e.preventDefault(); nav(`/app/all?q=${encodeURIComponent(q)}`) }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input bg-slate-50 pl-9" placeholder="Search deals, landlords, pincodes…" value={q} onChange={e => setQ(e.target.value)} />
          </form>
          <div className="flex-1" />
          <Link to="/app/visit" className="btn-secondary" title="Log a field visit"><MapPinPlus className="h-4 w-4" /><span className="hidden sm:inline">Log visit</span></Link>
          <Link to="/app/deals/new?type=lead" className="btn-secondary"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Create lead</span><span className="sm:hidden">Lead</span></Link>
          <Link to="/app/deals/new" className="btn-primary"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Create deal</span><span className="sm:hidden">Deal</span></Link>
        </header>
        <UpdateBanner />
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
        <ChangePassword open={pwOpen || recovery} onClose={() => { setPwOpen(false); clearRecovery() }} />
      </div>
    </div>
  )
}

function ChangePassword({ open, onClose }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast('Password changed'); setPw(''); setPw2(''); onClose()
  }
  const ok = pw.length >= 8 && pw === pw2
  return (
    <Modal open={open} onClose={onClose} title="Change password"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!ok || busy} onClick={save}>Save</button></>}>
      <div className="space-y-3">
        <Field label="New password" hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
        <Field label="Confirm"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></Field>
        {pw2 && pw !== pw2 && <p className="text-sm text-red-600">Passwords don't match</p>}
      </div>
    </Modal>
  )
}

/** Checks every few minutes (and when the tab regains focus) whether a newer version is deployed. */
function UpdateBanner() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const mine = [...document.querySelectorAll('script[type="module"][src]')].map(x => new URL(x.src).pathname).find(p => p.includes('/assets/'))
    if (!mine) return
    const check = async () => {
      try {
        const html = await (await fetch('/index.html?v=' + Date.now(), { cache: 'no-store' })).text()
        if (!html.includes(mine)) setStale(true)
      } catch { /* offline */ }
    }
    const t = setInterval(check, 3 * 60 * 1000)
    const onFocus = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onFocus)
    check()
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus) }
  }, [])
  if (!stale) return null
  return (
    <div className="flex items-center justify-center gap-3 bg-brand-600 px-3 py-2 text-sm font-semibold text-white">
      A newer version of SiteKhojo is available.
      <button className="rounded-md bg-white px-2.5 py-1 text-brand-700" onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
