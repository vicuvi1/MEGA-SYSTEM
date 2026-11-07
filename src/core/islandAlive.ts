// The alive island (pure, no DOM, tested in islandAlive.test.ts with pinned clocks).
//
// What makes the island feel alive without making it noisy:
// - the hourly pulse, countdown peeks before a block or event, a streak that
//   would break tonight, a mirror of what you just added (Todoist, Telegram),
//   rain coming;
// - the focus shield (non-urgent cards wait during a focus timer, are counted,
//   and come back as one summary);
// - data for the island's look: day state, top 3, next 3 hours, the points
//   flash, the day's story, a few numbers;
// - the Lively preset (store what you had, put it all back exactly).
//
// Rules for every card here: one per AliveKind switch (all OFF until you accept
// the preset), at most one non-urgent peek per 10 minutes (the rest merge into
// it), never in a meeting or quiet hours, never over another card. A button
// only ever logs something real.
import type { IslandAlert, IslandBlock, IslandSnapshot } from './islandModel'
import type { IslandMode } from './islandCalm'
import type { PushLevel } from './lifeFit'
import { nextRain, type IslandWeather } from './widgets/weatherPill'

// ---- Switches ----

export type AliveKind = 'pulse' | 'countdown' | 'streak' | 'mirror' | 'weather' | 'shield'
export const ALIVE_KINDS: readonly AliveKind[] = ['pulse', 'countdown', 'streak', 'mirror', 'weather', 'shield']
export const ALIVE_LABEL: Record<AliveKind, string> = {
  pulse: 'Hourly pulse',
  countdown: 'Countdown before a block or event',
  streak: 'Streak about to break',
  mirror: 'Mirror what I add (Todoist, Telegram)',
  weather: 'Rain heads-up',
  shield: 'Focus shield (hold alerts while I focus)'
}
export const ALIVE_HINT: Record<AliveKind, string> = {
  pulse: 'A 3-second peek every hour: the time, must-dos, water and focus so far.',
  countdown: 'A peek 10 and 2 minutes before a plan block or event, with "Start the kit?".',
  streak: 'In the evening, when a workout streak would break tonight, with a one-tap real log.',
  mirror: 'A task you add in Todoist or through Ben on Telegram shows up as "Added: …".',
  weather: '"Rain at 17:00", from the weather plugin when it is on.',
  shield: 'During a focus timer non-urgent cards wait, are counted, and come back as one summary.'
}
export type AlivePrefs = Record<AliveKind, boolean>
/** Calm stays calm: everything is off until you accept the preset or switch it on yourself. */
export const DEFAULT_ALIVE: AlivePrefs = { pulse: false, countdown: false, streak: false, mirror: false, weather: false, shield: false }
export const LIVELY_ALIVE: AlivePrefs = { pulse: true, countdown: true, streak: true, mirror: true, weather: true, shield: true }
export function cleanAlive(raw: unknown): AlivePrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return Object.fromEntries(ALIVE_KINDS.map((k) => [k, typeof o[k] === 'boolean' ? o[k] : DEFAULT_ALIVE[k]])) as AlivePrefs
}

// ---- The Lively preset ----

export type SoundMode = 'off' | 'subtle' | 'full'
/** Every value the preset touches, as it is now (so it can be put back exactly). */
export interface PresetValues {
  mode: IslandMode
  sound: SoundMode
  coach: boolean
  wins: boolean
  push: PushLevel
  brief: boolean
  shutdown: boolean
  /** "Peek for → alive moments" (Calm and Balanced). */
  peekAlive: boolean
  alive: AlivePrefs
}
export interface PresetState {
  /** The one-time card was answered (or dismissed). */
  offered: boolean
  active: boolean
  choice: 'balanced' | 'lively' | null
  /** What you had before; only while active. */
  prev: PresetValues | null
}
export const EMPTY_PRESET: PresetState = { offered: false, active: false, choice: null, prev: null }

