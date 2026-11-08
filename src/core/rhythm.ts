// The coach's daily rhythm, pure and tested:
// - a morning plan it proposes (must-dos, time blocks in your free time, a
//   training slot, the water goal) that you approve, edit or redo;
// - nudges during the day (water behind pace, no training by evening);
// - the evening review (planned vs done, a score, one lesson, tomorrow's
//   top 3) and the Sunday review (the week, next week's focus and big 3).
// When each is due comes from the tick (every few minutes) and this state.
import { islandHasWater } from './healthyDay'
import { freeGaps, suggestBlocks, type CalEvent } from './dayTime'
import { calendarDay } from './dates'

export interface PlanBlock {
  title: string
  start: string
  minutes: number
  /** DP1: what kind of block (a goal, focus work, or small tasks batched). */
  kind?: 'goal' | 'focus' | 'quick'
  /** DP1: the tasks it covers (their exact Todoist titles). */
  tasks?: string[]
  /** PE: a stable id for edits, undo and sync (core/planEdit ensureIds). */
  id?: string
  /** PE6: pinned: re-planning, shift and Regenerate never move it. */
  locked?: boolean
  /** PE5: this block is approved on its own (it syncs) while the rest stays a draft. */
  ok?: boolean
  /** PE3: tasks of this block ticked in the plan (their titles). */
  done?: string[]
  /** PE2/PE3: what Google Calendar and Todoist hold for it, as last synced (core/planSync). */
  sync?: BlockSync
  /** A deadline study session's reason ("exam in 5 days, session 2 of 4", core/planDeadlines). */
  why?: string
}

/** What the outside apps hold for a block, as last synced. */
export interface BlockSync {
  eventId?: string
  calendarId?: string
  start: string
  minutes: number
  title: string
  /** Its Todoist tasks and the time each was given. */
  tasks?: { id: string; title: string; at: string; minutes: number }[]
  /** The block's task list as written into the event's notes. */
  names?: string[]
}

/** DP1: one of today's other tasks (not a must-do), for the "Also today" list. */
export interface AlsoItem {
  id?: string
  title: string
  /** Time estimate in minutes. */
  minutes: number
  /** Todoist priority: 4 = P1 … 1 = P4. */
  priority: number
  project?: string
  /** The start of the block it is packed into, when it is in one. */
  at?: string
  /** The start of today's calendar event that is the same thing (the habit, the class): it has no block of its own. */
  event?: string
  overdue?: boolean
  /** He asked for it today: it stays today even without a slot. */
  asked?: boolean
}

/** DP1: a task moved to tomorrow, with the reason. */
export interface DeferredItem {
  id?: string
  title: string
  why: string
}

export interface DayProposal {
  day: string
  headline: string
  mustdos: string[]
  blocks: PlanBlock[]
  training: { time: string; what: string; minutes?: number; locked?: boolean; ok?: boolean; sync?: BlockSync } | null
  waterMl: number
  /** PE2: blocks deleted from an approved plan whose calendar event / task times still need clearing. */
  removed?: { id: string; eventId?: string; calendarId?: string; tasks?: { id: string; title: string }[] }[]
  /** PE3: Todoist tasks the plan has closed (ids), so a tick is sent once and an untick reopens it. */
  closed?: string[]
  /** DP1: every other task of the day, most important first. */
  also?: AlsoItem[]
  /** DP1: tasks that don't fit today, each with its reason. */
  deferred?: DeferredItem[]
  /** DP1: one line on why the day is planned this way. */
  why?: string
  /** DP1: already lighter for a short night (not lightened twice). */
  light?: boolean
  /** DP1: the free time between events when it was planned (for "add X" / "move Y to the afternoon"). */
  free?: { start: string; end: string }[]
  /** The day is full and something he asked for today has no slot: keep it, or drop `drop` for it. */
  squeeze?: { keep: string; drop?: string }
  /** Things the user took off the plan by hand today (normalized titles): a re-plan never puts them back. */
  dropped?: string[]
}

