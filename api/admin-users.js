// Vercel serverless function: admin-only user management.
// Uses the Supabase service-role key, which stays on the server (never sent to browsers).
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!url || !serviceKey) return res.status(500).json({ error: 'Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Who is calling? Must be an active admin.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Not signed in' })
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return res.status(401).json({ error: 'Invalid session' })
  const { data: prof } = await admin.from('profiles').select('role,is_active').eq('id', caller.user.id).single()
  if (!prof || prof.role !== 'admin' || !prof.is_active) return res.status(403).json({ error: 'Admins only' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

  try {
    switch (body.action) {
      case 'create': {
        const email = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        const role = body.role === 'admin' ? 'admin' : 'team'
        if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Valid email required' })
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { full_name: body.full_name || '' },
          app_metadata: { role },
        })
        if (error) return res.status(400).json({ error: error.message })
        if (body.phone) await admin.from('profiles').update({ phone: body.phone }).eq('id', data.user.id)
        return res.status(200).json({ id: data.user.id })
      }
      case 'set_password': {
        if (String(body.password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password })
        if (error) return res.status(400).json({ error: error.message })
        return res.status(200).json({ ok: true })
      }
      case 'last_sign_in': {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
        if (error) return res.status(400).json({ error: error.message })
        return res.status(200).json(Object.fromEntries(data.users.map(u => [u.id, u.last_sign_in_at])))
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
