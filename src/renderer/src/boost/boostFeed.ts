// Focus boost on the desktop island (the app window's side, called on every
// island build: no new timer). It makes at most one card:
// - DX7: "What's in the way?" after you snoozed or skipped a block on the
//   island, then the fix for the reason you tapped;
// - DX4: the push ladder's step (soft chime → sharp alarm → Ben's voice line
//   plus a Telegram message with a stake you can take), reset when you start;
// - DX19: the morning launch countdown (water → push-ups → the first must-do
//   opened within 2 minutes, with its launch kit).
// The ladder and the morning run live in this PC's storage; the Telegram
// step goes through Ben 2's shared push log (one key, sent once).
import type { IslandAction, IslandAlert, IslandBlock } from '@core/islandModel'
import { inQuiet, levelFor, type AreaLevels } from '@core/benPushes'
import { ladderKey, ladderTick, ladderTrigger, STEP_KIND, type LadderState } from '@core/pushLadder'
import { currentStep, launchCard, markStep, morningBegin, cleanRun, type MorningRun } from '@core/morningLaunch'
import { stallFix, STALL_REASONS, isStallReason, type StallFix } from '@core/stallFix'
import { kitFor } from '@core/launchKit'
import { suggestStake } from '@core/benStakes'
import { dayKey } from '@core/dates'
import { life } from '../bridge'
import { playCheck } from '../soundKit'
import { boostNow, loadBoost } from './boostBus'
import { openKit } from './launch'

const LADDER = 'ls.boostLadder'
const MORNING = 'ls.boostMorning'
const read = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* private window */
  }
}

interface LadderStore {
  day: string
  state: LadderState | null
  /** Blocks you skipped from the ladder today (never again today). */
  skipped: string[]
  /** "10 min later" from the ladder: quiet until. */
  snooze: Record<string, number>
  /** The card showing now (it stays until answered or the next step). */
  card: IslandAlert | null
}
const emptyLadder = (day: string): LadderStore => ({ day, state: null, skipped: [], snooze: {}, card: null })
const ladderStore = (day: string): LadderStore => {
  const s = read<LadderStore | null>(LADDER, null)
  return s && s.day === day ? { ...emptyLadder(day), ...s } : emptyLadder(day)
}

/** DX7 on the island: the open question and the fix. */
let stall: { subject: string; until: number } | null = null
let fix: { fix: StallFix; until: number } | null = null

/** A block was snoozed or skipped on the island: ask why (if that's on). */
export function queueStall(subject: string, now = Date.now()): void {
  if (!boostNow().stall) return
  stall = { subject: subject.slice(0, 60), until: now + 5 * 60_000 }
  fix = null
}

export interface BoostIslandInput {
  now: number
  here: boolean
  blocks: IslandBlock[]
  running: { subject: string } | null
  meeting: boolean
  bedLogged: boolean
  areas?: AreaLevels | null
  /** Ben 2's push answers today (check-in Skip / 10 min later). */
  recs: Record<string, { ans?: string; until?: number; at?: number } | undefined>
  /** The PC coach's drift, still going. */
  drift: { since: number } | null
  /** The drift block's or timer's name. */
  driftTitle: string | null
  mustdos: { i: number; text: string; done: boolean }[]
  /** Today's logged wake-up (ms), or null. */
  wokeAt: number | null
}

const say = (text: string) => {
  try {
    const s = window.speechSynthesis
    if (!s || typeof SpeechSynthesisUtterance === 'undefined') return
    s.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1
    u.pitch = 0.9
    s.speak(u)
  } catch {
    /* no voice on this device */
  }
}