export interface RhythmState {
  day: string
  /** Ben approved the plan himself (it waited past 10:00). */
  autoApproved?: boolean
  /** Calendar blocks Ben already moved or asked about today (event ids). */
  moved?: string[]
  /** Blocks missed again after the move: Ben asked what to do (K3). */
  asked?: string[]
  /** "Rescue my day" offered today (W1). */
  rescued?: boolean
  /** Auto-rescue: the last rescue offered for a late block, kept for Accept (core/planRescue). */
  rescue?: import('./planRescue').RescueOffer
  /** The last plan change made from Telegram or a push (Too much today, Move to tomorrow, a rescue), for its Undo. */
  planUndo?: { at: number; label: string; before: DayProposal; dates: { id: string; due: string }[] }
  /** The midweek check went out (W14, Wednesdays). */
  midweek?: boolean
  /** Big-3 blocks Ben proposed for the week, waiting for "Book them" (W13). */
  booking?: { title: string; day: string; start: string; end: string }[]
  /** The honest end-of-day check-out (W6): what you say you did, never paid. */
  checkout?: { items: string[]; marks: (null | 'k' | 'p' | 'x')[] }
  /** `planner`: which day planner made it (an older one's draft expires, see PLANNER_VERSION). */
  briefing?: { status: 'proposed' | 'approved'; sentAt: string; plan: DayProposal; version: number; planner?: number }
  /** A draft that was never approved and has expired (last night's, or from an older planner): shown folded. */
  expired?: { sentAt: string; version: number; headline: string; why: 'night' | 'planner' }
  evening?: { sentAt: string; score: number; top3: string[]; lesson?: string }
  water: string[]
  training?: boolean
  /** Tomorrow's top 3 from the evening review (they become the morning's must-dos). */
  tomorrow?: { day: string; top3: string[]; /** W18: tomorrow's plan, drafted the evening before. */ plan?: DayProposal }
  /** The Sunday of the last weekly review, and its suggested plan. */
  weekly?: { day: string; focus: string; note: string; big3: string[] }
}

export interface RhythmPrefs {
  on: boolean
  evening: string
  weekly: string
  /** Ben 2: the weekly review's day (0 = Sunday, the default). */
  weeklyDay?: number
  water: boolean
  training: boolean
  /** Autopilot: the day's plan is ready by this time (not before your wake-up target). */
  autopilot?: string
  /** Re-plan by itself: the draft part of today's plan re-packs when the day changes (default on). */
  autoReplan?: boolean
}

export const RHYTHM = 'coach_rhythm'
export const RHYTHM_PREFS = 'coach_rhythm_prefs'
export const DEFAULT_RHYTHM_PREFS: RhythmPrefs = { on: true, evening: '21:00', weekly: '19:00', water: true, training: true, autopilot: '07:30' }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function cleanPrefs(p: any): RhythmPrefs {
  return {
    on: p?.on !== false,
    evening: HM.test(p?.evening) ? p.evening : DEFAULT_RHYTHM_PREFS.evening,
    weekly: HM.test(p?.weekly) ? p.weekly : DEFAULT_RHYTHM_PREFS.weekly,
    weeklyDay: Number.isInteger(p?.weeklyDay) && p.weeklyDay >= 0 && p.weeklyDay <= 6 ? p.weeklyDay : 0,
    autopilot: HM.test(p?.autopilot) ? p.autopilot : DEFAULT_RHYTHM_PREFS.autopilot,
    water: p?.water !== false,
    training: p?.training !== false,
    autoReplan: p?.autoReplan !== false
  }
}

/** Today's state: a new day keeps only tomorrow's top 3 and the weekly review. */
/**
 * The day planner's version. 2 = the packer that fits ALL of today's tasks
 * (core/dayPacker, Nov 2026). A plan still waiting for an OK that an older
 * planner made expires, so the morning gets a fresh one.
 */
export const PLANNER_VERSION = 2

const expiredOf = (b: any, why: 'night' | 'planner'): RhythmState['expired'] => ({ sentAt: String(b.sentAt ?? ''), version: Number(b.version) || 1, headline: String(b.plan?.headline ?? '').slice(0, 160), why })

export function rhythmFor(state: any, today: string): RhythmState {
  const s = state && typeof state === 'object' ? state : {}
  if (s.day === today) {
    const out: RhythmState = { ...s, water: Array.isArray(s.water) ? s.water : [] }
    // A draft from an older planner never stays live: it expires and a fresh one is made.
    if (out.briefing?.status === 'proposed' && (Number(out.briefing.planner) || 1) < PLANNER_VERSION) {
      out.expired = expiredOf(out.briefing, 'planner')
      delete out.briefing
    }
    return out
  }
  // The app day turned (04:00): last night's draft that was never approved expires.
  const exp = s.briefing?.status === 'proposed' ? expiredOf(s.briefing, 'night') : undefined
  return { day: today, water: [], ...(s.tomorrow ? { tomorrow: s.tomorrow } : {}), ...(s.weekly ? { weekly: s.weekly } : {}), ...(exp ? { expired: exp } : {}) }
}

