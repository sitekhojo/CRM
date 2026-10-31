import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import DealForm from '../components/DealForm'
import { supabase, errMsg } from '../lib/supabase'
import { useToast } from '../components/ui'
import { validLatLng } from '../lib/geo'

export default function DealNew() {
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const lat = parseFloat(params.get('lat')), lng = parseFloat(params.get('lng'))
  const initialLoc = validLatLng(lat, lng) ? { lat, lng, source: 'map' } : undefined

  const submit = async payload => {
    setBusy(true)
    if (!payload.assigned_to) delete payload.assigned_to
    const { data, error } = await supabase.from('sites').insert(payload).select('id, site_code').single()
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast(`Deal ${data.site_code} created`)
    nav(`/app/deals/${data.id}`, { replace: true })
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link to="/app/deals" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Deals</Link>
      <h1 className="mb-4 text-xl font-extrabold text-navy-900">Create deal</h1>
      <DealForm onSubmit={submit} submitting={busy} initialLoc={initialLoc} />
    </div>
  )
}
