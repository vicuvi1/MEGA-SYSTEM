// Sets sent to the bot ("3x15 push-ups", "push-ups 15 14 12"): they go into
// Sport Track's sets for that exercise today, and the reply says your best set
// and where you stand on the ladder. Pure; the bots call it (webBots.ts).
import { findSharedExercise } from './sportShared'
import { moveOf } from './sportLadders'
import { progressFor } from './sportProgress'
import { addSets, bestSet } from './sportSets'

/** The state with the sets added (or null if there's no such exercise), and one reply line. */
export function logBotSets(st: any, name: string, reps: number[], day: string, now = Date.now()): { st: any; line: string } | null {
  const s = st && typeof st === 'object' ? JSON.parse(JSON.stringify(st)) : null
  const ex = s && findSharedExercise(s, name)
  if (!ex || !reps.length) return null
  const id = String(ex.id ?? ex.name)
  const before = bestSet(s.sets, id)
  s.sets = addSets(s.sets, day, id, reps, now)
  const top = Math.max(...reps)
  const move = moveOf({ name: String(ex.name ?? ''), move: ex.move })
  const p = move ? progressFor({ log: s.sets, exId: id, move, today: day }) : null
  const best = before && top > before.reps ? `🏆 New best set: <b>${top}</b> (was ${before.reps})` : `Best set today: <b>${top}</b>${before ? ` · all-time ${Math.max(before.reps, top)}` : ''}`
  const prog = !p ? '' : p.status === 'ready' && p.next ? `\n⬆️ Level up: <b>${p.next.name}</b> is unlocked. Open Sport Track to move up.` : p.status === 'building' || p.status === 'new' ? `\n🎯 Next level at <b>${p.nextAt}</b>${p.hits ? ` (${p.hits} of ${p.need} sessions there)` : ''}` : `\n${p.line}`
  return { st: s, line: best + prog }
}
