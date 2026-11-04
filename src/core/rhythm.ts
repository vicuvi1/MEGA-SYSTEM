// The coach's daily rhythm, pure and tested:
// - a morning plan it proposes (must-dos, time blocks in your free time, a
//   training slot, the water goal) that you approve, edit or redo;
// - nudges during the day (water behind pace, no training by evening);
// - the evening review (planned vs done, a score, one lesson, tomorrow's
//   top 3) and the Sunday review (the week, next week's focus and big 3).
// When each is due comes from the tick (every few minutes) and this state.
import { freeGaps, suggestBlocks, type CalEvent } from './dayTime'

export interface PlanBlock {
  title: string
  start: string
  minutes: number
}

export interface DayProposal {
  day: string
  headline: string
  mustdos: string[]
  blocks: PlanBlock[]
  training: { time: string; what: string } | null
  waterMl: number
}

export interface RhythmState {
  day: string
  /** Ben approved the plan himself (it waited past 10:00). */
  autoApproved?: boolean
  /** Calendar blocks Ben already moved or asked about today (event ids). */
  moved?: string[]
  briefing?: { status: 'proposed' | 'approved'; sentAt: string; plan: DayProposal; version: number }
  evening?: { sentAt: string; score: number; top3: string[]; lesson?: string }
  water: string[]
  training?: boolean
  /** Tomorrow's top 3 from the evening review (they become the morning's must-dos). */
  tomorrow?: { day: string; top3: string[] }
  /** The Sunday of the last weekly review, and its suggested plan. */
  weekly?: { day: string; focus: string; note: string; big3: string[] }
}

export interface RhythmPrefs {
  on: boolean
  evening: string
  weekly: string
  water: boolean
  training: boolean
}

export const RHYTHM = 'coach_rhythm'
export const RHYTHM_PREFS = 'coach_rhythm_prefs'
export const DEFAULT_RHYTHM_PREFS: RhythmPrefs = { on: true, evening: '21:00', weekly: '19:00', water: true, training: true }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function cleanPrefs(p: any): RhythmPrefs {
  return {
    on: p?.on !== false,
    evening: HM.test(p?.evening) ? p.evening : DEFAULT_RHYTHM_PREFS.evening,
    weekly: HM.test(p?.weekly) ? p.weekly : DEFAULT_RHYTHM_PREFS.weekly,
    water: p?.water !== false,
    training: p?.training !== false
  }
}

/** Today's state: a new day keeps only tomorrow's top 3 and the weekly review. */
export function rhythmFor(state: any, today: string): RhythmState {
  const s = state && typeof state === 'object' ? state : {}
  if (s.day === today) return { ...s, water: Array.isArray(s.water) ? s.water : [] }
  return { day: today, water: [], ...(s.tomorrow ? { tomorrow: s.tomorrow } : {}), ...(s.weekly ? { weekly: s.weekly } : {}) }
}

export interface RhythmFacts {
  today: string
  time: string
  /** 0 = Sunday. */
  weekday: number
  /** When you logged waking up today (HH:MM), if you did. */
  wakeAt: string | null
  wakeTarget: string
  waterMl: number
  waterTarget: number
  workoutDone: boolean
  paused: boolean
}

export type RhythmJob = 'briefing' | 'evening' | 'weekly' | 'water' | 'training'

/** What the coach should send now (in order). */
export function dueRhythm(state: RhythmState, prefs: RhythmPrefs, f: RhythmFacts): RhythmJob[] {
  if (!prefs.on) return []
  const t = toMin(f.time)
  const out: RhythmJob[] = []
  // Morning: 5 minutes after you log waking up, else 45 minutes after your target; never before 06:00 or after noon.
  const start = Math.max(toMin('06:00'), f.wakeAt ? toMin(f.wakeAt) + 5 : toMin(f.wakeTarget) + 45)
  if (!state.briefing && t >= start && t < toMin('12:00')) out.push('briefing')
  if (!f.paused && prefs.water && waterBehind(state, f)) out.push('water')
  if (!f.paused && prefs.training && !f.workoutDone && !state.training && t >= toMin('18:00') && t < toMin('21:00')) out.push('training')
  if (f.weekday === 0 && t >= toMin(prefs.weekly) && state.weekly?.day !== f.today) out.push('weekly')
  if (!state.evening && t >= toMin(prefs.evening)) out.push('evening')
  return out
}

