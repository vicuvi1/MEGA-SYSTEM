// Coach UI v4 ("alive companion"): the pure parts of Ben's living presence.
// The time of day the chat's light follows, Ben's mood, the "Ben will…" hint
// under the message box, the big moments worth a celebration and the start
// screen's greeting. No DOM here, so it is all tested.

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'
export type BenFeel = 'calm' | 'happy' | 'focused' | 'sleepy' | 'stern'
/** What Ben is doing right now (the big face shows it). */
export type BenAct = 'idle' | 'listening' | 'thinking' | 'talking'

/** The light of the chat: dawn 05–08, day 08–17, dusk 17–21, night 21–05. */
export function dayPhase(hour: number): DayPhase {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (h >= 5 && h < 8) return 'dawn'
  if (h >= 8 && h < 17) return 'day'
  if (h >= 17 && h < 21) return 'dusk'
  return 'night'
}

/**
 * Ben's mood on his face. Something you just finished wins (happy for a
 * while), then a running focus block, then his own mood from the last reply
 * when it was a hard one, then late at night he gets sleepy.
 */
export function benFeel(x: { hour: number; cheering: boolean; focusing: boolean; replyMood?: string | null }): BenFeel {
  if (x.cheering) return 'happy'
  if (x.focusing) return 'focused'
  if (x.replyMood === 'annoyed' || x.replyMood === 'angry' || x.replyMood === 'furious') return 'stern'
  if (x.replyMood === 'proud' || x.replyMood === 'happy') return 'happy'
  const h = ((Math.floor(x.hour) % 24) + 24) % 24
  if (h >= 23 || h < 5) return 'sleepy'
  return 'calm'
}

const n = (s: string) => Number(s.replace(',', '.'))

/**
 * "Ben will…": what a typed line will most likely do, for a live hint under
 * the message box ("water 500" → "Log 500 ml of water"). Only the clear,
 * common commands; anything else gets no hint (Ben just answers).
 */
