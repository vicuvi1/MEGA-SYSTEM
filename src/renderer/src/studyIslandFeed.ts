// The app window's side of the island's Study page (CR3, CR4): the pack for
// now and one quick flashcard in the snapshot (fetched at most once a minute,
// at once after a change), and the island's taps (start the pack as a focus
// timer, grade the card, another pack).
import { life } from './bridge'
import type { IslandAction } from '@core/islandModel'
import { GRADE_LABEL, ivlText, nextIvl } from '@core/career/srs'
import { PACK_SUBJECT, type IslandStudy } from '@core/career/studyPack'

let cache: { at: number; v: IslandStudy | null } = { at: 0, v: null }
if (typeof window !== 'undefined') {
  window.addEventListener('life-career-changed', () => (cache = { ...cache, at: 0 }))
  window.addEventListener('life-focus-changed', () => (cache = { ...cache, at: 0 }))
}

export async function studyForIsland(now: number): Promise<IslandStudy | null> {
  if (now - cache.at < 60_000 || !life.career) return cache.v
  cache.at = now
  const v = await life.career.view().catch(() => null)
  if (!v) return cache.v
  const c = v.cards.queue[0]
  cache.v = {
    shift: !!v.study.shift?.now,
    pack: v.study.pack,
    card: c ? { id: c.id, front: c.front, back: c.back, deck: c.deck, left: v.cards.queue.length, ivls: { again: ivlText(nextIvl(c, 'again', v.today)), hard: ivlText(nextIvl(c, 'hard', v.today)), good: ivlText(nextIvl(c, 'good', v.today)), easy: ivlText(nextIvl(c, 'easy', v.today)) } } : null,
    due: v.cards.queue.length,
    packsWeek: v.study.packsWeek.count
  }
  return cache.v
}

export async function studyAct(a: Extract<IslandAction, { kind: 'study' }>): Promise<string> {
  const c = life.career
  if (!c) throw new Error('Career needs the web app')
  cache = { ...cache, at: 0 }
  if (a.op === 'start') {
    const min = Math.max(10, Math.min(25, Math.round(a.minutes ?? 20)))
    await life.focus.start(PACK_SUBJECT, min)
    window.dispatchEvent(new CustomEvent('life-focus-changed'))
    return `📚 Study pack started · ${min} min`
  }
  if (a.op === 'grade' && a.cardId && a.grade) {
    await c.grade(a.cardId, a.grade)
    return `🃏 ${GRADE_LABEL[a.grade]}`
  }
  await c.nextPack()
  return '📚 Another pack'
}
