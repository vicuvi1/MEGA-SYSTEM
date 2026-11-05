// The app window's side of the island's controls (IC1, IC6–IC8, IC10, IC11):
// pause and resume, the end set by the wheel, renaming, undoing the last tap,
// links and files dropped on the island, and the focus → break → next block
// flow. IslandFeed calls these; everything goes through the same services as
// the rest of the app, so points stay honest (paused minutes and breaks never
// pay; an undo takes back exactly what that tap logged, its points included).
import { focusEndsAt } from '@core/focus'
import { flowStages, nextBlock, shouldHandOff, stageDots, startBreak, type FlowBlock, type FocusBreak, type FocusStage } from '@core/focusFlow'
import { canUndo, classifyDrop, DROP_MAX_BYTES, UNDO_KEEP_MS } from '@core/islandCommands'
import { cleanIslandPrefs, type IslandAction, type IslandAlert, type IslandSnapshot } from '@core/islandModel'
import { calendarDay } from '@core/dates'
import type { RunningFocus } from '@shared/api'
import { life } from './bridge'
import { addWater } from './water'
import { findExercise, updateSport } from './sportTrack'

const BREAK = 'ls.islandBreak'
const get = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const put = (k: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(k)
    else localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}
const focusChanged = () => window.dispatchEvent(new Event('life-focus-changed'))

// ---- IC11: the break between two blocks ------------------------------------

/** The break going on (null: none, or it is over and was handled). */
export function currentBreak(): FocusBreak | null {
  const b = get<FocusBreak | null>(BREAK, null)
  return b && Number.isFinite(b.endsAt) ? b : null
}
/** Your island's break length (Settings → Desktop island; 0 = no break). */
let breakMin = 5
export async function loadBreakPref(): Promise<void> {
  const p = await window.desktop?.getIslandPrefs?.().catch(() => null)
  if (p) breakMin = cleanIslandPrefs(p).controls.breakMin
}

/** The snapshot's running timer: the focus timer (paused or not) or the break. */
export function islandRunning(run: RunningFocus | null, now: number): IslandSnapshot['running'] {
  if (run) {
    const startedAt = Date.parse(run.startedAt)
    const paused = run.pausedAt ? Date.parse(run.pausedAt) : null
    const next = run.stages?.find((s) => s.kind === 'next')
    return { subject: run.subject, startedAt, endsAt: focusEndsAt(run), pausedAt: paused, dots: stageDots(run.stages), next: next?.subject ? { subject: next.subject, minutes: next.minutes } : null }
  }
  const b = currentBreak()
  if (b && now < b.endsAt + 10 * 60_000) return { subject: b.next ? `Break · next ${b.next.subject}` : 'Break', startedAt: b.startedAt, endsAt: b.endsAt, brk: true, dots: b.dots, next: b.next }
  return null
}

/**
 * Every build: a flow timer whose time is up (and you are at the PC) is
 * stopped and logged with its real minutes, and its break starts; a break
 * that is over starts the next block when "start focus by itself" is on.
 * Returns what to say (a toast-like note), if anything happened.
 */
export async function flowTick(o: { run: RunningFocus | null; now: number; idleSec: number | null; blocks: FlowBlock[]; autoFocus: boolean }): Promise<'handed' | 'started' | null> {
  const { run, now } = o
  if (run?.stages?.length) {
    const endsAt = focusEndsAt(run)
    if (shouldHandOff({ now, endsAt, paused: !!run.pausedAt, stages: run.stages, idleSec: o.idleSec })) {
      await life.focus.stop()
      const b = startBreak(run.stages, now, { subject: run.subject, minutes: run.planned }, o.blocks)
      put(BREAK, b)
      focusChanged()
      return 'handed'
    }
    return null
  }
  const b = currentBreak()
  if (!run && b && now >= b.endsAt && o.autoFocus && b.next && (o.idleSec == null || o.idleSec < 300)) {
    put(BREAK, null)
    await life.focus.start(b.next.subject, b.next.minutes, null, flowStages(breakMin, null)).catch(() => null)
    focusChanged()
    return 'started'
  }
  // A break nobody followed (10 min past its end, or a timer started elsewhere): gone.
  if (b && (run || now > b.endsAt + 10 * 60_000)) put(BREAK, null)
  return null
}

