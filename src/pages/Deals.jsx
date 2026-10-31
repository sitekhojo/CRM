import { useMemo, useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Table2, Columns3, Download, Upload, Plus, AlertTriangle, Handshake, ArrowUpDown } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS } from '../lib/deals'
import { useAuth } from '../lib/auth'
import { useConfig, stagesFor } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { StageBadge, PageLoader, Empty, Pill } from '../components/ui'
import { fmtDate, fmtINR, daysLabel, POWER_FEASIBILITY, RECORD_TYPES } from '../lib/format'
import { exportRows, DEAL_COLUMNS } from '../lib/excel'
import ImportDealsModal from '../components/ImportDealsModal'

export default function Deals() {
  const { deals, loading, reload } = useDeals()
  const { stages = [] } = useConfig()
  const { user, isAdmin } = useAuth()
  const [params] = useSearchParams()
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, q: params.get('q') || '', overdue: params.get('overdue') === '1', stage: params.get('stage') ? params.get('stage').split(',') : [], city: params.get('city') ? params.get('city').split(',') : [], recordType: params.get('type') || '', age: params.get('age') || '' })
  const [view, setView] = useState(() => localStorage.getItem('dealsView') || 'table')
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })
  const [importOpen, setImportOpen] = useState(false)
  const nav = useNavigate()

  useEffect(() => { setFilters(f => ({ ...f, q: params.get('q') || f.q })) }, [params])
  useEffect(() => { try { localStorage.setItem('dealsView', view) } catch { /* ignore */ } }, [view])

  const rows = useMemo(() => {
    if (!deals) return []
    const r = applyFilters(deals, filters, user?.id).map(d => ({ ...d, qis: d.extra?.qis_count ?? null }))
    const { key, dir } = sort
    return [...r].sort((a, b) => {
      const x = a[key], y = b[key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (x > y ? 1 : -1) * (dir === 'asc' ? 1 : -1)
    })
  }, [deals, filters, sort, user])

  if (loading) return <PageLoader />

  const SortTh = ({ k, children, className = '' }) => (
    <th className={`th cursor-pointer select-none hover:text-slate-800 ${className}`} onClick={() => setSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      <span className="inline-flex items-center gap-1">{children}<ArrowUpDown className={`h-3 w-3 ${sort.key === k ? 'text-brand-600' : 'text-slate-300'}`} /></span>
    </th>
  )

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-navy-900">Leads & Deals</h1>
          <p className="text-sm text-slate-500">{rows.length} of {deals.length} sites</p>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
          {[['table', Table2, 'Table'], ['board', Columns3, 'Board']].map(([v, Icon, l]) => (
            <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? 'bg-navy-900 text-white' : 'text-slate-600'}`}><Icon className="h-4 w-4" />{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => exportRows(flatten(rows), DEAL_COLUMNS, `sitekhojo-deals-${new Date().toISOString().slice(0, 10)}`)}><Download className="h-4 w-4" />Excel</button>
          <button className="btn-secondary" onClick={() => exportRows(flatten(rows), DEAL_COLUMNS, `sitekhojo-deals-${new Date().toISOString().slice(0, 10)}`, 'csv')}>CSV</button>
          {isAdmin && <button className="btn-secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />Import</button>}
        </div>
      </div>

      {filters.age && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing sites pending <b>{filters.age.replace('-', '–').replace(/–$/, '+')} days</b> in their current stage
          <button className="ml-auto font-semibold underline" onClick={() => setFilters({ ...filters, age: '' })}>Clear</button>
        </div>
      )}
      <div className="mb-4">
        <DealFilters value={filters} onChange={setFilters}
          extra={<label className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <input type="checkbox" checked={filters.mine} onChange={e => setFilters({ ...filters, mine: e.target.checked })} className="accent-brand-600" /> My deals</label>} />
      </div>

      {deals.length === 0 ? (
        <div className="card"><Empty icon={Handshake} title="No leads or deals yet">
          <Link to="/app/deals/new" className="btn-primary mt-3"><Plus className="h-4 w-4" />Create your first deal</Link></Empty></div>
      ) : view === 'table' ? (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <SortTh k="site_code">ID</SortTh><SortTh k="record_type">Type</SortTh><SortTh k="name">Site</SortTh><SortTh k="stage_order">Stage</SortTh>
                <SortTh k="qis">QIS</SortTh><SortTh k="days_in_stage">In stage</SortTh><SortTh k="city">City</SortTh><SortTh k="rent_expectation">Rent</SortTh>
                <th className="th">Power</th><SortTh k="assigned_to_name">Owner</SortTh><SortTh k="created_at">Created</SortTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(d => (
                <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/app/deals/${d.id}`)}>
                  <td className="td font-mono text-xs text-slate-500">{d.site_code}</td>
                  <td className="td"><Pill className={RECORD_TYPES[d.record_type || 'deal'].cls}>{RECORD_TYPES[d.record_type || 'deal'].label}</Pill></td>
                  <td className="td max-w-[260px]"><div className="truncate font-semibold text-slate-900">{d.name}</div><div className="truncate text-xs text-slate-500">{[d.site_type, d.address].filter(Boolean).join(' · ') || '—'}</div></td>
                  <td className="td"><StageBadge name={d.stage_name} color={d.stage_color} /></td>
                  <td className="td font-semibold">{d.qis ?? '—'}</td>
                  <td className="td">
                    <span className={d.is_overdue ? 'inline-flex items-center gap-1 font-semibold text-red-600' : ''}>
                      {d.is_overdue && <AlertTriangle className="h-3.5 w-3.5" />}{daysLabel(d.days_in_stage)}
                    </span>
                    {d.stage_sla_days && <span className="text-xs text-slate-400"> / {d.stage_sla_days}d</span>}
                  </td>
                  <td className="td">{d.city}</td>
                  <td className="td">{fmtINR(d.rent_expectation)}</td>
                  <td className="td"><Pill className={POWER_FEASIBILITY[d.power_feasibility]?.cls}>{POWER_FEASIBILITY[d.power_feasibility]?.label}</Pill></td>
                  <td className="td">{d.assigned_to_name || '—'}</td>
                  <td className="td text-slate-500">{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty title="No deals match these filters" />}
        </div>
      ) : (
        <Board rows={rows} stages={stagesFor(stages, filters.siteType)} />
      )}
      <ImportDealsModal open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
    </div>
  )
}

