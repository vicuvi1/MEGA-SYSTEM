// Study Time on the database (src/core/studyTime.ts holds the pure rules).
// It wraps the ONE focus timer (FocusService) instead of adding a second:
// a block runs as the focus timer with its block id on focus_running, a
// break is the timer's pause, and a finished session is a focus_sessions
// row. What Study Time adds per session (its block, break minutes, where it
// came from) sits in the synced setting `study_log`, keyed by the session's
// start time. The blocks are the synced setting `study_blocks`.
//
// Points: a normal stop pays like any focus timer (live time). Typed-in
// sessions and a forgotten timer put right pay nothing; editing the minutes
// or day of a paid session gives its points back.
import { LedgerError } from '@core/ledger'
import { pausedMsOf } from '@core/focus'
import {
  MAX_LIVE_MIN,
  applyStudyOp,
  checkManual,
  cleanLog,
  cleanStore,
  minutesUntil,
  putNote,
  withNote,
  type StudyBlockOp,
  type StudyLog,
  type StudyNote,
  type StudySession,
  type StudyStore
} from '@core/studyTime'
import type { DB } from './db'
import { FocusService, type FocusState, type RunningFocus } from './focus'
import { readSetting, writeSetting } from './settings'
import type { Wallet } from './wallet'

export class StudyService {
  private focus: FocusService
  constructor(
    private db: DB,
    private wallet: Wallet
  ) {
    this.focus = new FocusService(db, wallet)
  }

  // ---- blocks

  blocks(): StudyStore | null {
    const raw = readSetting(this.db, 'study_blocks')
    return raw ? cleanStore(raw) : null
  }

  change(op: StudyBlockOp, now = new Date()): StudyStore {
    const next = applyStudyOp(cleanStore(readSetting(this.db, 'study_blocks')), op, now)
    writeSetting(this.db, 'study_blocks', next as unknown as Record<string, unknown>)
    return next
  }

  // ---- the timer

  private run(): RunningFocus | null {
    try {
      return readSetting(this.db, 'focus_running') as RunningFocus | null
    } catch {
      return null
    }
  }

  private setRun(r: RunningFocus & { blockId?: string | null; open?: boolean; breakMin?: number | null }): void {
    writeSetting(this.db, 'focus_running', r as any)
  }

  /** Starts a block on the focus timer (one timer at a time). No planned length: an open stopwatch, capped at 4 h. */
  start(block: { id: string; name: string; plannedMin: number | null; taskId?: string | null; taskTitle?: string | null }, now = new Date()): FocusState {
    return this.db.transaction(() => {
      const open = !block.plannedMin
      const planned = open ? MAX_LIVE_MIN : Math.min(MAX_LIVE_MIN, Math.max(1, Math.round(block.plannedMin!)))
      const task = block.taskId ? { kind: 'todoist' as const, ref: block.taskId, title: block.taskTitle || block.name } : null
      this.focus.start(block.name, Math.min(180, Math.max(5, planned)), now, task)
      const r = this.run()!
      this.setRun({ ...r, planned, blockId: String(block.id).slice(0, 40), ...(open ? { open: true } : {}) })
      this.note(r.startedAt, { b: block.id }, now)
      return this.focus.state(now)
    })()
  }

  /** A break: the timer's pause (break time never counts as study), with an optional length for the sound at its end. */
  breakStart(minutes: number | null, now = new Date()): FocusState {
    return this.db.transaction(() => {
      this.focus.pause(now)
      const r = this.run()
      const b = Math.round(Number(minutes) || 0)
      if (r) this.setRun({ ...r, breakMin: b >= 1 ? Math.min(120, b) : null })
      return this.focus.state(now)
    })()
  }

  breakEnd(now = new Date()): FocusState {
    return this.db.transaction(() => {
      this.focus.resume(now)
      const r = this.run()
      if (r) this.setRun({ ...r, breakMin: null })
      return this.focus.state(now)
    })()
  }

  /** Stops and logs (the focus timer's own stop: capped, paid as live time). Break minutes are kept beside it. */
  stop(now = new Date()) {
    return this.db.transaction(() => {
      const r = this.run()
      const k = r ? Math.round(pausedMsOf(r, now.getTime()) / 60_000) : 0
      const res = this.focus.stop(now)
      if (r && k > 0) this.note(r.startedAt, { ...(this.notes()[r.startedAt] ?? {}), k }, now)
      return res
    })()
  }

  /** A timer forgotten overnight, ended at the time you say (capped); saved on the day it began, pays nothing. */
  stopAt(endAt: string, now = new Date()) {
    return this.db.transaction(() => {
      const r = this.run() as (RunningFocus & { blockId?: string | null; open?: boolean }) | null
      if (!r) throw new LedgerError('No focus session is running')
      const start = Date.parse(r.startedAt)
      const end = Math.min(now.getTime(), Math.max(start, Date.parse(endAt) || now.getTime()))
      const minutes = minutesUntil(r, end)
      const pausedAt = r.pausedAt ? Date.parse(r.pausedAt) : NaN
      const breakMs = Math.max(0, Number(r.pausedMs) || 0) + (Number.isFinite(pausedAt) && pausedAt < end ? end - pausedAt : 0)
      this.focus.cancel(now)
      this.note(r.startedAt, null, now)
      const day = this.wallet.today(new Date(start))
      const res = this.focus.add(r.subject, minutes, day, new Date(end))
      const row = this.db.prepare('SELECT started_at FROM focus_sessions WHERE id = ?').get(res.session.id) as { started_at: string } | undefined
      if (row) this.note(row.started_at, { ...(r.blockId ? { b: r.blockId } : {}), ...(breakMs >= 60_000 ? { k: Math.round(breakMs / 60_000) } : {}), s: 'fixed' }, now)
      return res
    })()
  }