/** The boost card for the island now, or null. */
export async function boostTick(o: BoostIslandInput): Promise<IslandAlert | null> {
  const prefs = await loadBoost().catch(() => boostNow())
  const now = o.now
  const day = dayKey(new Date(now))
  const pc = playCheck()
  const quiet = o.bedLogged || inQuiet(now, pc.quiet.on ? pc.quiet : null)

  // DX7: the question, then the fix.
  if (fix && fix.until > now) return fixAlert(fix.fix)
  fix = null
  if (stall && stall.until > now && !o.meeting) return stallAlert(stall.subject)
  stall = null

  // DX4: the ladder (only while you're at the PC; away, Ben 2's Telegram pushes do the work).
  const ls = ladderStore(day)
  if (o.here) {
    const focusBlocks = o.blocks.filter((b) => !b.maybe && !b.call && b.kind !== 'event').map((b) => ({ id: b.id, title: b.title, start: b.start, end: b.end, focus: true }))
    const trig0 = ladderTrigger({ now, drift: o.drift && o.driftTitle ? { title: o.driftTitle, since: o.drift.since } : null, blocks: focusBlocks, running: !!o.running, answers: o.recs })
    const trig = trig0 && !ls.skipped.includes(trig0.key) && (ls.snooze[trig0.key] ?? 0) <= now ? trig0 : null
    const level = o.areas ? levelFor(o.areas, 'checkin', trig?.title ?? '') : 'normal'
    const r = ladderTick({ now, prefs: prefs.ladder, level, trigger: trig, started: !!o.running && !o.drift, quiet, meeting: o.meeting, state: ls.state })
    let card = r.state ? ls.card : null
    if (r.fire) {
      const f = r.fire
      card = {
        id: `ladder:${f.key}:${f.step}`,
        kind: STEP_KIND[f.step],
        title: `${f.head} · step ${f.step}`,
        text: f.text,
        face: f.face,
        actions: [
          { label: '▶ Start now', primary: true, action: { kind: 'boost', op: 'ladderStart', alertId: `ladder:${f.key}`, arg: f.title.slice(0, 40), minutes: 25 } },
          { label: '⏰ 10 min', action: { kind: 'boost', op: 'ladderSnooze', alertId: `ladder:${f.key}`, arg: f.key } },
          { label: 'Skip it', action: { kind: 'boost', op: 'ladderSkip', alertId: `ladder:${f.key}`, arg: f.key } }
        ]
      }
      if (f.voice) say(f.voice)
      if (f.telegram && life.coach?.pushes) {
        const st = f.telegram.stake ? suggestStake(f.title, new Date(now)) : null
        const subject = f.title.slice(0, 28)
        const rows = [[{ text: '▶ Start now · 25 min', callback_data: `fo|25|${subject}`.slice(0, 64) }], ...(st ? [[{ text: `🎯 Stake it: ${st.points} pts`, callback_data: `sg|${subject}`.slice(0, 64) }]] : [])]
        const text = st ? `${f.telegram.text}\n🎯 Stake: ${st.text}, ${st.points} points. It's only made if you tap it.` : f.telegram.text
        void life.coach.pushes.queue({ key: ladderKey(f.key), text, at: now, rows }).catch(() => {})
      }
    }
    write(LADDER, { ...ls, state: r.state, card })
    if (card && (!o.running || o.drift)) return card
  } else if (ls.card) write(LADDER, { ...ls, card: null })

  // DX19: the morning launch countdown.
  if (o.meeting || quiet) return null
  const prev = cleanRun(read(MORNING, null), day)
  const brief = o.recs[`brief:${day}`]
  const run = morningBegin({ run: prev, day, now, prefs: prefs.morning, wokeAt: o.wokeAt, briefOpenedAt: brief?.ans ? brief.at ?? null : null })
  if (!run) return null
  const md = o.mustdos.find((m) => !m.done)?.text ?? null
  let cur = run
  if (o.running && currentStep(cur, !!md) === 'mustdo') cur = markStep(cur, 'mustdo', 'done', now, !!md)
  if (currentStep(cur, !!md) === 'mustdo' && cur.lastAt == null) cur = { ...cur, lastAt: now }
  if (cur !== prev) write(MORNING, cur)
  const kit = md ? kitFor(prefs.kits, md) : null
  const c = launchCard({ run: cur, now, prefs: prefs.morning, mustdo: md, kit: kit?.name ?? null })
  if (!c) return null
  return {
    id: c.step === 'mustdo' ? `${c.id}:${Math.floor(now / 15_000)}` : c.id,
    kind: 'launch',
    title: c.title,
    text: c.text,
    face: c.face,
    actions: c.buttons.map((b) => ({ label: b.label, ...(b.primary ? { primary: true } : {}), action: { kind: 'boost' as const, op: `m:${b.op}`, alertId: c.id, arg: c.step } }))
  }
}

function stallAlert(subject: string): IslandAlert {
  return {
    id: `stall:${subject}`,
    kind: 'coach',
    title: `What's in the way of ${subject}?`,
    text: 'One tap, one fix.',
    face: '🤔',
    actions: STALL_REASONS.map((r) => ({ label: `${r.icon} ${r.label}`, action: { kind: 'boost' as const, op: `stall:${r.id}`, alertId: `stall:${subject}`, arg: subject } }))
  }
}
function fixAlert(f: StallFix): IslandAlert {
  return {
    id: `fix:${f.reason}`,
    kind: 'coach',
    title: f.title,
    text: f.text,
    face: STALL_REASONS.find((r) => r.id === f.reason)?.icon ?? '💡',
    actions: [
      { label: f.button, primary: true, action: { kind: 'boost', op: 'fix', alertId: `fix:${f.reason}` } },
      { label: 'Not now', action: { kind: 'boost', op: 'fixNo', alertId: `fix:${f.reason}` } }
    ]
  }
}

