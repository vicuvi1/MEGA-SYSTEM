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
import {
  MAX_LIVE_MIN,
  NOTE_MAX,
  applyStudyOp,
  pausesOf,
  pomoBreakLen,
  pomosDone,
  prefsOf,
  runNow,
  type PomoRun,
  type StudyRun,
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
import { todoistBlocks } from '@core/studyPlan'
import { bestHours, type BestHours } from '@core/studyInsights'
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
    const cur = cleanStore(readSetting(this.db, 'study_blocks'))
    const next = op.op === 'todoist' ? todoistBlocks(cur, Array.isArray(op.tasks) ? op.tasks : [], now) : applyStudyOp(cur, op, now, this.wallet.today(now))
    if (op.op === 'todoist' && next === cur) return cur
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

  private setRun(r: RunningFocus & Partial<StudyRun>): void {
    writeSetting(this.db, 'focus_running', r as any)
  }

  private studyRun(): (RunningFocus & Partial<StudyRun>) | null {
    return this.run() as (RunningFocus & Partial<StudyRun>) | null
  }

  /**
   * Starts a block on the focus timer (one timer at a time). Pomodoro mode
   * (your Study Time setting, or `mode`): a pomodoro of your work length,
   * then a break. Count up: the planned length, or with none an open
   * stopwatch capped at 4 h.
   */
  start(block: { id: string; name: string; plannedMin: number | null; taskId?: string | null; taskTitle?: string | null }, now = new Date(), mode?: 'pomodoro' | 'up'): FocusState {
    return this.db.transaction(() => {
      const prefs = prefsOf(this.blocks() ?? {})
      const pomoMode = (mode ?? prefs.mode) === 'pomodoro'
      const open = !pomoMode && !block.plannedMin
      const planned = pomoMode ? prefs.work : open ? MAX_LIVE_MIN : Math.min(MAX_LIVE_MIN, Math.max(1, Math.round(block.plannedMin!)))
      const task = block.taskId ? { kind: 'todoist' as const, ref: block.taskId, title: block.taskTitle || block.name } : null
      this.focus.start(block.name, Math.min(180, Math.max(5, planned)), now, task)
      const r = this.run()!
      const pomo: PomoRun | null = pomoMode ? { work: prefs.work, short: prefs.short, long: prefs.long, every: prefs.every, done: 0, at: prefs.work, from: 0 } : null
      this.setRun({ ...r, planned, blockId: String(block.id).slice(0, 40), ...(open ? { open: true } : {}), ...(pomo ? { pomo } : {}) })
      this.note(r.startedAt, { b: block.id }, now)
      return this.focus.state(now)
    })()
  }

  /** A break: the timer's pause (break time never counts as study), with an optional length for the sound at its end. */
  breakStart(minutes: number | null, now = new Date()): FocusState {
    return this.db.transaction(() => {
      const was = this.studyRun()
      // From a plain pause straight into a break: that pause ends first (kept apart).
      if (was?.pausedAt && was.pauseKind === 'pause') this.resume(now)
      this.focus.pause(now)
      const r = this.studyRun()
      const b = Math.round(Number(minutes) || 0)
      if (r) this.setRun({ ...r, pauseKind: 'break', breakMin: b >= 1 ? Math.min(120, b) : null })
      return this.focus.state(now)
    })()
  }

  /** A plain pause (no length, no "break's over"): Pause and Resume. Paused time never counts. */
  pause(now = new Date()): FocusState {
    return this.db.transaction(() => {
      const r0 = this.studyRun()
      if (r0?.pausedAt) return this.focus.state(now)
      this.focus.pause(now)
      const r = this.studyRun()
      if (r) this.setRun({ ...r, pauseKind: 'pause', breakMin: null })
      return this.focus.state(now)
    })()
  }

  /** Goes on after a pause or a break (the break part is kept apart for the session's note). */
  resume(now = new Date()): FocusState {
    return this.db.transaction(() => {
      const r0 = this.studyRun()
      if (!r0?.pausedAt) return this.focus.state(now)
      const brk = pausesOf(r0, now.getTime()).breakMs
      this.focus.resume(now)
      const r = this.studyRun()
      if (r) this.setRun({ ...r, breakMin: null, pauseKind: null, brkMs: Math.min(brk, Number(r.pausedMs) || 0) })
      return this.focus.state(now)
    })()
  }

  breakEnd(now = new Date()): FocusState {
    return this.resume(now)
  }

  /** Pomodoro done → its break (long after every few); the next pomodoro starts after it. */
  pomoBreak(now = new Date()): FocusState {
    return this.db.transaction(() => {
      const r = this.studyRun()
      if (!r?.pomo) return this.breakStart(5, now)
      const len = pomoBreakLen(r.pomo)
      this.nextPomo(r, now)
      return this.breakStart(len, now)
    })()
  }

  /** Pomodoro done, no break: it counts, and the next one starts now. */
  keepGoing(now = new Date()): FocusState {
    return this.db.transaction(() => {
      const r = this.studyRun()
      if (r?.pomo) this.nextPomo(r, now)
      return this.focus.state(now)
    })()
  }

  private nextPomo(r: RunningFocus & Partial<StudyRun>, now: Date): void {
    const p = r.pomo!
    const worked = runNow(r as StudyRun, now.getTime()).workedMs
    // The next one ends a full pomodoro after now (or after this one's end, if you answered early).
    const base = Math.max(p.at, Math.floor(worked / 60_000))
    const at = Math.min(MAX_LIVE_MIN, base + p.work)
    this.setRun({ ...r, planned: Math.min(MAX_LIVE_MIN, Math.max(r.planned, at)), pomo: { ...p, done: p.done + 1, at, from: base } })
  }

  /** +N minutes: on the pomodoro going on (or the planned length); at most 4 h in all. */
  extend(minutes: number, now = new Date()): FocusState {
    return this.db.transaction(() => {
      const r = this.studyRun()
      const m = Math.max(1, Math.min(60, Math.round(Number(minutes) || 5)))
      if (!r) return this.focus.state(now)
      if (r.pomo) {
        const at = Math.min(MAX_LIVE_MIN, r.pomo.at + m)
        this.setRun({ ...r, planned: Math.min(MAX_LIVE_MIN, Math.max(r.planned, at)), pomo: { ...r.pomo, at } })
      } else if (!r.open) this.setRun({ ...r, planned: Math.min(MAX_LIVE_MIN, r.planned + m) })
      return this.focus.state(now)
    })()
  }

  /** A break gets longer (the island's "+5 min break"). */
  breakMore(minutes: number, now = new Date()): FocusState {
    return this.db.transaction(() => {
      const r = this.studyRun()
      if (!r?.pausedAt) return this.focus.state(now)
      const sofar = Math.ceil((now.getTime() - Date.parse(r.pausedAt)) / 60_000)
      this.setRun({ ...r, pauseKind: 'break', breakMin: Math.min(120, Math.max(Number(r.breakMin) || 0, sofar) + Math.max(1, Math.round(minutes))) })
      return this.focus.state(now)
    })()
  }

  /**
   * Switch block without stopping: the time so far goes to the old block (a
   * normal stop, paid as live time) and the new one starts at once, in the
   * same mode. Under 30 seconds on the old one: nothing is logged for it.
   */
  switchTo(block: { id: string; name: string; plannedMin: number | null; taskId?: string | null; taskTitle?: string | null }, now = new Date(), note?: string | null): { logged: { session: { id: number; minutes: number }; coins: number } | null; state: FocusState } {
    return this.db.transaction(() => {
      const r = this.studyRun()
      if (!r) return { logged: null, state: this.start(block, now) }
      if (r.blockId === block.id) return { logged: null, state: this.focus.state(now) }
      if (r.pausedAt) this.resume(now)
      const cur = this.studyRun()!
      let logged: { session: { id: number; minutes: number }; coins: number } | null = null
      if (runNow(cur as StudyRun, now.getTime()).workedMs < 30_000) {
        this.focus.cancel(now)
        this.note(cur.startedAt, null, now)
      } else logged = this.stop(now, note)
      return { logged, state: this.start(block, now, cur.pomo ? 'pomodoro' : 'up') }
    })()
  }

  /** Stops and logs (the focus timer's own stop: capped, paid as live time). Break and pause minutes, pomodoros and your note are kept beside it. */
  stop(now = new Date(), note?: string | null) {
    return this.db.transaction(() => {
      const r = this.studyRun()
      const t = now.getTime()
      const parts = r ? pausesOf(r, t) : { breakMs: 0, pauseMs: 0 }
      const k = Math.round(parts.breakMs / 60_000)
      const q = Math.round(parts.pauseMs / 60_000)
      const p = r ? pomosDone(r, runNow(r as StudyRun, t).workedMs) : 0
      const n = String(note ?? '').trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX)
      const res = this.focus.stop(now)
      if (r && (k > 0 || q > 0 || p > 0 || n)) this.note(r.startedAt, { ...(this.notes()[r.startedAt] ?? {}), ...(k > 0 ? { k } : {}), ...(q > 0 ? { q } : {}), ...(p > 0 ? { p } : {}), ...(n ? { n } : {}) }, now)
      return res
    })()
  }

  /** The page's and the island's Stop: with your one-line note (the API puts the note first). */
  finish(note?: string | null, now = new Date()) {
    return this.stop(now, note)
  }

  /** The page's and the island's switch (the API puts the block first, then the note for the old block). */
  switchBlock(block: { id: string; name: string; plannedMin: number | null; taskId?: string | null; taskTitle?: string | null }, note?: string | null, now = new Date()) {
    return this.switchTo(block, now, note)
  }

  /** "What did you do?" on a past session (changes no minutes and no points). */
  setNote(id: number, text: string, now = new Date()): StudySession {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT day, started_at FROM focus_sessions WHERE id = ?').get(id) as { day: string; started_at: string } | undefined
      if (!row) throw new LedgerError('That session is gone')
      const n = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX)
      const was: StudyNote = { ...(this.notes()[String(row.started_at)] ?? {}) }
      delete was.n
      this.note(String(row.started_at), { ...was, ...(n ? { n } : {}) }, now)
      return this.sessions(String(row.day)).find((s) => s.id === id)!
    })()
  }

  /** The hours you focus longest (last 30 days), for the page, the planner and Ben. */
  bestHours(now = new Date()): BestHours {
    const today = this.wallet.today(now)
    return bestHours(this.sessions(this.wallet.today(new Date(now.getTime() - 31 * 86_400_000))), today, 30)
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
    const empty = !n || (!n.b && !n.k && !n.s && !n.n && !n.q && !n.p)
    const cur = this.notes()
    if (empty && !cur[startedAt]) return
    writeSetting(this.db, 'study_log', putNote(cur, startedAt, empty ? null : n, now.getTime()) as Record<string, unknown>)
  }
}