const flatten = rows => rows.map(r => ({ ...r, ...(r.extra || {}) }))

function Board({ rows, stages }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex gap-3">
        {stages.map(s => {
          const items = rows.filter(r => r.stage_id === s.id)
          const overdue = items.filter(r => r.is_overdue).length
          return (
            <div key={s.id} className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100">
              <div className="flex items-center gap-2 border-t-4 px-3 py-2.5" style={{ borderColor: s.color, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                <span className="text-sm font-bold text-slate-800">{s.name}</span>
                <span className="rounded-full bg-white px-2 text-xs font-bold text-slate-500">{items.length}</span>
                {items.some(r => r.qis) && <span className="text-xs text-slate-500">{items.reduce((a, r) => a + (r.qis || 0), 0)} QIS</span>}
                {overdue > 0 && <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-red-600"><AlertTriangle className="h-3 w-3" />{overdue}</span>}
              </div>
              <div className="flex max-h-[calc(100vh-280px)] flex-col gap-2 overflow-y-auto p-2">
                {items.map(d => (
                  <Link key={d.id} to={`/app/deals/${d.id}`} className={`block rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md ${d.is_overdue ? 'border-red-300' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold leading-snug text-slate-900">{d.name}</span>
                      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-400">{d.site_code}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Pill className={RECORD_TYPES[d.record_type || 'deal'].cls}>{RECORD_TYPES[d.record_type || 'deal'].label}</Pill>
                      <span className="truncate">{d.city}{d.site_type ? ` · ${d.site_type}` : ''}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-600">{d.qis ? <b>{d.qis} QIS · </b> : ''}{d.assigned_to_name || '—'}</span>
                      <span className={`font-semibold ${d.is_overdue ? 'text-red-600' : 'text-slate-500'}`}>{daysLabel(d.days_in_stage)}</span>
                    </div>
                  </Link>
                ))}
                {items.length === 0 && <p className="py-4 text-center text-xs text-slate-400">No deals</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
