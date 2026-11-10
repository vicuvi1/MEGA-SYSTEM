// Desktop only: Study Time on the island. The app window builds the island's
// study part (every open block to start, searchable; today's minutes), adds
// the subject's colour, emoji and ring target to the running timer, runs the
// island's taps through life.study (the one focus timer), and turns Study
// Time's notices (src/core/studyNotify.ts: pomodoro done, break over, planned
// time, over time, a goal, a forgotten timer, a block waiting) into island
// cards with their sound and buttons. One notice per event: an answered or
// dropped one stays dropped (the island's `dismissed`).
import { dayKey } from '@core/dates'
import { studyNotice, type StudyNotice } from '@core/studyNotify'
import { categoryColor, categoryEmoji, cleanStore, filterBlocks, prefsOf, resolveBlocks, weekStart, type StudyRun, type StudySession, type StudyStore } from '@core/studyTime'
import type { IslandAction, IslandAlert, IslandSnapshot } from '@core/islandModel'
import { life } from './bridge'

type StudyTap = Extract<IslandAction, { kind: 'studyTime' }>
type Running = NonNullable<IslandSnapshot['running']>

// The blocks and this week's sessions, read at most every 20 s (sooner after a change).
let cache: { at: number; store: StudyStore | null; sessions: StudySession[] } = { at: 0, store: null, sessions: [] }
if (typeof window !== 'undefined') for (const e of ['life-study-changed', 'life-focus-changed', 'life-external-changed']) window.addEventListener(e, () => (cache.at = 0))

async function load(now: number): Promise<typeof cache> {
  if (now - cache.at < 20_000 && cache.at <= now) return cache
  if (!life.study) return cache
  const raw = await life.study.blocks().catch(() => null)
  const store = raw ? cleanStore(raw) : null
  const today = dayKey(new Date(now))
  const sessions = store ? resolveBlocks(await life.study.sessions(weekStart(today)).catch(() => []), store) : []
  cache = { at: now, store, sessions }
  return cache
}

/** The island's study part: your open blocks (quick ones first, then today's, then the rest) and today's minutes. */
function snapOf(store: StudyStore, sessions: StudySession[], today: string): IslandSnapshot['studyTime'] {
  const open = store.blocks.filter((b) => !b.done)
  if (!open.length) return null
  const todays = new Set(filterBlocks(store.blocks, { kind: 'today' }, today).map((b) => b.id))
  const rank = (b: (typeof open)[number]) => (b.quick ? 0 : todays.has(b.id) ? 1 : 2)
  const sorted = [...open].sort((a, b) => rank(a) - rank(b))
  const item = (b: (typeof open)[number]) => ({ id: b.id, name: b.name, color: categoryColor(store, b.category), emoji: categoryEmoji(store, b.category), planned: b.plannedMin, category: b.category, due: b.due && b.due <= today ? b.due : null })
  return {
    quick: sorted.filter((b) => b.quick).slice(0, 6).map(item),
    blocks: sorted.slice(0, 60).map(item),
    todayMin: sessions.filter((s) => s.day === today).reduce((t, s) => t + s.minutes, 0),
    mode: prefsOf(store).mode
  }
}

/** The running Study Time block, with its subject's colour and emoji, its ring target and its sounds. */
function decorate(running: Running, run: (StudyRun & Record<string, unknown>) | null, store: StudyStore): Running {
  if (!running.up || !run?.blockId) return running
  const b = store.blocks.find((x) => x.id === run.blockId)
  const p = prefsOf(store)
  const goalAt = run.pomo ? run.pomo.at * 60_000 : run.open ? null : run.planned * 60_000
  const goalFrom = run.pomo ? (run.pomo.from ?? Math.max(0, run.pomo.at - run.pomo.work)) * 60_000 : 0
  return {
    ...running,
    color: categoryColor(store, b?.category ?? ''),
    emoji: categoryEmoji(store, b?.category ?? ''),
    goalAt,
    goalFrom,
    pomo: run.pomo ? { n: run.pomo.done + 1, every: run.pomo.every, done: run.pomo.done } : null,
    plain: run.pauseKind === 'pause',
    sound: { noise: p.noise, tick: p.tick }
  }
}

