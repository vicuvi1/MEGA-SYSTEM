// Voice commands without the AI (JV6, pure, tested). What you say is made
// tidy (voiceText.ts), turned into the command bar's own words ("start focus
// 25 on algebra" → "focus 25 algebra") and run through the command bar's rules
// (islandCommands.ts commandPreview): the same taps as the island's buttons,
// instantly, offline. A few things only make sense spoken (what's next, the
// music, "never mind"). Everything else goes to Ben.
//
// Points stay honest: only what you say you did is logged, through the same
// rules as typing it (water you drank, reps you did, bed/wake times, a task
// to add). Nothing is guessed; a nap has no log of its own, so Ben hears it.
import type { IslandAction, IslandPrefs, IslandSnapshot } from './islandModel'
import { commandPreview, type PreviewCtx } from './islandCommands'
import { tidySpeech } from './voiceText'

export type MediaKey = 'playpause' | 'next' | 'prev' | 'mute' | 'volup' | 'voldown'
export type AnswerTopic = 'next' | 'now' | 'water' | 'time' | 'focus'

export type VoiceCommand =
  /** A tap, through the island (the same path as its buttons and command bar). */
  | { kind: 'action'; action: IslandAction; say: string }
  /** Said back from what the island already knows. */
  | { kind: 'answer'; topic: AnswerTopic }
  /** A media key on this PC (the music or video playing). */
  | { kind: 'media'; key: MediaKey; say: string }
  /** The island goes quiet for a while (null: wake it now). */
  | { kind: 'quiet'; minutes: number | null; say: string }
  /** Something the island can't do right now, said kindly. */
  | { kind: 'say'; text: string }
  /** "Never mind": stop talking and listening. */
  | { kind: 'cancel' }
  /** Everything else: Ben. */
  | { kind: 'ben'; text: string }

export interface VoiceCtx {
  snap: IslandSnapshot
  chips: IslandPrefs['chips']
  now: number
}

/** The command bar's results a voice line may run by itself (never "tick a Todoist task" from a loose match). */
const SAFE = /^(?:remind:|water:|pause$|resume$|stop$|next$|extend:|focus:|bed:|wake:|join$|reps:|sport$|money:|task$)/

const PAGES: Record<string, string> = {
  today: 'today', home: 'today', calendar: 'calendar', schedule: 'calendar', tasks: 'tasks', todoist: 'tasks', coach: 'coach', chat: 'coach', ben: 'coach',
  focus: 'focus', sleep: 'sleep', money: 'money', finance: 'money', body: 'body', sport: 'body', workout: 'body', rewards: 'rewards', shop: 'rewards',
  notebook: 'notebook', notes: 'notebook', settings: 'settings', goals: 'goals', progress: 'progress', discipline: 'discipline'
}

const EXERCISE = /(push ?-?ups?|press ?-?ups?|squats?|sit ?-?ups?|pull ?-?ups?|chin ?-?ups?|burpees?|crunch(?:es)?|lunges?|dips?|jumping jacks?|planks?)/

