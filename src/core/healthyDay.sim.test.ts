// A whole made-up weekday, minute by minute with a fake clock, through the
// real pure models: the island's chain (dayNudges.ts → islandNudges,
// islandBody, islandMoments, the governor), the island's pop-up gate
// (islandModel alertGate), Ben's Telegram rhythm (rhythm.ts dueRhythm,
// waterBehind), the Telegram wind-down rule, quiet hours and your reminders
// (coachKit). It writes a timeline of every nudge on every surface and
// checks the healthy-day rules (docs/AI_HANDOFF.md, "Your healthy day").
import { describe, expect, it } from 'vitest'
import { dayNudge } from './dayNudges'
import { DEFAULT_ISLAND_PREFS, alertGate, type IslandAlert, type IslandBlock } from './islandModel'
import { addMove, cleanNudgeStore, dayOf, noteIdle, tally, type NudgeStore } from './islandNudges'
import { DEFAULT_RHYTHM_PREFS, dueRhythm, rhythmFor, type RhythmState } from './rhythm'
import { addReminder, afterSend, dueReminders, type Reminder } from './coachKit'
import { DEFAULT_NOTIF_SETTINGS, quietNow } from './eventAlerts'
import {
  MAX_PER_HOUR,
  SAME_TOPIC_MIN,
  alertKey,
  alertTopic,
  bodyLine,
  govern,
  healthyBonus,
  healthyDay,
  noteMessage,
  noteShown,
  parseReminder,
  reminderDone,
  screenBreaks,
  sleptOnTime,
  stillQuiet,
  waterSeen,
  telegramWindDown,
  textTopic,
  windDownMode,
  type Queued,
  type Shown
} from './healthyDay'
import { dayKey } from './dates'

const at = (h: number, m = 0, d = 0) => new Date(2026, 10, 4 + d, h, m).getTime() // Wednesday 4 Nov 2026
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const MIN = 60_000
const BED = '23:00'
const WATER_TARGET = 2500

interface Event { at: number; surface: 'island' | 'telegram' | 'toast'; topic: string; id: string; text: string; peek: boolean }

/** The made-up day: where you are, minute by minute. */
const plan = {
  // [from, to): at the PC with mouse and keys.
  pc: [
    [at(7, 30), at(8, 0)],
    [at(8, 0), at(9, 30)], // class: notes on the laptop
    [at(9, 45), at(12, 0)], // a long sitting stretch
    [at(12, 45), at(17, 30)], // call, focus, the afternoon slump
    [at(18, 40), at(19, 30)],
    [at(20, 0), at(0, 40, 1)] // wind-down and late-night PC use
  ] as [number, number][],
  classBlock: { title: 'Algebra lecture', start: at(8, 0), end: at(9, 30), kind: 'event', call: false } as IslandBlock,
  callBlock: { title: 'Project call', start: at(13, 0), end: at(13, 45), kind: 'event', call: true } as IslandBlock,
  focus: { subject: 'Rust exercises', startedAt: at(14, 0), endsAt: at(14, 50) },
  wakeTelegram: at(6, 40),
  bedLogged: at(0, 40, 1),
  workoutDone: at(18, 40)
}

