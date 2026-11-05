// Island eyes: from what an eye read (already checked by eyesGuard) to one
// short line and, sometimes, one offer for the island:
// - "Looks like interview prep: start a focus block for it?"
// - "Save this as a task?" (a page with a deadline on it)
// and the line Ben gets when you share it ("now: reading X in Chrome").
// Pure and tested (eyesSense.test.ts).
import { summarize, SUMMARY_MAX, type EyeKind } from './eyesGuard'

export interface EyesSeen {
  at: number
  kind: EyeKind
  /** Friendly app name ("Chrome"). */
  app: string
  /** At most 120 characters. */
  summary: string
  hint: EyesHint | null
}

export type EyesHint = { kind: 'focus'; subject: string; text: string } | { kind: 'task'; task: string; text: string }

const TOPICS: { re: RegExp; subject: string; label: string }[] = [
  { re: /\b(interview prep|mock interview|behavio(u)?ral interview|system design|leetcode|neetcode|hackerrank|coding interview|cracking the coding)\b/i, subject: 'Interview prep', label: 'interview prep' },
  { re: /\b(hack ?the ?box|tryhackme|picoctf|ctftime|capture the flag|\bctf\b|pwn|reverse engineering|ghidra)\b/i, subject: 'CTF', label: 'CTF practice' },
  { re: /\b(rust ?lang|the rust (programming )?book|cargo|rustlings|crates\.io)\b/i, subject: 'Rust', label: 'Rust' },
  { re: /\b(cryptograph(y|ic)|cryptopals|aes|rsa|elliptic curve)\b/i, subject: 'Crypto', label: 'cryptography' },
  { re: /\b(lecture|course|coursera|udemy|edx|khan academy|homework|assignment|exam|quiz|seminar|syllabus|textbook|chapter \d+)\b/i, subject: 'Study', label: 'study' }
]

/** Words that make a page a to-do: a deadline, a due date, an ask. */
const TASKY = /\b(due (date|on|by)?|deadline|submit (by|before)|reply by|rsvp|action items?|to-?do|register by|apply by|pay by|expires? on)\b/i

/** The subject a window is about: your goal words first, then the topics above. */
export function topicOf(title: string, text: string, goals: string[] = []): { subject: string; label: string } | null {
  const hay = `${title} ${text}`
  const low = hay.toLowerCase()
  const goal = goals.map((g) => g.trim()).filter((g) => g.length >= 3).find((g) => low.includes(g.toLowerCase()))
  if (goal) return { subject: goal.slice(0, 40), label: goal.slice(0, 40) }
  for (const t of TOPICS) if (t.re.test(hay)) return { subject: t.subject, label: t.label }
  return null
}

/** The one line for the log, the island and Ben: "“Two Sum - LeetCode” in Chrome", or the text when there is no title. */
export function seenLine(o: { app: string; title: string; text: string; kind: EyeKind }): string {
  const app = o.app.trim()
  if (o.kind === 'caption') return summarize(o.text || o.title)
  const title = o.title.trim()
  // A title that is only the app's name says nothing: use the text then.
  const useful = title && title.toLowerCase() !== app.toLowerCase() ? title : ''
  const core = useful ? `“${summarize(useful, 80)}”` : summarize(o.text, 90)
  if (!core) return ''
  return summarize(app ? `${core} in ${app}` : core, SUMMARY_MAX)
}

/** At most one offer for what's in front (never while a timer runs for focus offers). */
export function eyesHint(o: { title: string; text: string; running: boolean; goals?: string[] }): EyesHint | null {
  const topic = topicOf(o.title, o.text, o.goals)
  if (topic && !o.running) return { kind: 'focus', subject: topic.subject, text: `Looks like ${topic.label}. Start a focus block for it?` }
  if (TASKY.test(`${o.title} ${o.text}`)) {
    const task = summarize(o.title || o.text, 80)
    if (task) return { kind: 'task', task, text: 'There is a date on this. Save it as a task?' }
  }
  return null
}

/** What Ben is told, when you share it (the line is already short and checked). */
export function benNowLine(seen: { at: number; line: string } | null | undefined, now: number, maxAgeMin = 10): string {
  if (!seen || typeof seen.line !== 'string' || !seen.line.trim() || !Number.isFinite(seen.at)) return ''
  if (now - seen.at > maxAgeMin * 60_000 || seen.at - now > 60_000) return ''
  const mins = Math.max(0, Math.round((now - seen.at) / 60_000))
  return `Right now on his PC (island eyes, ${mins ? `${mins} min ago` : 'just now'}): ${summarize(seen.line)}. Use it only if it helps; never quote it back word for word.`
}

/** "now: reading “X” in Chrome" (what the island and Settings show). */
export const nowText = (line: string) => (line ? `now: reading ${line}` : '')
