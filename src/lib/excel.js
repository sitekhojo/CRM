// Excel / CSV import & export. ExcelJS is loaded only when needed (keeps the app fast).
import Papa from 'papaparse'

export const DEAL_COLUMNS = [
  ['site_code', 'ID'], ['record_type', 'Type'], ['name', 'Site name'], ['stage_name', 'Stage'], ['days_in_stage', 'Days in stage'],
  ['is_overdue', 'Beyond SLA'], ['city', 'City'], ['address', 'Address'], ['pincode', 'Pincode'],
  ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['site_type', 'Site type'], ['area_sqft', 'Area (sq ft)'],
  ['landlord_name', 'Landlord name'], ['landlord_phone', 'Landlord phone'], ['landlord_email', 'Landlord email'],
  ['rent_expectation', 'Rent / month (INR)'], ['deposit_expectation', 'Deposit (INR)'], ['rent_negotiable', 'Rent negotiable'],
  ['power_available', 'Power available'], ['power_phase', 'Power phase'], ['sanctioned_load_kw', 'Sanctioned load (kW)'],
  ['power_feasibility', 'Power feasibility'], ['power_notes', 'Power notes'], ['observations', 'Observations'],
  ['remarks', 'Remarks'], ['drop_reason', 'Drop reason'], ['drop_notes', 'Drop notes'],
  ['qis_count', 'No. of QIS'], ['expected_ho', 'Expected HO date'], ['priority_zone', 'Priority zone (P0/P1)'], ['probability', 'Probability %'],
  ['ho_date', 'Handover date'], ['energized_on', 'Energization date'],
  ['region', 'Region'], ['owner', 'Owner'], ['created_by_name', 'Scouted by'], ['created_at', 'Created at'], ['stage_entered_at', 'Stage since'],
]

// Columns accepted on import (header text is matched case-insensitively against key OR label)
export const IMPORT_FIELDS = [
  ['name', 'Site name', true], ['city', 'City', true], ['latitude', 'Latitude', true], ['longitude', 'Longitude', true],
  ['address', 'Address'], ['pincode', 'Pincode'], ['site_type', 'Site type'], ['area_sqft', 'Area (sq ft)'],
  ['landlord_name', 'Landlord name'], ['landlord_phone', 'Landlord phone'], ['landlord_email', 'Landlord email'],
  ['rent_expectation', 'Rent / month (INR)'], ['deposit_expectation', 'Deposit (INR)'], ['power_available', 'Power available'],
  ['power_phase', 'Power phase'], ['sanctioned_load_kw', 'Sanctioned load (kW)'], ['power_feasibility', 'Power feasibility'],
  ['observations', 'Observations'], ['remarks', 'Remarks'], ['stage', 'Stage'], ['owner', 'Owner'],
  ['record_type', 'Type'], ['drop_reason', 'Drop reason'],
  ['qis_count', 'No. of QIS'], ['expected_ho', 'Expected HO date'], ['priority_zone', 'Priority zone (P0/P1)'], ['probability', 'Probability %'],
  ['ho_date', 'Handover date'], ['energized_on', 'Energization date'],
]

const cell = v => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)

export async function exportRows(rows, columns, filename, format = 'xlsx') {
  const header = columns.map(c => c[1])
  const data = rows.map(r => columns.map(([k]) => {
    const v = r[k]
    if (k.endsWith('_at') && v) return new Date(v)
    return cell(v)
  }))
  if (format === 'csv') {
    const csv = Papa.unparse([header, ...data.map(r => r.map(v => (v instanceof Date ? v.toISOString() : v)))])
    return download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename + '.csv')
  }
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  ws.addRow(header)
  data.forEach(r => ws.addRow(r))
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F33' } }
  ws.columns.forEach((col, i) => {
    col.width = Math.min(40, Math.max(12, header[i].length + 2))
    if (columns[i][0].endsWith('_at')) col.numFmt = 'dd-mmm-yyyy hh:mm'
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } }
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename + '.xlsx')
}

/** Read a .csv or .xlsx file into an array of plain objects keyed by header text. */
export async function readSheet(file) {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text()
    return Papa.parse(text, { header: true, skipEmptyLines: true }).data
  }
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  const headers = []
  const out = []
  ws.eachRow((row, i) => {
    const vals = row.values.slice(1).map(v => (v && typeof v === 'object' && 'text' in v ? v.text : v && typeof v === 'object' && 'result' in v ? v.result : v))
    if (i === 1) { vals.forEach((v, j) => (headers[j] = String(v ?? '').trim())); return }
    const o = {}
    headers.forEach((h, j) => { if (h) o[h] = vals[j] ?? '' })
    if (Object.values(o).some(v => v !== '' && v !== null)) out.push(o)
  })
  return out
}

/** Map arbitrary header names onto field keys. */
export function normaliseRow(raw, fields) {
  const lookup = {}
  for (const [key, label] of fields) { lookup[key.toLowerCase()] = key; lookup[label.toLowerCase()] = key }
  const o = {}
  for (const [h, v] of Object.entries(raw)) {
    const k = lookup[String(h).trim().toLowerCase()]
    if (k) o[k] = typeof v === 'string' ? v.trim() : v
  }
  return o
}

export const toBool = v => {
  if (v === true || v === false) return v
  const s = String(v ?? '').trim().toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return null
}
export const toNum = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

export async function downloadTemplate(fields, filename) {
  return exportRows([], fields.map(([k, l]) => [k, l]), filename, 'xlsx')
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
