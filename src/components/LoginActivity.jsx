import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, LogIn, Smartphone, Monitor, Tablet } from 'lucide-react'
import { supabase, fetchAll, errMsg } from '../lib/supabase'
import { deviceId } from '../lib/logins'
import { useToast } from './ui'

const istDay = (d = new Date()) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10)
const addDays = (day, n) => { const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const fmtDay = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
const fmtTime = d => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
const DevIcon = ({ d }) => { const I = d === 'Phone' ? Smartphone : d === 'Tablet' ? Tablet : Monitor; return <I className="inline h-3.5 w-3.5 text-slate-400" /> }

/** Admin view: sign-ins and app opens per day, per account and per device. */
export default function LoginActivity() {
  const toast = useToast()
  const today = istDay()
  const [day, setDay] = useState(today)
  const [events, setEvents] = useState(null)
  const from = addDays(today, -13)

  useEffect(() => {
    fetchAll(() => supabase.from('login_events').select('*').gte('day', addDays(day < from ? day : from, 0)).order('at'))
      .then(setEvents).catch(e => { toast(errMsg(e), 'error'); setEvents([]) })
  }, [day < from ? day : from]) // eslint-disable-line

  const m = useMemo(() => {
    if (!events) return null
    const inDay = events.filter(e => e.day === day)
    const accounts = [...new Set(events.map(e => e.email || '—'))].sort()
    const devName = {}
    events.forEach(e => { if (e.member_hint) devName[e.device_id] = e.member_hint })
    const days = []; for (let d = from; d <= today; d = addDays(d, 1)) days.push(d)
    const grid = accounts.map(a => ({ a, cells: days.map(d => { const xs = events.filter(e => e.day === d && (e.email || '—') === a); return { signIns: xs.filter(e => e.event === 'sign_in').length, devices: new Set(xs.map(e => e.device_id)).size } }) }))
    const devices = Object.values(inDay.reduce((o, e) => {
      const k = e.device_id || e.id
      o[k] = o[k] || { id: k, email: e.email, device: e.device, browser: e.browser, name: devName[e.device_id], first: e.at, last: e.at, signIns: 0 }
      o[k].last = e.at; if (e.event === 'sign_in') o[k].signIns++
      return o
    }, {}))
    return { inDay, days, grid, devices, signIns: inDay.filter(e => e.event === 'sign_in').length }
  }, [events, day, from, today])

  const mine = deviceId()
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-lg font-extrabold text-navy-900"><LogIn className="h-5 w-5" />Login activity</h2>
        <div className="flex items-center rounded-lg border border-slate-300 bg-white">
          <button className="px-2 py-1.5 text-slate-500 hover:text-slate-900" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" className="border-0 bg-transparent px-1 py-1 text-sm font-semibold focus:ring-0" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} />
          <button className="px-2 py-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      {!m ? <div className="card p-6 text-center text-sm text-slate-400">Loading…</div> : <>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Sign-ins {day === today ? 'today' : fmtDay(day)}</p><p className="text-2xl font-extrabold text-navy-900">{m.signIns}</p><p className="text-xs text-slate-500">typed email and password</p></div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">Devices that used SiteKhojo</p><p className="text-2xl font-extrabold text-brand-700">{m.devices.length}</p><p className="text-xs text-slate-500">phones and computers, incl. already logged in</p></div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-500">By account</p>
            {[...new Set(m.devices.map(d => d.email))].map(a => <p key={a} className="truncate text-sm"><b>{m.devices.filter(d => d.email === a).length}</b> <span className="text-slate-500">device(s) · {a}</span></p>)}
            {!m.devices.length && <p className="text-sm text-slate-400">No activity</p>}</div>
        </div>

        <div className="card mb-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Device</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Likely person</th><th className="px-3 py-2 text-right">Sign-ins</th><th className="px-3 py-2">First seen</th><th className="px-3 py-2">Last seen</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {m.devices.map(d => (
                <tr key={d.id}>
                  <td className="px-3 py-2"><DevIcon d={d.device} /> {d.device} · <span className="text-slate-500">{d.browser}</span>{d.id === mine && <span className="ml-1 rounded bg-brand-50 px-1.5 text-[11px] font-semibold text-brand-700">this device</span>}</td>
                  <td className="px-3 py-2">{d.email}</td>
                  <td className="px-3 py-2">{d.name || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-right font-semibold">{d.signIns || '—'}</td>
                  <td className="px-3 py-2">{fmtTime(d.first)}</td><td className="px-3 py-2">{fmtTime(d.last)}</td>
                </tr>
              ))}
              {!m.devices.length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">No logins or app opens on this day.</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-slate-100 p-3 text-xs text-slate-500">Each phone or computer is counted once a day. "Likely person" is the name last picked on Log visit on that device, which helps tell people apart on the shared team login.</p>
        </div>

        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left uppercase tracking-wide">Last 14 days</th>{m.days.map(d => <th key={d} className="px-2 py-2 text-center font-semibold">{fmtDay(d).replace(/^\w+, /, '')}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {m.grid.map(g => (
                <tr key={g.a}><td className="whitespace-nowrap px-3 py-2 font-semibold">{g.a}</td>
                  {g.cells.map((c, i) => (
                    <td key={i} className="px-1 py-1 text-center">
                      <button onClick={() => setDay(m.days[i])} title={`${c.signIns} sign-ins · ${c.devices} devices`}
                        className={`min-w-[2.5rem] rounded px-1.5 py-1 text-xs ${m.days[i] === day ? 'ring-2 ring-brand-500' : ''} ${c.devices ? 'bg-emerald-50 text-emerald-800' : 'text-slate-300'}`}>
                        {c.devices ? <><b>{c.devices}</b><span className="text-[10px]">d</span>{c.signIns ? <> · {c.signIns}<span className="text-[10px]">s</span></> : ''}</> : '–'}
                      </button>
                    </td>
                  ))}</tr>
              ))}
              {!m.grid.length && <tr><td colSpan={15} className="p-6 text-center text-slate-400">Tracking starts now. Activity appears here as people log in.</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-slate-100 p-3 text-xs text-slate-500"><b>d</b> = devices that used the account that day · <b>s</b> = sign-ins. Click a day to see its devices.</p>
        </div>
      </>}
    </div>
  )
}
