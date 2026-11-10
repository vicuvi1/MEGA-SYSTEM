// The one sound engine (SO1): a single AudioContext per page, every sound
// through a bus per kind (clicks, done things, points, focus, alerts) into a
// master volume and a limiter, so stacked sounds never clip. Unlocked on the
// first tap, asleep after 30 s of silence. The notes, themes and rules live in
// core/sounds.ts; nothing here is a file, everything is synthesized.
import { DEFAULT_SOUND_PREFS, BED_LOWPASS, HAPTICS, SOUND_CATEGORY, bedSamples, cleanSoundPrefs, createDebounce, remindSound, soundBlock, soundLength, themed, themeVoices, type BedKind, type PlayCheck, type SoundCategory, type SoundName, type SoundPrefs, type Voice } from '@core/sounds'
import { DEFAULT_NOTIF, getUiPrefs } from './uiPrefs'
import { BODY_REMINDER_SOUND, reminderGain, type BodyReminder } from '@core/islandReminderSound'
import { MOMENT_CATEGORY, momentForNotif, momentRecipe, pickFor, type MomentId, type MomentSound } from '@core/soundMoments'

type Ctx = AudioContext
interface Engine { c: Ctx; master: GainNode; pan: StereoPannerNode | null; buses: Record<SoundCategory, GainNode> }
/** Clicks sit well under everything else. */
const BUS_GAIN: Record<SoundCategory, number> = { ui: 0.5, success: 1, money: 1, focus: 1, alerts: 1 }
let eng: Engine | null = null

function engine(): Engine | null {
  if (eng && eng.c.state !== 'closed') return eng
  try {
    const AC = typeof window !== 'undefined' ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined
    if (!AC) return null
    const c = new AC({ latencyHint: 'interactive' })
    const master = c.createGain()
    const lim = c.createDynamicsCompressor()
    lim.threshold.value = -10
    lim.knee.value = 6
    lim.ratio.value = 12
    lim.attack.value = 0.003
    lim.release.value = 0.25
    const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null
    master.connect(lim)
    if (pan) {
      pan.pan.value = panValue
      lim.connect(pan).connect(c.destination)
    } else lim.connect(c.destination)
    const buses = {} as Record<SoundCategory, GainNode>
    for (const k of Object.keys(BUS_GAIN) as SoundCategory[]) {
      buses[k] = c.createGain()
      buses[k].gain.value = BUS_GAIN[k]
      buses[k].connect(master)
    }
    eng = { c, master, pan, buses }
    return eng
  } catch {
    return null
  }
}

// ---- prefs and the outside world ----

export function soundPrefs(): SoundPrefs {
  return cleanSoundPrefs(getUiPrefs().sounds ?? DEFAULT_SOUND_PREFS)
}
const QUIET_KEY = 'ls.soundQuiet'
let quiet: { on: boolean; from: string; to: string } | null = null
/** Quiet hours as synced across devices (Settings → Notifications); kept for the island page too. */
export function setSoundQuiet(q: { on: boolean; from: string; to: string }): void {
  quiet = q
  try {
    localStorage.setItem(QUIET_KEY, JSON.stringify(q))
  } catch {
    /* private window */
  }
}
function quietNow(): { on: boolean; from: string; to: string } {
  if (quiet) return quiet
  try {
    const q = JSON.parse(localStorage.getItem(QUIET_KEY) || 'null')
    if (q && typeof q.from === 'string') return q
  } catch {
    /* none saved */
  }
  const n = { ...DEFAULT_NOTIF, ...(getUiPrefs().notif ?? {}) }
  return { on: n.quiet, from: n.quietFrom, to: n.quietTo }
}
const meetingChecks = new Set<() => boolean>()
let meetingFlag = false
/** The island says a call or meeting is on. */
export function setInMeeting(on: boolean): void {
  meetingFlag = on
  if (on) stopBed()
}
/** The app's calendar: is a meeting on right now? */
export function addMeetingCheck(f: () => boolean): void {
  meetingChecks.add(f)
}
const inMeeting = () => meetingFlag || [...meetingChecks].some((f) => {
  try {
    return f()
  } catch {
    return false
  }
})
let panValue = 0
/** Sounds lean toward where the island sits (SO5). */
export function setPan(p: number): void {
  panValue = Math.max(-1, Math.min(1, p))
  if (eng?.pan) eng.pan.pan.setTargetAtTime(panValue, eng.c.currentTime, 0.05)
}

