// Sport now lives in Ben. Sets sent to the bots ("3x15 push-ups", "push-ups 15
// 14 12", "8 push-ups +10 kg", "plank 3x45s", "best set push-ups 50") go into
// Sport Track, and Ben's reply is a receipt: what was logged, your best set, the
// level, the next target and the coach's note for next time. Pure; the bots call
// it (webBots.ts). Points are unchanged: sets, weights and best sets pay nothing.
import { findSharedExercise } from './sportShared'
import { moveOf } from './sportLadders'
import { matchMove } from './sportMoves'
import { progressFor } from './sportProgress'
import { addSets, bestSet, parseSets, setsText } from './sportSets'
import { placeFamily } from './sportLevels'
import { adjustAfterSession } from './sportAdjust'
import type { CoachCtx } from './sportCoachRules'
import type { InsightData } from './sportInsight'

export interface SportSay {
  kind: 'sets' | 'best'
  name: string
  reps: number[]
  unit: 'reps' | 'sec'
  /** Added weight in kg (a backpack), 0 for bodyweight. */
  kg: number
}

const KG = /\s*(?:\+|\bwith\s+|@\s*)\s*(\d{1,3}(?:[.,]\d)?)\s*kg\b/i
const NAMES = /^(press|pushups?|situps?|squats?|pullups?|dips?|plank|flotari|abdomene|genuflexiuni|tractiuni)$/i

/** A name Ben takes as sport: a library move or one of the plain old names. */
export const isSportName = (name: string) => !!matchMove(name) || NAMES.test(String(name).replace(/[^a-z]/gi, ''))