function simulate() {
  const events: Event[] = []
  const log: { role: 'coach'; via: 'telegram'; text: string; at: string }[] = []
  let store: NudgeStore = cleanNudgeStore(null)
  let shown: Shown[] = []
  let queue: Queued[] = []
  const dismissed: Record<string, number> = {}
  let reminders: Reminder[] = []
  let water = 0
  let lastWaterAt = 0
  let lastMoveAt = 0
  let activeSince: number | null = null
  let lastActive = 0
  let idleState = { maxIdle: 0 }
  let firstActiveAt: number | null = null
  let shownId: string | null = null
  let shownSince = 0
  let seenWater: { ml: number; at: number } | null = null
  const moodSlots: ('noon' | 'evening')[] = []
  let lastPeekAt = 0
  let rhythm: RhythmState = rhythmFor(null, '2026-11-04')
  let away2 = 0 // a move break: 2 minutes off the PC
  let bonusPaid: number | null = null
  let bonusPays = 0
  let islandWaterAt: number | null = null
  let islandBedAt: number | null = null
  let windDownDay = ''
  const day = '2026-11-04'
  const reacted = new Set<string>()
  const busyAt = (t: number) => ({
    call: plan.callBlock.start <= t && t < plan.callBlock.end,
    focus: plan.focus.startedAt <= t && t < plan.focus.endsAt,
    event: plan.classBlock.start <= t && t < plan.classBlock.end
  })
  const atPc = (t: number) => t >= away2 && plan.pc.some(([a, b]) => a <= t && t < b)
  const sendTelegram = (t: number, text: string) => {
    const reminder = /^⏰/u.test(text)
    // Quiet hours (23:00–07:00 by default): only your own reminders go through.
    if (!reminder && stillQuiet(quietNow(DEFAULT_NOTIF_SETTINGS, new Date(t)), new Date(t), t >= plan.wakeTelegram ? '06:40' : null)) return false
    events.push({ at: t, surface: 'telegram', topic: textTopic(text) ?? 'other', id: `tg:${t}`, text, peek: true })
    log.push({ role: 'coach', via: 'telegram', text, at: new Date(t).toISOString() })
    shown = noteMessage(shown, text, t)
    return true
  }

  for (let t = at(6, 30); t <= at(1, 30, 1); t += MIN) {
    const asleep = t >= plan.bedLogged
    const pc = !asleep && atPc(t)
    if (pc) {
      lastActive = t
      firstActiveAt ??= t
    }
    const idleSec = lastActive ? Math.round((t - lastActive) / 1000) : null
    if (idleSec != null && idleSec >= 300) activeSince = null
    else if (idleSec != null && idleSec < 60 && !activeSince) activeSince = t
    // Back after time away: "Moved?" (IN32).
    const r = noteIdle(idleState, idleSec ?? 0, t)
    idleState = { maxIdle: r.maxIdle }
    if (r.back) store = { ...store, away: r.back }
    const b = busyAt(t)
    const ctx = { now: t, call: b.call, focus: b.focus, event: b.event, asleep }

    // ---- Telegram: Ben's tick every 10 minutes ----
    if (new Date(t).getMinutes() % 10 === 0) {
      // Your reminders first (they always go through, once).
      for (const rm of dueReminders(reminders, new Date(t))) if (sendTelegram(t, `⏰ ${rm.text}`)) reminders = afterSend(reminders, rm.id, new Date(t))
      const facts = { today: day, time: hm(t), weekday: 3, wakeAt: '06:40', wakeTarget: '07:00', waterMl: water, waterTarget: WATER_TARGET, workoutDone: t >= plan.workoutDone, paused: false, busy: b.call || b.focus || b.event, islandWaterAt, nowMs: t, asleep }
      if (t < at(4, 0, 1))
        for (const job of dueRhythm(rhythm, DEFAULT_RHYTHM_PREFS, facts)) {
          if (job === 'briefing' && sendTelegram(t, `☀️ <b>Your day</b> · Classes, Rust, gym\n\n💧 Water: 2.5 L`)) rhythm = { ...rhythm, briefing: { status: 'approved', sentAt: new Date(t).toISOString(), plan: {} as any, version: 1 } }
          if (job === 'water' && sendTelegram(t, `💧 Water ${(water / 1000).toFixed(1)} of 2.5 L and the day is going. Drink 2 glasses now.`)) rhythm = { ...rhythm, water: [...rhythm.water, hm(t)] }
          if (job === 'training' && sendTelegram(t, '💪 No training today yet. 20 minutes counts: start now.')) rhythm = { ...rhythm, training: true }
          if (job === 'evening') {
            const h = healthyDay({ waterMl: water, waterTarget: WATER_TARGET, moves: dayOf(store, day).moves, breaks: screenBreaks(dayOf(store, day)), sleptOnTime: true })
            if (sendTelegram(t, `🌙 <b>Day review: 74/100</b> 🙂\n\nMust-dos 2/3 · Focus 50 min\n${bodyLine(h)}`)) rhythm = { ...rhythm, evening: { sentAt: new Date(t).toISOString(), score: 74, top3: [] } }
          }
        }
      // The wind-down message, 25–50 minutes before bed, once a day (only when the island didn't just show it).
      const bm = (23 * 60 - (new Date(t).getHours() * 60 + new Date(t).getMinutes()) + 1440) % 1440
      if (windDownDay !== day && telegramWindDown({ minutesBefore: bm, bedLogged: asleep, islandBedAt, now: t })) {
        windDownDay = day
        sendTelegram(t, '🌙 <b>Wind-down</b> · in bed by <b>23:00</b>\nLights out at 23:00, up at 07:00.')
      }
    }

    // ---- You, on the island ----
    // 17:00: "remind me to call mom at 18:00" in the "/" palette.
    if (t === at(17, 0)) {
      const ask = parseReminder('remind me to call mom at 18:00', t)!
      reminders = addReminder(reminders, { at: new Date(ask.at).toISOString(), text: ask.text, kind: 'remind' }, new Date(t))
    }
    // 23:45, by voice: "remind me in 60 min to take my meds" (it rings after bed: your own reminders always do).
    if (t === at(23, 45)) {
      const ask = parseReminder('remind me in 60 min to take my meds', t)!
      reminders = addReminder(reminders, { at: new Date(ask.at).toISOString(), text: ask.text, kind: 'remind' }, new Date(t))
    }
    if (t === at(7, 35)) water += 250
    if (t === at(12, 30)) water += 500 // lunch
    if (t === plan.workoutDone) water += 500
    const waterBefore = water
    // Water logged anywhere (the phone at lunch) starts the island's 90 minutes again.
    seenWater = waterSeen(seenWater, water, t)
    lastWaterAt = Math.max(lastWaterAt, seenWater.at)

    const res = dayNudge({
      now: t,
      day: dayKey(new Date(t)),
      ctx,
      shown,
      queue,
      dismissed,
      reminders,
      idleSec: pc || idleSec != null ? idleSec : null,
      activeSince,
      firstActiveAt,
      wakeLogged: t >= plan.wakeTelegram,
      wakeTime: t >= plan.wakeTelegram ? '06:40' : null,
      firstBlock: plan.classBlock.end > t ? { title: plan.classBlock.title, start: plan.classBlock.start } : null,
      blockStarted: t >= plan.classBlock.start,
      // Last night the PC logged the bedtime by itself.
      bedAuto: firstActiveAt ? { time: '23:05', at: new Date(firstActiveAt).toISOString() } : null,
      bedTarget: BED,
      bedLogged: asleep,
      store,
      lastMoveAt,
      lastEyesAt: 0,
      lastWaterAt,
      exercises: [
        { id: 'pushups', name: 'Push-ups', done: 0, target: 60 },
        { id: 'squats', name: 'Squats', done: 0, target: 60 }
      ],
      coins: 3,
      eyeBreaks: false,
      running: b.focus ? plan.focus : null,
      moodSlots,
      lowMood: false,
      snooze: { now: t },
      water: { ml: water, target: WATER_TARGET },
      eveningAt: DEFAULT_RHYTHM_PREFS.evening,
      recap: { mustDone: 2, mustTotal: 3, waterMl: water, waterTarget: WATER_TARGET, focusMin: 50, focusGoal: 100 },
      eveningSent: !!rhythm.evening
    })
    queue = res.queue
    let alert: IslandAlert | null = res.alert
    // Ben's Telegram messages show on the island too (the last fallback, through the same governor).
    if (!alert && !b.call) {
      const fresh = log.filter((e) => !/^⏰/u.test(e.text) && Date.parse(e.at) > t - 10 * MIN && !dismissed[`ben:${e.at}`])
      const last = fresh[fresh.length - 1]
      if (last) alert = govern({ id: `ben:${last.at}`, kind: 'ben', title: 'Ben', text: last.text, actions: [] }, ctx, shown.filter((s) => s.key !== `tg:${Date.parse(last.at)}`)).show
    }
    if (alert && alert.id !== shownId) {
      const gate = alertGate({ kind: alert.kind, meeting: alert.meeting, dot: alert.dot, prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: b.call, lastPeekAt, now: t })
      const peek = gate === 'peek'
      if (peek) lastPeekAt = t
      const topic = alertTopic(alert)
      if (topic) events.push({ at: t, surface: 'island', topic, id: alert.id, text: `${alert.title} · ${alert.text}`, peek })
      shown = noteShown(shown, peek ? alert : { ...alert, dot: true }, 'island', t, true)
      if (topic === 'water') islandWaterAt = t
      if (topic === 'bed') islandBedAt = t
    }
    if (alert?.id !== shownId) shownSince = t
    shownId = alert?.id ?? null

    // How you answer: a pop-up at once; a dot when you next open the island (10 minutes); a move dot grows into a pop-up.
    const seen = alert && (!alert.dot || (t - shownSince >= 10 * MIN && alert.nudge?.type !== 'move'))
    if (alert && seen && !reacted.has(alert.id) && pc) {
      const n = alert.nudge
      const k = alertKey(alert)
      if (alert.kind === 'water') {
        reacted.add(alert.id)
        water += 250
        lastWaterAt = t
      } else if (n?.type === 'move' && !alert.dot) {
        reacted.add(alert.id)
        store = addMove(store, { id: `mv${t}`, at: t, day, ex: 'pushups', name: 'Push-ups', n: 15, workoutId: null, ledgerId: null, coins: 3 })
        lastMoveAt = t
        activeSince = t
        away2 = t + 2 * MIN
        dismissed[k] = t + 864e5
      } else if (n?.type === 'moveDone') {
        reacted.add(alert.id)
        dismissed[alert.id] = t + 864e5
      } else if (n?.type === 'posture') {
        reacted.add(alert.id)
        store = tally(store, day, 'posture', t)
        dismissed[alert.id] = t + 864e5
      } else if (n?.type === 'breathe') {
        reacted.add(alert.id)
        store = tally(store, day, 'calm', t)
      } else if (n?.type === 'timer' && n.kind === 'tidy') {
        reacted.add(alert.id)
        store = tally(store, day, 'tidy', t)
      } else if (n?.type === 'mood') {
        reacted.add(alert.id)
        store = tally(store, day, 'mood', t)
        moodSlots.push(new Date(t).getHours() < 15 ? 'noon' : 'evening')
      } else if (n?.type === 'gratitude') {
        reacted.add(alert.id)
        store = tally(store, day, 'gratitude', t)
      } else if (n?.type === 'away') {
        reacted.add(alert.id)
        store = { ...tally(store, day, 'walk', t, n.min), away: null }
      } else if (alert.id.startsWith('remind:')) {
        reacted.add(alert.id)
        reminders = reminderDone(reminders, alert.id.slice(7), t)
      } else if (alert.kind === 'late') {
        reacted.add(alert.id)
        dismissed[alert.id] = t + 600 * MIN
      } else if (alert.kind === 'winddown') {
        reacted.add(alert.id)
        dismissed[alert.id] = t + 3 * 3600_000 // Close my day
      } else {
        reacted.add(alert.id)
        dismissed[alert.id] = t + 864e5
      }
    }
    // Celebrations (app toasts): the water goal, and the healthy-day bonus once all four are done.
    if (waterBefore < WATER_TARGET && water >= WATER_TARGET) events.push({ at: t, surface: 'toast', topic: 'celebrate', id: 'water-goal', text: '💧 2.5 L today', peek: false })
    const h = healthyDay({ waterMl: water, waterTarget: WATER_TARGET, moves: dayOf(store, day).moves, breaks: screenBreaks(dayOf(store, day)), sleptOnTime: sleptOnTime({ bedTime: '23:05', bedTarget: BED, bedOnTime: null }) })
    const bonus = healthyBonus(h, bonusPaid)
    if (bonus === 'pay') {
      bonusPaid = 1
      bonusPays++
      events.push({ at: t, surface: 'toast', topic: 'celebrate', id: 'healthy', text: '💚 Healthy day: +5', peek: false })
    }
  }
  return { events, reminders, store, water, bonusPays, day }
}