/** Water well behind the day's pace (08:00→21:00), at most 5 nudges, 1h50 apart, 11:00–20:30. */
export function waterBehind(state: RhythmState, f: RhythmFacts): boolean {
  const t = toMin(f.time)
  if (t < toMin('11:00') || t > toMin('20:30') || f.waterTarget <= 0) return false
  if (state.water.length >= 5) return false
  const last = state.water[state.water.length - 1]
  if (last && t - toMin(last) < 110) return false
  const pace = Math.min(1, Math.max(0, (t - toMin('08:00')) / (toMin('21:00') - toMin('08:00'))))
  return f.waterMl < f.waterTarget * pace - f.waterTarget * 0.25
}

// ---- The morning plan --------------------------------------------------

export interface PlanInputs {
  today: string
  /** Round up to the next quarter hour. */
  now: string
  events: CalEvent[]
  /** Candidates in order: starred first, then priority, then due. */
  tasks: { content: string; starred?: boolean; priority?: number; due?: string | null }[]
  /** From last night's review. */
  top3: string[]
  waterTarget: number
  workoutDone: boolean
  /** Goal blocks needed today (planned backward from deadlines), placed first. */
  goals?: { title: string; minutes: number }[]
}

export const quarter = (hm: string) => fromMin(Math.ceil(toMin(hm) / 15) * 15)

/** A plan without the model: last night's top 3 (else starred and urgent tasks), blocks in free time, a training slot. */
export function localProposal(p: PlanInputs): DayProposal {
  const seen = new Set<string>()
  const pick: string[] = []
  const add = (t: string) => {
    const k = t.trim().toLowerCase()
    if (!k || seen.has(k) || pick.length >= 3) return
    seen.add(k)
    pick.push(t.trim())
  }
  p.top3.forEach(add)
  const ranked = [...p.tasks].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || (b.priority ?? 1) - (a.priority ?? 1) || String(a.due ?? '9').localeCompare(String(b.due ?? '9')))
  ranked.forEach((t) => add(t.content))
  const gaps = freeGaps(p.events, p.today, { after: quarter(p.now), minMinutes: 30 })
  const blocks = suggestBlocks(gaps, [...(p.goals ?? []), ...pick.map((title) => ({ title, minutes: 50 }))]).map((b) => ({ title: b.title, start: b.start, minutes: b.minutes }))
  let training: DayProposal['training'] = null
  if (!p.workoutDone) {
    const taken = blocks.map((b) => ({ s: toMin(b.start), e: toMin(b.start) + b.minutes }))
    const evening = freeGaps(p.events, p.today, { after: fromMin(Math.max(toMin(quarter(p.now)), toMin('17:00'))), minMinutes: 45 })
    for (const g of evening) {
      let s = toMin(g.start)
      while (s + 45 <= toMin(g.end) && taken.some((x) => s < x.e + 10 && s + 45 > x.s - 10)) s += 15
      if (s + 45 <= toMin(g.end)) {
        training = { time: fromMin(s), what: 'Workout · 45 min' }
        break
      }
    }
  }
  const focus = blocks.reduce((t, b) => t + b.minutes, 0)
  return {
    day: p.today,
    headline: pick.length ? `${pick.length} must-do${pick.length === 1 ? '' : 's'} · ${focus} min of focus planned` : 'A light day: pick one thing that matters',
    mustdos: pick,
    blocks,
    training,
    waterMl: p.waterTarget
  }
}