const SOUNDS: SoundMode[] = ['off', 'subtle', 'full']
const MODES: IslandMode[] = ['calm', 'balanced', 'lively']
const PUSHES: PushLevel[] = ['gentle', 'firm', 'push']
export function cleanPresetValues(raw: unknown): PresetValues | null {
  const o = raw as Partial<PresetValues> | null
  if (!o || typeof o !== 'object' || !MODES.includes(o.mode as IslandMode)) return null
  return {
    mode: o.mode as IslandMode,
    sound: SOUNDS.includes(o.sound as SoundMode) ? (o.sound as SoundMode) : 'subtle',
    coach: o.coach === true,
    wins: o.wins === true,
    push: PUSHES.includes(o.push as PushLevel) ? (o.push as PushLevel) : 'push',
    brief: o.brief !== false,
    shutdown: o.shutdown !== false,
    peekAlive: o.peekAlive === true,
    alive: cleanAlive(o.alive)
  }
}
export function cleanPreset(raw: unknown): PresetState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<PresetState>
  const prev = cleanPresetValues(o.prev)
  const active = o.active === true && !!prev
  return { offered: o.offered === true || active, active, choice: active && (o.choice === 'balanced' || o.choice === 'lively') ? o.choice : null, prev: active ? prev : null }
}
/** The values the preset sets. */
export const livelyValues = (choice: 'balanced' | 'lively'): PresetValues => ({ mode: choice, sound: 'full', coach: true, wins: true, push: 'firm', brief: true, shutdown: true, peekAlive: true, alive: { ...LIVELY_ALIVE } })
/** Accept the preset: remember what you have (the first time only: switching Balanced ↔ Lively keeps the original). */
export function startPreset(s: PresetState, current: PresetValues, choice: 'balanced' | 'lively'): { state: PresetState; apply: PresetValues } {
  return { state: { offered: true, active: true, choice, prev: s.active && s.prev ? s.prev : current }, apply: livelyValues(choice) }
}
/** Back to Calm: exactly what you had before (null apply: nothing to put back). */
export function restorePreset(s: PresetState): { state: PresetState; apply: PresetValues | null } {
  return { state: { offered: true, active: false, choice: null, prev: null }, apply: s.active ? s.prev : null }
}
export const dismissOffer = (s: PresetState): PresetState => ({ ...s, offered: true })
/** The one-time card: until answered, and only for someone still on Calm. */
export const shouldOffer = (s: PresetState, mode: IslandMode): boolean => !s.offered && !s.active && mode === 'calm'

// ---- Rate limit and merging ----

export const NON_URGENT_GAP_MS = 10 * 60_000
export const peekAllowed = (lastAt: number, now: number) => now - lastAt >= NON_URGENT_GAP_MS

/** Kinds that always get through the shield (and are never held). */
const URGENT = new Set<string>(['over', 'end', 'remind', 'sleep', 'shutdown', 'late'])
export const isUrgent = (a: Pick<IslandAlert, 'kind' | 'meeting'>) => URGENT.has(a.kind) || (a.kind === 'block' && !!a.meeting)