/** The words for an expired draft (the folded card). */
export const expiredLabel = (e: { why: 'night' | 'planner' }) => (e.why === 'night' ? "Expired · last night's draft" : 'Expired · made by the old planner')

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
  /** A life mode today (exam week, sick, travel): fewer nudges (FT4). */
  mode?: { waterMax: number; training: boolean; replan: boolean } | null
  /** HD: a class, a meeting or a focus timer is on right now: water and training wait for after. */
  busy?: boolean
  /** HD: when the island last showed its water card (ms): it has water covered for 90 minutes. */
  islandWaterAt?: number | null
  /** HD: now in ms (with islandWaterAt). */
  nowMs?: number
  /** HD: you logged going to bed: nothing more until the morning. */
  asleep?: boolean
}

export type RhythmJob = 'briefing' | 'replan' | 'midweek' | 'evening' | 'weekly' | 'water' | 'training'

/** What the coach should send now (in order). */
export function dueRhythm(state: RhythmState, prefs: RhythmPrefs, f: RhythmFacts): RhythmJob[] {
  if (!prefs.on || f.asleep) return []
  const t = toMin(f.time)
  const out: RhythmJob[] = []
  // Morning: 5 minutes after you log waking up, else 45 minutes after your target; never before 06:00 or after noon.
  // Autopilot (N12): the plan is ready by 07:30 (your setting), never before your wake-up target.
  const auto = Math.max(toMin(prefs.autopilot ?? '07:30'), toMin(f.wakeTarget))
  const start = Math.max(toMin('06:00'), Math.min(f.wakeAt ? toMin(f.wakeAt) + 5 : toMin(f.wakeTarget) + 45, auto))
  if (!state.briefing && t >= start && t < toMin('12:00')) out.push('briefing')
  // W8: no plan by noon → half a day left, still worth planning (until 16:00).
  else if (!state.briefing && !f.paused && f.mode?.replan !== false && t >= Math.max(start, toMin('12:00')) && t < toMin('16:00')) out.push('replan')
  if (!f.paused && !f.busy && prefs.water && !islandHasWater(f.islandWaterAt, f.nowMs ?? 0) && waterBehind(state, f, f.mode?.waterMax ?? 5)) out.push('water')
  if (!f.paused && !f.busy && prefs.training && f.mode?.training !== false && !f.workoutDone && !state.training && t >= toMin('18:00') && t < toMin('21:00')) out.push('training')
  if (f.weekday === (prefs.weeklyDay ?? 0) && t >= toMin(prefs.weekly) && state.weekly?.day !== f.today) out.push('weekly')
  // W14: Wednesday, 90 minutes before the evening review: where the week stands.
  if (f.weekday === 3 && !state.midweek && t >= toMin(prefs.evening) - 90 && t < toMin(prefs.evening)) out.push('midweek')
  if (!state.evening && t >= toMin(prefs.evening)) out.push('evening')
  return out
}

/** Water well behind the day's pace (08:00→21:00), at most 5 nudges, 1h50 apart, 11:00–20:30. */
export function waterBehind(state: RhythmState, f: RhythmFacts, max = 5): boolean {
  const t = toMin(f.time)
  if (t < toMin('11:00') || t > toMin('20:30') || f.waterTarget <= 0) return false
  if (state.water.length >= max) return false
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
    const tasks = (Array.isArray(b?.tasks) ? b.tasks : []).map((x: any) => String(x ?? '').trim().slice(0, 160)).filter(Boolean).slice(0, 12)
    const kind = b?.kind === 'quick' || b?.kind === 'goal' || b?.kind === 'focus' ? b.kind : undefined
    blocks.push({ title, start, minutes, ...(kind ? { kind } : {}), ...(tasks.length ? { tasks } : {}) })
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
  // DP1: "Also today" and what moves to tomorrow (checked against the real tasks later: checkModelPlan).
  const name = (x: any) => String(x?.task ?? x?.title ?? (typeof x === 'string' ? x : '')).trim().slice(0, 160)
  const also: AlsoItem[] = (Array.isArray(raw.also) ? raw.also : []).map((x: any) => ({ title: name(x), minutes: Math.round(Number(x?.minutes)) || 0, priority: 1 })).filter((x: AlsoItem) => x.title)
  const deferred: DeferredItem[] = (Array.isArray(raw.deferred) ? raw.deferred : []).map((x: any) => ({ title: name(x), why: String(x?.why ?? '').trim().slice(0, 120) })).filter((x: DeferredItem) => x.title && x.why)
  const why = String(raw.why ?? '').trim().slice(0, 200)
  return {
    day,
    headline: String(raw.headline ?? '').trim().slice(0, 140) || fallback.headline,
    mustdos: mustdos.length ? mustdos : fallback.mustdos,
    blocks: blocks.length || !fallback.blocks.length ? blocks : fallback.blocks,
    training: training ?? (raw.training === null ? null : fallback.training),
    waterMl,
    ...(also.length ? { also } : fallback.also ? { also: fallback.also } : {}),
    ...(deferred.length ? { deferred } : {}),
    ...(why ? { why } : fallback.why ? { why: fallback.why } : {})
  }
}