/** The model's plan, made safe: real times, no clashes with your calendar or each other, at most 3 must-dos. */
export function cleanProposal(raw: any, fallback: DayProposal, events: CalEvent[], now: string): DayProposal {
  if (!raw || typeof raw !== 'object') return fallback
  const day = fallback.day
  const busy = events
    .filter((e) => !e.allDay && localDayOf(e.start) === day)
    .map((e) => ({ s: minOfIso(e.start), e: minOfIso(e.end) }))
  const after = toMin(quarter(now))
  const taken: { s: number; e: number }[] = []
  const blocks: PlanBlock[] = []
  for (const b of Array.isArray(raw.blocks) ? raw.blocks : []) {
    const start = String(b?.start ?? '').padStart(5, '0')
    const minutes = Math.round(Number(b?.minutes))
    const title = String(b?.title ?? '').trim().slice(0, 80)
    if (!HM.test(start) || !title || !(minutes >= 15 && minutes <= 180)) continue
    const s = toMin(start)
    const e = s + minutes
    if (s < after || e > toMin('23:30')) continue
    if ([...busy, ...taken].some((x) => s < x.e && e > x.s)) continue
    taken.push({ s, e })
    blocks.push({ title, start, minutes })
    if (blocks.length >= 6) break
  }
  const mustdos = (Array.isArray(raw.mustdos) ? raw.mustdos : []).map((x: any) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3)
  let training: DayProposal['training'] = null
  if (raw.training && HM.test(String(raw.training.time ?? '').padStart(5, '0'))) {
    const t = String(raw.training.time).padStart(5, '0')
    const s = toMin(t)
    if (s >= after && ![...busy, ...taken].some((x) => s < x.e && s + 30 > x.s)) training = { time: t, what: String(raw.training.what ?? 'Workout').slice(0, 60) || 'Workout' }
  }
  const waterMl = Number(raw.waterMl) >= 1000 && Number(raw.waterMl) <= 5000 ? Math.round(Number(raw.waterMl)) : fallback.waterMl
  return {
    day,
    headline: String(raw.headline ?? '').trim().slice(0, 140) || fallback.headline,
    mustdos: mustdos.length ? mustdos : fallback.mustdos,
    blocks: blocks.length || !fallback.blocks.length ? blocks : fallback.blocks,
    training: training ?? (raw.training === null ? null : fallback.training),
    waterMl
  }
}

const localDayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const minOfIso = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** The plan as a Telegram message (HTML). */
export function proposalText(p: DayProposal, opts: { version?: number; approved?: boolean } = {}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = [`☀️ <b>Your day${opts.version && opts.version > 1 ? ` (v${opts.version})` : ''}</b> · ${esc(p.headline)}`]
  if (p.mustdos.length) lines.push('', '<b>Must-dos</b>', ...p.mustdos.map((m, i) => `${i + 1}. ${esc(m)}`))
  const timed = [...p.blocks.map((b) => ({ s: b.start, text: `${b.start}–${fromMin(toMin(b.start) + b.minutes)} ${esc(b.title)}` })), ...(p.training ? [{ s: p.training.time, text: `${p.training.time} 💪 ${esc(p.training.what)}` }] : [])].sort((a, b) => a.s.localeCompare(b.s))
  if (timed.length) lines.push('', '<b>Blocks</b>', ...timed.map((x) => x.text))
  lines.push('', `💧 Water: ${(p.waterMl / 1000).toFixed(1)} L`)
  lines.push('', opts.approved ? '✅ <b>Approved.</b> Blocks are in your calendar, must-dos are starred.' : 'Approve, change it, or ask for another one.')
  return lines.join('\n')
}

export const PROPOSAL_KEYBOARD = { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'rb|a' }, { text: '✏️ Change', callback_data: 'rb|e' }, { text: '🔄 Redo', callback_data: 'rb|r' }]] }
export const EDIT_ASK = 'What should change in today\'s plan?'

// ---- The evening review ------------------------------------------------

export interface DayResult {
  mustdosDone: number
  mustdosTotal: number
  focusMin: number
  plannedFocusMin: number
  blocksDone: number
  blocksPlanned: number
  waterMl: number
  waterTarget: number
  workoutDone: boolean
  trainingPlanned: boolean
}

/** 0–100: must-dos 40, focus against the plan 30, water 15, training 15. */
export function dayScore(r: DayResult): number {
  const md = r.mustdosTotal ? r.mustdosDone / r.mustdosTotal : r.focusMin >= 50 ? 1 : 0
  const fo = Math.min(1, r.focusMin / Math.max(50, r.plannedFocusMin))
  const wa = r.waterTarget ? Math.min(1, r.waterMl / r.waterTarget) : 0
  const tr = r.workoutDone ? 1 : r.trainingPlanned ? 0 : 0.5
  return Math.round(md * 40 + fo * 30 + wa * 15 + tr * 15)
}