// ---- Hourly pulse ----

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
export const dayStr = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
export interface PulseStats { mustDone: number; mustTotal: number; waterMl: number; focusMin: number }
export const litres = (ml: number) => `${(Math.round(ml / 100) / 10).toFixed(1)} L`
export const minutesText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(m)} min`)
export function pulseText(s: PulseStats): string {
  const parts = [s.mustTotal > 0 ? `${s.mustDone}/${s.mustTotal} must-dos` : null, litres(s.waterMl), `${Math.round(s.focusMin)} min focus`]
  return parts.filter(Boolean).join(' · ')
}
/**
 * The pulse is due in the first 5 minutes of an hour from 09:00 to 21:00 (once
 * per hour; a late start still counts for those minutes).
 */
export function pulseDue(now: number, seen: Record<string, number>): string | null {
  const d = new Date(now)
  if (d.getHours() < 9 || d.getHours() > 21 || d.getMinutes() >= 5) return null
  const key = `pulse:${dayStr(now)}:${d.getHours()}`
  return seen[key] ? null : key
}

// ---- Countdown ----

export type CountdownStep = 10 | 2
/** The block or event that starts in about 10 or 2 minutes (a meeting has its own card; a maybe is skipped). */
export function countdownDue(now: number, blocks: IslandBlock[], seen: Record<string, number>): { block: IslandBlock; step: CountdownStep; key: string } | null {
  let best: { block: IslandBlock; step: CountdownStep; key: string } | null = null
  for (const b of blocks) {
    if (b.call || b.maybe || b.mark) continue
    const left = b.start - now
    if (left <= 0 || left > 10 * 60_000) continue
    const step: CountdownStep = left <= 2 * 60_000 ? 2 : 10
    // The 10-minute peek is only for a start more than 5 minutes away (a late tick doesn't make it a 3-minute "10").
    if (step === 10 && left < 5 * 60_000) continue
    const key = `cd${step}:${b.start}:${b.title}`
    if (seen[key]) continue
    if (!best || b.start < best.block.start) best = { block: b, step, key }
  }
  return best
}

// ---- Streak at risk ----

export interface StreakInfo {
  days: number
  /** Today's real log is already in. */
  doneToday: boolean
  /** The exercise a tap logs, from your own list (never invented). */
  rep: { id: string; name: string; n: number } | null
}
/** From 20:00, a streak of 2+ days with nothing logged today: "ends in 3h". Twice a day at most (20:00 and 22:00). */
export function streakRisk(now: number, s: StreakInfo | null, seen: Record<string, number>): { key: string; hoursLeft: number } | null {
  if (!s || s.doneToday || s.days < 2) return null
  const d = new Date(now)
  const h = d.getHours()
  if (h < 20) return null
  const slot = h >= 22 ? 22 : 20
  const key = `streak:${dayStr(now)}:${slot}`
  if (seen[key]) return null
  const left = new Date(now)
  left.setHours(24, 0, 0, 0)
  return { key, hoursLeft: Math.max(1, Math.round((left.getTime() - now) / 3_600_000)) }
}

// ---- Mirror ----

/** `app`: added in the app itself: only part of the baseline, never announced. */
export interface MirrorItem { id: string; title: string; src: 'todoist' | 'telegram' | 'app' }
/**
 * Items that are new since the last look. `known === null` is the first look:
 * everything already there is the baseline, nothing is announced.
 */
export function mirrorNew(known: string[] | null, items: MirrorItem[]): MirrorItem[] {
  if (known == null) return []
  const have = new Set(known)
  return items.filter((i) => i.src !== 'app' && !have.has(i.id))
}
export const mirrorKnown = (items: MirrorItem[], prev: string[] | null): string[] => [...new Set([...(prev ?? []), ...items.map((i) => i.id)])].slice(-300)

// ---- Cards ----

export interface AliveInput {
  now: number
  prefs: AlivePrefs
  /** What the usual chain chose (it always wins; the alive cards only fill the gaps). */
  base: IslandAlert | null
  ctx: { meeting: boolean; focus: boolean; quiet: boolean; asleep: boolean }
  stats: PulseStats
  blocks: IslandBlock[]
  streak: StreakInfo | null
  mirror: MirrorItem[]
  weather: IslandWeather | null
  /** True when "Start the kit?" has a kit to open for this title. */
  hasKit: (title: string) => boolean
}
export interface HeldItem { id: string; title: string }
export interface AliveState {
  lastAt: number
  seen: Record<string, number>
  card: { alert: IslandAlert; until: number } | null
  held: HeldItem[]
  wasFocus: boolean
  mirrorKnown: string[] | null
}
export const EMPTY_ALIVE: AliveState = { lastAt: 0, seen: {}, card: null, held: [], wasFocus: false, mirrorKnown: null }
export function cleanAliveState(raw: unknown): AliveState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<AliveState>
  return {
    lastAt: Number(o.lastAt) || 0,
    seen: o.seen && typeof o.seen === 'object' ? (o.seen as Record<string, number>) : {},
    card: null,
    held: Array.isArray(o.held) ? o.held.filter((h) => h && typeof h.id === 'string').slice(0, 50) : [],
    wasFocus: o.wasFocus === true,
    mirrorKnown: Array.isArray(o.mirrorKnown) ? o.mirrorKnown.filter((x) => typeof x === 'string') : null
  }
}
const prune = (seen: Record<string, number>, now: number) => Object.fromEntries(Object.entries(seen).filter(([, t]) => now - t < 36 * 3_600_000))

type Cand = { kind: AliveKind; priority: number; alert: IslandAlert; keys: string[]; bypassGap?: boolean; ttl: number }

function candidates(i: AliveInput, seen: Record<string, number>, mirrorItems: MirrorItem[]): Cand[] {
  const out: Cand[] = []
  const { now, prefs } = i
  if (prefs.countdown) {
    const c = countdownDue(now, i.blocks, seen)
    if (c) {
      const mins = Math.max(1, Math.round((c.block.start - now) / 60_000))
      const id = `countdown:${c.key}`
      const kit = i.hasKit(c.block.title)
      out.push({
        kind: 'countdown', priority: 4, bypassGap: c.step === 2, ttl: 100_000, keys: [c.key],
        alert: {
          id, kind: 'countdown', title: `${c.block.title} in ${mins} min`, text: kit ? 'Start the kit?' : `Starts at ${hm(c.block.start)}`, face: '⏱',
          actions: [
            kit ? { label: 'Start the kit', action: { kind: 'boost', op: 'kitOpen', alertId: id, arg: c.block.title }, primary: true } : { label: 'Start 25 min', action: { kind: 'start', subject: c.block.title, minutes: 25 }, primary: true },
            { label: 'Later', action: { kind: 'dismiss', id } }
          ]
        }
      })
    }
  }
  if (prefs.streak) {
    const r = streakRisk(now, i.streak, seen)
    if (r && i.streak) {
      const id = `streakRisk:${r.key}`
      const rep = i.streak.rep
      out.push({
        kind: 'streak', priority: 3, ttl: 4 * 60_000, keys: [r.key],
        alert: {
          id, kind: 'streakRisk', title: `Workout streak ends in ${r.hoursLeft}h`, text: rep ? `${i.streak.days} days in a row. ${rep.n} ${rep.name} now?` : `${i.streak.days} days in a row. One set keeps it.`, face: '🔥',
          actions: [
            rep ? { label: `${rep.n} ${rep.name}`, action: { kind: 'reps', id: rep.id, name: rep.name, n: rep.n }, primary: true } : { label: 'Open Sport', action: { kind: 'open', page: 'sport' }, primary: true },
            { label: 'Not tonight', action: { kind: 'dismiss', id } }
          ]
        }
      })
    }
  }
  if (prefs.mirror && mirrorItems.length) {
    const first = mirrorItems[0]
    const more = mirrorItems.length - 1
    const src = first.src === 'telegram' ? 'Telegram' : 'Todoist'
    const id = `mirror:${first.id}`
    out.push({
      kind: 'mirror', priority: 2, ttl: 90_000, keys: mirrorItems.map((m) => `mirror:${m.id}`),
      alert: { id, kind: 'mirror', title: `📱 Added: ${first.title.slice(0, 80)}`, text: more > 0 ? `+${more} more from ${src}` : `From ${src}`, face: '📱', actions: [{ label: 'OK', action: { kind: 'dismiss', id }, primary: true }] }
    })
  }
  if (prefs.weather) {
    const r = nextRain(i.weather, now)
    if (r && r.start > now && r.start - now <= 2 * 3_600_000 && r.prob >= 40) {
      const key = `rain:${dayStr(now)}:${r.from}`
      if (!seen[key]) {
        const id = `weather:${key}`
        out.push({ kind: 'weather', priority: 1, ttl: 120_000, keys: [key], alert: { id, kind: 'weather', title: `Rain at ${r.from}`, text: `${r.prob}% chance. Take a jacket, or walk before.`, face: '🌧', actions: [{ label: 'OK', action: { kind: 'dismiss', id }, primary: true }] } })
      }
    }
  }
  if (prefs.pulse && !i.ctx.focus) {
    const key = pulseDue(now, seen)
    if (key) {
      const id = `pulse:${key}`
      out.push({ kind: 'pulse', priority: 0, ttl: 45_000, keys: [key], alert: { id, kind: 'pulse', title: hm(now), text: pulseText(i.stats), face: '✦', peekMs: 3000, actions: [] } })
    }
  }
  return out
}

/** Titles of what waited, for the summary ("Water, Ben's message"). */
const heldText = (h: HeldItem[]) => {
  const names = [...new Set(h.map((x) => x.title).filter(Boolean))].slice(0, 3)
  return `${names.join(' · ')}${h.length > names.length ? ` · +${h.length - names.length}` : ''}`
}

/**
 * One step: the final alert for the island and the new state.
 * - the shield holds non-urgent base alerts while a focus timer runs and releases
 *   one summary when it ends;
 * - an alive card shows for its short life, then goes;
 * - a new card needs a free slot: no card on, no meeting, quiet hours, bed,
 *   and 10 minutes since the last non-urgent peek (the 2-minute countdown is exempt).
 */
export function aliveStep(i: AliveInput, st: AliveState): { alert: IslandAlert | null; state: AliveState; held: number } {
  const { now } = i
  let s: AliveState = { ...st, seen: prune(st.seen, now), card: st.card && st.card.until > now ? st.card : null }
  const shield = i.prefs.shield
  let base = i.base
  // Shield: hold while focusing.
  if (shield && i.ctx.focus && base && !isUrgent(base) && !s.held.some((h) => h.id === base!.id)) {
    s = { ...s, held: [...s.held, { id: base.id, title: base.title.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40) }] }
  }
  if (shield && i.ctx.focus && base && !isUrgent(base)) base = null
  // A shielded focus holds mirror/streak/countdown cards below too (they count), pulse is skipped.
  const focusHold = shield && i.ctx.focus
  // The focus just ended: one summary.
  let summary: IslandAlert | null = null
  if (s.wasFocus && !i.ctx.focus && s.held.length) {
    const id = `shield:${now}`
    summary = { id, kind: 'pulse', title: `${s.held.length} waited while you focused`, text: heldText(s.held), face: '🛡', peekMs: 4000, actions: [{ label: 'OK', action: { kind: 'dismiss', id }, primary: true }] }
    s = { ...s, held: [], card: { alert: summary, until: now + 90_000 }, lastAt: now }
  } else if (!shield && s.held.length) s = { ...s, held: [] }
  s = { ...s, wasFocus: i.ctx.focus }

  const known = s.mirrorKnown
  const mirrorItems = mirrorNew(known, i.mirror)
  s = { ...s, mirrorKnown: mirrorKnown(i.mirror, known) }
  if (base) return { alert: base, state: s, held: s.held.length }
  if (s.card) return { alert: s.card.alert, state: s, held: s.held.length }
  // Free slot?
  const blocked = i.ctx.meeting || i.ctx.quiet || i.ctx.asleep
  const cands = blocked ? [] : candidates(i, s.seen, mirrorItems).filter((c) => !(i.ctx.focus && !focusHold && c.kind !== 'countdown'))
  if (!cands.length) {
    // Quiet or a meeting: a mirror is still marked as seen so it doesn't pop up afterwards as old news.
    return { alert: null, state: s, held: s.held.length }
  }
  const top = [...cands].sort((a, b) => b.priority - a.priority)[0]
  const seen = { ...s.seen }
  for (const c of cands) for (const k of c.keys) seen[k] = now
  // Focus with the shield: hold the card (counted), nothing shows.
  if (focusHold) return { alert: null, state: { ...s, seen, held: [...s.held, ...cands.map((c) => ({ id: c.alert.id, title: c.alert.title.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40) }))] }, held: s.held.length + cands.length }
  if (!top.bypassGap && !peekAllowed(s.lastAt, now)) return { alert: null, state: { ...s, seen: { ...s.seen } }, held: s.held.length }
  const merged = cands.length - 1
  const alert: IslandAlert = merged > 0 && top.kind !== 'mirror' ? { ...top.alert, text: `${top.alert.text} · +${merged} more` } : top.alert
  return { alert, state: { ...s, seen, card: { alert, until: now + top.ttl }, lastAt: top.bypassGap ? s.lastAt : now }, held: s.held.length }
}

// ---- The island's look: data ----

export type DayStateName = NonNullable<IslandSnapshot['dayState']>
/**
 * How the day is going. Rest: a day off. Drifting: video, games or social in
 * front right now. Behind: less done than the hour says (from 11:00). Else on track.
 */
export function dayState(o: { now: number; dayPct: number; mustDone: number; mustTotal: number; restDay: boolean; drifting: boolean }): DayStateName {
  if (o.restDay) return 'rest'
  if (o.drifting) return 'drifting'
  const d = new Date(o.now)
  const h = d.getHours() + d.getMinutes() / 60
  if (h < 11 || h >= 23) return 'ontrack'
  // Expected progress: 0 at 08:00, 100 at 22:00 (a bit forgiving).
  const expected = Math.max(0, Math.min(100, ((h - 8) / 14) * 100)) * 0.7
  const mustBehind = o.mustTotal > 0 && h >= 15 && o.mustDone / o.mustTotal < (h - 8) / 14 / 2
  return o.dayPct < expected || mustBehind ? 'behind' : 'ontrack'
}

/** The three that matter today: must-dos first (open ones, then done), then the week's top, then Todoist. */
export function top3Of(o: { mustdos: { text: string; done: boolean }[]; top?: { text: string; done: boolean }[]; todoist?: { content: string }[] }): { title: string; done: boolean }[] {
  const out: { title: string; done: boolean }[] = []
  const add = (title: string, done: boolean) => {
    const t = title.trim()
    if (t && !out.some((x) => x.title.toLowerCase() === t.toLowerCase())) out.push({ title: t.slice(0, 80), done })
  }
  for (const m of [...o.mustdos].sort((a, b) => Number(a.done) - Number(b.done))) add(m.text, m.done)
  for (const m of o.top ?? []) add(m.text, m.done)
  for (const t of o.todoist ?? []) add(t.content, false)
  return out.slice(0, 3)
}

/** The next three hours: blocks and events that start soon (and the one on now), reminders and timed Todoist tasks. */
export function next3h(o: { now: number; blocks: IslandBlock[]; reminders?: { at: number; text: string }[]; tasks?: { content: string; at: number | null }[] }): { at: number; title: string; kind: string }[] {
  const to = o.now + 3 * 3_600_000
  const rows: { at: number; title: string; kind: string }[] = []
  for (const b of o.blocks) if (!b.maybe && b.start >= o.now && b.start <= to) rows.push({ at: b.start, title: b.title, kind: b.call ? 'meeting' : b.kind === 'event' ? 'event' : 'block' })
  for (const r of o.reminders ?? []) if (r.at >= o.now && r.at <= to) rows.push({ at: r.at, title: r.text, kind: 'reminder' })
  for (const t of o.tasks ?? []) if (t.at != null && t.at >= o.now && t.at <= to) rows.push({ at: t.at, title: t.content, kind: 'task' })
  return rows.sort((a, b) => a.at - b.at).slice(0, 5)
}

/** "+N" flash: a balance that went up because something really paid. null baseline: first look. */
export function pointsFx(prev: number | null, balance: number, label: string, now: number): { id: string; delta: number; label: string } | null {
  if (prev == null) return null
  const delta = balance - prev
  return delta > 0 ? { id: `fx:${now}:${balance}`, delta, label } : null
}

/** The day's story, from 23:00 to 04:00. */
export function dayStory(o: { now: number; focusMin: number; waterMl: number; waterTarget: number; mustDone: number; mustTotal: number; streak?: number }): NonNullable<IslandSnapshot['story']> | null {
  const h = new Date(o.now).getHours()
  if (h < 23 && h >= 4) return null
  const lines: string[] = []
  if (o.focusMin > 0) lines.push(`You focused for ${minutesText(o.focusMin)}.`)
  else lines.push('No focus timer today. Tomorrow is a fresh start.')
  if (o.mustTotal > 0) lines.push(`${o.mustDone} of ${o.mustTotal} must-dos done${o.mustDone === o.mustTotal ? '. All of them.' : '.'}`)
  if (o.waterTarget > 0) lines.push(`${litres(o.waterMl)} of water${o.waterMl >= o.waterTarget ? ', goal reached.' : `, ${Math.round((o.waterMl / o.waterTarget) * 100)}% of the goal.`}`)
  if (o.streak && o.streak > 1) lines.push(`${o.streak}-day workout streak.`)
  return { lines: lines.slice(0, 4), stats: { focusMin: Math.round(o.focusMin), waterMl: Math.round(o.waterMl), done: o.mustDone } }
}

/** A few numbers for the hover peek. Habits are your rep targets reached today. */
export function glance(o: { waterMl: number; waterGoal: number; reps: { done: number; target: number }[]; moneyLeft: number | null; proteinG: number; proteinGoal: number }): NonNullable<IslandSnapshot['glance']> {
  return { waterMl: o.waterMl, waterGoal: o.waterGoal, habitsDone: o.reps.filter((r) => r.target > 0 && r.done >= r.target).length, habitsTotal: o.reps.length, moneyLeft: o.moneyLeft, proteinG: o.proteinG, proteinGoal: o.proteinGoal }
}

/** Sunrise / sunset tint and one line ("Rain at 17:00", "Sunset in 40 min"). */
export function weatherMoment(w: IslandWeather | null | undefined, now: number): NonNullable<IslandSnapshot['moment']> | null {
  if (!w) return null
  const at = (v: string | null) => (v ? new Date(now).setHours(Number(v.slice(0, 2)), Number(v.slice(3, 5)), 0, 0) : null)
  const up = at(w.sunrise)
  const down = at(w.sunset)
  let tint: 'dawn' | 'day' | 'dusk' | 'night' = 'day'
  if (up != null && down != null) {
    const H = 3_600_000
    if (now < up - H / 2 || now > down + H) tint = 'night'
    else if (now < up + H) tint = 'dawn'
    else if (now > down - H) tint = 'dusk'
  }
  let line: string | null = null
  const r = nextRain(w, now)
  if (r && r.start > now && r.start - now <= 3 * H_MS) line = `Rain at ${r.from}`
  else if (r && r.start <= now) line = `Rain until ${r.to}`
  else if (down != null && down > now && down - now <= 90 * 60_000) line = `Sunset in ${Math.max(1, Math.round((down - now) / 60_000))} min`
  else if (up != null && up > now && up - now <= 45 * 60_000) line = `Sunrise in ${Math.max(1, Math.round((up - now) / 60_000))} min`
  return { tint, line }
}
const H_MS = 3_600_000

// ---- Voice quick capture ----

/**
 * What the island says after "add gym tomorrow 18" (hold to talk): the real
 * receipt of what Ben saved, else his reply. "(nothing saved)" is never a receipt.
 */
export function voiceReceipt(r: { reply: string; done?: string[]; receipt?: string }): string {
  const done = (r.done ?? []).map((d) => d.replace(/<[^>]+>/g, '').trim()).filter((d) => d && !/nothing saved/i.test(d))
  if (done.length) return `✓ ${done.slice(0, 2).join(' · ')}`.slice(0, 140)
  if (r.receipt) return r.receipt.replace(/<[^>]+>/g, '').slice(0, 140)
  return r.reply.replace(/<[^>]+>/g, '').slice(0, 140)
}
