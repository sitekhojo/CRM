import { useMemo, useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Table2, Columns3, Download, Upload, Plus, Handshake, ArrowUpDown } from 'lucide-react'
import { useDeals, applyFilters, EMPTY_FILTERS } from '../lib/deals'
import { useAuth } from '../lib/auth'
import { useConfig, stagesFor } from '../lib/config'
import DealFilters from '../components/DealFilters'
import { SingleSelect } from '../components/MultiSelect'
import PeriodBar, { periodRange, periodLabel, isoDay } from '../components/PeriodBar'
import { StageBadge, PageLoader, Empty, Pill } from '../components/ui'
import { fmtDate, fmtINR, daysInt, stageAgeTone, AGE_TONES, POWER_FEASIBILITY, RECORD_TYPES, INTENTS, SITE_FORMATS } from '../lib/format'
import { exportRows, DEAL_COLUMNS } from '../lib/excel'
import ImportDealsModal from '../components/ImportDealsModal'
import StageCell from '../components/StageCell'
import TypeCell from '../components/TypeCell'
import OwnerCell from '../components/OwnerCell'
import DateCell from '../components/DateCell'
import IntentCell from '../components/IntentCell'
import { useTargets, matchSite, PRIORITIES, monthLabel } from '../lib/acquisition'