/** The break is over and nothing started by itself: "Break's over: start X?" */
export function breakOverAlert(now: number, dismissed: Record<string, number>, running: boolean): IslandAlert | null {
  const b = currentBreak()
  if (!b || running || now < b.endsAt) return null
  const id = `brk:${b.startedAt}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'block',
    title: "Break's over",
    text: b.next ? `Next: ${b.next.subject} · ${b.next.minutes} min` : 'Ready for the next one?',
    face: '▶',
    actions: [
      ...(b.next ? [{ label: `▶ Start ${b.next.minutes} min`, action: { kind: 'start', subject: b.next.subject, minutes: b.next.minutes, flow: true } as IslandAction, primary: true }] : []),
      { label: '+5 min', action: { kind: 'extend', minutes: 5 } },
      { label: 'Done for now', action: { kind: 'stop' }, primary: !b.next }
    ]
  }
}

// ---- IC10: what each tap logged, to take back --------------------------------

type Undo =
  | { kind: 'water'; ml: number }
  | { kind: 'reps'; ex: string; name: string; n: number; workoutId: number | null }
  | { kind: 'mustdo'; i: number; ledgerId: number | null }
  | { kind: 'extend'; minutes: number }
  | { kind: 'start'; startedAt: string }
const undos = new Map<string, { at: number; u: Undo }>()

/** After a tap went through: remember how to take it back (only logs; for a minute). */
export function rememberUndo(tapId: string | undefined, u: Undo | null): void {
  if (!tapId || !u) return
  const now = Date.now()
  for (const [k, v] of undos) if (now - v.at > UNDO_KEEP_MS) undos.delete(k)
  undos.set(tapId, { at: now, u })
}
/** Can this tap be undone? (So the island offers "↶ Undo" only for logs.) */
export const undoable = (a: IslandAction) => canUndo(a)

async function newestLedgerId(ruleId: string, since: number): Promise<number | null> {
  const list = await life.wallet.history(15).catch(() => [])
  const undone = new Set(list.filter((e) => e.kind === 'undo' && e.undoOf != null).map((e) => e.undoOf))
  const e = list.filter((x) => x.ruleId === ruleId && x.kind !== 'undo' && !undone.has(x.id) && Date.parse(x.ts) >= since - 5000).sort((a, b) => b.id - a.id)[0]
  return e ? e.id : null
}

/** The must-do tap's points (if that tick paid), for its undo. */
export async function mustdoUndo(i: number, coins: number, since: number): Promise<Undo> {
  return { kind: 'mustdo', i, ledgerId: coins > 0 ? await newestLedgerId('plan.item_done', since) : null }
}

async function runUndo(of: string): Promise<string> {
  const e = undos.get(of)
  if (!e || Date.now() - e.at > UNDO_KEEP_MS) throw new Error('Too late to undo that')
  undos.delete(of)
  const u = e.u
  switch (u.kind) {
    case 'water':
      await addWater(-u.ml)
      return `↶ Took back ${u.ml} ml`
    case 'reps':
      updateSport((d) => {
        const ex = findExercise(d, u.ex) ?? findExercise(d, u.name)
        if (ex) ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) - u.n)
      })
      // Deleting the workout takes its points back too.
      if (u.workoutId != null) await life.body.deleteWorkout(u.workoutId)
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      return `↶ Took back ${u.n} ${u.name}`
    case 'mustdo': {
      const plan = (await life.focus.state()).plan
      const item = plan.items[u.i]
      if (item) await life.focus.togglePlan(u.i)
      if (u.ledgerId != null) await life.wallet.undo(u.ledgerId, 'Undone from the island').catch(() => {})
      window.dispatchEvent(new CustomEvent('life-external-changed'))
      return '↶ Must-do back to open'
    }
    case 'extend':
      await life.focus.extend?.(-u.minutes)
      focusChanged()
      return `↶ −${u.minutes} min`
    case 'start': {
      const run = (await life.focus.state()).running
      if (!run || run.startedAt !== u.startedAt) throw new Error('That timer is not running any more')
      await life.focus.cancel()
      focusChanged()
      return '↶ Timer dropped (not logged)'
    }
  }
}

// ---- IC8: links and files dropped on the island --------------------------------

async function appendTo(title: string, head: string, line: string): Promise<void> {
  const notes = await life.notes!.list()
  const n = notes.find((x) => x.title.toLowerCase() === title.toLowerCase())
  await life.notes!.save(n ? { id: n.id, title: n.title, body: `${n.body.replace(/\s*$/, '')}\n${line}\n` } : { title, body: `${head}\n\n${line}\n` })
}

async function runDrop(a: Extract<IslandAction, { kind: 'drop' }>, findTask: (id: string) => { id: string; content: string } | null): Promise<string> {
  if (!life.notes) throw new Error('The Notebook is not available here')
  const day = calendarDay(new Date())
  const d = classifyDrop({ uris: a.link ? [a.link] : [], files: a.file ? [{ name: a.file.name, type: a.file.mime, size: a.file.size }] : [] })
  if (d.kind === 'refuse') throw new Error(d.why)
  if (d.kind === 'todoist') {
    let t = findTask(d.taskId)
    if (!t && life.todoist?.everything) t = (await life.todoist.everything().catch(() => null))?.tasks.find((x) => x.id === d.taskId) ?? null
    if (!t) throw new Error('That Todoist task was not found (is it done already?)')
    if ((await life.focus.state()).running) throw new Error('A timer is running: stop it first')
    const subject = t.content.slice(0, 40)
    await life.focus.start(subject, 25, { kind: 'todoist', ref: t.id, title: t.content }, flowStages(breakMin, null))
    focusChanged()
    return `▶ Focus on ${subject} · 25 min`
  }
  if (d.kind === 'link') {
    await appendTo('Inbox', '# Inbox\n\nThings you saved from the island.', `- ${d.url} _(${day})_`)
    return '📓 Link saved in Notebook → Inbox'
  }
  if (d.kind === 'file') {
    const data = a.file?.data ?? ''
    // The size is checked again here (the island could be an old version).
    if (!data || data.length > Math.ceil((DROP_MAX_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error('That file could not be read')
    const url = `data:${d.mime};base64,${data}`
    const line = d.mime.startsWith('image/') ? `![${d.name}](${url})` : `[📄 ${d.name}](${url})`
    await appendTo(`Journal/${day}`, `# ${day}`, line)
    return `📓 ${d.mime.startsWith('image/') ? 'Picture' : 'PDF'} added to today's note`
  }
  throw new Error('Nothing to drop')
}

