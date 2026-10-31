import { useEffect, useState } from 'react'
import { UserPlus, KeyRound } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useConfig } from '../lib/config'
import { useAuth } from '../lib/auth'
import { Modal, Field, useToast } from '../components/ui'
import { fmtDate, timeAgo } from '../lib/format'

async function adminApi(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('/api/admin-users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}

const genPassword = () => 'Sk-' + Math.random().toString(36).slice(2, 8) + Math.floor(100 + Math.random() * 900)

export default function Users() {
  const { users = [], reload } = useConfig()
  const { profile } = useAuth()
  const toast = useToast()
  const [lastSeen, setLastSeen] = useState({})
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'team', password: genPassword() })
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [pwFor, setPwFor] = useState(null)
  const [newPw, setNewPw] = useState('')

  useEffect(() => { adminApi({ action: 'last_sign_in' }).then(setLastSeen).catch(() => {}) }, [])

  const patch = async (id, p) => {
    const { error } = await supabase.from('profiles').update(p).eq('id', id)
    if (error) return toast(errMsg(error), 'error')
    toast('User updated'); reload()
  }

  const create = async e => {
    e.preventDefault(); setBusy(true)
    try {
      await adminApi({ action: 'create', ...form })
      setCreated({ email: form.email, password: form.password })
      setForm({ full_name: '', email: '', phone: '', role: 'team', password: genPassword() })
      reload()
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  const setPassword = async () => {
    try { await adminApi({ action: 'set_password', user_id: pwFor.id, password: newPw }); toast(`Password updated for ${pwFor.full_name}`); setPwFor(null) }
    catch (err) { toast(err.message, 'error') }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="mr-auto"><h1 className="text-xl font-extrabold text-navy-900">Users</h1><p className="text-sm text-slate-500">{users.filter(u => u.is_active).length} active · {users.length} total</p></div>
        <button className="btn-primary" onClick={() => { setAdding(true); setCreated(null) }}><UserPlus className="h-4 w-4" />Add user</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Phone</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last login</th><th className="th">Added</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className={u.is_active ? '' : 'bg-slate-50 text-slate-400'}>
                <td className="td"><input className="input w-44 py-1" defaultValue={u.full_name} onBlur={e => e.target.value !== u.full_name && patch(u.id, { full_name: e.target.value })} /></td>
                <td className="td">{u.email}</td>
                <td className="td"><input className="input w-32 py-1" defaultValue={u.phone || ''} onBlur={e => e.target.value !== (u.phone || '') && patch(u.id, { phone: e.target.value || null })} /></td>
                <td className="td">
                  <select className="input w-auto py-1" value={u.role} disabled={u.id === profile.id} onChange={e => patch(u.id, { role: e.target.value })}>
                    <option value="team">Team</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td className="td">
                  <button disabled={u.id === profile.id} onClick={() => patch(u.id, { is_active: !u.is_active })}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{u.is_active ? 'Active' : 'Deactivated'}</button>
                </td>
                <td className="td text-slate-500">{lastSeen[u.id] ? timeAgo(lastSeen[u.id]) : '—'}</td>
                <td className="td text-slate-500">{fmtDate(u.created_at)}</td>
                <td className="td"><button className="btn-ghost py-1 text-xs" onClick={() => { setPwFor(u); setNewPw(genPassword()) }}><KeyRound className="h-3.5 w-3.5" />Reset password</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Deactivated users can no longer see or change any data. Their deals and history are kept.</p>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add user">
        {created ? (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-emerald-700">User created. Share these login details:</p>
            <pre className="rounded-lg bg-slate-100 p-3 text-sm">{`Website: ${window.location.origin}/login\nEmail:   ${created.email}\nPassword: ${created.password}`}</pre>
            <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(`Site Khojo login\n${window.location.origin}/login\nEmail: ${created.email}\nPassword: ${created.password}`).then(() => toast('Copied'))}>Copy</button>
            <button className="btn-primary ml-2" onClick={() => setCreated(null)}>Add another</button>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-3">
            <Field label="Full name"><input className="input" required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label="Email (login id)"><input className="input" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Role"><select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="team">Team — scout & manage own deals</option><option value="admin">Admin — full access</option></select></Field>
            <Field label="Initial password" hint="At least 8 characters. They can change it after logging in."><input className="input font-mono" required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
          </form>
        )}
      </Modal>

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`Reset password — ${pwFor?.full_name}`}
        footer={<><button className="btn-secondary" onClick={() => setPwFor(null)}>Cancel</button><button className="btn-primary" disabled={newPw.length < 8} onClick={setPassword}>Set password</button></>}>
        <Field label="New password"><input className="input font-mono" value={newPw} onChange={e => setNewPw(e.target.value)} /></Field>
      </Modal>
    </div>
  )
}
