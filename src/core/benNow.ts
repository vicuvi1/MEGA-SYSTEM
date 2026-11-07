// "now I am going to clean up the room": he is starting something NOW (pure, tested).
//
// Before, Ben re-described the plan ("Room's on the plan at 13:45–14:30…") and
// did nothing. Now the message is read in code and Ben offers to start it now:
// a ▶ timer button for it (the plan block's length, or 25 min) and a "Later" chip.
// If it is a block later in the plan, he says it moves up to now; if a timer is
// already running, he offers to switch. A time word ("tomorrow", "at 18") makes
// it a promise instead (benPromise.ts), so it is not read here.

import { similarity } from './benNormalize'

const LEAD =
  /^(?:ok(?:ay)?[,.]?\s+|so\s+|right\s+|alright[,.]?\s+)?(?:now\s+|right now\s+)?(?:i\s*(?:'m| am)\s+(?:now\s+)?(?:going to|gonna|about to|starting(?: to)?|off to|heading to)|i\s*(?:'ll| will)\s+(?:go\s+)?(?:do|start)|let me|time to|starting(?: to)?|going to|gonna|about to)\s+(.+)$/i
const TAIL = /\s*(?:now|right now|at once|first|then|for a bit|for a while)?[.!…]*$/i
const NOW_WORD = /\b(now|right now|at once|about to|starting|let me|time to|off to|heading to)\b/i
/** Not a "start now": a later time (a promise), a question, sleep and meals (their own flows). */
const NOT = /\?|\b(tomorrow|tonight|later|this evening|at \d|in \d+|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next week|sleep|bed|nap|eat|lunch|dinner|breakfast|shower|stop|quit|cancel|skip|not|don'?t|never)\b/i

/** What he is starting now ("clean up the room"), or null. */
export function readStartingNow(text: string): string | null {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ')
  if (!t || t.length > 90 || NOT.test(t)) return null
  const m = LEAD.exec(t)
  if (!m) return null
  // "going to clean the room" with no "now" in it could be later: only with a now-word
  // ("now I'm going to…", "I'm about to…", "starting…", "let me…", "time to…").
  if (!NOW_WORD.test(t)) return null
  const what = m[1].replace(TAIL, '').replace(/^(?:do|work on|start(?: on)?)\s+/i, '').trim()
  if (!what || what.split(' ').length > 8 || /^(it|this|that|do it|work|go)$/i.test(what)) return null
  return what
}

export interface StartBlock {
  title: string
  start: string
  minutes: number
  tasks?: string[]
}

/** The plan block he means, when one clearly fits. */
export function blockFor(what: string, blocks: StartBlock[]): StartBlock | null {
  let best: { b: StartBlock; s: number } | null = null
  for (const b of blocks) {
    const names = [b.title, ...(b.tasks ?? [])]
    const s = Math.max(...names.map((n) => Math.max(similarity(what, n), similarity(n, what))))
    if (s >= 0.7 && (!best || s > best.s)) best = { b, s }
  }
  return best?.b ?? null
}

const pad = (n: number) => String(n).padStart(2, '0')
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const fromMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

export interface StartNowReply {
  reply: string
  chips: string[]
  buttons: { label: string; do: string }[]
}

/**
 * The reply: "Go." plus a ▶ button for a timer now and a "Later" chip. Only real facts:
 * the block's own times when it is in the plan, the timer that is really running.
 */
export function startNowReply(what: string, o: { block: StartBlock | null; running: { subject: string; leftMin: number } | null; now: Date; estimate?: number | null }): StartNowReply {
  const nowMin = o.now.getHours() * 60 + o.now.getMinutes()
  const b = o.block
  const minutes = Math.max(10, Math.min(90, b?.minutes || o.estimate || 25))
  const subject = (b?.title ?? what).replace(/\(.*?\)/g, '').replace(/^(the|my|a|an)\s+/i, '').trim()
  const label = subject.charAt(0).toUpperCase() + subject.slice(1)
  const short = label.slice(0, 28)
  const start = { label: `▶ Start ${minutes} min ${short}`.slice(0, 32), do: `focus:${minutes}:${short}` }
  if (o.running) {
    return {
      reply: `You have "${o.running.subject}" running (${o.running.leftMin} min left).\nSwitch to ${what} now? I'll stop that timer and start ${minutes} min for this.`,
      chips: ['Later', 'Finish the timer first'],
      buttons: [{ label: '⏹ Stop timer', do: 'say:stop' }, start]
    }
  }
  let where = ''
  if (b) {
    const s = toMin(b.start)
    const e = s + b.minutes
    where = s > nowMin + 5 ? `\nIt was on your plan for ${b.start}–${fromMin(e)}, so it moves up to now.` : s <= nowMin && e > nowMin ? `\nIt's on your plan for now anyway (until ${fromMin(e)}).` : ''
  }
  return { reply: `Good, ${what} now.${where}\nStart a ${minutes}-min timer so it counts?`, chips: ['Later'], buttons: [start] }
}

/** "I finished the lab report", "done with algebra", "lab report done": what he finished, or null. */
export function readFinished(text: string): string | null {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '')
  if (!t || t.length > 80 || /\?|\b(not|almost|nearly|half|tomorrow|later)\b/i.test(t)) return null
  const m = /^(?:ok(?:ay)?[,.]?\s+|so\s+)?(?:i(?:'ve| have)?\s+)?(?:just\s+)?(?:finished|completed|wrapped up|done with|am done with|'m done with)\s+(.+)$/i.exec(t) ?? /^(?:i'?m |i am )(?:done|finished) with (.+)$/i.exec(t) ?? /^(.+?) (?:is )?(?:done|finished)$/i.exec(t)
  const what = m?.[1]?.trim()
  if (!what || what.split(' ').length > 6 || /^(i|it'?s|that'?s|all|everything)$/i.test(what)) return null
  return what
}

/** Does what he finished mean the running timer ("the session", "it", or its subject)? */
export function meansTimer(what: string, subject: string): boolean {
  if (/^(it|this|that|the (session|timer|focus|block)|my (session|focus|block)|focus)$/i.test(what.trim())) return true
  return Math.max(similarity(what, subject), similarity(subject, what)) >= 0.7
}
