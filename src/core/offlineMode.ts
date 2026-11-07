// QA3: basic mode (pure, tested). When the network or the AI is down, or the
// month's AI budget is used up, the Coach page still does the simple things at
// once, without the AI: log water / reps / money, mark a must-do done, start a
// focus timer, add a task (queued until Todoist can be reached). Anything else
// waits in a small queue and goes to Ben when he's back. Nothing is faked: a
// queued message is shown as queued.

export type BasicReason = 'offline' | 'ai-down' | 'budget'

export type BasicCmd =
  | { k: 'focus'; subject: string; minutes: number }
  | { k: 'stop' }
  | { k: 'done'; what: string }
  | { k: 'task'; text: string }
  /** Something the bots' own rules may know ("water 500", "20 pushups", "spent 45 on lunch"). */
  | { k: 'quick'; text: string }

/** What a message means in basic mode. Always returns something: 'quick' is tried, then queued. */
export function readBasic(text: string): BasicCmd {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ')
  const focus = /^(?:start (?:a |the )?)?(?:focus|deep work|pomodoro)(?: (?:block|timer|session))?(?: (?:for )?(\d{1,3}) ?(?:min(?:utes?)?|m)?)?(?: (?:on|for) (.+?))?$/i.exec(t) ?? /^(?:start )?(?:focus) (\d{1,3}) (.+)$/i.exec(t)
  if (focus && /focus|deep|pomodoro/i.test(t)) {
    const minutes = Math.min(180, Math.max(5, Number(focus[1]) || 25))
    return { k: 'focus', subject: (focus[2] ?? '').trim().slice(0, 60) || 'Focus', minutes }
  }
  if (/^(?:stop|end|finish) (?:the )?(?:focus|timer)$/i.test(t)) return { k: 'stop' }
  const task = /^(?:add (?:a )?(?:task|todo)|new task|todo|task|remind me to)\s*:?\s+(.+)$/i.exec(t)
  if (task) return { k: 'task', text: task[1].trim().slice(0, 200) }
  const done = /^(?:done|did|finished|completed|i did|i finished)\s*:?\s+(.+)$/i.exec(t)
  if (done && !/^\d/.test(done[1])) return { k: 'done', what: done[1].trim().slice(0, 120) }
  return { k: 'quick', text: t }
}

/** The must-do a "done X" means (words in common), or -1. */
export function matchMustDo(items: { text: string; done: boolean }[], what: string): number {
  const w = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(' ').filter((x) => x.length > 2)
  const want = w(what)
  if (!want.length) return -1
  let best = -1
  let bestScore = 0
  items.forEach((it, i) => {
    if (it.done) return
    const have = new Set(w(it.text))
    const score = want.filter((x) => have.has(x) || [...have].some((h) => h.startsWith(x) || x.startsWith(h))).length / want.length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return bestScore >= 0.5 ? best : -1
}

export interface Queued {
  text: string
  at: string
  /** 'task': goes to Todoist; 'ben': goes to Ben as a message. */
  to: 'task' | 'ben'
}

export const QUEUE_MAX = 20

/** Adds to the queue (the same text twice in 10 minutes is kept once). */
export function enqueue(list: Queued[], item: { text: string; to: Queued['to'] }, now = new Date()): Queued[] {
  const clean = (Array.isArray(list) ? list : []).filter((q) => q && typeof q.text === 'string')
  const dup = clean.find((q) => q.text === item.text && q.to === item.to && now.getTime() - Date.parse(q.at) < 10 * 60_000)
  if (dup) return clean
  return [...clean, { text: item.text.slice(0, 2000), to: item.to, at: now.toISOString() }].slice(-QUEUE_MAX)
}

/** Queued things older than 3 days are dropped (too late to matter). */
export function freshQueue(list: Queued[], now = new Date()): Queued[] {
  return (Array.isArray(list) ? list : []).filter((q) => q && now.getTime() - Date.parse(q.at) < 3 * 86400_000)
}

export function basicLabel(r: BasicReason): string {
  return r === 'offline' ? 'Offline — basic mode' : r === 'budget' ? 'AI budget reached — basic mode' : "Ben's AI is down — basic mode"
}

export function basicHint(r: BasicReason): string {
  return r === 'budget'
    ? 'Logs, done, focus and tasks still work. Other questions wait for next month, or ask the AI anyway.'
    : 'Logs, done, focus and tasks still work right away. Other messages wait and go to Ben when he is back.'
}

/** Which reason applies now (offline beats the rest). */
export function basicReason(s: { online: boolean; aiDownUntil?: number; budgetUsedUp?: boolean; override?: boolean }, now = Date.now()): BasicReason | null {
  if (!s.online) return 'offline'
  if (s.aiDownUntil && s.aiDownUntil > now) return 'ai-down'
  if (s.budgetUsedUp && !s.override) return 'budget'
  return null
}
