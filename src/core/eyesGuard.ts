// Island eyes (EY6): the one gate every eye read goes through. The eyes are
// the desktop app reading the window in front (EY1, Windows UI Automation),
// reading the screen's text (EY2, Windows OCR) and a one-line caption of the
// window (EY3, a small local model). Before any of them looks, this decides:
//
// - everything is OFF until you turn it on (each eye has its own switch);
// - a big Pause (15 min, 1 hour, until tomorrow, until you resume);
// - a private list: banking, password managers, private chats, incognito /
//   InPrivate windows, Windows Security and anything with pass|bank|login|
//   2fa|wallet in the app or the title is never read (you can edit the list);
// - a rate limit (one read per 20 s, one caption per 5 min, by themselves);
// - only a short summary (120 characters at most) is ever kept; no image is
//   stored or sent anywhere; sensitive-looking text (passwords, card numbers,
//   codes) is dropped, not summarized;
// - a log of the last 50 things the eyes saw (Settings → Island eyes).
//
// Pure and tested (eyesGuard.test.ts); the desktop runs it in its main process.

export type EyeKind = 'read' | 'ocr' | 'caption'

export const EYE_LABEL: Record<EyeKind, string> = { read: 'Window text', ocr: 'Screen text', caption: 'Caption' }

/** Paused "until I resume". */
export const PAUSE_FOREVER = Number.MAX_SAFE_INTEGER

export interface EyesPrefs {
  /** The master switch. Off: no eye looks, whatever the others say. */
  on: boolean
  /** EY1: read the window in front's text when it changes. */
  read: boolean
  /** EY2: when a window gives little text, read its screen text once (Windows OCR). The button works without it. */
  ocrAuto: boolean
  /** EY3: captions (needs the downloaded model). */
  caption: boolean
  /** EY3: a caption every few minutes by itself (else only when you ask). */
  captionAuto: boolean
  /** Minutes between captions by themselves (5 at least). */
  captionEveryMin: number
  /** Island suggestions from what the eyes read ("Start a focus block for it?"). */
  suggest: boolean
  /** Tell Ben what's in front, as one short line ("now: reading X in Chrome"). */
  shareBen: boolean
  /** Your private list: words or phrases; "a|b|c" means any of them. */
  deny: string[]
  /** Paused until (ms); 0 = not paused; PAUSE_FOREVER = until you resume. */
  pausedUntil: number
}

export const DEFAULT_DENY: string[] = [
  'pass|bank|login|2fa|wallet',
  'banking|paypal|revolut|stripe|crypto exchange',
  '1password|bitwarden|keepass|lastpass|dashlane|keeperpassword|enpass|proton pass|nordpass|authenticator',
  'signal|whatsapp|telegram|messenger|threema|viber',
  'incognito|inprivate|private browsing|privat',
  'windows security|securityhealth|sechealthui|defender|credential|sign in|sign-in'
]

export const DEFAULT_EYES_PREFS: EyesPrefs = {
  on: false,
  read: false,
  ocrAuto: false,
  caption: false,
  captionAuto: false,
  captionEveryMin: 5,
  suggest: true,
  shareBen: false,
  deny: DEFAULT_DENY,
  pausedUntil: 0
}

/** Our own windows are never read (the island, the app). */
const SELF = /^(life system|lifesystem|electron)$/i

/** The list, clean: lower case, trimmed, no empty parts, 60 entries of 200 characters at most. */
export function cleanDeny(list: unknown): string[] {
  const raw = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/\r?\n/) : []
  const out: string[] = []
  for (const x of raw) {
    const parts = String(x ?? '')
      .toLowerCase()
      .split('|')
      .map((p) => p.trim().replace(/\s+/g, ' '))
      .filter((p) => p.length >= 2)
    const e = [...new Set(parts)].join('|').slice(0, 200).replace(/\|$/, '')
    if (e && !out.includes(e)) out.push(e)
    if (out.length >= 60) break
  }
  return out
}

export function cleanEyesPrefs(raw: unknown): EyesPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EyesPrefs, unknown>>
  const b = (k: keyof EyesPrefs) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULT_EYES_PREFS[k] as boolean))
  const every = Number(r.captionEveryMin)
  const until = Number(r.pausedUntil)
  return {
    on: b('on'),
    read: b('read'),
    ocrAuto: b('ocrAuto'),
    caption: b('caption'),
    captionAuto: b('captionAuto'),
    captionEveryMin: Number.isFinite(every) ? Math.max(5, Math.min(120, Math.round(every))) : 5,
    suggest: b('suggest'),
    shareBen: b('shareBen'),
    // An empty list stays empty only if you emptied it (an array); missing → the defaults.
    deny: Array.isArray(r.deny) ? cleanDeny(r.deny) : DEFAULT_DENY,
    pausedUntil: Number.isFinite(until) && until > 0 ? Math.min(until, PAUSE_FOREVER) : 0
  }
}

