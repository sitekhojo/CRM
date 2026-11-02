import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './index.css'
import { configured } from './lib/supabase'
import { AuthProvider, useAuth } from './lib/auth'
import { ConfigProvider } from './lib/config'
import { ToastProvider, PageLoader } from './components/ui'
import AppLayout from './components/AppLayout'
import Home from './pages/Home'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Deals = lazy(() => import('./pages/Deals'))
const Acquisition = lazy(() => import('./pages/Acquisition'))
const DealNew = lazy(() => import('./pages/DealNew'))
const DealDetail = lazy(() => import('./pages/DealDetail'))
const MapPage = lazy(() => import('./pages/MapPage'))
const Planning = lazy(() => import('./pages/Planning'))
const Users = lazy(() => import('./pages/Users'))
const Settings = lazy(() => import('./pages/Settings'))
const LogVisit = lazy(() => import('./pages/LogVisit'))

function RequireAuth({ children, admin }) {
  const { session, profile, loading, isAdmin } = useAuth()
  const loc = useLocation()
  if (session === undefined || loading) return <div className="flex h-full items-center justify-center"><PageLoader /></div>
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (profile && !profile.is_active) return <Inactive />
  if (admin && !isAdmin) return <Navigate to="/app/deals" replace />
  return children
}

function Inactive() {
  const { signOut } = useAuth()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-bold">Your account is deactivated</p>
      <p className="text-sm text-slate-500">Ask your admin to re-activate it.</p>
      <button className="btn-secondary" onClick={signOut}>Sign out</button>
    </div>
  )
}

function AppHome() {
  const { isAdmin } = useAuth()
  return <Navigate to="/app/dashboard" replace />
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-xl font-bold">Supabase is not configured</h1>
      <p className="mt-2 text-slate-600">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (Vercel → Settings → Environment Variables), then redeploy.</p>
    </div>
  )
}

function App() {
  if (!configured) return <NotConfigured />
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/app" element={<RequireAuth><ConfigProvider><AppLayout /></ConfigProvider></RequireAuth>}>
              <Route index element={<AppHome />} />
              <Route path="dashboard" element={<Lazy><Dashboard /></Lazy>} />
              <Route path="leads" element={<Lazy><Deals key="lead" fixedType="lead" /></Lazy>} />
              <Route path="deals" element={<Lazy><Deals key="deal" fixedType="deal" /></Lazy>} />
              <Route path="all" element={<Lazy><Deals key="all" /></Lazy>} />
              <Route path="deals/new" element={<Lazy><DealNew /></Lazy>} />
              <Route path="deals/:id" element={<Lazy><DealDetail /></Lazy>} />
              <Route path="visit" element={<Lazy><LogVisit /></Lazy>} />
              <Route path="acquisition" element={<Lazy><Acquisition /></Lazy>} />
              <Route path="map" element={<Lazy><MapPage /></Lazy>} />
              <Route path="planning" element={<Lazy><Planning /></Lazy>} />
              <Route path="admin/users" element={<RequireAuth admin><Lazy><Users /></Lazy></RequireAuth>} />
              <Route path="admin/settings" element={<RequireAuth admin><Lazy><Settings /></Lazy></RequireAuth>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}

const Lazy = ({ children }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