const localDayOf = (iso: string) => {
  const d = new Date(iso)
  return calendarDay(d)
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
  const timed = [...p.blocks.map((b) => ({ s: b.start, text: `${b.start}–${fromMin(toMin(b.start) + b.minutes)} ${esc(b.title)}${(b.tasks ?? []).length > 1 ? (b.tasks ?? []).map((t) => `\n   · ${esc(t)}`).join('') : ''}` })), ...(p.training ? [{ s: p.training.time, text: `${p.training.time} 💪 ${esc(p.training.what)}` }] : [])].sort((a, b) => a.s.localeCompare(b.s))
  if (timed.length) lines.push('', '<b>Blocks</b>', ...timed.map((x) => x.text))
  // A task in a block is listed with its block, not again here.
  const also = (p.also ?? []).filter((a) => !a.at)
  if (also.length) lines.push('', `<b>Also today (${also.length})</b>`, ...also.slice(0, 12).map((a) => `· ${esc(a.title)} · ${a.minutes} min${a.event ? ` (at the ${a.event} event)` : ''}`), ...(also.length > 12 ? [`…and ${also.length - 12} more`] : []))
  if (p.deferred?.length) lines.push('', '<b>Tomorrow</b>', ...p.deferred.slice(0, 6).map((d) => `· ${esc(d.title)}: ${esc(d.why)}`))
  if (p.why) lines.push('', `<i>${esc(p.why)}</i>`)
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
  /** true approved, false proposed but never approved (it still counts, K8), null no plan. */
  planApproved?: boolean | null
  waterMl: number
  waterTarget: number
  workoutDone: boolean
  trainingPlanned: boolean
}

/** 0–100: must-dos 40, focus against the plan 30 (half of it the blocks kept, when there were blocks), water 15, training 15. */
export function dayScore(r: DayResult): number {
  const md = r.mustdosTotal ? r.mustdosDone / r.mustdosTotal : r.focusMin >= 50 ? 1 : 0
  const fo = Math.min(1, r.focusMin / Math.max(50, r.plannedFocusMin))
  const bl = r.blocksPlanned ? Math.min(1, r.blocksDone / r.blocksPlanned) : fo
  const wa = r.waterTarget ? Math.min(1, r.waterMl / r.waterTarget) : 0
  const tr = r.workoutDone ? 1 : r.trainingPlanned ? 0 : 0.5
  return Math.round(md * 40 + fo * 15 + bl * 15 + wa * 15 + tr * 15)
}

/**
 * Plan blocks you actually kept (K1): at least half of the block's time was
 * focused, at the planned time or later the same day (a moved block counts).
 */
export function blocksKept(blocks: PlanBlock[], sessions: { startedAt: string | null; endedAt: string | null; minutes?: number }[], day: string, now = new Date()): number {
  const spans = sessions
    .filter((x) => x.startedAt)
    .map((x) => ({ s: Date.parse(x.startedAt!), e: x.endedAt ? Date.parse(x.endedAt) : now.getTime() }))
    .sort((a, b) => a.s - b.s)
  // Each focused minute counts for one block only, in time order.
  const used = spans.map(() => 0)
  let kept = 0
  for (const b of [...blocks].sort((a, c) => a.start.localeCompare(c.start))) {
    const from = Date.parse(`${day}T${b.start}:00`)
    let need = b.minutes / 2
    spans.forEach((sp, i) => {
      if (need <= 0 || sp.e <= from) return
      const free = (sp.e - Math.max(sp.s, from)) / 60000 - used[i]
      if (free <= 0) return
      const take = Math.min(free, need)
      used[i] += take
      need -= take
    })
    if (need <= 0) kept++
  }
  return kept
}

