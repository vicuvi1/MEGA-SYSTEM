// The app window's part of sleep care on the island (BD4, BD5, BD11, BD12):
// it reads the synced sleep care (coffee, light, tonight's checklist), the
// weather plugin and today's screen time on this PC, and hands the island's
// chain (core/dayNudges.ts) the cards and settings; it answers the island's
// 'care' taps. The pure rules live in core/sleepCare.ts, afterShift.ts,
// eyeCare.ts and deskMobility.ts.
import type { IslandAction } from '@core/islandModel'
import type { DayNudgeInput } from '@core/dayNudges'
import type { LifeFit } from '@core/lifeFit'
import { caffeineAlert, careDay, cleanCare, lightCard, type CareView } from '@core/sleepCare'
import { afterShiftPlan, effectiveBed, shiftPhase, windModeTonight, type AfterShiftPlan } from '@core/afterShift'
import { eyeIntervalMin, eyeTip } from '@core/eyeCare'
import { life } from './bridge'
import { doingNow } from './smartIsland'
import { weatherToday } from './widgets/widgetsFeed'

let view: { at: number; v: CareView | null } = { at: 0, v: null }
let screen: { at: number; min: number | null } = { at: 0, min: null }
if (typeof window !== 'undefined') window.addEventListener('life-care-changed', () => (view.at = 0))

async function careNow(now: number): Promise<CareView | null> {
  if (now - view.at < 60_000 && view.v) return view.v
  view.at = now
  view.v = (await life.care?.state().catch(() => null)) ?? view.v
  return view.v
}

/** Today's minutes on screens on this PC (the PC activity data), every 5 minutes; null off the desktop. */
async function screenMin(now: number): Promise<number | null> {
  if (now - screen.at < 5 * 60_000) return screen.min
  screen.at = now
  const t = await window.desktop?.pcToday?.().catch(() => null)
  screen.min = t ? Math.round(Object.values(t.apps).reduce((s, a) => s + (Number(a.sec) || 0), 0) / 60) : null
  return screen.min
}

export interface CareTick {
  care: NonNullable<DayNudgeInput['care']>
  plan: AfterShiftPlan | null
  /** Tonight's bedtime for the late nudges and Ben on your PC (lights out after a late shift). */
  bed: string
  windMode: ReturnType<typeof windModeTonight>
  afterShift: { minutesLeft: number; lightsOut: string } | null
}

export async function careTick(o: { now: number; day: string; fit: LifeFit | null; wakeTarget: string; bedTarget: string; bedLogged: boolean; wakeTime: string | null; dismissed: Record<string, number>; eyesToday: number }): Promise<CareTick> {
  const v = await careNow(o.now)
  const c = v?.care ?? cleanCare(null)
  const d = careDay(c, o.day)
  const weather = await weatherToday(o.now).catch(() => null)
  const plan = afterShiftPlan(o.fit, o.day, o.bedTarget)
  const sm = await screenMin(o.now).catch(() => null)
  const phase = shiftPhase(plan, o.now, o.bedLogged)
  return {
    care: {
      light: lightCard({ now: o.now, day: o.day, wakeTime: o.wakeTime, wakeTarget: o.wakeTarget, done: !!d.light, weather, dismissed: o.dismissed }),
      caffeine: caffeineAlert({ now: o.now, day: o.day, care: c, bed: o.bedTarget, dismissed: o.dismissed }),
      afterShift: { plan, done: d.shift ?? [], ctf: doingNow()?.ctx === 'ctf' },
      eyes: { everyMin: eyeIntervalMin(sm), tip: eyeTip({ now: o.now, n: o.eyesToday, sunset: weather?.sunset, warmDone: !!d.warm, screenMin: sm }) },
      drill: true
    },
    plan,
    bed: effectiveBed(plan, o.bedTarget),
    windMode: windModeTonight(plan, o.now, o.bedTarget, o.bedLogged),
    afterShift: phase?.phase === 'wind' && plan ? { minutesLeft: phase.minutesLeft, lightsOut: plan.lightsOut } : null
  }
}

/** A tap on a sleep-care card. Returns the island's short answer. */
export async function careAct(a: Extract<IslandAction, { kind: 'care' }>): Promise<string | null> {
  if (!life.care) throw new Error('This needs the newest version')
  view.at = 0
  const op = a.op
  switch (op.op) {
    case 'light':
      await life.care.light()
      return '☀️ Morning light: noted'
    case 'coffee':
      return (await life.care.coffee(1)).reply
    case 'warm':
      await life.care.warm()
      return '🌙 Warm screen on: noted'
    case 'shiftStep': {
      await life.care.shiftStep(op.step, op.on)
      return op.on ? `✓ ${op.step === 'alarm' ? 'Alarm set' : op.step === 'phone' ? 'Phone away' : op.step === 'skin' ? 'Skin' : 'Teeth'}` : null
    }
  }
}