export default function Deals({ fixedType }) {
  const { deals, loading, reload } = useDeals()
  const { stages = [] } = useConfig()
  const { user, isAdmin } = useAuth()
  const [params] = useSearchParams()
  const list = k => (params.get(k) ? params.get(k).split(',') : [])
  const [filters, setFilters] = useState({
    ...EMPTY_FILTERS, q: params.get('q') || '', stage: list('stage'), city: list('city'), siteType: list('siteType'), region: list('region'), owner: list('owner'),
    recordType: fixedType || params.get('type') || '', age: params.get('age') || '', from: params.get('from') || '', to: params.get('to') || '',
    ho: params.get('ho') || '', en: params.get('en') || '', openOnly: params.get('open') === '1', inPipe: params.get('inp') || '', pipeAt: params.get('at') || '', exit: params.get('exit') || '', worked: params.get('worked') || '',
  })
  const fromCard = params.get('card')
  const [pkind, setPkind] = useState(params.get('from') || params.get('to') || (params.get('inp') && params.get('inp') !== ',') ? 'custom' : 'all')
  const [pmode, setPmode] = useState(params.get('inp') ? 'pipe' : 'added') // added in period | in pipeline during period
  const onPeriod = v => {
    setPkind(v.kind)
    applyPeriod(v.kind, v.from, v.to, pmode)
  }
  const curRange = () => { const [a = '', b = ''] = (filters.inPipe || '').split(','); return filters.inPipe ? [a, b] : [filters.from, filters.to] }
  const applyPeriod = (kind, from, to, mode) => {
    let a = '', b = ''
    if (kind === 'custom') { a = from || ''; b = to || '' } else if (kind !== 'all') { const [x, y] = periodRange({ kind }); a = isoDay(x); b = isoDay(y) }
    setFilters(f => (mode === 'pipe' && kind !== 'all' ? { ...f, from: '', to: '', inPipe: `${a},${b}` } : { ...f, from: a, to: b, inPipe: '' }))
  }
  useEffect(() => { if (!filters.from && !filters.to && !filters.inPipe && !['all', 'custom'].includes(pkind)) setPkind('all') }, [filters.from, filters.to, filters.inPipe]) // eslint-disable-line
  const [rA, rB] = curRange()
  const pLabel = periodLabel({ kind: pkind }, ...periodRange({ kind: pkind, from: rA, to: rB }))
  const [view, setView] = useState(() => localStorage.getItem('dealsView') || 'table')
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })
  const [importOpen, setImportOpen] = useState(false)
  const nav = useNavigate()
  const { targets } = useTargets()

  useEffect(() => { setFilters(f => ({ ...f, q: params.get('q') || f.q })) }, [params])
  useEffect(() => { try { localStorage.setItem('dealsView', view) } catch { /* ignore */ } }, [view])

  const rows = useMemo(() => {
    if (!deals) return []
    const r = applyFilters(deals, filters, user?.id).map(d => { const t = matchSite(d, targets); return { ...d, qis: d.extra?.qis_count ?? null, ho_sort: d.extra?.ho_date ?? null, intent_sort: { hot: 1, warm: 2, cold: 3 }[d.extra?.intent] ?? null, en_sort: d.extra?.energized_on ?? null, target: t, target_priority: t?.priority || null, target_name: t?.name || null, target_month_label: t ? monthLabel(t.target_month) : null } })
    const { key, dir } = sort
    return [...r].sort((a, b) => {
      const x = a[key], y = b[key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (x > y ? 1 : -1) * (dir === 'asc' ? 1 : -1)
    })
  }, [deals, filters, sort, user, targets])

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
          <h1 className="text-xl font-extrabold text-navy-900">{fixedType === 'lead' ? 'Leads' : fixedType === 'deal' ? 'Deals' : 'Leads & Deals'}</h1>
          <p className="text-sm text-slate-500">{rows.length} of {fixedType ? deals.filter(d => (d.record_type || 'deal') === fixedType).length : deals.length} {fixedType ? `${fixedType}s` : 'sites'} · <b className="text-slate-700">{rows.reduce((a, r) => a + (Number(r.qis) || 0), 0)} QIS</b></p>
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

      {fromCard && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          From dashboard: <b>{fromCard}</b>
          {filters.from && <> · added {filters.from} → {filters.to || 'today'}</>}
          {filters.inPipe && <> · {filters.inPipe === ',' ? 'open pipeline (excl. dropped & energized)' : `in pipeline ${filters.inPipe.replace(',', ' → ')}`}</>}
          {filters.ho && <> · handed over {filters.ho.replace(',', ' → ')}</>}
          {filters.en && <> · energized {filters.en.replace(',', ' → ')}</>}
          {filters.openOnly && <> · excluding dropped</>}
          {filters.pipeAt && <> · in pipeline at end of {filters.pipeAt}</>}
          {filters.worked && <> · in pipeline at some point {filters.worked.replace(',', ' → ')}</>}
          {filters.exit && <> · {filters.exit.startsWith('ho') ? 'handed over' : 'dropped'} {filters.exit.split(',').slice(1).join(' → ')}</>}
          <button className="ml-auto font-semibold underline" onClick={() => setFilters({ ...EMPTY_FILTERS, recordType: fixedType || '' })}>Show all</button>
        </div>
      )}
      {filters.age && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing sites pending <b>{filters.age.replace('-', '–').replace(/–$/, '+')} days</b> in their current stage
          <button className="ml-auto font-semibold underline" onClick={() => setFilters({ ...filters, age: '' })}>Clear</button>
        </div>
      )}
      <div className="mb-4">
        <DealFilters value={filters} onChange={f => setFilters({ ...f, recordType: fixedType || f.recordType })} show={['q', 'region', 'city', 'owner', ...(fixedType ? [] : ['type']), 'stage', 'siteType', 'format']} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PeriodBar allTime value={{ kind: pkind, from: rA, to: rB }} onChange={onPeriod} label={pLabel} prefix={pmode === 'pipe' ? 'Sites in pipeline' : 'Sites added'} />
          {pkind !== 'all' && (
            <SingleSelect value={pmode} allValue="added" onChange={v => { setPmode(v); applyPeriod(pkind, rA, rB, v) }}
              options={[{ value: 'added', label: 'Added in this period' }, { value: 'pipe', label: 'In pipeline in this period' }]} />
          )}
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="card"><Empty icon={Handshake} title="No leads or deals yet">
          <Link to="/app/deals/new" className="btn-primary mt-3"><Plus className="h-4 w-4" />Create your first deal</Link></Empty></div>
      ) : view === 'table' ? (
        <>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="font-semibold text-slate-600">Days in stage:</span>
          {[...AGE_TONES.map(t => [t.cls, `${t.label} days`]), ['bg-slate-100 text-slate-500', 'Dropped / Energized']].map(([c, l]) => (
            <span key={l} className={`rounded-md px-2 py-0.5 font-semibold ${c}`}>{l}</span>
          ))}
        </div>
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <SortTh k="site_code">ID</SortTh><SortTh k="record_type">Type</SortTh><SortTh k="intent_sort">Intent</SortTh><SortTh k="name">Site</SortTh><SortTh k="stage_order">Stage</SortTh>
                <SortTh k="qis">QIS</SortTh><SortTh k="days_in_stage">Days in stage</SortTh><SortTh k="city">City</SortTh><SortTh k="rent_expectation">Rent</SortTh>
                <th className="th">Power</th><SortTh k="ho_sort">HO date</SortTh><SortTh k="en_sort">Energized</SortTh><SortTh k="owner">Owner</SortTh><SortTh k="created_at">Created</SortTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(d => (
                <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/app/deals/${d.id}`)}>
                  <td className="td font-mono text-xs text-slate-500">{d.site_code}</td>
                  <td className="td" onClick={e => e.stopPropagation()}><TypeCell deal={d} onChanged={reload} /></td>
                  <td className="td" onClick={e => e.stopPropagation()}><IntentCell deal={d} onChanged={reload} /></td>
                  <td className="td max-w-[260px]"><div className="truncate font-semibold text-slate-900">{d.name}</div><div className="truncate text-xs text-slate-500">{[d.site_type, SITE_FORMATS[d.extra?.site_format], d.address].filter(Boolean).join(' · ') || '—'}{d.latitude === null && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">No location</span>}</div>{d.target && <div className="mt-0.5 truncate text-[11px] text-slate-600" title={`Priority location · month of acquisition ${d.target_month_label}`}><span className={`mr-1 rounded px-1 font-bold ${PRIORITIES[d.target.priority]?.cls}`}>{d.target.priority}</span>{d.target.name}</div>}</td>
                  <td className="td" onClick={e => e.stopPropagation()}><StageCell deal={d} onChanged={reload} /></td>
                  <td className="td font-semibold">{d.qis ?? '—'}</td>
                  <td className="td whitespace-nowrap">
                    {(() => { const t = stageAgeTone(d.days_in_stage, d.stage_category); return (
                      <span title={t.label} className={`inline-block min-w-[2.5rem] rounded-md px-2 py-1 text-center text-sm font-bold ${t.cls}`}>{daysInt(d.days_in_stage) ?? '—'}</span>) })()}
                  </td>
                  <td className="td">{d.city}{d.region && <div className="text-[10px] text-slate-400">{d.region}</div>}</td>
                  <td className="td">{fmtINR(d.rent_expectation)}</td>
                  <td className="td"><Pill className={POWER_FEASIBILITY[d.power_feasibility]?.cls}>{POWER_FEASIBILITY[d.power_feasibility]?.label}</Pill></td>
                  <td className="td whitespace-nowrap" onClick={e => e.stopPropagation()}><DateCell deal={d} field="ho_date" label="Handover date" onChanged={reload} /></td>
                  <td className="td whitespace-nowrap" onClick={e => e.stopPropagation()}><DateCell deal={d} field="energized_on" label="Energization date" onChanged={reload} /></td>
                  <td className="td whitespace-nowrap" onClick={e => e.stopPropagation()}><OwnerCell deal={d} onChanged={reload} /></td>
                  <td className="td text-slate-500">{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty title="No deals match these filters" />}
        </div>
        </>
      ) : (
        <Board rows={rows} stages={stagesFor(stages, filters.siteType)} />
      )}
      <ImportDealsModal open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
    </div>
  )
}

const flatten = rows => rows.map(r => ({ ...r, ...(r.extra || {}), intent: INTENTS[r.extra?.intent]?.label ?? r.extra?.intent ?? null, site_format: SITE_FORMATS[r.extra?.site_format] ?? null }))

function Board({ rows, stages }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex gap-3">
        {stages.map(s => {
          const items = rows.filter(r => r.stage_id === s.id)
          return (
            <div key={s.id} className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100">
              <div className="flex items-center gap-2 border-t-4 px-3 py-2.5" style={{ borderColor: s.color, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                <span className="text-sm font-bold text-slate-800">{s.name}</span>
                <span className="rounded-full bg-white px-2 text-xs font-bold text-slate-500">{items.length}</span>
                {items.some(r => r.qis) && <span className="text-xs text-slate-500">{items.reduce((a, r) => a + (r.qis || 0), 0)} QIS</span>}
              </div>
              <div className="flex max-h-[calc(100vh-280px)] flex-col gap-2 overflow-y-auto p-2">
                {items.map(d => (
                  <Link key={d.id} to={`/app/deals/${d.id}`} className={`block rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md border-slate-200`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold leading-snug text-slate-900">{d.name}</span>
                      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-400">{d.site_code}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Pill className={RECORD_TYPES[d.record_type || 'deal'].cls}>{RECORD_TYPES[d.record_type || 'deal'].label}</Pill>
                      <span className="truncate">{d.city}{d.site_type ? ` · ${d.site_type}` : ''}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-600">{d.qis ? <b>{d.qis} QIS · </b> : ''}{d.owner || '—'}</span>
                      <span title="Days in stage" className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${stageAgeTone(d.days_in_stage, d.stage_category).cls}`}>{daysInt(d.days_in_stage) ?? '—'}</span>
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