/** The second miss of a block Ben already moved (K3): a choice, not silence. */
export function missedTwiceText(title: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `🔁 <b>${esc(title)}</b> slipped again. What now: a shorter 25 minutes now, tomorrow at the same time, or drop it?`
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
    ...(r.planApproved === false ? [`<i>You never approved today's plan, but it still counts: ${r.plannedFocusMin} min planned, ${r.focusMin} done.</i>`] : []),
    `Water ${(r.waterMl / 1000).toFixed(1)}/${(r.waterTarget / 1000).toFixed(1)} L · Training ${r.workoutDone ? '✅' : '—'}`,
    '',
    `<b>Lesson:</b> ${esc(lesson)}`,
    ...(top3.length ? ['', "<b>Tomorrow's top 3</b>", ...top3.map((t, i) => `${i + 1}. ${esc(t)}`)] : [])
  ].join('\n')
}

export const REVIEW_KEYBOARD = { inline_keyboard: [[{ text: "✅ Keep as tomorrow's top 3", callback_data: 'rv|k' }, { text: '✏️ Change', callback_data: 'rv|e' }], [{ text: '☑️ Check out the day honestly', callback_data: 'rv|o' }]] }

/**
 * W5: after a short night (under 6 h) the plan gets lighter: blocks shorter
 * (75%, at least 25 min), at most 3, and training "easy".
 */
export function lightenForSleep(plan: DayProposal, sleptMin: number | null): DayProposal {
  if (sleptMin == null || sleptMin >= 360 || !plan.blocks.length || plan.light) return plan
  const h = `${Math.floor(sleptMin / 60)}h${String(sleptMin % 60).padStart(2, '0')}`
  // DP1: at most 4 blocks (never cut to one when the day is full); the dropped blocks' tasks stay on the list.
  const kept = plan.blocks.slice(0, 4)
  const dropped = new Set(plan.blocks.slice(4).map((b) => b.start))
  return {
    ...plan,
    light: true,
    headline: `Short night (${h}): a lighter day. ${plan.headline}`.slice(0, 160),
    ...(plan.also ? { also: plan.also.map((a) => (a.at && dropped.has(a.at) ? { ...a, at: undefined } : a)) } : {}),
    blocks: kept.map((b) => ({ ...b, minutes: Math.max(25, Math.round((b.minutes * 0.75) / 5) * 5) })),
    training: plan.training ? { ...plan.training, what: /^easy/i.test(plan.training.what) ? plan.training.what : `easy: ${plan.training.what}` } : null
  }
}

const MARK: Record<string, string> = { k: '✅', p: '½', x: '✗' }
/** W6: the check-out list, with your marks so far. */
export function checkoutText(items: string[], marks: (null | 'k' | 'p' | 'x')[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const done = marks.filter(Boolean).length === items.length
  return [
    '☑️ <b>Check out the day</b>: what really happened? (Goes in your journal. No points: points only come from what you logged during the day.)',
    '',
    ...items.map((t, i) => `${marks[i] ? MARK[marks[i]!] : '·'} ${esc(t)}`),
    ...(done ? ['', `<b>Done:</b> ${marks.filter((m) => m === 'k').length} done, ${marks.filter((m) => m === 'p').length} partly, ${marks.filter((m) => m === 'x').length} not.`] : [])
  ].join('\n')
}
export function checkoutKeyboard(items: string[], marks: (null | 'k' | 'p' | 'x')[]) {
  return {
    inline_keyboard: items
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !marks[i])
      .slice(0, 8)
      .map(({ t, i }) => [
        { text: `✅ ${t.slice(0, 18)}`, callback_data: `rv|c|${i}|k` },
        { text: '½', callback_data: `rv|c|${i}|p` },
        { text: '✗', callback_data: `rv|c|${i}|x` }
      ])
  }
}
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

/**
 * W13: the week's big 3 as calendar blocks in free time: each task gets
 * `perTask` blocks of `minutes`, spread over the coming days (one per task
 * per day), between 09:00 and 20:00. Shown first; booked only on "Book them".
 */