/** What a spoken line means. */
export function parseVoiceCommand(raw: string, c: VoiceCtx): VoiceCommand {
  const original = raw.trim().replace(/\s+/g, ' ')
  const t = tidySpeech(original)
  if (!t) return { kind: 'cancel' }
  const ben = (): VoiceCommand => ({ kind: 'ben', text: original })
  const run = c.snap.running
  // ---- only spoken ----
  if (/^(?:cancel|never ?mind|nevermind|forget it|stop talking|shut up|be quiet|silence|that's all|that is all|nothing|no thanks|stop|stop it|thanks|thank you|ok thanks)$/.test(t)) return { kind: 'cancel' }
  const media = mediaKey(t)
  if (media) return media
  const quiet = /^(?:be )?(?:quiet|silent|do not disturb|don't disturb me|dnd)(?: mode)?(?: for)? (\d{1,3}) min$/.exec(t) ?? (/^(?:be )?(?:quiet|silent|do not disturb|don't disturb me)(?: mode)?(?: for (?:a while|now))?$/.test(t) ? ['', '60'] : null)
  if (quiet) {
    const m = Math.max(5, Math.min(480, Number(quiet[1]) || 60))
    return { kind: 'quiet', minutes: m, say: `Quiet for ${m} minutes.` }
  }
  if (/^(?:wake up|you can talk again|stop being quiet|quiet off)$/.test(t)) return { kind: 'quiet', minutes: null, say: "I'm back." }
  const answer = answerTopic(t)
  if (answer) return { kind: 'answer', topic: answer }
  const open = /^(?:open|show(?: me)?|go to|take me to)(?: the| my)? ([a-z]+)(?: page| tab| screen)?$/.exec(t)
  if (open && PAGES[open[1]]) return { kind: 'action', action: { kind: 'open', page: PAGES[open[1]] }, say: `Opening ${open[1]}.` }
  // A nap has no log of its own: Ben hears it (he notes it; no points).
  const nap = /^(?:log |add |i (?:took|had) )?(?:a )?(\d{1,3}) min nap$|^(?:log |add )?(?:a )?nap(?: of| for)? (\d{1,3}) min$|^i napped(?: for)? (\d{1,3}) min$/.exec(t)
  if (nap) return { kind: 'ben', text: `I took a ${Number(nap[1] ?? nap[2] ?? nap[3])} minute nap.` }
  // A must-do you say you finished: only one that clearly matches, and not done yet.
  const did = /^(?:i )?(?:did|finished|completed|done with|tick off|check off|mark done|done) (?:the |my )?(.{3,80})$/.exec(t)
  if (did && !EXERCISE.test(did[1])) {
    const m = matchMustdo(did[1], c.snap.mustdos)
    if (m) return { kind: 'action', action: { kind: 'mustdo', i: m.i }, say: `Ticked: ${m.text}.` }
  }
  // ---- the command bar's own rules ----
  const line = toCommandLine(t, run != null)
  if (line == null) return ben()
  const ctx: PreviewCtx = { now: c.now, running: run, tasks: [], meet: c.snap.now?.meet ?? c.snap.next?.meet ?? null, chips: c.chips, reps: c.snap.reps, subject: c.snap.now && !c.snap.now.call ? c.snap.now.title : 'Focus' }
  const first = commandPreview(line.text, ctx).find((x) => x.id !== 'ben')
  if (!first || !SAFE.test(first.id)) {
    // The words were a timer command, but there's no timer (or one is running already).
    if (line.intent === 'timer' || (line.intent === 'focus' && run)) return { kind: 'say', text: run ? 'Your timer is already running.' : 'No timer is running.' }
    return ben()
  }
  if (line.intent === 'focus' && run) return { kind: 'say', text: `A timer is already running: ${run.subject}.` }
  return { kind: 'action', action: first.action, say: sayFor(first.action, first.label) }
}

/** The command bar's words for a spoken line, or null when it isn't a command. */
export function toCommandLine(t: string, running: boolean): { text: string; intent: 'focus' | 'timer' | 'log' } | null {
  // Focus: "start focus 25 on algebra", "start a 50 min timer", "focus on algebra for 25 min", "pomodoro".
  const subjectOf = (s: string | undefined) => (s ?? '').replace(/^(?:on|for|about) /, '').replace(/ (?:session|block)$/, '').trim()
  let m = /^(?:start|begin|do|run|set)?(?: a| an| my)? ?(\d{1,3}) min (?:focus|timer|session|block|pomodoro|deep work)(?: (?:on|for) (.{2,40}))?$/.exec(t)
  if (m) return { text: `focus ${m[1]}${m[2] ? ` ${subjectOf(m[2])}` : ''}`, intent: 'focus' }
  m = /^(?:start|begin|do|run|set)?(?: a| an| my| the)? ?(?:focus|timer|pomodoro|deep work)(?: session| block)?(?: (?:for )?(\d{1,3})(?: min)?)?(?: (?:on|for|about) (.{2,40}?))?(?: (?:for )?(\d{1,3}) min)?$/.exec(t)
  if (m && (/^(?:start|begin|do|run|set)\b/.test(t) || /^(?:focus|pomodoro|deep work)/.test(t))) {
    const n = m[1] ?? m[3]
    const subject = subjectOf(m[2])
    return { text: `focus${n ? ` ${n}` : ''}${subject ? ` ${subject}` : ''}`, intent: 'focus' }
  }
  // The running timer.
  if (/^(?:stop|end|finish|done with|i'm done with|close)(?: the| my)? (?:focus|timer|session|block|pomodoro)$|^(?:i'm|i am) done$|^done$|^finished$/.test(t)) return { text: 'stop', intent: 'timer' }
  if (/^(?:pause|hold)(?: the| my)?(?: focus| timer| session)?$/.test(t)) return { text: 'pause', intent: 'timer' }
  if (/^(?:resume|continue|go on|unpause)(?: the| my)?(?: focus| timer| session)?$/.test(t)) return { text: 'resume', intent: 'timer' }
  if (/^(?:skip|end) the break$|^next block$|^start the next(?: block)?$/.test(t)) return { text: 'next', intent: 'timer' }
  m = /^(?:add|give me|extend(?: it| the timer| focus)?(?: by)?) (\d{1,3})(?: more)? min(?: more)?$|^(\d{1,3}) more min$/.exec(t)
  if (m) return running ? { text: `+${m[1] ?? m[2]}`, intent: 'timer' } : { text: '+0', intent: 'timer' }
  // Water: "add water", "log 500 ml of water", "I drank 2 glasses of water".
  if (/\bwater\b/.test(t) && /^(?:add|log|drank|drink|had|i drank|i had|i've had|plus|water)\b/.test(t)) {
    const ml = /(\d{2,4}) ?ml\b/.exec(t)?.[1]
    const glasses = /(\d{1,2}) (?:glass|glasses|cups?|bottles?)\b/.exec(t)?.[1]
    return { text: ml ? `water ${ml}` : glasses ? `${glasses} glasses water` : 'water', intent: 'log' }
  }
  // Sleep: "going to bed", "going to bed at 23:40", "I'm up", "woke up at 7".
  m = /^(?:i'm |i am )?(?:going to bed|going to sleep|off to bed|good night|goodnight|bedtime)(?: at (\d{1,2}(?::\d{2})?))?$/.exec(t)
  if (m) return { text: m[1] ? `going to bed ${m[1]}` : 'bed', intent: 'log' }
  m = /^(?:i (?:woke up|got up)|woke up|i'm up|i am up|i'm awake|i am awake|good morning)(?: at (\d{1,2}(?::\d{2})?))?$/.exec(t)
  if (m) return { text: m[1] ? `woke up ${m[1]}` : "i'm up", intent: 'log' }
  // Reps you did: "I did 30 pushups", "log 20 squats".
  m = new RegExp(`^(?:i )?(?:did|done|log|add|just did)? ?(\\d{1,4}) ${EXERCISE.source}$`).exec(t)
  if (m) return { text: `${m[1]} ${m[2].replace(/[ -]/g, '')}`, intent: 'log' }
  // Money: "I spent 40 lei on a taxi", "paid 120 for groceries".
  m = /^(?:i )?(?:spent|paid|bought .{2,30} for) (\d{1,6}(?:[.,]\d{1,2})?)(?: lei| mdl| dollars?| euros?)?(?: on| for)? (?:a |an |the )?(.{2,40})$/.exec(t)
  if (m) return { text: `spent ${m[1]} ${m[2]}`, intent: 'log' }
  // HD: a reminder with a time: "remind me to call mom at 18:00", "remind me in 20 min to stretch".
  m = /^remind me (?:to .{2,100} (?:at \d{1,2}(?::\d{2})?(?: ?[ap]m)?|in \d{1,3} (?:min|minutes|hours?))|(?:at \d{1,2}(?::\d{2})?(?: ?[ap]m)?|in \d{1,3} (?:min|minutes|hours?)) to .{2,100})$/.exec(t)
  if (m) return { text: t, intent: 'log' }
  // A task: "add task call mom tomorrow", "remind me to call mom friday".
  m = /^(?:add|create|new|make)(?: a| an)? (?:task|todo|to-do|to do|reminder)(?: to)?:? (.{2,120})$|^remind me to (.{2,120})$/.exec(t)
  if (m) return { text: `task ${m[1] ?? m[2]}`, intent: 'log' }
  return null
}

function mediaKey(t: string): VoiceCommand | null {
  if (/^(?:pause|stop|play|resume|continue|start)(?: the)? (?:music|song|spotify|video|playback|track|podcast|youtube)$|^(?:pause|play) it$/.test(t)) return { kind: 'media', key: 'playpause', say: '' }
  if (/^(?:next|skip)(?: the| this)? (?:song|track|video)$/.test(t)) return { kind: 'media', key: 'next', say: '' }
  if (/^(?:previous|last|go back)(?: the)?(?: song| track| video)$/.test(t)) return { kind: 'media', key: 'prev', say: '' }
  if (/^(?:mute|unmute)(?: the)?(?: sound| volume| pc| computer| music)?$/.test(t)) return { kind: 'media', key: 'mute', say: '' }
  if (/^(?:volume up|turn (?:it|the volume|the music) up|louder)$/.test(t)) return { kind: 'media', key: 'volup', say: '' }
  if (/^(?:volume down|turn (?:it|the volume|the music) down|quieter|softer)$/.test(t)) return { kind: 'media', key: 'voldown', say: '' }
  return null
}

function answerTopic(t: string): AnswerTopic | null {
  if (/^(?:what's|what is|whats|what do i have|what have i got|what's on)(?: up)? next(?: today)?$|^what's my next (?:thing|block|event|meeting|class)$|^what(?:'s| is) after this$/.test(t)) return 'next'
  if (/^(?:what (?:should|do) i do|what am i doing|what's on|what is on|what's happening)(?: today)?$|^what(?:'s| is) the plan$/.test(t)) return 'now'
  if (/^how much water(?: (?:have i had|did i drink|today))?$|^(?:my )?water(?: today)?$/.test(t)) return 'water'
  if (/^what time is it$|^what's the time$|^the time$/.test(t)) return 'time'
  if (/^how (?:much time|long)(?: is)? (?:left|to go)$|^how many min(?:utes)? left$|^time left$/.test(t)) return 'focus'
  return null
}

const STOP = new Set(['the', 'a', 'an', 'my', 'to', 'of', 'and', 'for', 'on', 'in', 'with', 'at'])
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))

/** The one must-do you mean (most of its words said, not done yet), or null when unsure. */
export function matchMustdo(said: string, list: IslandSnapshot['mustdos']): { i: number; text: string } | null {
  const heard = new Set(words(said))
  if (!heard.size) return null
  const scored = list
    .filter((m) => !m.done)
    .map((m) => {
      const w = words(m.text)
      const hit = w.filter((x) => heard.has(x) || [...heard].some((h) => h.length >= 4 && (x.startsWith(h) || h.startsWith(x)))).length
      return { m, score: w.length ? hit / w.length : 0, hit }
    })
    .filter((x) => x.hit > 0 && x.score >= 0.6)
    .sort((a, b) => b.score - a.score)
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null
  return { i: scored[0].m.i, text: scored[0].m.text }
}

function sayFor(a: IslandAction, label: string): string {
  switch (a.kind) {
    case 'water':
      return `${a.ml} millilitres logged.`
    case 'start':
      return `Focus, ${a.minutes} minutes${a.subject && a.subject !== 'Focus' ? `, on ${a.subject}` : ''}. Go.`
    case 'stop':
      return 'Stopped and logged.'
    case 'pause':
      return 'Paused.'
    case 'resume':
      return 'Going on.'
    case 'extend':
      return `${a.minutes} more minutes.`
    case 'bed':
      return a.time ? `Bed at ${a.time}, logged. Good night.` : 'Good night. Logged.'
    case 'wake':
      return a.time ? `Up at ${a.time}, logged.` : 'Good morning. Logged.'
    case 'join':
      return 'Joining the call.'
    default:
      return `${label.replace(/^[^\w]+/, '')}.`
  }
}

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The spoken answer from what the island knows (no AI, no network). */
export function voiceAnswer(topic: AnswerTopic, s: IslandSnapshot, now: number): string {
  const r = s.running
  const left = r ? Math.max(0, Math.round(((r.pausedAt ?? now) < r.endsAt ? r.endsAt - (r.pausedAt ?? now) : 0) / 60_000)) : 0
  switch (topic) {
    case 'next': {
      const b = s.next
      if (!b) return 'Nothing else in your calendar today.'
      const inMin = Math.round((b.start - now) / 60_000)
      return `Next: ${b.title}, at ${hhmm(b.start)}${inMin > 0 && inMin <= 90 ? `, in ${inMin} minutes` : ''}.`
    }
    case 'now':
      if (r) return r.brk ? `A break, ${left} minutes left.` : `Focus on ${r.subject}, ${left} minutes left.`
      if (s.now) return `Now: ${s.now.title}, until ${hhmm(s.now.end)}.`
      if (s.ben.move) return `${s.ben.move.title}.`
      return s.next ? voiceAnswer('next', s, now) : 'Nothing planned right now.'
    case 'water':
      return s.water.target ? `${s.water.ml} of ${s.water.target} millilitres today.` : `${s.water.ml} millilitres today.`
    case 'time':
      return `It's ${hhmm(now)}.`
    case 'focus':
      return r ? `${left} minutes left${r.brk ? ' of your break' : ` on ${r.subject}`}.` : 'No timer is running.'
  }
}