/** A Study Time notice as an island card: its sound, its words, its buttons (each closes the notice). */
export function noticeAlert(n: StudyNotice, look: { color: string; emoji: string }): IslandAlert {
  return {
    id: n.id,
    kind: n.timer ? 'over' : n.kind === 'due' ? 'remind' : 'goal',
    title: n.title,
    text: n.text,
    face: n.face,
    sound: n.sound,
    ...(n.dot ? { dot: true } : {}),
    study: { kind: n.kind, color: look.color, emoji: look.emoji || n.face },
    actions: n.actions.map((a) => ({ label: a.label, primary: a.primary, action: { kind: 'studyTime', op: a.op, alertId: n.id, ...(a.blockId ? { blockId: a.blockId } : {}), ...(a.minutes ? { minutes: a.minutes } : {}) } }))
  }
}

export interface StudyIslandTick {
  studyTime: IslandSnapshot['studyTime']
  running: IslandSnapshot['running']
  /** A timer notice (pomodoro done, break over, planned time, over time, forgotten): it comes before most cards. */
  urgent: IslandAlert | null
  /** A gentle one (goal reached or behind, a planned block waiting): it waits its turn. */
  gentle: IslandAlert | null
}

/** One build of the island's Study Time part. */
export async function studyIslandTick(o: { now: number; run: unknown; running: IslandSnapshot['running']; meeting: boolean; dismissed: Record<string, number> }): Promise<StudyIslandTick> {
  const c = await load(o.now)
  const none: StudyIslandTick = { studyTime: null, running: o.running, urgent: null, gentle: null }
  if (!c.store) return none
  const today = dayKey(new Date(o.now))
  const run = (o.run as (StudyRun & Record<string, unknown>) | null) ?? null
  const running = o.running ? decorate(o.running, run, c.store) : null
  const n = studyNotice({ run: run?.blockId ? run : null, now: o.now, today, store: c.store, sessions: c.sessions, done: (id) => (o.dismissed[id] ?? 0) > o.now, meeting: o.meeting, dayOf: (d) => dayKey(d) })
  let alert: IslandAlert | null = null
  if (n) {
    const b = n.actions.find((a) => a.blockId)?.blockId ?? run?.blockId
    const blk = b ? c.store.blocks.find((x) => x.id === b) : undefined
    alert = noticeAlert(n, { color: running?.color ?? categoryColor(c.store, blk?.category ?? ''), emoji: running?.emoji ?? categoryEmoji(c.store, blk?.category ?? '') })
  }
  return { studyTime: snapOf(c.store, c.sessions, today), running, urgent: n?.timer ? alert : null, gentle: n && !n.timer ? alert : null }
}

/** A tap on the island's study part or one of its notices. Returns what to say (or an action for the island to run). */
export async function studyTimeAct(a: StudyTap): Promise<string> {
  const st = life.study
  if (!st) throw new Error('Study Time needs the newest version')
  cache.at = 0
  const blockOf = async (id?: string) => {
    const store = cleanStore(await st.blocks())
    const b = store.blocks.find((x) => x.id === id)
    if (!b) throw new Error('That block is gone')
    return b
  }
  switch (a.op) {
    case 'start': {
      const b = await blockOf(a.blockId)
      const cur = (await life.focus.state()).running as { blockId?: string | null } | null
      if (cur) {
        const r = await st.switchBlock(b)
        return r.logged ? `⇄ ${b.name} · ${r.logged.session.minutes} min logged` : `⇄ ${b.name}`
      }
      await st.start(b)
      return `⏱ ${b.name}${b.plannedMin ? ` · ${b.plannedMin} min` : ''}`
    }
    case 'switch': {
      const b = await blockOf(a.blockId)
      const r = await st.switchBlock(b)
      return r.logged ? `⇄ ${b.name} · ${r.logged.session.minutes} min logged` : `⇄ ${b.name}`
    }
    case 'break':
      await st.breakStart(a.minutes ?? null)
      return a.minutes ? `☕ ${a.minutes} min break` : '☕ Break'
    case 'pomoBreak':
      await st.pomoBreak()
      return '☕ Break: rest your eyes'
    case 'keepGoing':
      await st.keepGoing()
      return '🍅 Next pomodoro'
    case 'breakMore':
      await st.breakMore(a.minutes ?? 5)
      return `☕ +${a.minutes ?? 5} min break`
    case 'pause':
      await st.pause()
      return '❚❚ Paused'
    case 'resume':
    case 'back':
      await st.resume()
      return '▶ Back to it'
    case 'extend':
      await st.extend(a.minutes ?? 5)
      return `+${a.minutes ?? 5} min`
    case 'stop': {
      const r = await st.stop()
      return `✓ ${r.session.minutes} min logged`
    }
    case 'drop':
      await life.focus.cancel()
      return 'Timer dropped'
    case 'open':
      window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'study' }))
      return ''
    case 'later':
    case 'ok':
      return ''
  }
}