export function playCheck(): PlayCheck {
  const ui = getUiPrefs()
  const d = new Date()
  return {
    sound: !!ui.sound,
    volume: typeof ui.volume === 'number' ? ui.volume : 80,
    cats: soundPrefs().cats,
    quiet: quietNow(),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    meeting: inMeeting(),
    // Safari and phones say "interrupted" during a call or when the system took the audio.
    muted: (eng?.c.state as string) === 'interrupted'
  }
}
/** Why sounds of this kind are quiet right now (for Settings), or null. */
export const whyQuiet = (cat: SoundCategory = 'success') => soundBlock(cat, playCheck())

// ---- waking and sleeping ----

let idleT: ReturnType<typeof setTimeout> | null = null
let busyUntil = 0
function wake(c: Ctx) {
  if (c.state === 'suspended') c.resume().catch(() => {})
}
function sleepSoon(c: Ctx, ringsFor: number) {
  busyUntil = Math.max(busyUntil, Date.now() + ringsFor * 1000)
  if (idleT) clearTimeout(idleT)
  idleT = setTimeout(() => {
    if (!bed && !voiceHold && Date.now() >= busyUntil && c.state === 'running') c.suspend().catch(() => {})
  }, Math.max(0, busyUntil - Date.now()) + 30_000)
}
if (typeof window !== 'undefined') {
  const unlock = () => {
    const e = engine()
    if (e) {
      wake(e.c)
      sleepSoon(e.c, 0)
    }
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

// ---- playing ----

let noiseBuf: AudioBuffer | null = null
function noise(c: Ctx): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.1), c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return (noiseBuf = b)
}

const debounced = createDebounce(60)
/** A gong at time-up and the island's "time is up" are the same moment: once. */
const LONG_DEBOUNCE: Partial<Record<SoundName, number>> = { focusEnd: 20_000 }
const lastLong = new Map<SoundName, number>()

export interface PlayOpts {
  /** How many habits are done today: the pluck climbs. */
  step?: number
  /** Settings' preview buttons: plays in quiet hours and meetings too. */
  preview?: boolean
  /** Has its own switch (notifications, the island's reminders): the main switch doesn't apply. */
  ownSwitch?: boolean
  /** Extra loudness 0–1 (the island's own volume). */
  gain?: number
  /** Theme to use instead of yours (the theme picker's preview). */
  theme?: SoundPrefs['theme']
  /** Loudness above 1 (the island's body reminders, core/islandReminderSound.ts reminderGain); the limiter keeps it clean. */
  loud?: number
}

/** Plays one of the app's sounds if it may (SO3), with its phone buzz (SO9). */
export function play(name: SoundName, opts: PlayOpts = {}): void {
  const cat = SOUND_CATEGORY[name]
  if (!cat) return
  const now = Date.now()
  if (!debounced(name, now)) return
  const long = LONG_DEBOUNCE[name]
  if (long && !opts.preview) {
    if (now - (lastLong.get(name) ?? -Infinity) < long) return
    lastLong.set(name, now)
  }
  const prefs = soundPrefs()
  // Which sound for what (Settings → Sound): your pick for this moment, or None.
  const pick = pickFor(name, prefs.moments)
  if (pick === null) return
  if (!opts.preview) buzzFor(name, prefs)
  if (soundBlock(cat, playCheck(), opts)) return
  const e = engine()
  if (!e) return
  const theme = opts.theme ?? prefs.theme
  const voices = pick === 'own' ? themed(name, theme, opts.step ?? 0) : themeVoices(momentRecipe(pick), theme)
  const extra = opts.loud != null ? Math.max(0, Math.min(3, opts.loud)) : opts.gain == null ? 1 : Math.max(0, Math.min(1, opts.gain))
  schedule(e, voices, cat, extra, 0)
}

