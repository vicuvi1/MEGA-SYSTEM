import { describe, expect, it } from 'vitest'
import { applyEdit, ensureIds, planItems } from './planEdit'
import { planJobs, settle, type JobResult } from './planSync'
import { rebase, UndoStack } from './planUndo'
import type { DayProposal } from './rhythm'

const day = '2030-03-12'
const taskId = (t: string) => ({ Essay: 't1' })[t]
const synced = (): DayProposal => {
  const p = ensureIds({ day, headline: '', mustdos: [], blocks: [{ title: 'Essay', start: '09:00', minutes: 60, tasks: ['Essay'] }, { title: 'Read', start: '11:00', minutes: 30 }], training: null, waterMl: 2500 })
  const s = planJobs(p, { status: 'approved', taskId })
  let n = 0
  return settle(p, s.jobs.map((j): JobResult => ({ id: j.id, from: j.from, ok: true, snap: j.snap, event: { id: `e${++n}`, calendarId: 'primary' } })), s.closed)
}
const send = (p: DayProposal) => planJobs(p, { status: 'approved', taskId })

describe('undo', () => {
  it('keeps the last 20 edits', () => {
    const u = new UndoStack()
    const p = synced()
    for (let i = 0; i < 25; i++) u.push({ label: `e${i}`, before: p, after: p })
    expect(u.size).toBe(20)
    expect(u.undo()!.label).toBe('e24')
    expect(u.redo()!.label).toBe('e24')
  })

  it('undoing a move moves the event back', () => {
    const before = synced()
    const id = planItems(before)[0].id
    let cur = applyEdit(before, { op: 'move', id, start: '13:00' })
    // The move reached Google.
    cur = settle(cur, send(cur).jobs.map((j) => ({ id: j.id, from: j.from, ok: true, snap: j.snap })))
    const back = rebase(before, cur)
    const s = send(back)
    expect(s.jobs.length).toBe(1)
    expect(s.jobs[0].google).toMatchObject({ kind: 'update', eventId: 'e1', start: new Date(`${day}T09:00:00`).toISOString() })
  })

  it('undoing a delete keeps the event if it was not removed yet, else makes it again', () => {
    const before = synced()
    const id = planItems(before).find((b) => b.title === 'Read')!.id
    const cur = applyEdit(before, { op: 'remove', id })
    // Not sent yet: nothing to do at all.
    expect(send(rebase(before, cur)).jobs).toEqual([])
    // Sent: the event is made again.
    const gone = settle(cur, send(cur).jobs.map((j) => ({ id: j.id, from: j.from, ok: true, snap: j.snap })))
    expect(send(rebase(before, gone)).jobs.map((j) => j.google?.kind)).toEqual(['create'])
  })

  it('undoing an add removes its event', () => {
    const before = synced()
    let cur = applyEdit(before, { op: 'add', start: '15:00', minutes: 30, title: 'Walk' })
    cur = settle(cur, send(cur).jobs.map((j) => ({ id: j.id, from: j.from, ok: true, snap: j.snap, event: { id: 'e9', calendarId: 'primary' } })))
    const s = send(rebase(before, cur))
    expect(s.jobs.map((j) => j.google)).toEqual([{ kind: 'remove', eventId: 'e9', calendarId: 'primary' }])
  })
})