/** The rule on your list that this window matches ("bank"), or null. Our own windows count as private too. */
export function deniedBy(win: { proc?: string | null; app?: string | null; title?: string | null }, deny: string[]): string | null {
  if (SELF.test(String(win.proc ?? '').trim()) || SELF.test(String(win.app ?? '').trim())) return 'Life System'
  const hay = `${win.proc ?? ''} ${win.app ?? ''} ${win.title ?? ''}`.toLowerCase()
  if (!hay.trim()) return null
  for (const entry of deny) for (const part of entry.split('|')) if (part && hay.includes(part)) return part
  return null
}

/** A regex of the list for the desktop's own check (PowerShell -match, before any text is read). */
export function denyRegex(deny: string[]): string {
  const parts = [...new Set(deny.flatMap((e) => e.split('|')).filter((p) => p.length >= 2))]
  if (!parts.length) return '(?!)'
  return parts.map((p) => p.replace(/[.*+?^${}()|[\]\\'"`]/g, (c) => (c === "'" || c === '"' || c === '`' ? '.' : `\\${c}`))).join('|')
}

export const isPaused = (p: EyesPrefs, now: number) => p.pausedUntil > now

export type PauseChoice = '15m' | '1h' | 'tomorrow' | 'forever' | 'resume'

/** When a pause ends (ms), 0 for Resume. "tomorrow" is 06:00 the next morning. */
export function pauseUntil(choice: PauseChoice, now: number): number {
  if (choice === 'resume') return 0
  if (choice === '15m') return now + 15 * 60_000
  if (choice === '1h') return now + 60 * 60_000
  if (choice === 'forever') return PAUSE_FOREVER
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(6, 0, 0, 0)
  return d.getTime()
}

/** "Paused for 1 h", "Paused until 06:00", "Paused until you resume". */
export function pauseLabel(until: number, now: number): string {
  if (until <= now) return ''
  if (until >= PAUSE_FOREVER) return 'Paused until you resume'
  const min = Math.ceil((until - now) / 60_000)
  if (min <= 60) return `Paused for ${min} min`
  const d = new Date(until)
  return `Paused until ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The least time between two looks of each kind (ms): by themselves, and when you press the button. */
export const EYE_LIMITS: Record<'auto' | 'manual', Record<EyeKind, number>> = {
  auto: { read: 20_000, ocr: 20_000, caption: 5 * 60_000 },
  manual: { read: 5_000, ocr: 5_000, caption: 30_000 }
}

export interface GuardState {
  /** When each kind last looked (ms). */
  lastAt: Partial<Record<EyeKind, number>>
}

export const newGuardState = (): GuardState => ({ lastAt: {} })

export type GuardWhy = 'off' | 'paused' | 'kindOff' | 'denied' | 'rate' | 'busy'

export type GuardAnswer = { ok: true } | { ok: false; why: GuardWhy; rule?: string; waitMs?: number }

/**
 * May this eye look now? `manual` is you pressing a button (a shorter limit,
 * and the eye's own "by itself" switch isn't needed). `busy`: another look is
 * still running (one at a time).
 */
export function mayLook(p: EyesPrefs, st: GuardState, req: { kind: EyeKind; now: number; manual?: boolean; win?: { proc?: string | null; app?: string | null; title?: string | null } | null; busy?: boolean }): GuardAnswer {
  if (!p.on) return { ok: false, why: 'off' }
  if (isPaused(p, req.now)) return { ok: false, why: 'paused' }
  const auto = !req.manual
  if (req.kind === 'read' && auto && !p.read) return { ok: false, why: 'kindOff' }
  if (req.kind === 'ocr' && auto && !p.ocrAuto) return { ok: false, why: 'kindOff' }
  if (req.kind === 'caption' && (!p.caption || (auto && !p.captionAuto))) return { ok: false, why: 'kindOff' }
  if (req.win) {
    const rule = deniedBy(req.win, p.deny)
    if (rule) return { ok: false, why: 'denied', rule }
  }
  if (req.busy) return { ok: false, why: 'busy' }
  const gap = auto ? (req.kind === 'caption' ? Math.max(EYE_LIMITS.auto.caption, p.captionEveryMin * 60_000) : EYE_LIMITS.auto[req.kind]) : EYE_LIMITS.manual[req.kind]
  const last = st.lastAt[req.kind] ?? 0
  if (last && req.now - last < gap) return { ok: false, why: 'rate', waitMs: gap - (req.now - last) }
  return { ok: true }
}

/** This eye looked now (call it when the look starts, so a slow one still counts). */
export function noteLook(st: GuardState, kind: EyeKind, now: number): GuardState {
  return { lastAt: { ...st.lastAt, [kind]: now } }
}

/** A plain-English reason a look didn't happen, for the island's toast. */
export function whyText(a: GuardAnswer): string {
  if (a.ok) return ''
  switch (a.why) {
    case 'off':
      return 'The eyes are off (Settings → Island eyes)'
    case 'paused':
      return 'The eyes are paused'
    case 'kindOff':
      return 'That eye is off in Settings'
    case 'denied':
      return 'This window is on your private list'
    case 'busy':
      return 'Still reading…'
    case 'rate':
      return `Wait ${Math.max(1, Math.ceil((a.waitMs ?? 0) / 1000))} s`
  }
}

// ---- what is kept ----

export const SUMMARY_MAX = 120

/** Things that look private in text: such text is dropped, never summarized. */
const SENSITIVE = /\b(password|passwort|parol[aă]|passcode|one[- ]time (code|password)|verification code|security code|cvv|cvc|iban|card number|seed phrase|recovery phrase|private key|secret key|api key)\b/i

export const looksSensitive = (text: string) => SENSITIVE.test(text)

/** Emails, links, long numbers (cards, codes, phones) and key-like strings are taken out. */
export function scrub(text: string): string {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '…')
    .replace(/\bhttps?:\/\/\S+/gi, '…')
    .replace(/\b(?:\d[ -]?){5,}\d\b/g, '…')
    .replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '…')
    .replace(/(…\s*){2,}/g, '… ')
}

/** One line, at most `max` characters (whole words, with … when cut). */
export function summarize(text: string, max = SUMMARY_MAX): string {
  const t = scrub(text).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

export type SeenOutcome = 'kept' | 'denied' | 'sensitive' | 'empty'

/**
 * What a look returned, checked again before anything is kept: the title the
 * eye found can be on your list (a window the app name didn't give away), the
 * text can look private. Only the summary leaves this function.
 */
export function checkSeen(raw: { proc?: string | null; app?: string | null; title?: string | null; text?: string | null }, deny: string[]): { outcome: SeenOutcome; rule?: string; title: string; text: string } {
  const rule = deniedBy(raw, deny)
  if (rule) return { outcome: 'denied', rule, title: '', text: '' }
  const title = String(raw.title ?? '')
  const text = String(raw.text ?? '')
  if (looksSensitive(title) || looksSensitive(text)) return { outcome: 'sensitive', title: '', text: '' }
  const t = summarize(title)
  const x = summarize(text)
  if (!t && !x) return { outcome: 'empty', title: '', text: '' }
  return { outcome: 'kept', title: t, text: x }
}

// ---- the log (Settings → Island eyes → What the eyes saw) ----

export interface EyesLogEntry {
  at: number
  kind: EyeKind
  /** The friendly app name ("Chrome"); empty for our own windows. */
  app: string
  /** At most 120 characters; for a skipped window only why ("On your private list: bank"). */
  summary: string
  outcome: SeenOutcome
}

export const EYES_LOG_MAX = 50

export function addLog(log: EyesLogEntry[], e: EyesLogEntry, max = EYES_LOG_MAX): EyesLogEntry[] {
  const clean: EyesLogEntry = { at: e.at, kind: e.kind, app: String(e.app ?? '').slice(0, 40), summary: summarize(e.summary), outcome: e.outcome }
  // The same skip twice in a row is one line (switching back and forth to your bank).
  const prev = log[0]
  if (prev && prev.outcome !== 'kept' && prev.outcome === clean.outcome && prev.app === clean.app && prev.summary === clean.summary) return [{ ...clean }, ...log.slice(1)].slice(0, max)
  return [clean, ...log].slice(0, max)
}

export function cleanLog(raw: unknown): EyesLogEntry[] {
  if (!Array.isArray(raw)) return []
  const kinds: EyeKind[] = ['read', 'ocr', 'caption']
  const outs: SeenOutcome[] = ['kept', 'denied', 'sensitive', 'empty']
  return raw
    .filter((e) => e && typeof e === 'object' && Number.isFinite(e.at) && kinds.includes(e.kind) && outs.includes(e.outcome))
    .map((e) => ({ at: Number(e.at), kind: e.kind as EyeKind, app: String(e.app ?? '').slice(0, 40), summary: summarize(String(e.summary ?? '')), outcome: e.outcome as SeenOutcome }))
    .slice(0, EYES_LOG_MAX)
}

/** The line a skipped look leaves in the log. */
export function skipLine(outcome: Exclude<SeenOutcome, 'kept'>, rule?: string): string {
  if (outcome === 'denied') return rule ? `Not read: on your private list (${rule})` : 'Not read: on your private list'
  if (outcome === 'sensitive') return 'Dropped: it looked private (a password, code or card)'
  return 'Nothing to read here'
}
