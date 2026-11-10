// Study Time's notices (pure, tested in studyNotify.test.ts): what the island
// (or, with no island, the app window) says, once per event, with clear words
// and buttons. One notice at a time, the most important first:
//   a forgotten timer → break over → pomodoro done (then one over-time nudge)
//   → planned time reached (then one over-time nudge)
//   → with nothing running: a goal reached → a planned block waiting → a goal behind.
// Quiet hours and calls are the island's own rule (alertGate); in a meeting
// the timer notices come as a dot (`dot`), the gentle ones not at all.
import { categoryEmoji, isForgotten, prefsOf, runNow, goalMin, pomoBreakLen, type StudyBlock, type StudyRun, type StudySession, type StudySound, type StudyStore } from './studyTime'
import { goalViews } from './studyInsights'

export type NoticeKind = 'forgot' | 'breakOver' | 'pomoDone' | 'planned' | 'overtime' | 'goalReached' | 'due' | 'goalBehind'

/** What a button on a notice does (the island turns it into a studyTime action). */
export type NoticeOp = 'pomoBreak' | 'keepGoing' | 'back' | 'stop' | 'extend' | 'breakMore' | 'start' | 'later' | 'ok' | 'open' | 'drop'

export interface NoticeAction {
  label: string
  op: NoticeOp
  minutes?: number
  blockId?: string
  primary?: boolean
}

export interface StudyNotice {
  /** Once per event: the island keeps a notice it was told to drop by this id. */
  id: string
  kind: NoticeKind
  /** Timer notices ring like time's up (they wait as a dot in quiet hours). */
  timer: boolean
  title: string
  text: string
  face: string
  /** Your chosen sound for it (the island's kit plays it). */
  sound: StudySound | 'remind' | 'remindReward'
  actions: NoticeAction[]
  /** In a meeting: only a dot that waits (never a pop-up with a sound). */
  dot?: boolean
}

export interface NoticeIn {
  run: (StudyRun & { color?: string }) | null
  now: number
  /** The app's day (it starts at 04:00). */
  today: string
  store: StudyStore
  /** At least this week's sessions (the goals) and today's (the gap since the last one). */
  sessions: StudySession[]
  /** Ids already answered or dropped. */
  done: (id: string) => boolean
  /** In a meeting or a class from the calendar (or a call). */
  meeting: boolean
  dayOf: (at: Date) => string
}