/** Turns notes into sound on a bus, at `extra` loudness, leaning left/right by `pan`. */
function schedule(e: Engine, voices: Voice[], cat: SoundCategory, extra: number, pan: number): void {
  try {
    const { c, master, buses } = e
    wake(c)
    const vol = Math.max(0, Math.min(100, getUiPrefs().volume ?? 80)) / 100
    master.gain.setTargetAtTime(vol, c.currentTime, 0.01)
    let out: AudioNode = buses[cat]
    let panner: StereoPannerNode | null = null
    if (pan && typeof c.createStereoPanner === 'function') {
      panner = c.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, pan))
      panner.connect(buses[cat])
      out = panner
    }
    const t0 = c.currentTime + 0.005
    let left = voices.length
    for (const x of voices) {
      const t = t0 + x.at
      const atk = x.attack ?? 0.008
      const end = t + atk + x.len
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(Math.max(0.0002, x.gain * extra), t + atk)
      g.gain.exponentialRampToValueAtTime(0.0001, end)
      let src: AudioScheduledSourceNode
      let head: AudioNode
      if (x.noise) {
        const n = c.createBufferSource()
        n.buffer = noise(c)
        // Longer air (a whoosh) loops the short noise buffer.
        n.loop = x.len + atk > 0.09
        const bp = c.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.setValueAtTime(x.f, t)
        if (x.f2) bp.frequency.exponentialRampToValueAtTime(x.f2, end)
        bp.Q.value = x.f2 ? 1.4 : 3
        n.connect(bp)
        src = n
        head = bp
      } else {
        const o = c.createOscillator()
        o.type = x.wave ?? 'sine'
        o.frequency.setValueAtTime(x.f, t)
        if (x.f2) o.frequency.exponentialRampToValueAtTime(x.f2, t + atk + x.len)
        src = o
        head = o
      }
      if (x.lp) {
        const lp = c.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(x.lp[0], t)
        lp.frequency.exponentialRampToValueAtTime(x.lp[1], end)
        head.connect(lp)
        head = lp
      }
      head.connect(g).connect(out)
      src.start(t)
      src.stop(end + 0.03)
      src.onended = () => {
        try {
          g.disconnect()
          src.disconnect()
          if (--left === 0) panner?.disconnect()
        } catch {
          /* gone */
        }
      }
    }
    sleepSoon(c, soundLength(voices))
  } catch {
    /* no audio device, or the context went away */
  }
}

/**
 * The sound engine has started (after your first tap or key): nothing makes it
 * start early, except on the desktop island (`allowEagerAudio`): Electron lets
 * its window play without a click, and in Calm every click passes through, so
 * waiting for one meant the island's sounds never played.
 */
let eager = false
export const allowEagerAudio = () => {
  eager = true
}
export const audioReady = () => eager || (!!eng && eng.c.state !== 'closed')

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Resumes the context and waits (at most `ms`) until it really runs. */
async function running(e: Engine, ms: number): Promise<boolean> {
  if (e.c.state === 'running') return true
  await Promise.race([e.c.resume().catch(() => {}), wait(ms)])
  return (e.c.state as string) === 'running'
}
/**
 * An engine that really plays: resumed, and if its resume hangs or fails (the
 * audio device changed, Windows took it away, the context went bad after a
 * sleep), a fresh AudioContext once. null: no audio here at all.
 */
export async function readyEngine(ms = 400): Promise<Engine | null> {
  const e = engine()
  if (!e) return null
  if (await running(e, ms)) return e
  try {
    void e.c.close().catch(() => {})
  } catch {
    /* already closed */
  }
  eng = null
  const f = engine()
  if (!f) return null
  return (await running(f, ms)) ? f : null
}
/** What the audio engine says (for the island log). */
export function audioState(): string {
  if (!eng) return 'not started'
  const c = eng.c as AudioContext & { baseLatency?: number }
  return `${c.state}, ${c.sampleRate} Hz${typeof c.baseLatency === 'number' ? `, ${Math.round(c.baseLatency * 1000)} ms` : ''}`
}

export type CardSoundResult = 'played' | 'no audio device' | `blocked: ${string}`
/**
 * A notification's sound on the island (core/islandCardSound.ts decided it may
 * ring). Its own volume: the app's main volume and Sounds switch don't make it
 * quieter (the island reminder volume does); quiet hours, a meeting and a
 * muted system still stop it, except for the Settings test (`preview`).
 * Waits until the audio really runs, so a sleeping context can't swallow it.
 */
export async function playCard(name: SoundName, loud: number, opts: { preview?: boolean } = {}): Promise<CardSoundResult> {
  const cat = SOUND_CATEGORY[name] ?? 'alerts'
  const block = soundBlock(cat, { ...playCheck(), volume: 100 }, { ownSwitch: true, preview: opts.preview })
  if (block) return `blocked: ${block}`
  const prefs = soundPrefs()
  const pick = pickFor(name, prefs.moments)
  if (pick === null) return 'blocked: its sound is None (Settings → Sound → Which sound for what)'
  const e = await readyEngine()
  if (!e) return 'no audio device'
  const voices = pick === 'own' ? themed(name, prefs.theme, 0) : themeVoices(momentRecipe(pick), prefs.theme)
  const vol = Math.max(0, Math.min(100, getUiPrefs().volume ?? 80)) / 100
  schedule(e, voices, cat, Math.min(4, Math.max(0, loud) / Math.max(0.25, vol)), 0)
  return 'played'
}

