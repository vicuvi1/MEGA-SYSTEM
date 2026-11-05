// Island eyes, the app window's side (desktop only). The desktop's main
// process does the looking and the checking (eyesGuard); here:
// - the last short line it kept becomes at most one island suggestion
//   ("Looks like interview prep. Start a focus block for it?");
// - if you share it, that line goes to Ben's day log (at most every 2 min);
// - EY3: the caption worker runs here, loads the downloaded model only when
//   a caption is asked for, and stops after 2 idle minutes (memory back).
import type { EyesSeen } from '@core/eyesSense'
import type { EyesPrefs } from '@core/eyesGuard'
import type { Suggestion } from '@core/suggest'
import type { EyesCaptionJob } from '../../shared/eyes'
import { onEyesState } from './eyesState'
import { calendarDay } from '@core/dates'
import { life } from './bridge'

let started = false
let prefs: EyesPrefs | null = null
let last: EyesSeen | null = null
let sharedAt = 0
let sharedLine = ''

/** A suggestion only for a fresh look (3 min). */
const FRESH_MS = 3 * 60_000
/** The worker stops after this long without a caption. */
const IDLE_MS = 2 * 60_000
const SHARE_EVERY_MS = 2 * 60_000

export function startEyes(onChange: () => void) {
  const eyes = window.desktop?.eyes
  if (started || !eyes) return
  started = true
  void eyes.get().then((i) => {
    if (i) prefs = i.prefs
  }, () => {})
  onEyesState((s) => {
    const was = prefs?.shareBen
    prefs = s.prefs
    if (!s.prefs.on || s.prefs.pausedUntil > Date.now()) last = null
    // Sharing turned off: Ben's line is cleared.
    if (was && !s.prefs.shareBen) void share('', Date.now(), true)
  })
  eyes.onSeen((seen) => {
    if (!seen || typeof seen.summary !== 'string') return
    last = seen
    if (prefs?.shareBen) void share(seen.summary, seen.at)
    if (seen.hint) onChange()
  })
  eyes.onCaptionJob((job) => void runCaption(job))
  eyes.onCaptionUnload(() => stopWorker())
}

async function share(line: string, at: number, force = false) {
  const now = Date.now()
  if (!force && (line === sharedLine || now - sharedAt < SHARE_EVERY_MS)) return
  sharedAt = now
  sharedLine = line
  await life.dayLog?.setEyes?.(calendarDay(new Date(now)), line, at).catch(() => {})
}

/** At most one offer from what the eyes read (the Smart island's queue decides when it shows). */
export function eyesSuggestion(m: { now: number; running: boolean }): Suggestion | null {
  if (!prefs?.on || !prefs.suggest || !last?.hint || m.now - last.at > FRESH_MS) return null
  const h = last.hint
  const hour = new Date(m.now).getHours()
  if (h.kind === 'focus') {
    if (m.running) return null
    return {
      id: `eyes:focus:${h.subject.toLowerCase()}:${new Date(m.now).toDateString()}:${hour}`,
      sk: 'eyes',
      title: `Start 25 min · ${h.subject}?`,
      text: h.text,
      face: '👀',
      accept: { label: '▶ 25 min', action: { kind: 'start', subject: h.subject, minutes: 25 } },
      laterMin: 30
    }
  }
  return {
    id: `eyes:task:${h.task.toLowerCase()}`,
    sk: 'eyes',
    title: 'Save this as a task?',
    text: `${h.text} “${h.task}”`,
    face: '📝',
    accept: { label: '+ Task', action: { kind: 'safe', acts: [{ do: 'task', text: h.task }], why: 'Island eyes' } },
    laterMin: 60
  }
}

// ---- EY3: the caption worker ----
let worker: Worker | null = null
let idle: number | null = null
const waiting = new Map<string, (r: { ok: boolean; text?: string; error?: string }) => void>()

function stopWorker() {
  if (idle) clearTimeout(idle)
  idle = null
  worker?.terminate()
  worker = null
  for (const [id, done] of waiting) {
    done({ ok: false, error: 'Stopped' })
    waiting.delete(id)
  }
}

async function runCaption(job: EyesCaptionJob) {
  const eyes = window.desktop?.eyes
  if (!eyes) return
  if (idle) clearTimeout(idle)
  idle = null
  try {
    if (!worker) {
      worker = new Worker('/eyes/caption-worker.js', { type: 'module' })
      worker.onmessage = (e) => {
        const r = e.data ?? {}
        waiting.get(String(r.id))?.({ ok: !!r.ok, text: r.text, error: r.error })
      }
      worker.onerror = () => stopWorker()
    }
    const w = worker
    const r = await new Promise<{ ok: boolean; text?: string; error?: string }>((done) => {
      waiting.set(job.id, (x) => (waiting.delete(job.id), done(x)))
      // The picture is handed over (not copied) and is gone from here.
      const rgb = job.rgb instanceof Uint8Array ? job.rgb : new Uint8Array(job.rgb as ArrayLike<number>)
      w.postMessage({ id: job.id, w: job.w, h: job.h, rgb }, [rgb.buffer])
    })
    eyes.captionDone(job.id, r)
  } catch (err) {
    eyes.captionDone(job.id, { ok: false, error: (err as Error)?.message || 'The caption failed' })
  } finally {
    if (idle) clearTimeout(idle)
    idle = window.setTimeout(stopWorker, IDLE_MS)
  }
}