/** Minutes past the plan before the one over-time nudge. */
export const OVERTIME_MIN = { pomo: 10, planned: 15 }
/** A notice about a timer moment stays this long after it (then it's old news). */
const FRESH_MS = 30 * 60_000

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${Math.round(min)} min`)

export function studyNotice(o: NoticeIn): StudyNotice | null {
  const t = timerNotice(o)
  if (t) return o.meeting ? { ...t, dot: true } : t
  if (o.run || o.meeting || !prefsOf(o.store).nudges) return null
  return gentleNotice(o)
}

function emojiOf(store: StudyStore, run: StudyRun): string {
  const b = run.blockId ? store.blocks.find((x) => x.id === run.blockId) : undefined
  return (b && categoryEmoji(store, b.category)) || '⏱'
}

function timerNotice(o: NoticeIn): StudyNotice | null {
  const { run, now, store, done } = o
  if (!run?.blockId) return null
  const p = prefsOf(store)
  const subj = run.subject
  const face = emojiOf(store, run)
  if (isForgotten(run, now, o.dayOf)) {
    const id = `study:forgot:${run.startedAt}`
    if (done(id)) return null
    const since = new Date(Date.parse(run.startedAt)).toTimeString().slice(0, 5)
    return {
      id,
      kind: 'forgot',
      timer: true,
      title: 'Timer still running?',
      text: `${subj} has run since ${since}. Say when you stopped (saved without points), or drop it.`,
      face: '⏳',
      sound: 'remind',
      actions: [
        { label: 'Fix it in Study Time', op: 'open', primary: true },
        { label: 'Drop it', op: 'drop' }
      ]
    }
  }
  const n = runNow(run, now)
  if (n.onBreak) {
    if (n.breakEndsAt && now >= n.breakEndsAt && now - n.breakEndsAt < FRESH_MS) {
      const id = `study:brk:${n.breakEndsAt}`
      if (done(id)) return null
      return {
        id,
        kind: 'breakOver',
        timer: true,
        title: "Break's over",
        text: `Back to ${subj}${run.pomo ? ` · pomodoro ${run.pomo.done + 1}` : ''}.`,
        face,
        sound: p.breakSound,
        actions: [
          { label: `Back to ${short(subj)}`, op: 'back', primary: true },
          { label: '+5 min break', op: 'breakMore', minutes: 5 },
          { label: 'Stop & log', op: 'stop' }
        ]
      }
    }
    return null
  }
  const goal = goalMin(run)
  if (goal == null || n.plannedEndsAt == null || now < n.plannedEndsAt) return null
  const overMin = n.workedMs / 60_000 - goal
  if (run.pomo) {
    const over = `study:over:${run.startedAt}:${goal}`
    if (overMin >= OVERTIME_MIN.pomo && overMin * 60_000 < FRESH_MS + OVERTIME_MIN.pomo * 60_000 && !done(over))
      return {
        id: over,
        kind: 'overtime',
        timer: true,
        title: `${Math.floor(overMin)} min past the pomodoro`,
        text: `Still on ${subj}? A short break keeps the next one sharp.`,
        face,
        sound: 'remind',
        actions: [
          { label: `Take ${pomoBreakLen(run.pomo)}`, op: 'pomoBreak', primary: true },
          { label: 'Keep going', op: 'keepGoing' },
          { label: 'Stop & log', op: 'stop' }
        ]
      }
    const id = `study:pomo:${run.startedAt}:${goal}`
    if (done(id) || overMin * 60_000 >= FRESH_MS) return null
    const len = pomoBreakLen(run.pomo)
    const nth = run.pomo.done + 1
    const long = len === run.pomo.long && run.pomo.long !== run.pomo.short
    return {
      id,
      kind: 'pomoDone',
      timer: true,
      title: `Pomodoro ${nth} done`,
      text: long ? `${subj}: ${nth} in a row. Time for a long break.` : `${subj}: nice work. Rest your eyes for ${len} minutes.`,
      face,
      sound: p.endSound,
      actions: [
        { label: `Take ${len}`, op: 'pomoBreak', primary: true },
        { label: 'Keep going', op: 'keepGoing' },
        { label: 'Stop & log', op: 'stop' }
      ]
    }
  }
  const over = `study:over:${run.startedAt}:${goal}`
  if (overMin >= OVERTIME_MIN.planned && !done(over) && overMin * 60_000 < FRESH_MS + OVERTIME_MIN.planned * 60_000)
    return {
      id: over,
      kind: 'overtime',
      timer: true,
      title: `${Math.floor(overMin)} min over the plan`,
      text: `${subj} was planned for ${hm(goal)}. Wrap up, or give it 15 more.`,
      face,
      sound: 'remind',
      actions: [
        { label: 'Stop & log', op: 'stop', primary: true },
        { label: '+15 min', op: 'extend', minutes: 15 }
      ]
    }
  const id = `study:plan:${run.startedAt}:${goal}`
  if (done(id) || overMin * 60_000 >= FRESH_MS) return null
  return {
    id,
    kind: 'planned',
    timer: true,
    title: 'Planned time reached',
    text: `${subj}: ${hm(goal)} done. Stop and log it, or keep going.`,
    face,
    sound: p.endSound,
    actions: [
      { label: 'Stop & log', op: 'stop', primary: true },
      { label: '+5 min', op: 'extend', minutes: 5 },
      { label: 'Keep going', op: 'ok' }
    ]
  }
}

const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)

function gentleNotice(o: NoticeIn): StudyNotice | null {
  const { store, today, now, done } = o
  const hour = new Date(now).getHours()
  const goals = goalViews(o.sessions, store, today)
  const todays = o.sessions.filter((s) => s.day === today)
  // A goal reached today (once a week each).
  for (const g of goals) {
    if (!g.reached) continue
    const id = `study:goal:${g.category.toLowerCase()}:${today}`
    const beforeToday = g.doneMin - todays.filter((s) => (store.blocks.find((b) => b.id === s.blockId)?.category ?? '').toLowerCase() === g.category.toLowerCase()).reduce((t, s) => t + s.minutes, 0)
    if (beforeToday >= g.goalMin || done(id) || weekDone(done, g.category, today)) continue
    return { id, kind: 'goalReached', timer: false, title: 'Goal reached', text: `${g.category}: ${hm(g.doneMin)} this week, your goal was ${hm(g.goalMin)}. 🎉`, face: g.emoji || '🏆', sound: 'remindReward', actions: [{ label: 'Nice', op: 'ok', primary: true }, { label: 'See stats', op: 'open' }] }
  }
  if (hour < 9 || hour >= 22) return null
  // A planned block waiting: due today or overdue, not done, and no study in the last 45 minutes.
  const lastEnd = todays.reduce((t, s) => Math.max(t, Date.parse(s.endedAt) || 0), 0)
  if (now - lastEnd > 45 * 60_000) {
    const due = store.blocks.find((b) => !b.done && !!b.due && b.due <= today && !done(`study:due:${b.id}:${today}`))
    if (due) {
      const id = `study:due:${due.id}:${today}`
      const late = due.due! < today
      return {
        id,
        kind: 'due',
        timer: false,
        title: late ? 'A planned block is overdue' : 'Your planned block is waiting',
        text: `${due.name}${due.plannedMin ? ` · ${hm(due.plannedMin)}` : ''}. Start it now?`,
        face: categoryEmoji(store, due.category) || '📚',
        sound: 'remind',
        actions: [
          { label: `Start ${short(due.name)}`, op: 'start', blockId: due.id, primary: true },
          { label: 'In an hour', op: 'later', minutes: 60 },
          { label: 'Not today', op: 'ok' }
        ]
      }
    }
  }
  // A goal behind (afternoon or evening, once a day each).
  if (hour >= 14 && hour < 21) {
    for (const g of goals) {
      if (!g.behind) continue
      const id = `study:behind:${g.category.toLowerCase()}:${today}`
      if (done(id)) continue
      const b = firstOpen(store.blocks, g.category)
      return {
        id,
        kind: 'goalBehind',
        timer: false,
        title: `Behind on ${g.category}`,
        text: `${hm(g.doneMin)} of ${hm(g.goalMin)} this week. About ${hm(g.perDayMin)} a day gets you there.`,
        face: g.emoji || '📈',
        sound: 'remind',
        actions: [...(b ? [{ label: `Start ${short(b.name)}`, op: 'start' as const, blockId: b.id, primary: true }] : []), { label: 'Later', op: 'later', minutes: 120 }, { label: 'Not today', op: 'ok' }]
      }
    }
  }
  return null
}

const firstOpen = (blocks: StudyBlock[], category: string) => blocks.find((b) => !b.done && b.category.toLowerCase() === category.toLowerCase())

/** A goal's "reached" notice already said this week (it is keyed by the day it came). */
function weekDone(done: (id: string) => boolean, category: string, today: string): boolean {
  const d = new Date(`${today}T12:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  for (let i = 1; i <= back; i++) {
    const x = new Date(d.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    if (done(`study:goal:${category.toLowerCase()}:${x}`)) return true
  }
  return false
}