export function willHint(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (t.length < 2) return null
  const low = t.toLowerCase()
  // Shortcuts: "/water 300", "/plan"…
  const slash = /^\/(\w+)(?:\s+(.*))?$/.exec(low)
  if (slash) {
    const [, cmd, arg = ''] = slash
    if (cmd === 'water') return `Log ${/^\d{2,4}$/.test(arg.trim()) ? arg.trim() : '250'} ml of water`
    if (cmd === 'focus') {
      const m = Number(arg.match(/\d+/)?.[0] ?? 25)
      return `Start a ${Math.max(5, Math.min(180, m))} min focus block`
    }
    const say: Record<string, string> = { plan: "Plan your day around your calendar", rescue: 'Shrink the rest of today', left: "Show what's left today", week: 'Review your week', tired: 'Find the smallest useful step' }
    if (say[cmd]) return say[cmd]
    if (/^(pushups?|push_ups?|squats?|situps?|press)$/.test(cmd) && /^\d{1,4}$/.test(arg.trim())) return `Log ${arg.trim()} ${repName(cmd)}`
    return null
  }
  // Water: "water 500", "500 ml water", "drank 1.5 l"
  let m = /^(?:water|apa|drank|drink)\s+(\d+(?:[.,]\d+)?)\s*(ml|l|liters?|litres?)?$/i.exec(t) ?? /^(\d+(?:[.,]\d+)?)\s*(ml|l)\s+(?:of\s+)?(?:water|apa)$/i.exec(t)
  if (m) {
    const v = n(m[1])
    const ml = /^l/i.test(m[2] ?? '') || (v > 0 && v < 10) ? Math.round(v * 1000) : Math.round(v)
    if (ml >= 50 && ml <= 5000) return `Log ${ml >= 1000 && ml % 100 === 0 ? `${ml / 1000} L` : `${ml} ml`} of water`
  }
  // Reps: "20 pushups", "pushups 20", "30 squats"
  m = /^(\d{1,4})\s*(push[- ]?ups?|flotari|squats?|sit[- ]?ups?|pull[- ]?ups?)$/i.exec(t) ?? /^(push[- ]?ups?|flotari|squats?|sit[- ]?ups?|pull[- ]?ups?)\s+(\d{1,4})$/i.exec(t)
  if (m) {
    const [count, what] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]
    return `Log ${count} ${repName(what)}`
  }
  // Focus: "focus 25 algebra", "f algebra 50"
  m = /^(?:focus|f)\s+(.{2,80})$/i.exec(t)
  if (m) {
    const num = /(?:^|\s)(\d{1,3})\s*(?:min|m)?(?=\s|$)/i.exec(m[1])
    const subject = num ? m[1].replace(num[0], ' ').replace(/\s+/g, ' ').trim() : ''
    if (num && subject) return `Start ${Math.max(5, Math.min(180, Number(num[1])))} min of focus on ${subject}`
  }
  // A task: "task call the dentist tomorrow"
  m = /^(?:task|todo|add)\s*:?\s+(.{2,})$/i.exec(t)
  if (m) return `Add a task: ${cut(m[1])}`
  m = /^(?:goal|new goal)\s*:\s*(.{4,})$/i.exec(t)
  if (m) return `Draft a goal: ${cut(m[1])}`
  // Money: "spent 45 on lunch", "45 lei coffee"
  m = /^(?:spent|paid)\s+(\d+(?:[.,]\d+)?)\s*(?:lei|mdl|eur|€|\$|usd)?\s*(?:on|for)?\s*(.*)$/i.exec(t) ?? /^(\d+(?:[.,]\d+)?)\s*(?:lei|mdl)\s+(.{2,})$/i.exec(t)
  if (m) return `Log ${m[1]} spent${m[2] ? ` on ${cut(m[2], 28)}` : ''}`
  // Sleep: "slept 7h", "slept 6.5 hours"
  m = /^slept\s+(\d+(?:[.,]\d+)?)\s*(?:h|hours?)?$/i.exec(t)
  if (m) return `Log ${m[1]} h of sleep`
  if (/^(?:approve|aprove|ok,? approve)(?: (?:the|my|today'?s))? ?(?:plan|paln)?$/i.test(t)) return "Approve today's plan"
  if (/^(?:rename|move|change|shift)\b.*\bblock\b/i.test(t)) return 'Change that block in your calendar'
  if (/^plan (?:my|the) (?:day|afternoon|evening|morning)/i.test(t)) return 'Plan blocks in your free time'
  return null
}

function repName(w: string): string {
  const s = w.toLowerCase().replace(/[-_ ]/g, '')
  if (/^(pushups?|flotari)$/.test(s)) return 'push-ups'
  if (/^squats?$/.test(s)) return 'squats'
  if (/^situps?$/.test(s)) return 'sit-ups'
  if (/^pullups?$/.test(s)) return 'pull-ups'
  return 'presses'
}
const cut = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

export type MomentKind = 'plan' | 'goal' | 'streak'
export interface Moment { kind: MomentKind; title: string; sub: string }

/**
 * A big thing Ben just confirmed, worth a full-width moment: today's plan
 * approved, a goal milestone, a streak. Read from what he did (`done`), then
 * from his words. Small logs (water, reps) are not moments.
 */
export function bigMoment(x: { text?: string; done?: string[] }): Moment | null {
  const done = (x.done ?? []).filter((d) => !d.startsWith('⚠️'))
  const all = [...done, x.text ?? ''].join('\n')
  if (done.some((d) => /\b(plan|day)\b.*\bapproved\b|\bapproved\b.*\bplan\b/i.test(d))) return { kind: 'plan', title: 'Plan approved', sub: 'Blocks are in your calendar and the must-dos are on Today.' }
  const streak = /(\d{1,4})[- ]day streak|streak(?: of|:)? (\d{1,4}) days?/i.exec(all)
  if (streak) {
    const days = Number(streak[1] ?? streak[2])
    if (days >= 3) return { kind: 'streak', title: `${days}-day streak`, sub: days >= 30 ? 'A whole month. This is who you are now.' : days >= 7 ? 'A full week and counting. Keep the chain.' : 'Keep the chain going.' }
  }
  const goal = done.find((d) => /\bgoal\b/i.test(d) && /(\b(?:25|50|75|100)\s?%|\bmilestone\b|\breached\b|\bcompleted?\b|\bdone\b)/i.test(d))
  if (goal) {
    const pct = /(\d{2,3})\s?%/.exec(goal)?.[1]
    return { kind: 'goal', title: pct === '100' || /reached|completed?|done/i.test(goal) ? 'Goal reached' : `Goal ${pct ?? ''}% there`.replace('  ', ' '), sub: goal.replace(/^\p{Extended_Pictographic}️?\s*/u, '') }
  }
  return null
}

/** True when a reply did something good (a burst of colour in the chat). */
export function goodNews(done: string[] | undefined): boolean {
  return (done ?? []).some((d) => !d.startsWith('⚠️'))
}

/** The start screen's greeting: "Morning, Alex" (no name: just the part of the day). */
export function greeting(hour: number, name?: string | null): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  const part = h >= 5 && h < 12 ? 'Morning' : h < 17 && h >= 12 ? 'Afternoon' : h >= 17 && h < 22 ? 'Evening' : 'Up late'
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
}

/** Delay between words when a reply reveals itself: ~1 s for the whole reply, 10–34 ms a word. */
export function wordStep(words: number): number {
  return Math.max(10, Math.min(34, Math.round(1000 / Math.max(1, words))))
}
