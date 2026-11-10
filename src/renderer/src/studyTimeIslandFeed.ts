// Desktop only: Study Time on the island. The app window builds the island's
// study part (your quick blocks, today's minutes), runs its taps through
// life.study (the one focus timer), and raises "Break's over" when a break
// with a length ends (it rings like time's up). The planned end of a block is
// the timer's own "time is up" card.
import { dayKey } from '@core/dates'
import { categoryColor, cleanStore } from '@core/studyTime'
import type { IslandAction, IslandAlert, IslandSnapshot } from '@core/islandModel'
import { life } from './bridge'

type StudyTap = Extract<IslandAction, { kind: 'studyTime' }>

/** The island's study part, or null when Study Time has no quick blocks. */
export async function studyTimeForIsland(now: number): Promise<IslandSnapshot['studyTime']> {
  if (!life.study) return null
  const raw = await life.study.blocks().catch(() => null)
  if (!raw) return null
  const store = cleanStore(raw)
  const quick = store.blocks.filter((b) => b.quick && !b.done).slice(0, 6)
  if (!quick.length) return null
  const today = dayKey(new Date(now))
  const sessions = await life.study.sessions(today).catch(() => [])
  return {
    quick: quick.map((b) => ({ id: b.id, name: b.name, color: categoryColor(store, b.category), planned: b.plannedMin })),
    todayMin: sessions.filter((s) => s.day === today).reduce((t, s) => t + s.minutes, 0)
  }
}

/** A tap on the island's study part. Returns what to say. */
export async function studyTimeAct(a: StudyTap): Promise<string> {
  const st = life.study
  if (!st) throw new Error('Study Time needs the newest version')
  switch (a.op) {
    case 'start': {
      const store = cleanStore(await st.blocks())
      const b = store.blocks.find((x) => x.id === a.blockId)
      if (!b) throw new Error('That block is gone')
      await st.start(b)
      return `⏱ ${b.name}${b.plannedMin ? ` · ${b.plannedMin} min` : ''}`
    }
    case 'break':
      await st.breakStart(a.minutes ?? null)
      return a.minutes ? `☕ ${a.minutes} min break` : '☕ Break'
    case 'back':
      await st.breakEnd()
      return '▶ Back to it'
    case 'stop': {
      const r = await st.stop()
      return `✓ ${r.session.minutes} min logged`
    }
  }
}

/** "Break's over": a Study Time break with a length has ended (once per break end). */
export function studyBreakAlert(running: IslandSnapshot['running'], now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (!running?.up || !running.pausedAt || !running.breakEndsAt || now < running.breakEndsAt) return null
  const id = `sbrk:${running.breakEndsAt}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'over',
    title: "Break's over",
    text: `Back to ${running.subject}?`,
    face: '▶',
    actions: [
      { label: '▶ Back to it', action: { kind: 'studyTime', op: 'back', alertId: id }, primary: true },
      { label: '+5 min', action: { kind: 'studyTime', op: 'break', minutes: Math.round((now - running.pausedAt) / 60_000) + 5, alertId: id } },
      { label: 'Stop & log', action: { kind: 'studyTime', op: 'stop', alertId: id } }
    ]
  }
}
