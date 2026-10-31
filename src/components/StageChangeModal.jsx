import { useState, useEffect } from 'react'
import { Modal, Field } from './ui'
import { useConfig } from '../lib/config'
import { useAuth } from '../lib/auth'

/** Move a deal to another stage, with a note and (when dropping) a required reason. */
export default function StageChangeModal({ open, onClose, deal, onSave, presetStageId }) {
  const { stages = [], dropReasons = [] } = useConfig()
  const { isAdmin } = useAuth()
  const [stageId, setStageId] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [dropNotes, setDropNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setStageId(presetStageId || ''); setNote(''); setReason(''); setDropNotes('') } }, [open, presetStageId])

  const target = stages.find(s => String(s.id) === String(stageId))
  const isDrop = target?.category === 'dropped'
  const options = stages.filter(s => s.is_active && s.id !== deal?.stage_id)

  const save = async () => {
    setBusy(true)
    const ok = await onSave({ stage_id: Number(stageId), stage_note: note || null, drop_reason: isDrop ? reason : null, drop_notes: isDrop ? dropNotes || null : null })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Change stage"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className={isDrop ? 'btn-danger' : 'btn-primary'} disabled={!stageId || busy || (isDrop && !reason)} onClick={save}>
          {busy ? 'Saving…' : isDrop ? 'Drop deal' : 'Move deal'}
        </button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Current stage: <b>{deal?.stage_name}</b> · {deal?.days_in_stage} days</p>
        <Field label="New stage">
          <select className="input" value={stageId} onChange={e => setStageId(e.target.value)}>
            <option value="">Select stage</option>
            {options.map(s => (
              <option key={s.id} value={s.id} disabled={s.admin_only && !isAdmin}>
                {s.name}{s.admin_only && !isAdmin ? ' (admin only)' : ''}
              </option>
            ))}
          </select>
        </Field>
        {isDrop && <>
          <Field label="Drop reason *">
            <select className="input" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Select reason</option>
              {dropReasons.filter(r => r.is_active).map(r => <option key={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Drop details"><textarea className="input" rows={2} value={dropNotes} onChange={e => setDropNotes(e.target.value)} /></Field>
        </>}
        <Field label="Note for the history log"><textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened? Next step?" /></Field>
      </div>
    </Modal>
  )
}