export function bookBig3(big3: string[], events: CalEvent[], days: string[], nowIso: string, perTask = 2, minutes = 50): { title: string; day: string; start: string; end: string }[] {
  const out: { title: string; day: string; start: string; end: string }[] = []
  const taken: CalEvent[] = [...events]
  const now = new Date(nowIso)
  const todayKey = calendarDay(now)
  const left = new Map(big3.map((t) => [t, perTask]))
  for (const day of days) {
    for (const title of big3) {
      if ((left.get(title) ?? 0) <= 0) continue
      const from = day === todayKey ? quarter(now.toTimeString().slice(0, 5)) : '09:00'
      const gap = freeGaps(taken, day, { after: from < '09:00' ? '09:00' : from, to: '20:00', minMinutes: minutes + 10 })[0]
      if (!gap) continue
      const end = fromMin(toMin(gap.start) + minutes)
      out.push({ title: `🎯 ${title}`.slice(0, 80), day, start: gap.start, end })
      taken.push({ id: `b${out.length}`, calendarId: '', title, start: new Date(`${day}T${gap.start}:00`).toISOString(), end: new Date(`${day}T${fromMin(toMin(gap.start) + minutes + 10)}:00`).toISOString(), allDay: false })
      left.set(title, (left.get(title) ?? 0) - 1)
    }
  }
  return out
}

/** W18: last night's draft still fits this morning (no block over a new event). */
export function draftFits(plan: DayProposal, events: CalEvent[]): boolean {
  return plan.blocks.every((b) => {
    const s = Date.parse(`${plan.day}T${b.start}:00`)
    const e = s + b.minutes * 60000
    return !events.some((x) => !x.allDay && Date.parse(x.start) < e && Date.parse(x.end) > s)
  })
}
export const WEEK_ASK = "Next week's 3 big tasks? One per line."

/** "1. a\n2) b\n- c" → ['a','b','c'] (at most 3). */
export function readLines(text: string): string[] {
  return text
    .split(/\n|;/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}


/**
 * The morning plan that never times out (N6): the rules build the slots
 * (times stay exactly as built), the AI only names the blocks, ranks the
 * must-dos and writes the headline. Anything odd from the AI is ignored.
 */
export function nameAndRank(rules: DayProposal, raw: any): DayProposal {
  if (!raw || typeof raw !== 'object') return rules
  const names: unknown[] = Array.isArray(raw.names) ? raw.names : []
  const blocks = rules.blocks.map((b, i) => {
    const n = typeof names[i] === 'string' ? String(names[i]).trim().slice(0, 60) : ''
    return n ? { ...b, title: n } : b
  })
  const pool = new Map(rules.mustdos.map((m) => [m.trim().toLowerCase(), m]))
  const ranked = (Array.isArray(raw.mustdos) ? raw.mustdos : []).map((m: unknown) => pool.get(String(m).trim().toLowerCase())).filter((m: string | undefined): m is string => !!m)
  const mustdos = [...new Set([...ranked, ...rules.mustdos])].slice(0, 3)
  const headline = typeof raw.headline === 'string' && raw.headline.trim() ? raw.headline.trim().slice(0, 120) : rules.headline
  return { ...rules, blocks, mustdos, headline }
}

// ---- B22: simple plan changes, done in code -----------------------------

const PLAN_STOP = new Set(['the', 'my', 'block', 'session', 'to', 'at', 'a', 'an'])
const planWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !PLAN_STOP.has(w))
/** "18", "18:30", "6pm", "7.30" → "HH:MM". */
function planTime(t: string): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(t.trim())
  if (!m) return null
  let h = Number(m[1])
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
  const min = Number(m[2] ?? 0)
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null
}
const TRAINING = /^(gym|training|workout|train|sport|run)$/

/**
 * "move gym to 19", "put algebra at 10:30", "drop the reading block",
 * "no training today", "make algebra 90 min": the plan changes at once,
 * without the AI. null when the note isn't one of these (then the AI re-plans).
 */