  // ---- sessions

  sessions(sinceDay: string): StudySession[] {
    const notes = this.notes()
    return (this.db.prepare('SELECT id, day, subject, minutes, started_at, ended_at FROM focus_sessions WHERE day >= ? ORDER BY started_at DESC, id DESC').all(sinceDay) as any[]).map((r) =>
      withNote({ id: Number(r.id), day: String(r.day), subject: String(r.subject), minutes: Number(r.minutes), startedAt: String(r.started_at), endedAt: String(r.ended_at) }, notes[String(r.started_at)])
    )
  }

  /** A session typed in: counts in the stats, pays nothing. */
  add(o: { subject: string; blockId?: string | null; minutes: number; breakMin?: number; day: string }, now = new Date()) {
    const name = String(o.subject || '').trim().slice(0, 40)
    if (!name) throw new LedgerError('Which block?')
    const today = this.wallet.today(now)
    const bad = checkManual(o, today)
    if (bad) throw new LedgerError(bad)
    // No real clock times: today it ends now, an earlier day at 20:00.
    const at = o.day === today ? now : new Date(`${o.day}T20:00:00`)
    return this.db.transaction(() => {
      const res = this.focus.add(name, Math.round(o.minutes), o.day, at)
      const row = this.db.prepare('SELECT started_at FROM focus_sessions WHERE id = ?').get(res.session.id) as { started_at: string } | undefined
      const k = Math.round(o.breakMin ?? 0)
      if (row) this.note(row.started_at, { ...(o.blockId ? { b: String(o.blockId).slice(0, 40) } : {}), ...(k > 0 ? { k } : {}), s: 'manual' }, now)
      return res
    })()
  }

  /** Changes a past session; a paid one gives its points back when its minutes or day change. */
  edit(id: number, patch: { subject?: string; blockId?: string | null; minutes?: number; breakMin?: number; day?: string }, now = new Date()): StudySession {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT id, day, subject, minutes, coins, started_at FROM focus_sessions WHERE id = ?').get(id) as any
      if (!row) throw new LedgerError('That session is gone')
      const was: StudyNote = this.notes()[String(row.started_at)] ?? {}
      const minutes = patch.minutes == null ? Number(row.minutes) : Math.round(patch.minutes)
      const breakMin = patch.breakMin == null ? (was.k ?? 0) : Math.round(patch.breakMin)
      const day = patch.day ?? String(row.day)
      const bad = checkManual({ minutes, breakMin, day }, this.wallet.today(now))
      if (bad) throw new LedgerError(bad)
      const subject = patch.subject != null ? String(patch.subject).trim().slice(0, 40) || String(row.subject) : String(row.subject)
      const blockId = patch.blockId !== undefined ? (patch.blockId ? String(patch.blockId).slice(0, 40) : null) : (was.b ?? null)
      let coins = Number(row.coins) || 0
      let source: StudySession['source'] = was.s ?? 'timer'
      if ((minutes !== Number(row.minutes) || day !== String(row.day)) && source !== 'manual') {
        if (coins > 0) this.takeBack(id, 'Study session edited', now)
        coins = 0
        source = 'manual'
      }
      this.db.prepare('UPDATE focus_sessions SET subject = ?, minutes = ?, day = ?, coins = ? WHERE id = ?').run(subject, minutes, day, coins, id)
      this.note(String(row.started_at), { ...(blockId ? { b: blockId } : {}), ...(breakMin > 0 ? { k: breakMin } : {}), ...(source !== 'timer' ? { s: source } : {}) }, now)
      return this.sessions(day).find((s) => s.id === id)!
    })()
  }

  /** Removes a session; points it paid go back. */
  remove(id: number, now = new Date()): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT started_at FROM focus_sessions WHERE id = ?').get(id) as { started_at: string } | undefined
      this.takeBack(id, 'Study session removed', now)
      this.db.prepare('DELETE FROM focus_sessions WHERE id = ?').run(id)
      if (row) this.note(row.started_at, null, now)
    })()
  }

  // ---- inside

  private takeBack(id: number, note: string, now: Date): void {
    const paid = this.wallet.effective().find((e) => e.ref === `focus:${id}` && e.coins > 0)
    if (!paid) return
    try {
      this.wallet.undo(paid.id, note, now)
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e
    }
  }

  private notes(): StudyLog {
    try {
      return cleanLog(readSetting(this.db, 'study_log'))
    } catch {
      return {}
    }
  }

  private note(startedAt: string, n: StudyNote | null, now: Date): void {
    const empty = !n || (!n.b && !n.k && !n.s)
    const cur = this.notes()
    if (empty && !cur[startedAt]) return
    writeSetting(this.db, 'study_log', putNote(cur, startedAt, empty ? null : n, now.getTime()) as Record<string, unknown>)
  }
}