/** The weakest part of the day, for the lesson when there's no model. */
export function weakest(r: DayResult): string {
  const parts = [
    { k: r.mustdosTotal ? r.mustdosDone / r.mustdosTotal : 1, t: `${r.mustdosTotal - r.mustdosDone} must-do${r.mustdosTotal - r.mustdosDone === 1 ? '' : 's'} left open. Tomorrow: the hardest one first, before noon.` },
    { k: Math.min(1, r.focusMin / Math.max(50, r.plannedFocusMin)), t: `Focus ${r.focusMin} of ${Math.max(50, r.plannedFocusMin)} min planned. Start the first block on time; the rest follows.` },
    { k: r.waterTarget ? Math.min(1, r.waterMl / r.waterTarget) : 1, t: `Water ${(r.waterMl / 1000).toFixed(1)} of ${(r.waterTarget / 1000).toFixed(1)} L. A full glass with every meal.` },
    { k: r.workoutDone || !r.trainingPlanned ? 1 : 0, t: 'Training skipped. Put it before the evening, not after.' }
  ].sort((a, b) => a.k - b.k)
  return parts[0].k >= 1 ? 'Everything done. Keep the same rhythm tomorrow.' : parts[0].t
}

export function reviewText(r: DayResult, score: number, lesson: string, top3: string[], tone = 4): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const mark = score >= 80 ? '😎🔥' : score >= 55 ? '🙂' : tone < 5 ? '🎯' : score >= 35 ? '😤' : '😠'
  return [
    `🌙 <b>Day review: ${score}/100</b> ${mark}`,
    '',
    `Must-dos ${r.mustdosDone}/${r.mustdosTotal} · Focus ${r.focusMin}${r.plannedFocusMin ? `/${r.plannedFocusMin}` : ''} min${r.blocksPlanned ? ` · Blocks ${r.blocksDone}/${r.blocksPlanned}` : ''}`,
    `Water ${(r.waterMl / 1000).toFixed(1)}/${(r.waterTarget / 1000).toFixed(1)} L · Training ${r.workoutDone ? '✅' : '—'}`,
    '',
    `<b>Lesson:</b> ${esc(lesson)}`,
    ...(top3.length ? ['', "<b>Tomorrow's top 3</b>", ...top3.map((t, i) => `${i + 1}. ${esc(t)}`)] : [])
  ].join('\n')
}

export const REVIEW_KEYBOARD = { inline_keyboard: [[{ text: "✅ Keep as tomorrow's top 3", callback_data: 'rv|k' }, { text: '✏️ Change', callback_data: 'rv|e' }]] }
export const TOP3_ASK = "Tomorrow's top 3? One per line."

// ---- The Sunday review -------------------------------------------------

const FOCUS_NAMES: Record<string, string> = { focus: 'focus time', wake: 'wake-ups', sport: 'training', clean: 'clean days', todoist: 'tasks', spend: 'spending', mustdo: 'must-dos' }
export const focusName = (id: string) => FOCUS_NAMES[id] ?? id

/** Next week's focus without the model: the metric furthest below its target. */
export function suggestWeekFocus(metrics: { id: string; now: number; target?: number | null }[]): string {
  const scored = metrics.filter((m) => m.target && m.target > 0 && m.id !== 'spend').map((m) => ({ id: m.id, k: m.now / (m.target as number) }))
  scored.sort((a, b) => a.k - b.k)
  return scored[0]?.id ?? 'focus'
}

export function weeklyText(o: { score: number; prevScore: number; lines: string[]; win: string; leak: string; focus: string; note: string; big3: string[] }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const delta = o.score - o.prevScore
  return [
    `📊 <b>Week review: ${o.score}/100</b> (${delta >= 0 ? '+' : ''}${delta} vs last week)`,
    '',
    ...o.lines.map(esc),
    '',
    `🏆 <b>Win:</b> ${esc(o.win)}`,
    `🕳 <b>Leak:</b> ${esc(o.leak)}`,
    '',
    `<b>Next week</b>: focus on ${esc(focusName(o.focus))}${o.note ? ` (“${esc(o.note)}”)` : ''}`,
    ...o.big3.map((b, i) => `${i + 1}. ${esc(b)}`)
  ].join('\n')
}

export const WEEKLY_KEYBOARD = { inline_keyboard: [[{ text: '✅ Use this plan', callback_data: 'rw|a' }, { text: '✏️ Change', callback_data: 'rw|e' }]] }
export const WEEK_ASK = "Next week's 3 big tasks? One per line."

/** "1. a\n2) b\n- c" → ['a','b','c'] (at most 3). */
export function readLines(text: string): string[] {
  return text
    .split(/\n|;/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

