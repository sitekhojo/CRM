import { logSignIn } from '../lib/logins'
import { useState } from 'react'
import { Navigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/AppLayout'

export default function Login() {
  const { session, signIn } = useAuth()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('login') // login | forgot

  if (session) return <Navigate to={loc.state?.from || '/app'} replace />

  const submit = async e => {
    e.preventDefault(); setErr(''); setInfo(''); setBusy(true)
    if (mode === 'login') {
      const { error } = await signIn(email.trim(), password)
      if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
      else logSignIn()
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/login' })
      if (error) setErr(error.message); else setInfo('If that email has an account, a reset link is on its way.')
    }
    setBusy(false)
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/"><Logo /></Link>
          <h1 className="mt-8 text-2xl font-extrabold text-navy-900">{mode === 'login' ? 'Log in to your workspace' : 'Reset your password'}</h1>
          <p className="mt-1 text-sm text-slate-500">{mode === 'login' ? 'Use the credentials shared by your admin.' : "We'll email you a reset link."}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block"><span className="label">Email</span>
              <input className="input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            {mode === 'login' && (
              <label className="block"><span className="label">Password</span>
                <input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
            )}
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            {info && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{info}</p>}
            <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Send reset link'}</button>
          </form>
          <button className="mt-4 text-sm font-semibold text-brand-700 hover:underline" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setErr(''); setInfo('') }}>
            {mode === 'login' ? 'Forgot password?' : '← Back to log in'}
          </button>
        </div>
      </div>
      <div className="hidden flex-col justify-center bg-navy-900 p-12 text-white lg:flex">
        <p className="max-w-md text-3xl font-extrabold leading-snug">Every site your team scouts — <span className="text-brand-500">one pipeline, one map, one dashboard.</span></p>
        <ul className="mt-6 space-y-2 text-slate-300">
          <li>• GPS-pinned site capture from the field</li>
          <li>• Stage tracking with days in each stage</li>
          <li>• Instant network feasibility for any location</li>
        </ul>
      </div>
    </div>
  )
}