/** "3x15 push-ups", "push-ups 15 14 12", "8 push-ups +10 kg", "plank 3x45s", "best set push-ups 50": what was said, or null. */
export function parseSportSay(text: string): SportSay | null {
  let t = String(text ?? '').trim().replace(/^\//, '')
  if (!t || t.length > 90) return null
  let kg = 0
  const k = KG.exec(t)
  if (k) {
    kg = Math.round(Number(k[1].replace(',', '.')) * 2) / 2
    t = t.replace(KG, '').trim()
  }
  const best = /^(?:best(?:\s+set)?|max(?:\s+set)?|my\s+max|my\s+best(?:\s+set)?)[:\s-]+(.+?)\s+(\d{1,3})\s*(s|sec|secs|seconds)?$/i.exec(t) ?? (/^(.+?)\s+(?:best(?:\s+set)?|max)[:\s-]+(\d{1,3})\s*(s|sec|secs|seconds)?$/i.exec(t))
  if (best && isSportName(best[1])) return { kind: 'best', name: best[1].replace(/[:,.\-–]+$/, '').trim(), reps: [Number(best[2])], unit: best[3] ? 'sec' : 'reps', kg }
  const sets = parseSets(t)
  if (sets) return { kind: 'sets', name: sets.name, reps: sets.reps, unit: sets.unit as 'reps' | 'sec', kg }
  // One set with a weight: "8 push-ups +10 kg" (without a weight one number stays a total).
  if (kg > 0) {
    const nameFirst = /^([a-zA-Z][a-zA-Z' _-]{1,40}?)\s+(\d{1,3})$/i.exec(t)
    const repsFirst = /^(\d{1,3})\s*(?:x\s*|reps?\s+(?:of\s+)?)?([a-zA-Z][a-zA-Z' _-]{1,40})$/i.exec(t)
    const one = repsFirst ? { 1: repsFirst[1], 2: repsFirst[2] } : nameFirst ? { 1: nameFirst[2], 2: nameFirst[1] } : null
    if (one && Number(one[1]) >= 1 && isSportName(String(one[2]))) return { kind: 'sets', name: String(one[2]).trim(), reps: [Number(one[1])], unit: 'reps', kg }
  }
  return null
}

/** "8 × push-ups +10 kg" or "3 × 15 push-ups". */
export function receiptSets(name: string, reps: number[], unit: string, kg: number): string {
  const kgText = kg > 0 ? ` +${kg} kg` : ''
  return `${setsText(reps, unit)} ${name.toLowerCase()}${kgText}`
}

export interface BotOpts {
  kg?: number
  unit?: string
  /** Protein, sleep and readiness from the Body data (null: none). */
  body?: InsightData | null
}

const ctxOf = (s: any, day: string, body?: InsightData | null): CoachCtx => ({
  exercises: Array.isArray(s.exercises) ? s.exercises : [],
  days: s.days ?? {},
  sets: s.sets ?? {},
  today: day,
  best: s.bestSets ?? {},
  imported: s.importedDays ?? {},
  notYet: s.notYet ?? {},
  strength: s.sportySettings?.progressMode === 'strength',
  deload: !!s.sportySettings?.deloadUntil && s.sportySettings.deloadUntil >= day,
  program: s.weekProgram ?? null,
  body: body ?? null
})

/** "best set push-ups 50": remember it (the page places your level from it) and say where it puts you. */
export function declareBest(st: any, name: string, reps: number, day: string): { st: any; line: string } | null {
  const s = st && typeof st === 'object' ? JSON.parse(JSON.stringify(st)) : null
  const ex = s && findSharedExercise(s, name)
  const move = ex && moveOf({ name: String(ex.name ?? ''), move: ex.move })
  if (!ex || !move || !(reps >= 1 && reps <= 500)) return null
  s.bestSets = { ...(s.bestSets ?? {}), [move.family]: { move: move.id, reps: Math.round(reps), day } }
  const p = placeFamily({ exercises: s.exercises, days: s.days, sets: s.sets, today: day, best: s.bestSets, imported: s.importedDays }, move.family)
  return { st: s, line: `🏆 Best set saved: <b>${Math.round(reps)}</b> ${move.name.toLowerCase()}.${p?.lv ? `\n📈 Level <b>${p.level}</b> of ${p.of}: ${p.lv.name}.` : ''}\nOpen Sport Track and use “Re-check my levels” to put every exercise on the right variation.` }
}

/** The state with the sets added (or null if there's no such exercise), and one reply line (the receipt). */
export function logBotSets(st: any, name: string, reps: number[], day: string, now = Date.now(), opts: BotOpts = {}): { st: any; line: string } | null {
  const s = st && typeof st === 'object' ? JSON.parse(JSON.stringify(st)) : null
  const ex = s && findSharedExercise(s, name)
  if (!ex || !reps.length) return null
  const id = String(ex.id ?? ex.name)
  // Simple mode: Ben only confirms the log and gives today's total (the page already counted it in doneToday).
  if (s.sportySettings?.coachMode === false) {
    s.sets = addSets(s.sets, day, id, reps, now, { kg: opts.kg })
    const tgt = Number(ex.target) || 0
    return { st: s, line: `✅ Logged <b>${receiptSets(String(ex.name ?? name), reps, opts.unit ?? 'reps', opts.kg ?? 0)}</b>.\nToday: <b>${Number(ex.doneToday) || 0}</b>${tgt ? ` of ${tgt}` : ''} ${String(ex.name ?? name).toLowerCase()}.` }
  }
  const before = bestSet(s.sets, id)
  s.sets = addSets(s.sets, day, id, reps, now, { kg: opts.kg })
  const top = Math.max(...reps)
  const move = moveOf({ name: String(ex.name ?? ''), move: ex.move })
  const p = move ? progressFor({ log: s.sets, exId: id, move, today: day }) : null
  const best = before && top > before.reps ? `🏆 New best set: <b>${top}</b> (was ${before.reps})` : `Best set today: <b>${top}</b>${before ? ` · all-time ${Math.max(before.reps, top)}` : ''}`
  const prog = !p ? '' : p.status === 'ready' && p.next ? `\n⬆️ Level up: <b>${p.next.name}</b> is unlocked. Open Sport Track to move up.` : p.status === 'building' || p.status === 'new' ? `\n🎯 Next level at <b>${p.nextAt}</b>${p.hits ? ` (${p.hits} of ${p.need} sessions there)` : ''}` : `\n${p.line}`
  // Ben's receipt: what was logged, where you stand, and the coach's change for next time.
  const receipt = `✅ Logged <b>${receiptSets(String(ex.name ?? name), reps, opts.unit ?? 'reps', opts.kg ?? 0)}</b>.\n`
  let coach = ''
  try {
    const c = ctxOf(s, day, opts.body)
    const lv = move ? placeFamily({ ...c, exercises: c.exercises }, move.family) : null
    const adj = adjustAfterSession(c)
    const mine = adj.adjustments.find((a) => a.exId === id)
    coach = (lv?.lv ? `\n📈 Level <b>${lv.level}</b> of ${lv.of}: ${lv.lv.name}.` : '') + (mine ? `\n🧠 Next time: ${mine.text}` : '')
  } catch {
    coach = ''
  }
  return { st: s, line: receipt + best + prog + coach }
}
