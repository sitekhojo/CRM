import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [recovery, setRecovery] = useState(false)

  const loadProfile = useCallback(async (s) => {
    if (!s) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).single()
    setProfile(data || null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadProfile(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') loadProfile(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  globalThis.__skCanExport = profile?.role === 'admin' && !!profile?.is_active
  globalThis.__skActive = !!profile?.is_active
  const value = {
    session, profile,
    user: session?.user || null,
    loading: session === undefined || (session && !profile),
    isAdmin: profile?.role === 'admin' && profile?.is_active,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
    reloadProfile: () => loadProfile(session),
    recovery, clearRecovery: () => setRecovery(false),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