/**
 * Plays notes made elsewhere (the island's own sounds, core/islandSound.ts)
 * through the same engine, the same rules (your switches, quiet hours, a
 * meeting) and the same limiter. Never starts the engine before a gesture.
 */
export function playVoices(voices: Voice[], cat: SoundCategory, opts: { gain?: number; pan?: number; preview?: boolean } = {}): boolean {
  if (!voices.length || !audioReady()) return false
  if (soundBlock(cat, playCheck(), { preview: opts.preview })) return false
  const e = engine()
  if (!e) return false
  schedule(e, voices, cat, opts.gain == null ? 1 : Math.max(0, Math.min(1, opts.gain)), opts.pan ?? 0)
  return true
}

/** The island's reminders (water, stretch, eyes, bed, a meeting soon…), at the island's own volume. */
export const playReminder = (kind: string, volume = 0.7, meeting = false) => volume > 0 && play(remindSound(kind, meeting), { gain: volume, ownSwitch: true })

/**
 * A body reminder's own clear sound (water, eye break, move break, screen
 * break) at the "Island reminders" volume (0–100). Its switches were checked
 * by reminderPlan; quiet hours, a meeting and a muted system still stop it
 * here (except the Settings test button, `preview`).
 */
export function playBodyReminder(kind: BodyReminder, volume: number, opts: { preview?: boolean } = {}): void {
  if (!(volume > 0)) return
  play(BODY_REMINDER_SOUND[kind], { loud: reminderGain(volume), ownSwitch: true, preview: opts.preview })
}
/** Why the kit would keep an alert sound quiet right now (quiet hours, a meeting, the system muted), or null. The island's notifications have their own volume, so the app's main volume doesn't count. */
export const alertBlock = () => soundBlock('alerts', { ...playCheck(), volume: 100 }, { ownSwitch: true })

/** Settings' ▶ for one moment: its sound (or `sound` to try another), in quiet hours too. */
export function previewMoment(id: MomentId, sound?: MomentSound): void {
  const pick = sound ?? soundPrefs().moments[id]
  if (pick === 'none') return
  const e = engine()
  if (!e) return
  if (soundBlock(MOMENT_CATEGORY[id], playCheck(), { preview: true, ownSwitch: true })) return
  schedule(e, themeVoices(momentRecipe(pick), soundPrefs().theme), MOMENT_CATEGORY[id], 1, 0)
}

// ---- phone buzz (SO9) ----

const isPhone = () => typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
/** A buzz on phones, when the switch is on. */
export function buzz(pattern: number | number[]): void {
  if (!soundPrefs().haptics || !isPhone()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* no vibration here */
  }
}
function buzzFor(name: SoundName, prefs: SoundPrefs) {
  const p = HAPTICS[name]
  if (p != null && prefs.haptics) buzz(p)
}

// ---- focus background (SO6) ----