// ---- The taps -------------------------------------------------------------------

/**
 * The island's control taps. Returns what to say (a string, maybe empty), or
 * null when the tap is not one of these (IslandFeed's own switch does it).
 * Throws with a plain reason.
 */
export async function controlAct(a: IslandAction, ctx: { blocks: FlowBlock[]; findTask: (id: string) => { id: string; content: string } | null }): Promise<string | null> {
  switch (a.kind) {
    case 'pause': {
      if (!life.focus.pause) throw new Error('Pausing needs the newest version')
      if (currentBreak() && !(await life.focus.state()).running) throw new Error('A break has no pause')
      await life.focus.pause()
      focusChanged()
      return "⏸ Paused · this time doesn't count"
    }
    case 'resume':
      if (!life.focus.resume) throw new Error('Pausing needs the newest version')
      await life.focus.resume()
      focusChanged()
      return '▶ Going on'
    case 'rename':
      if (!life.focus.rename) throw new Error('Renaming needs the newest version')
      await life.focus.rename(a.subject)
      focusChanged()
      return `✎ ${a.subject.trim().slice(0, 40)}`
    case 'setEnd': {
      const st = await life.focus.state()
      const run = st.running
      if (!run) throw new Error('No focus session is running')
      // The island's end is the same as focusEndsAt (paused or not).
      const minutes = Math.round((a.at - focusEndsAt(run)) / 60_000)
      if (minutes) await life.focus.extend?.(minutes)
      focusChanged()
      return minutes ? `${minutes > 0 ? '+' : '−'}${Math.abs(minutes)} min` : 'No change'
    }
    case 'undo':
      return runUndo(a.of)
    case 'drop':
      return runDrop(a, ctx.findTask)
    case 'stop':
    case 'extend': {
      // During a break (no focus timer): Stop ends it, +5 makes it longer.
      const b = currentBreak()
      if (!b || (await life.focus.state()).running) return null
      if (a.kind === 'stop') {
        put(BREAK, null)
        focusChanged()
        return 'Break over · nothing started'
      }
      put(BREAK, { ...b, endsAt: Math.max(b.endsAt, Date.now()) + a.minutes * 60_000 })
      focusChanged()
      return `+${a.minutes} min break`
    }
    case 'start': {
      if (!a.flow && !a.task) return null
      put(BREAK, null)
      const next = nextBlock(ctx.blocks, Date.now() + (a.minutes + breakMin) * 60_000, { subject: a.subject, minutes: a.minutes })
      const stages: FocusStage[] = a.flow ? flowStages(breakMin, next) : []
      const st = await life.focus.start(a.subject, a.minutes, a.task ?? null, stages)
      rememberUndo(a.id, st.running ? { kind: 'start', startedAt: st.running.startedAt } : null)
      focusChanged()
      return `⏱ ${a.subject.slice(0, 40)} · ${a.minutes} min${stages.length ? ` · then a ${breakMin} min break` : ''}`
    }
    default:
      return null
  }
}