const sim = simulate()
const nudges = sim.events.filter((e) => e.topic !== 'celebrate' && e.topic !== 'reminder')
const timeline = sim.events.map((e) => `${hm(e.at)} ${e.surface.padEnd(8)} ${e.peek ? 'peek' : 'dot '} ${e.topic.padEnd(9)} ${e.text.replace(/<[^>]+>/g, '').split('\n')[0].slice(0, 90)}`)

describe('a whole healthy weekday, simulated', () => {
  it('prints the timeline of every nudge on every surface', () => {
    // Shown with `npx vitest run src/core/healthyDay.sim.test.ts --reporter verbose`.
    console.log(`\n${timeline.join('\n')}\n`)
    expect(timeline.length).toBeGreaterThan(10)
  })

  it('wake-up logged on Telegram at 06:40: one morning card, and it never asks "I\'m up"', () => {
    const morning = sim.events.filter((e) => e.topic === 'morning')
    expect(morning).toHaveLength(1)
    expect(morning[0].text).toContain('Up at 06:40')
    expect(morning[0].text).toContain('Bed at 23:05')
    expect(morning[0].text).not.toContain('Up since')
    // The morning plan came on Telegram 5 minutes after the wake-up.
    expect(sim.events.find((e) => e.topic === 'plan')?.at).toBe(at(6, 50))
    expect(sim.events.filter((e) => e.topic === 'plan' && e.peek)).toHaveLength(1)
  })

  it('no two nudges about the same thing within 30 minutes, on any surface', () => {
    // The island keeps a silent copy of Ben's Telegram message in its log (a dot): that's the same message, not a second nudge.
    const real = nudges.filter((e) => !(e.id.startsWith('ben:') && !e.peek))
    expect(nudges.filter((e) => e.id.startsWith('ben:') && e.peek)).toEqual([])
    for (const e of real) {
      const dup = real.find((x) => x !== e && x.topic === e.topic && x.id.replace(/:(?:dot|peek|sound|ben)$/, '') !== e.id.replace(/:(?:dot|peek|sound|ben)$/, '') && Math.abs(x.at - e.at) < SAME_TOPIC_MIN * MIN)
      expect(dup ? `${hm(e.at)} ${e.surface} ${e.topic} and ${hm(dup.at)} ${dup.surface}` : null).toBeNull()
    }
  })

  it('nothing during the class, the call or the focus block; water and moves come after', () => {
    const inside = (from: number, to: number) => nudges.filter((e) => e.at >= from && e.at < to)
    expect(inside(plan.classBlock.start, plan.classBlock.end)).toEqual([])
    expect(inside(plan.callBlock.start, plan.callBlock.end)).toEqual([])
    expect(inside(plan.focus.startedAt, plan.focus.endsAt)).toEqual([])
    // Sat through the call: the held-back move break comes right after it.
    const after = nudges.find((e) => e.at >= plan.callBlock.end && e.topic === 'move')
    expect(after && after.at - plan.callBlock.end).toBeLessThanOrEqual(2 * MIN)
    expect(after?.text).toContain('stretch')
  })

  it('water: spaced out, and nothing once the goal is met', () => {
    const w = nudges.filter((e) => e.topic === 'water')
    expect(w.length).toBeGreaterThanOrEqual(3)
    // A card that comes back (after time away) is the same card; different ones are 30+ minutes apart.
    for (let i = 1; i < w.length; i++) if (w[i].id !== w[i - 1].id) expect(w[i].at - w[i - 1].at, `${hm(w[i - 1].at)} → ${hm(w[i].at)}`).toBeGreaterThanOrEqual(SAME_TOPIC_MIN * MIN)
    const goal = sim.events.find((e) => e.id === 'water-goal')!
    expect(goal).toBeTruthy()
    expect(w.filter((e) => e.at > goal.at)).toEqual([])
    expect(sim.water).toBeGreaterThanOrEqual(WATER_TARGET)
  })

  it(`at most ${MAX_PER_HOUR} interruptions in any hour (island pop-ups and Ben's own messages)`, () => {
    const peeks = nudges.filter((e) => e.peek)
    for (const e of peeks) {
      const hour = peeks.filter((x) => x.at >= e.at && x.at < e.at + 60 * MIN)
      expect(hour.length, `${hm(e.at)}: ${hour.map((x) => `${hm(x.at)} ${x.topic}`).join(', ')}`).toBeLessThanOrEqual(MAX_PER_HOUR)
    }
  })

  it('move breaks only after real sitting (50 minutes without a 5-minute pause)', () => {
    const moves = nudges.filter((e) => e.topic === 'move' && e.peek)
    expect(moves.length).toBeGreaterThanOrEqual(3)
    expect(moves.every((e) => e.at >= at(8, 20))).toBe(true)
    // Never in the 50 minutes after a break or after coming back.
    expect(moves.some((e) => e.at > at(9, 45) && e.at < at(10, 35))).toBe(false)
    expect(moves.some((e) => e.at > at(12, 45) && e.at < at(13, 35))).toBe(false)
  })

  it('wind-down starts 60 minutes before bed, then a firmer late-night nudge (twice at most)', () => {
    const bed = nudges.filter((e) => e.topic === 'bed')
    expect(bed[0].at).toBe(at(22, 0))
    expect(bed[0].surface).toBe('island')
    // The island had it: Telegram's wind-down didn't repeat it.
    expect(bed.filter((e) => e.surface === 'telegram')).toEqual([])
    const late = nudges.filter((e) => e.topic === 'late')
    expect(late.map((e) => hm(e.at))).toEqual(['23:30', '00:00'])
    expect(late[1].text).toMatch(/hour past bedtime/i)
    expect(windDownMode(at(22, 30), BED, false)).toMatchObject({ phase: 'wind', minutes: 30 })
  })

  it('after bed: nothing but your own reminders', () => {
    expect(sim.events.filter((e) => e.at >= plan.bedLogged && e.topic !== 'reminder')).toEqual([])
    // The one you set for 00:45 still rings, once on each, through quiet hours.
    expect(sim.events.filter((e) => e.at >= plan.bedLogged).map((e) => `${hm(e.at)} ${e.surface} ${e.text.slice(0, 15)}`).sort()).toEqual(['00:45 island take my meds · ', '00:50 telegram ⏰ take my meds'])
    // Quiet hours on Telegram too: nothing from Ben after 23:00.
    expect(nudges.filter((e) => e.surface === 'telegram' && e.at >= at(23, 0))).toEqual([])
  })

  it('"remind me to call mom at 18:00": once on the island, once on Telegram, then Done', () => {
    const r = sim.events.filter((e) => e.topic === 'reminder' && e.text.includes('call mom'))
    expect(r.map((e) => `${hm(e.at)} ${e.surface}`).sort()).toEqual(['18:00 island', '18:00 telegram'])
    expect(sim.reminders.find((x) => x.text === 'call mom')).toMatchObject({ done: true, handled: true })
  })

  it('the healthy day: all four met, the bonus paid once', () => {
    const d = dayOf(sim.store, sim.day)
    const h = healthyDay({ waterMl: sim.water, waterTarget: WATER_TARGET, moves: d.moves, breaks: screenBreaks(d), sleptOnTime: true })
    expect(h.all).toBe(true)
    expect(sim.bonusPays).toBe(1)
    expect(bodyLine(h)).toMatch(/^Body today: .* All four: a healthy day/)
  })
})