const PUSHUP = /push[\s-]?ups?|flotari|flotări|отжим/i

/** A tap on a boost card. Returns what to say and island actions to run after (water, reps, chat). */
export async function boostAct(a: Extract<IslandAction, { kind: 'boost' }>, ctx: { reps: { id: string; name: string }[] } = { reps: [] }): Promise<{ said: string | null; then?: IslandAction[] }> {
  const now = Date.now()
  const day = dayKey(new Date(now))
  const prefs = await loadBoost().catch(() => boostNow())
  const ls = ladderStore(day)
  const clearCard = () => write(LADDER, { ...ladderStore(day), card: null })
  // Alive island: the countdown card's "Start the kit" (opens the kit for that block; nothing is logged).
  if (a.op === 'kitOpen') {
    const kit = a.arg ? kitFor(prefs.kits, a.arg) : null
    if (!kit) return { said: null }
    void openKit(kit)
    return { said: `🚀 ${kit.name ?? 'Kit'} opened` }
  }
  if (a.op === 'ladderStart') {
    const subject = (a.arg ?? 'Focus').slice(0, 40)
    await life.focus.start(subject, Math.max(5, Math.min(180, a.minutes ?? 25)), null)
    window.dispatchEvent(new Event('life-focus-changed'))
    write(LADDER, { ...ls, state: null, card: null })
    const kit = kitFor(prefs.kits, subject)
    if (kit?.auto) void openKit(kit)
    return { said: `▶ ${subject}` }
  }
  if (a.op === 'ladderSnooze' && a.arg) {
    write(LADDER, { ...ls, snooze: { ...ls.snooze, [a.arg]: now + 10 * 60_000 }, state: null, card: null })
    queueStall(ls.state?.title ?? ls.card?.text ?? 'this block', now)
    return { said: '⏰ OK, 10 minutes' }
  }
  if (a.op === 'ladderSkip' && a.arg) {
    write(LADDER, { ...ls, skipped: [...ls.skipped, a.arg].slice(-30), state: null, card: null })
    queueStall(ls.state?.title ?? 'this block', now)
    return { said: 'Skipped for today' }
  }
  if (a.op.startsWith('stall:')) {
    const reason = a.op.slice(6)
    if (!isStallReason(reason)) return { said: null }
    const subject = a.arg ?? 'it'
    stall = null
    await life.boost?.stall({ reason, subject }).catch(() => {})
    const reward = await life.shop.state().then((s) => s.rewards.find((x) => x.pinned && !x.archived)?.title ?? null).catch(() => null)
    fix = { fix: stallFix(reason, subject, { reward }), until: now + 5 * 60_000 }
    return { said: STALL_REASONS.find((r) => r.id === reason)!.fix }
  }
  if (a.op === 'fix' && fix) {
    const f = fix.fix
    fix = null
    if (f.action.kind === 'split') return { said: '✂️ Splitting it…', then: [{ kind: 'chat', text: `break down ${f.action.subject}` }] }
    return { said: null, then: [{ kind: 'start', subject: f.action.subject, minutes: f.action.minutes }] }
  }
  if (a.op === 'fixNo') {
    fix = null
    return { said: null }
  }
  if (a.op.startsWith('m:')) {
    const run = cleanRun(read(MORNING, null), day)
    const step = a.arg === 'water' || a.arg === 'pushups' || a.arg === 'mustdo' ? a.arg : null
    if (!run || !step) return { said: null }
    const st = await life.focus.state().catch(() => null)
    const md = st?.plan.items.find((x) => !x.done)?.text ?? null
    const op = a.op.slice(2)
    if (op === 'skip') {
      write(MORNING, markStep(run, step, 'skip', now, !!md))
      return { said: 'Skipped' }
    }
    write(MORNING, markStep(run, step, 'done', now, !!md))
    if (op === 'water') return { said: null, then: [{ kind: 'water', ml: prefs.morning.waterMl }] }
    if (op === 'pushups') {
      const ex = ctx.reps.find((r) => PUSHUP.test(r.name) || PUSHUP.test(r.id))
      return { said: null, then: [{ kind: 'reps', id: ex?.id ?? 'pushups', ex: ex?.id ?? 'pushups', name: ex?.name ?? 'Push-ups', n: prefs.morning.pushups }] }
    }
    if (op === 'open' && md) {
      const kit = kitFor(prefs.kits, md)
      if (kit) await openKit(kit)
      return { said: `🚀 ${md}`, then: [{ kind: 'start', subject: md.slice(0, 40), minutes: 25 }] }
    }
    return { said: null }
  }
  clearCard()
  return { said: null }
}
