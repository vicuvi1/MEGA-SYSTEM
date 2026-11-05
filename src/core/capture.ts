// One capture box: what a typed line means, the same everywhere (Today's
// "Type anything", the Ctrl+Space bar, Ctrl+K when nothing matches, the
// island). The cheap parts are decided here; money, water, reps, sleep go
// to the bot's rules next (free, instant), and only the rest goes to Ben.
export type Captured =
  | { kind: 'focus'; subject: string; minutes: number }
  | { kind: 'task'; text: string }
  | { kind: 'clean' }
  | { kind: 'oath' }
  | { kind: 'free'; text: string }

/** "focus 50 algebra", "f algebra 25", "task call mom tomorrow p1", "clean", "oath", anything else. */
export function parseCapture(raw: string): Captured | null {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (!t) return null
  const fm = /^(?:focus|f)\s+(.{2,80})$/i.exec(t)
  const num = fm ? /(?:^|\s)(\d{1,3})\s*(?:min|m)?(?=\s|$)/i.exec(fm[1]) : null
  const subject = fm && num ? fm[1].replace(num[0], ' ').replace(/\s+/g, ' ').trim() : ''
  if (fm && num && subject) return { kind: 'focus', subject, minutes: Math.max(5, Math.min(180, Number(num[1]) || 50)) }
  const task = /^(?:task|todo|quest|add)\s*:?\s+(.{2,})$/i.exec(t)
  if (task) return { kind: 'task', text: task[1].trim() }
  if (/^(?:clean|check ?in|clean day)$/i.test(t)) return { kind: 'clean' }
  if (/^oath$/i.test(t)) return { kind: 'oath' }
  return { kind: 'free', text: t }
}