export function editPlan(plan: DayProposal, note: string): DayProposal | null {
  const day = editDayPart(plan, note)
  if (day) return day
  const t = note.trim().toLowerCase().replace(/[.!]+$/, '')
  if (!t || t.length > 80 || /[,;]| and | then /.test(t)) return null
  const find = (name: string) => {
    const want = planWords(name)
    if (!want.length) return -1
    return plan.blocks.findIndex((b) => planWords(b.title).some((w) => want.some((x) => w.startsWith(x.slice(0, 5)) || x.startsWith(w.slice(0, 5)))))
  }
  const isTraining = (name: string) => planWords(name).some((w) => TRAINING.test(w))
  let m = /^(?:move|put|shift|change)\s+(.+?)\s+(?:to|at)\s+(\S+(?:\s*[ap]m)?)$/.exec(t)
  if (m) {
    const at = planTime(m[2])
    if (!at) return null
    if (isTraining(m[1]) && plan.training) return { ...plan, training: { ...plan.training, time: at } }
    const i = find(m[1])
    if (i < 0) return null
    return { ...plan, blocks: plan.blocks.map((b, k) => (k === i ? { ...b, start: at } : b)).sort((a, b) => a.start.localeCompare(b.start)) }
  }
  m = /^(?:drop|remove|skip|delete|cancel|no)\s+(.+?)(?:\s+today)?$/.exec(t)
  if (m) {
    if (isTraining(m[1])) return plan.training ? { ...plan, training: null } : null
    const i = find(m[1])
    if (i < 0) return null
    return { ...plan, blocks: plan.blocks.filter((_, k) => k !== i) }
  }
  m = /^(?:make\s+)?(.+?)\s+(\d{2,3})\s*(?:m|min|mins|minutes)$/.exec(t)
  if (m) {
    const minutes = Number(m[2])
    if (minutes < 15 || minutes > 180) return null
    const i = find(m[1])
    if (i < 0) return null
    return { ...plan, blocks: plan.blocks.map((b, k) => (k === i ? { ...b, minutes } : b)) }
  }
  return null
}

// ---- DP1: "add X", "move Y to the afternoon", in code ---------------------

const PARTS: Record<string, [string, string]> = { morning: ['07:00', '12:00'], afternoon: ['12:00', '18:00'], evening: ['18:00', '22:30'], tonight: ['18:00', '22:30'], later: ['00:00', '23:30'] }
const similar = (a: string, b: string) => {
  const want = planWords(a)
  const have = planWords(b)
  return want.length > 0 && want.every((x) => have.some((w) => w.startsWith(x.slice(0, 5)) || x.startsWith(w.slice(0, 5))))
}

/** The first free start in [from, to) for `minutes`, inside the plan's free time and clear of its blocks (10 min apart). */
export function freeSlot(plan: Pick<DayProposal, 'blocks' | 'training' | 'free'>, minutes: number, from: string, to: string, skip = -1): string | null {
  const free = plan.free?.length ? plan.free.map((f) => [toMin(f.start), toMin(f.end)] as const) : [[toMin('07:00'), toMin('22:30')] as const]
  const busy = [...plan.blocks.filter((_, i) => i !== skip).map((b) => [toMin(b.start) - 10, toMin(b.start) + b.minutes + 10] as const), ...(plan.training ? [[toMin(plan.training.time) - 10, toMin(plan.training.time) + 60] as const] : [])]
  for (const [fs, fe] of free) {
    for (let st = Math.ceil(Math.max(fs, toMin(from)) / 5) * 5; st + minutes <= Math.min(fe, toMin(to)); st += 5) {
      if (!busy.some(([bs, be]) => st < be && st + minutes > bs)) return fromMin(st)
    }
  }
  return null
}