let bed: { src: AudioBufferSourceNode; g: GainNode; kind: BedKind } | null = null
/** Starts the focus background sound you picked (or `kind`), fading in. */
export function startBed(kind?: BedKind, opts: { preview?: boolean } = {}): void {
  const p = soundPrefs()
  const k = kind ?? p.bed
  if (k === 'off') return stopBed()
  if (bed?.kind === k) return
  if (soundBlock('focus', playCheck(), opts)) return
  const e = engine()
  if (!e) return
  stopBed(0.4)
  try {
    const { c, buses } = e
    wake(c)
    e.master.gain.setTargetAtTime(Math.max(0, Math.min(100, getUiPrefs().volume ?? 80)) / 100, c.currentTime, 0.01)
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate)
    buf.getChannelData(0).set(bedSamples(k, c.sampleRate, 2))
    const src = c.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = BED_LOWPASS[k]
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, c.currentTime)
    g.gain.linearRampToValueAtTime(bedGain(p.bedVolume), c.currentTime + 2)
    src.connect(lp).connect(g).connect(buses.focus)
    src.start()
    bed = { src, g, kind: k }
  } catch {
    bed = null
  }
}
const bedGain = (v: number) => Math.max(0.0001, (v / 100) * 0.35)
/** Fades the background out. */
export function stopBed(fade = 1.5): void {
  const b = bed
  if (!b || !eng) return
  bed = null
  try {
    const t = eng.c.currentTime
    b.g.gain.cancelScheduledValues(t)
    b.g.gain.setValueAtTime(Math.max(0.0001, b.g.gain.value), t)
    b.g.gain.linearRampToValueAtTime(0.0001, t + fade)
    b.src.stop(t + fade + 0.05)
    b.src.onended = () => {
      try {
        b.src.disconnect()
        b.g.disconnect()
      } catch {
        /* gone */
      }
    }
    sleepSoon(eng.c, fade)
  } catch {
    /* gone */
  }
}
export const bedPlaying = () => bed?.kind ?? null
/** The background volume changed in Settings. */
export function setBedVolume(v: number): void {
  if (bed && eng) bed.g.gain.setTargetAtTime(bedGain(v), eng.c.currentTime, 0.1)
}

// ---- Study Time's soft tick (beside the background, not instead of it) ----

let tickLoop: { src: AudioBufferSourceNode; g: GainNode } | null = null
/** A soft clock tick once a second while a study block runs (Study Time's own switch). */
export function startTick(): void {
  if (tickLoop) return
  if (soundBlock('focus', playCheck())) return
  const e = engine()
  if (!e) return
  try {
    const { c, buses } = e
    wake(c)
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate)
    buf.getChannelData(0).set(bedSamples('tick', c.sampleRate, 2))
    const src = c.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = BED_LOWPASS.tick
    const g = c.createGain()
    g.gain.value = bedGain(soundPrefs().bedVolume) * 0.6
    src.connect(lp).connect(g).connect(buses.focus)
    src.start()
    tickLoop = { src, g }
  } catch {
    tickLoop = null
  }
}
export function stopTick(): void {
  const t = tickLoop
  tickLoop = null
  if (!t) return
  try {
    t.src.stop()
    t.src.disconnect()
    t.g.disconnect()
  } catch {
    /* gone */
  }
}

// ---- the old names, so every caller keeps working ----

export const soundTick = () => play('tick')
export const soundMechanicalClick = () => play('click')
export const soundSuccess = () => play('success')
export const soundCoin = () => play('coin')
export const soundSpend = () => play('spend')
export const soundFanfare = () => play('levelUp')
export const soundWarning = () => play('error')
export const soundSystemOracle = () => play('ben')
/** A new notification: its own switch (Settings → Notifications), even with other sounds off. */
export const soundNotify = (kind?: string) => play(notifSound(kind), { ownSwitch: true })
/** A notification's own sound by its kind (Ben, a reminder, water, a meeting, bedtime…). */
function notifSound(kind?: string): SoundName {
  if (!kind) return 'notify'
  const m: Record<MomentId, SoundName> = { ben: 'ben', reminder: 'notify', water: 'remindWater', move: 'remindMove', eyes: 'remindEyes', screen: 'remindScreen', timer: 'focusEnd', meeting: 'remindMeeting', done: 'success', points: 'coin', bed: 'remindBed', error: 'error', praise: 'remindPraise', drift: 'remindDrift', checkin: 'remindCheckin', push1: 'remindPush1', push2: 'remindPush2', push3: 'remindPush3' }
  return m[momentForNotif(kind)]
}
/** Quiet everything now (the context wakes again on the next sound). */
export function stopAllSounds(): void {
  stopBed(0.1)
  if (!voiceHold) eng?.c.suspend().catch(() => {})
}

// ---- voice: the mic and Ben's spoken voice use this same context ----
let voiceHold = 0
/**
 * The context for voice (the mic's audio thread, Ben's voice into the
 * master volume). `hold`: it stays awake until released (the mic is on).
 * Returns a release function with it.
 */
export function voiceAudio(): { ctx: AudioContext; out: AudioNode; release: () => void } | null {
  const e = engine()
  if (!e) return null
  voiceHold++
  wake(e.c)
  let done = false
  return {
    ctx: e.c,
    out: e.master,
    release: () => {
      if (done) return
      done = true
      voiceHold = Math.max(0, voiceHold - 1)
      if (!voiceHold) sleepSoon(e.c, 0)
    }
  }
}
