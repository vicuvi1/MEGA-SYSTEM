// When urges and resets happen, so Ben can warn you before your risky times.
// Pure and tested. Looks at the last 90 days in 2-hour blocks, every day or
// on one weekday; a reset weighs more than an urge you beat.

export interface UrgeEvent { kind: 'urge' | 'reset'; ts: string }
export interface TriggerNote { at: string; kind: 'urge' | 'reset'; trigger: string; before?: number; after?: number; action?: string }
export interface RiskWindow {
  /** 0..11: 2-hour block of the day (5 = 10:00–12:00). */
  slot: number
  /** null = every day; 0..6 = that weekday (0 = Sunday). */
  weekday: number | null
  from: string
  to: string
  urges: number
  resets: number
  score: number
}

export const TRIGGERS = ['Late night, tired', 'Phone in bed', 'Bored', 'Stress', 'Alone', 'Social media', 'Other'] as const
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n % 24).padStart(2, '0')
const W = { urge: 1, reset: 3 }

function recent<T extends { ts?: string; at?: string }>(list: T[], now: Date, days = 90): T[] {
  const from = now.getTime() - days * 864e5
  return list.filter((e) => {
    const t = Date.parse((e.ts ?? e.at) as string)
    return Number.isFinite(t) && t >= from && t <= now.getTime()
  })
}

/** Your risky times, worst first (at most `max`). */
export function riskWindows(events: UrgeEvent[], now = new Date(), max = 3): RiskWindow[] {
  type Acc = { urges: number; resets: number; score: number; dates: Set<string> }
  const daily = new Map<number, Acc>()
  const weekly = new Map<string, Acc>()
  const add = (m: Map<any, Acc>, k: any, e: UrgeEvent, date: string) => {
    const a = m.get(k) ?? { urges: 0, resets: 0, score: 0, dates: new Set<string>() }
    a[e.kind === 'urge' ? 'urges' : 'resets']++
    a.score += W[e.kind]
    a.dates.add(date)
    m.set(k, a)
  }
  for (const e of recent(events, now)) {
    const d = new Date(e.ts)
    const slot = Math.floor(d.getHours() / 2)
    const date = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    add(daily, slot, e, date)
    add(weekly, `${d.getDay()}:${slot}`, e, date)
  }
  const out: RiskWindow[] = []
  const win = (slot: number, weekday: number | null, a: Acc): RiskWindow => ({ slot, weekday, from: `${pad(slot * 2)}:00`, to: `${pad(slot * 2 + 2)}:00`, urges: a.urges, resets: a.resets, score: a.score })
  for (const [slot, a] of daily) if (a.score >= 4 && a.dates.size >= 3) out.push(win(slot, null, a))
  for (const [k, a] of weekly) {
    const [wd, slot] = k.split(':').map(Number)
    if (a.score >= 3 && a.dates.size >= 2 && !out.some((w) => w.weekday === null && w.slot === slot)) out.push(win(slot, wd, a))
  }
  return out.sort((a, b) => b.score - a.score || (a.weekday === null ? -1 : 1)).slice(0, max)
}

/** A risky window that is on now, or starts within `aheadMin` minutes. */
export function upcomingRisk(windows: RiskWindow[], now = new Date(), aheadMin = 60): RiskWindow | null {
  const minNow = now.getHours() * 60 + now.getMinutes()
  for (const w of windows) {
    if (w.weekday !== null && w.weekday !== now.getDay()) continue
    const start = w.slot * 120
    const until = start - minNow
    if ((until >= 0 && until <= aheadMin) || (minNow >= start && minNow < start + 120)) return w
  }
  return null
}

export function windowLabel(w: RiskWindow): string {
  return `${w.weekday === null ? 'every day' : DAYS[w.weekday]} ${w.from}–${w.to}`
}

/** What sets it off most (last 90 days). */
export function topTriggers(notes: TriggerNote[], now = new Date(), max = 3): { trigger: string; n: number }[] {
  const n = new Map<string, number>()
  for (const t of recent(notes, now)) if (t.trigger) n.set(t.trigger, (n.get(t.trigger) ?? 0) + (t.kind === 'reset' ? 2 : 1))
  return [...n.entries()].map(([trigger, k]) => ({ trigger, n: k })).sort((a, b) => b.n - a.n).slice(0, max)
}

/** Lines for Ben (empty when there's no pattern yet). */
export function patternLines(events: UrgeEvent[], notes: TriggerNote[], now = new Date()): string[] {
  const w = riskWindows(events, now)
  const t = topTriggers(notes, now)
  const lines: string[] = []
  if (w.length) lines.push(`Discipline danger times (last 90 days): ${w.map((x) => `${windowLabel(x)} (${x.urges} urges, ${x.resets} resets)`).join('; ')}.`)
  if (t.length) lines.push(`What sets it off most: ${t.map((x) => x.trigger).join(', ')}.`)
  return lines
}

const TIP: Record<string, string> = {
  'Late night, tired': 'Lights out early tonight; no "one more scroll".',
  'Phone in bed': 'Phone charges outside the bedroom tonight.',
  Bored: 'Have the next thing ready to do (a task, a walk, a call).',
  Stress: 'When it hits: 20 push-ups, cold water on your face, 10 slow breaths.',
  Alone: 'Be around people or call someone for that stretch.',
  'Social media': 'Log out of the feed apps before it starts.'
}

/** Ben's heads-up before a risky time (discreet when the streak is hidden). */
export function warningText(w: RiskWindow, topTrigger: string | null, stealth = false): string {
  if (stealth) return `🛡️ Heads-up: a tough stretch is coming (${w.from}–${w.to}). Stay sharp, keep the plan.`
  const tip = (topTrigger && TIP[topTrigger]) || 'Decide now what you will do instead, and keep your phone away.'
  const what = [w.urges ? `${w.urges} urge${w.urges === 1 ? '' : 's'}` : '', w.resets ? `${w.resets} reset${w.resets === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
  return `🛡️ <b>Heads-up</b>: ${w.from}–${w.to} is your risky time lately (${what}). ${tip}\nIf an urge hits: open the urge crusher, 3 minutes, you win.`
}