function editDayPart(plan: DayProposal, note: string): DayProposal | null {
  const raw = note.trim().replace(/[.!]+$/, '')
  if (!raw || raw.length > 100) return null
  const also = plan.also ?? []
  const sorted = (blocks: PlanBlock[]) => [...blocks].sort((a, b) => a.start.localeCompare(b.start))
  // "add X [at 15:00 | this afternoon] [30 min]"
  let m = /^add\s+(.+?)(?:\s+(?:at\s+(\S+(?:\s*[ap]m)?)|(?:in the |this )?(morning|afternoon|evening|tonight)))?(?:\s+(\d{2,3})\s*(?:m|min|mins|minutes))?$/i.exec(raw)
  if (m) {
    const what = m[1].replace(/^(?:a|an|the)\s+/i, '').replace(/\s+(?:block|today)$/i, '').trim()
    if (!what) return null
    const item = also.find((a) => !a.at && similar(what, a.title)) ?? also.find((a) => similar(what, a.title))
    const later = !item ? plan.deferred?.find((d) => similar(what, d.title)) : undefined
    if (item?.at) return null
    const title = item?.title ?? later?.title ?? what.slice(0, 80)
    const minutes = Math.min(180, Math.max(15, Number(m[4]) || item?.minutes || 30))
    const at = m[2] ? planTime(m[2]) : null
    if (m[2] && !at) return null
    const [from, to] = m[3] ? PARTS[m[3].toLowerCase()] : ['00:00', '23:30']
    const start = at ?? freeSlot(plan, minutes, from, to)
    if (!start) return null
    const block: PlanBlock = { title, start, minutes, kind: 'focus', ...(item || later ? { tasks: [title] } : {}) }
    const nextAlso: AlsoItem[] = item ? also.map((a) => (a === item ? { ...a, at: start } : a)) : later ? [...also, { title, minutes, priority: 1, ...(later.id ? { id: later.id } : {}), at: start }] : also
    return { ...plan, blocks: sorted([...plan.blocks, block]), ...(plan.also || later ? { also: nextAlso } : {}), ...(later ? { deferred: (plan.deferred ?? []).filter((d) => d !== later) } : {}) }
  }
  // "move Y to the afternoon / this evening / later"
  m = /^(?:move|put|shift|push|do)\s+(.+?)\s+(?:to|in|into|for)?\s*(?:the\s+|this\s+)?(morning|afternoon|evening|tonight|later)$/i.exec(raw)
  if (m) {
    const what = m[1].replace(/^(?:the|my)\s+/i, '').replace(/\s+block$/i, '')
    const part = m[2].toLowerCase()
    const [from, to] = PARTS[part]
    // A block by its name: the whole block moves.
    const bi = plan.blocks.findIndex((b) => similar(what, b.title) && (b.tasks?.length ?? 0) <= 1)
    if (bi >= 0) {
      const b = plan.blocks[bi]
      const start = freeSlot(plan, b.minutes, part === 'later' ? fromMin(toMin(b.start) + 15) : from, to, bi)
      if (!start) return null
      const blocks = plan.blocks.map((x, k) => (k === bi ? { ...x, start } : x))
      return { ...plan, blocks: sorted(blocks), ...(plan.also ? { also: also.map((a) => (a.at === b.start ? { ...a, at: start } : a)) } : {}) }
    }
    // One task inside a bigger block, or one on the list: it gets its own block there.
    const item = also.find((a) => similar(what, a.title))
    const host = plan.blocks.findIndex((b) => (b.tasks ?? []).some((x) => similar(what, x)))
    const title = item?.title ?? (host >= 0 ? (plan.blocks[host].tasks ?? []).find((x) => similar(what, x)) ?? null : null)
    if (!title) return null
    const minutes = Math.max(15, item?.minutes ?? 30)
    let blocks = plan.blocks
    if (host >= 0) {
      const h = plan.blocks[host]
      const rest = (h.tasks ?? []).filter((x) => x !== title)
      blocks = rest.length ? blocks.map((x, k) => (k === host ? { ...x, tasks: rest, minutes: Math.max(20, x.minutes - minutes), title: rest.length === 1 ? rest[0] : `${x.title.split(':')[0]}: ${rest.join(', ')}`.slice(0, 80) } : x)) : blocks.filter((_, k) => k !== host)
    }
    const start = freeSlot({ ...plan, blocks }, minutes, part === 'later' && host >= 0 ? fromMin(toMin(plan.blocks[host].start) + 15) : from, to)
    if (!start) return null
    blocks = sorted([...blocks, { title, start, minutes, kind: 'focus', tasks: [title] }])
    return { ...plan, blocks, ...(plan.also ? { also: also.map((a) => (a.title === title ? { ...a, at: start } : a)) } : {}) }
  }
  // "drop X" for a task on the list (not a block): moved to tomorrow, with the reason.
  m = /^(?:drop|skip|remove|defer|postpone)\s+(.+?)(?:\s+today)?$/i.exec(raw)
  if (m) {
    const what = m[1]
    if (plan.blocks.some((b) => similar(what, b.title))) return null
    const item = also.find((a) => !a.at && similar(what, a.title))
    if (!item) return null
    return { ...plan, also: also.filter((a) => a !== item), deferred: [...(plan.deferred ?? []), { title: item.title, ...(item.id ? { id: item.id } : {}), why: 'You moved it to tomorrow' }] }
  }
  return null
}
