// DX7: one-tap "why I'm stalling" fixes. When you snooze or skip a block,
// you can tap one reason and get its fix right away:
//   tired   → a 10-minute light version (a short timer on the same thing);
//   unclear → 5 minutes to write the one next step;
//   too big → split it (Ben's break-down: 3–6 steps, step 1 first);
//   boring  → your boring-task music and a reward bundle (Rewards' "pair it");
//   scared  → the 5-minute start (only 5 minutes, then you may stop).
// The reason is saved (and "tired" / "boring" also land on Ben's desk with his
// other excuses), so he sees which one keeps coming back. Pure and tested.
import { addDays } from './dates'

export type StallReason = 'tired' | 'unclear' | 'big' | 'boring' | 'scared'
export const STALL_REASONS: { id: StallReason; label: string; icon: string; fix: string }[] = [
  { id: 'tired', label: 'Tired', icon: '😴', fix: '10-min light version' },
  { id: 'unclear', label: 'Unclear', icon: '🌫', fix: 'Write the next step' },
  { id: 'big', label: 'Too big', icon: '🏔', fix: 'Split it' },
  { id: 'boring', label: 'Boring', icon: '🥱', fix: 'Music + a reward' },
  { id: 'scared', label: 'Scared', icon: '😬', fix: 'Just 5 minutes' }
]
export const isStallReason = (x: unknown): x is StallReason => STALL_REASONS.some((r) => r.id === x)

/** What a fix does. */
export type StallAction =
  | { kind: 'focus'; subject: string; minutes: number }
  | { kind: 'split'; subject: string }

export interface StallFix {
  reason: StallReason
  title: string
  text: string
  /** The main button. */
  button: string
  action: StallAction
  /** Boring: play this station (your "only during boring tasks" one) with the timer. */
  station?: string | null
  /** Boring: the reward to pair it with. */
  reward?: string | null
}

const clip = (s: string, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** The fix for one reason, for one block or task. */
export function stallFix(reason: StallReason, subject: string, ctx: { boringStation?: string | null; reward?: string | null } = {}): StallFix {
  const s = clip(subject, 60) || 'it'
  switch (reason) {
    case 'tired':
      return { reason, title: 'Light version, 10 min', text: `Do the easiest 10 minutes of ${s}. Low effort counts. Stop after if you need to.`, button: '▶ 10 min, light', action: { kind: 'focus', subject: clip(`${s} (light)`, 40), minutes: 10 } }
    case 'unclear':
      return { reason, title: 'Write the next step', text: `Not sure where to start? Spend 5 minutes writing the one next step for ${s}, in a few words.`, button: '▶ 5 min: next step', action: { kind: 'focus', subject: clip(`Next step: ${s}`, 40), minutes: 5 } }
    case 'big':
      return { reason, title: 'Split it', text: `${s} feels too big. Ben splits it into 3–6 small steps; you only start step 1.`, button: '✂️ Split it', action: { kind: 'split', subject: s } }
    case 'boring':
      return {
        reason,
        title: 'Music and a reward',
        text: ctx.reward ? `Pair it: ${s} with your boring-task music, then “${clip(ctx.reward, 40)}” after.` : `Make it less dull: put on your boring-task music and do 25 minutes of ${s}.`,
        button: '▶ 25 min with music',
        action: { kind: 'focus', subject: clip(s, 40), minutes: 25 },
        station: ctx.boringStation ?? null,
        reward: ctx.reward ?? null
      }
    case 'scared':
      return { reason, title: 'Just 5 minutes', text: `Only 5 minutes of ${s}. After that you're allowed to stop. Starting is the hard part.`, button: '▶ 5-minute start', action: { kind: 'focus', subject: clip(s, 40), minutes: 5 } }
  }
}

// ---- Telegram ("sl|<r>|<subject>") ----

const CODE: Record<StallReason, string> = { tired: 't', unclear: 'u', big: 'b', boring: 'o', scared: 's' }
const FROM: Record<string, StallReason> = { t: 'tired', u: 'unclear', b: 'big', o: 'boring', s: 'scared' }
const bytes = (s: string) => new TextEncoder().encode(s).length

/** Callback data for a reason, kept under Telegram's 64 bytes (the subject is cut to fit). */
export function stallCallback(reason: StallReason, subject: string): string {
  let s = clip(subject, 50)
  while (s && bytes(`sl|${CODE[reason]}|${s}`) > 64) s = s.slice(0, -1)
  return `sl|${CODE[reason]}|${s}`
}
export function readStallCallback(data: string): { reason: StallReason; subject: string } | null {
  const m = /^sl\|([tubos])\|(.*)$/s.exec(String(data ?? ''))
  return m ? { reason: FROM[m[1]], subject: m[2] || 'it' } : null
}
/** The reason buttons under "What's in the way?". */
export function stallKeyboard(subject: string): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const b = STALL_REASONS.map((r) => ({ text: `${r.icon} ${r.label}`, callback_data: stallCallback(r.id, subject) }))
  return { inline_keyboard: [b.slice(0, 3), b.slice(3)] }
}
/** The block's name from a push message's first line ("🎯 Lab 4 · 10:00" → "Lab 4"). */
export function subjectFromPush(text: string): string {
  const first = String(text ?? '').split('\n')[0] ?? ''
  return clip(first.replace(/^[^\p{L}\p{N}]+/u, '').split(' · ')[0], 40) || 'it'
}

// ---- the log ----

export interface StallEntry {
  at: string
  reason: StallReason
  subject: string
}
export function addStall(list: StallEntry[], e: StallEntry): StallEntry[] {
  return [...list.filter((x) => x && isStallReason(x.reason)), { at: e.at, reason: e.reason, subject: clip(e.subject, 60) }].slice(-200)
}
export function cleanStalls(raw: unknown): StallEntry[] {
  return (Array.isArray(raw) ? raw : []).filter((x) => x && typeof x.at === 'string' && isStallReason(x.reason)).map((x) => ({ at: x.at, reason: x.reason, subject: clip(x.subject, 60) })).slice(-200)
}
/** Reasons in the last `days`, most common first. */
export function stallCounts(list: StallEntry[], today: string, days = 30): { reason: StallReason; n: number }[] {
  const from = addDays(today, -(days - 1))
  const m = new Map<StallReason, number>()
  for (const e of list) if (e.at.slice(0, 10) >= from) m.set(e.reason, (m.get(e.reason) ?? 0) + 1)
  return [...m.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n)
}
/** One line for Ben ("Stalls this month: too big ×4, tired ×2"), or null. */
export function stallLine(list: StallEntry[], today: string): string | null {
  const c = stallCounts(list, today)
  if (!c.length) return null
  const label = (r: StallReason) => STALL_REASONS.find((x) => x.id === r)!.label.toLowerCase()
  return `Why he stalls (30 days): ${c.slice(0, 3).map((x) => `${label(x.reason)} ×${x.n}`).join(', ')}`
}
/** The words Ben's excuse log understands (only the reasons it has a kind for), or null. */
export function excuseWords(reason: StallReason, subject: string): string | null {
  if (reason === 'tired') return `didn't start ${clip(subject, 60)}, tired`
  if (reason === 'boring') return `didn't start ${clip(subject, 60)}, not in the mood`
  return null
}
