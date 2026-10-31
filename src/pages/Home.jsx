import { Link } from 'react-router-dom'
import { MapPinned, KanbanSquare, Radar, BarChart3, ShieldCheck, Smartphone, ArrowRight } from 'lucide-react'
import { Logo } from '../components/AppLayout'
import { useAuth } from '../lib/auth'

const FEATURES = [
  { icon: MapPinned, title: 'Scout from the field', text: 'Pin the exact GPS location, capture landlord, rent and power details in under two minutes from any phone.' },
  { icon: KanbanSquare, title: 'Deal pipeline', text: 'Every site moves through clear stages — from lead to live — with full history and time spent at each step.' },
  { icon: Radar, title: 'Network planning', text: 'Drop any lat/long and instantly see whether it fits the network: distance to stations, competition, demand.' },
  { icon: BarChart3, title: 'One-stop visibility', text: 'City, stage and team-wise dashboards, SLA breaches and turnaround times — live, for the whole team.' },
  { icon: ShieldCheck, title: 'Secure by role', text: 'Admins see and control everything; field teams work on the deals they own.' },
  { icon: Smartphone, title: 'Works everywhere', text: 'Built for the phone in the field and the laptop in the office. Export to Excel any time.' },
]

export default function Home() {
  const { session } = useAuth()
  return (
    <div className="min-h-full bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link to={session ? '/app' : '/login'} className="btn-primary">{session ? 'Open app' : 'Log in'}</Link>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-10 lg:grid-cols-2 lg:pt-16">
          <div>
            <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700">Site scouting & network planning</span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-navy-900 sm:text-5xl">
              Find, track and close the right sites for your <span className="text-brand-600">network</span>.
            </h1>
            <p className="mt-4 max-w-lg text-lg text-slate-600">Site Khojo brings every scouted location, every landlord conversation and every stage change into one place — so expansion moves faster and nothing gets stuck.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={session ? '/app' : '/login'} className="btn-primary px-5 py-3 text-base">{session ? 'Go to dashboard' : 'Log in to your workspace'} <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
          <HeroMock />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200 p-6">
              <div className="mb-3 inline-flex rounded-xl bg-brand-50 p-2.5"><Icon className="h-5 w-5 text-brand-600" /></div>
              <h3 className="font-bold text-navy-900">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} Site Khojo · Internal tool — access by invitation only</footer>
    </div>
  )
}

function HeroMock() {
  const cols = [['New Lead', '#94a3b8', 12], ['Scouted', '#3b82f6', 9], ['Negotiation', '#f59e0b', 5], ['Approved', '#14b8a6', 3], ['Live', '#22c55e', 7]]
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-brand-900/10">
      <div className="mb-3 flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /></div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[['Total sites', '248'], ['This week', '+64'], ['Beyond SLA', '6']].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-slate-50 p-2.5"><p className="text-[10px] font-semibold uppercase text-slate-400">{l}</p><p className="text-lg font-bold text-navy-900">{v}</p></div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {cols.map(([n, c, k]) => (
          <div key={n} className="rounded-lg bg-slate-50 p-1.5">
            <p className="truncate text-[10px] font-bold text-slate-500">{n} <span className="text-slate-400">{k}</span></p>
            {Array.from({ length: Math.min(3, Math.ceil(k / 3)) }).map((_, i) => (
              <div key={i} className="mt-1.5 rounded-md border-l-4 bg-white p-1.5 shadow-sm" style={{ borderColor: c }}>
                <div className="h-1.5 w-3/4 rounded bg-slate-200" /><div className="mt-1 h-1.5 w-1/2 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
