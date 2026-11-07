// BD12 Eye care beyond 20-20-20 (pure, tested in eyeCare.test.ts). The
// island's eye break grows up:
// - how often follows today's real screen time (the PC activity data): every
//   25 min on a light day, 20 from 3 h, 15 from 6 h, 12 from 9 h;
// - the break itself is "blink and look far": slow full blinks, then 20 s on
//   something 6 m away (the pill animates the blink);
// - every third break a screen check (distance and brightness), and after
//   sunset a warm-screen reminder (Night light), once until you say it's on.
// Points as before: body.eye_break, only for a break you start.

export interface EyeTip {
  kind: 'blink' | 'distance' | 'warm'
  title: string
  text: string
}

/** Minutes between eye breaks for `screenMin` minutes on screens today (null: unknown, the classic 20). */
export function eyeIntervalMin(screenMin: number | null | undefined): number {
  if (screenMin == null || !Number.isFinite(screenMin)) return 20
  if (screenMin < 180) return 25
  if (screenMin < 360) return 20
  if (screenMin < 540) return 15
  return 12
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Sunset from the weather plugin, else a rough one for the month (Northern Hemisphere, Central Europe). */
export function sunsetOf(now: number, sunset?: string | null): string {
  if (sunset && HM.test(sunset)) return sunset
  const m = new Date(now).getMonth()
  return ['16:30', '17:15', '18:30', '19:45', '20:20', '20:50', '20:45', '20:05', '19:10', '18:00', '16:40', '16:20'][m]
}

export function afterSunset(now: number, sunset?: string | null): boolean {
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  return cur >= toMin(sunsetOf(now, sunset)) || cur < 4 * 60
}

export const screenText = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`

/**
 * Which tip goes with this eye break: the warm screen after sunset (until
 * you say it's on today), a screen check every third break, else blink and
 * look far.
 */
export function eyeTip(o: { now: number; n: number; sunset?: string | null; warmDone: boolean; screenMin?: number | null }): EyeTip {
  const sm = o.screenMin != null && o.screenMin >= 60 ? ` ${screenText(o.screenMin)} on screens today.` : ''
  if (!o.warmDone && afterSunset(o.now, o.sunset)) return { kind: 'warm', title: 'Eyes · warm screen now', text: `The sun is down: turn on Night light (warm screen) so your eyes and your sleep get a break.${sm}` }
  if (o.n % 3 === 2) return { kind: 'distance', title: 'Eyes · screen check', text: `Screen an arm's length away, top edge at eye level, brightness close to the room's. Then 20 s looking far.${sm}` }
  return { kind: 'blink', title: 'Eyes · blink and look far', text: `10 slow, full blinks, then look 6 m away for 20 s.${sm}` }
}
