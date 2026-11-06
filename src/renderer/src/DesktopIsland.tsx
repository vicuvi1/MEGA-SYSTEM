// The desktop island: a command center in its own always-on-top window
// (Windows). One black shape that springs between three states:
// - compact: the pill (what's running, what's next), always there;
// - peek: hold the mouse on it, or something new happens: a bigger pill with
//   one action (start/stop focus, the alert's buttons) and Ben's last line;
// - expanded: click, the shortcut or Reply: the command bar (quick logs or
//   Ben), focus, Ben's message, must-dos, water and the rest of your sections.
// The window never resizes (that made it jump): only the shape animates, with
// springs that can reverse halfway. States and timers live in islandStep
// (core/islandModel.ts), so nothing closes or opens behind your back.
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IslandVoice, islandVoiceOn } from './voice/IslandVoice'
import { AnimatePresence, LayoutGroup, MotionConfig, animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { dayPart } from '@core/islandFeel'
import { DEFAULT_ISLAND_PREFS, EMPTY_ISLAND, cleanIslandPrefs, ISLAND_SHAPE, ISLAND_UI, ISLAND_ZOOM, activities, alertGate, alertPref, bedClock, clock, islandStep, islandTiming, isLive, liveStack, meetingToOpen, pill, pillBubbles, tuckState, windDownLeft, type Activity, type ClickAction, type IslandAction, type IslandPrefs, type IslandSection, type IslandSnapshot, type IslandUi, type IslandUiEvent } from '@core/islandModel'
import type { IslandBeat, IslandPlacement, IslandTheme } from '../../shared/desktop'
import { AlertScene, CountUp, Glass, Marquee, Roll, TypeIn, type WaterSplash } from './IslandScenes'
import { FeelContext, bump, feelFor, flyId, onFrame, ringColor, setFrameMode, useFeel, type Feel } from './islandFeel'
import { dropOldIslandUiLog, logIslandUi } from './islandLog'
import { finalShapeRect, inRects, roundOut, SHIELD_OFF, SHIELD_PAD, shieldStep, unionRect, type Rect, type Shield } from '@core/islandClicks'
import { installTaps, isPressed, onPress, tp } from './islandTap'
import { IslandMedia } from './IslandMedia'
import { IslandDebug, dbg, dbgEvent } from './IslandDebug'
import { plainError } from '@core/islandErrors'
import { play, playReminder } from './soundKit'
import { islandActionSound, play as islandSound, useIslandSoundEvents } from './islandSounds'
import { useIslandSounds } from './focusSound'
import { canUndo, classifyDrop, commandPreview, menuFor, moveChoice, quickButtons, ringItems, timerAdjust, UNDO_SHOW_MS, waterPick, wheelSteps, type MenuItem, type RingItem, type Suggestion } from '@core/islandCommands'
import { ActMenu, cacheSnap, cachedSnap, QuickRow, RING_RADIUS, RingMenu, shake, StageDots, Suggest, UndoButton, useEarlyOpen, useExpected, useKeyboardMode, useRing, WheelBadge } from './islandControls'
import { GripHandle, MoveModeBar, PanelCorner, ParkedDot, useIslandMove } from './IslandMoveBits'
import { KitTiles, PillKitButtons, ringKitItems, useKit } from './IslandTiles'
import { ClipTray, FileShelf, MiniCalendar, shelfDrop } from './IslandExtras'
import { MusicPanel, ScHost, ScPeekRow, ScPillBadge, useSc } from './IslandMusic'
import { IslandBeatGlow } from './music/IslandMusicFx'
import { run as musicRun } from './music/engine'
import { useTint } from './music/MusicUi'
import { cleanPower, cyclePower, filterPalette, paletteItems, POWER_LABEL, startsTyping, type PaletteItem, type PowerId } from '@core/islandPalette'
import { DayHero, Palette, PowerRow, useRipples, type HeroStat, type PowerTile } from './islandWow'
import { registeredPages } from './widgets/islandPages'
import { useMusicPage } from './IslandMusicTab'
import { IslandPager, useScriptClock } from './widgets/island'
import { IslandClock, IslandIndicator, lookRootClasses, notchRadius, showBar, useIslandLook } from './widgets/islandLook'
import './sysmon/register'
import './IslandGoals'
import { SysPill } from './sysmon/SysPill'
import { IslandAutomations } from './IslandAutomations'
import { lookClasses } from '@core/islandTiles'
import './island.css'
import './island-motion.css'
import './island-move.css'
import './island-fit.css'
import { islandSizing, type IslandDensity } from '@core/islandFit'
import { momentsFrom, todayRings, type Moment } from '@core/islandMoments'
import { cursorNear } from '../../desktop/islandPlace'
import { IslandParticles, burstFrom, setParticlesAllowed } from './IslandParticles'
import { CalendarCap, Crescent, DropCap, LiquidBorder, Sky, TodayRing, pageTurn } from './islandShapes'
import { IslandEyesBadge } from './IslandEyesBadge'
import { IslandMeet } from './IslandMeet'
import { IslandMoveBadge, IslandNudgeCard, IslandNudgePill, type NudgeRun } from './IslandNudgeCard'
import { HealthBadge, HealthCard, WeekHealthCard, WindDownCard } from './IslandHealth'
import { calmStationOf } from '@core/healthyDay'
import { STARTER_STATIONS } from '@core/starterStations'
import { NUDGE_CLOSES, nudgeTapLabel } from '@core/islandNudges'
import { BenThinking, EveningScene, LiveStack, MomentPill, PillEditor, RECAP_MS, SnapGhost, ThinkWave, leanFor, makeJelly, snapBounceIn } from './islandWidgets'

const desk = () => window.desktop
/** A clickable area in CSS px of this page (the desktop applies the page zoom) (IS2). */
export interface HotRect { x: number; y: number; w: number; h: number }
/** After this long without a fresh snapshot the island dims and says "Reconnecting…" (IS18). */
export const STALE_MS = 60_000
/** A press becomes a drag only after moving this far and being held this long (IS3). */
export const DRAG_PX = 8
export const DRAG_MS = 120
/** What may wait while you press a button (IC5): never your own clicks. */
const HELD_EVENTS = new Set<IslandUiEvent['type']>(['hover', 'hoverHeld', 'leave', 'alert', 'alertEnd', 'autoOpen', 'blur'])

/** A sound for each kind of reminder (A8), through the one sound kit (soundKit.ts). */
const playSound = playReminder
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const minsText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`
}

function Ring({ pct, over, size = 22, stroke = 2.6 }: { pct: number; over?: boolean; size?: number; stroke?: number }) {
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  return (
    <svg className={`di-ring ${over ? 'over' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="bg" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

/**
 * IL1: a ring that fills smoothly from `from` to `to` (ms), drawn by the one
 * shared animation frame (no re-render, no 1-second steps). It warms from
 * lime to amber in the last 5 minutes and goes red when time is up. A focus
 * timer's ring (`timer`) also breathes and gives a soft pulse each minute.
 * Off: it moves once a second.
 */
function SmoothRing({ from, to, size = 22, stroke = 2.6, timer = false, freeze = null }: { from: number; to: number; size?: number; stroke?: number; timer?: boolean; freeze?: number | null }) {
  const f = useFeel()
  const svg = useRef<SVGSVGElement>(null)
  const fg = useRef<SVGCircleElement>(null)
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  useEffect(() => {
    let lastOff = -1
    let lastColor = '-'
    let lastMin = -1
    const draw = (t0: number) => {
      // IC1: paused, the ring stands still where the pause began.
      const t = freeze ?? t0
      const el = fg.current
      if (!el) return
      const pct = Math.min(1, Math.max(0, (t - from) / Math.max(1, to - from)))
      const off = c * (1 - pct)
      if (Math.abs(off - lastOff) >= 0.02) {
        el.setAttribute('stroke-dashoffset', off.toFixed(2))
        lastOff = off
      }
      const color = ringColor(to - t) ?? ''
      if (color !== lastColor) {
        el.style.stroke = color
        svg.current?.classList.toggle('over', t > to)
        svg.current?.classList.toggle('warm', t <= to && to - t < 5 * 60_000)
        lastColor = color
      }
      // A soft pulse as each minute ticks over (Full only).
      const min = Math.floor((to - t) / 60_000)
      if (timer && f.extras && lastMin !== -1 && min !== lastMin && t < to) svg.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' })
      lastMin = min
    }
    if (f.mode === 'off') {
      draw(Date.now())
      const i = window.setInterval(() => draw(Date.now()), 1000)
      return () => clearInterval(i)
    }
    return onFrame(draw)
  }, [from, to, c, timer, f, freeze])
  return (
    <svg ref={svg} className={`di-ring live ${timer ? 'breathe' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="bg" strokeWidth={stroke} />
      <circle ref={fg} cx={size / 2} cy={size / 2} r={r} className="fg" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

/** IL1: the current block's (or timer's) progress, a thin line sweeping along the bottom edge. */
function Sweep({ from, to, freeze = null }: { from: number; to: number; freeze?: number | null }) {
  const f = useFeel()
  const el = useRef<HTMLElement>(null)
  useEffect(() => {
    let last = -1
    let lastColor = '-'
    const draw = (t0: number) => {
      const t = freeze ?? t0
      const pct = Math.min(1, Math.max(0, (t - from) / Math.max(1, to - from)))
      if (el.current && Math.abs(pct - last) >= 0.0005) {
        el.current.style.transform = `scaleX(${pct.toFixed(4)})`
        last = pct
      }
      const color = ringColor(to - t) ?? ''
      if (el.current && color !== lastColor) {
        el.current.style.background = color
        lastColor = color
      }
    }
    if (f.mode === 'off') {
      draw(Date.now())
      const i = window.setInterval(() => draw(Date.now()), 1000)
      return () => clearInterval(i)
    }
    return onFrame(draw)
  }, [from, to, f, freeze])
  return <i ref={el} className="di-sweep" aria-hidden />
}

/** IC8: the view; things only fly (and are measured) when it changes, not on every redraw. */
const ViewContext = createContext<string>('compact')
/**
 * IA2: something that flies between the pill, the peek and the panel (its
 * icon, title or time share an id there). `pos`: it only moves (text that
 * would look squashed if it stretched). Calm and Off: no flight, just a fade.
 */
function Fly({ id, pos = false, className, children }: { id: string; pos?: boolean; className?: string; children: ReactNode }) {
  const f = useFeel()
  const view = useContext(ViewContext)
  const lid = flyId(f, id)
  return (
    <motion.span layoutId={lid} layout={lid ? (pos ? 'position' : true) : undefined} layoutDependency={view} transition={f.fly} className={`di-flyer ${className ?? ''}`}>
      {children}
    </motion.span>
  )
}

function ActIcon({ a, face, small = false, size: px }: { a: Activity; face: string; small?: boolean; size?: number }) {
  const size = px ?? (small ? 20 : 22)
  if (a.kind === 'timer' || a.kind === 'now') return <Ring pct={a.pct} over={a.over} size={size} />
  if (a.kind === 'water') return <Glass pct={a.pct} size={Math.round(size * 1.05)} label={false} />
  if (a.kind === 'bed') return <span className="di-act-ico di-moon-sm">🌙</span>
  if (a.kind === 'next') return <span className={`di-act-ico ${a.at && a.at - Date.now() <= 10 * 60_000 ? 'tick' : ''}`}>⏭</span>
  if (a.kind === 'points') return <span className="di-act-ico">⭐</span>
  if (a.kind === 'mustdos') return <span className="di-act-ico">☑️</span>
  if (a.kind === 'tasks') return <span className="di-act-ico">✓</span>
  if (a.kind === 'rain') return <span className="di-act-ico">🌧</span>
  if (a.kind === 'sun') return <span className="di-act-ico">🌇</span>
  return <span className="di-face-sm">{face}</span>
}
/** The time, ticking on its own (the rest of the island doesn't re-render every second). */
function useNow(ms: number) {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => {
      dbg.commits++
      setN(Date.now())
    }, ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

type Run = NonNullable<IslandSnapshot['running']>
function LiveTimer({ run, big = false, guard }: { run: Run; big?: boolean; guard?: IslandSnapshot['focusGuard'] }) {
  const tick = useNow(1000)
  // IC1: paused, the time left stands still.
  const now = run.pausedAt ?? tick
  const left = (run.endsAt - now) / 1000
  const over = left < 0
  const text = `${over ? '+' : ''}${clock(left)}`
  if (!big) return <Roll className={`di-pill-time ${over ? 'over' : ''}`} text={text} />
  return (
    <>
      <Fly id="ic-timer">
        <SmoothRing from={run.startedAt} to={run.endsAt} size={58} stroke={4} timer freeze={run.pausedAt} />
      </Fly>
      <div className="di-timer-mid">
        <Fly id="tm-timer" className="di-clock-fly">
          <Roll className={`di-clock ${over ? 'over' : ''}`} text={text} />
        </Fly>
        <Fly id="ti-timer" pos className="di-sub-fly">
          <small>{run.pausedAt && <b className="di-paused-tag">Paused · </b>}{run.subject} <StageDots dots={run.dots} /></small>
        </Fly>
        {guard && (
          <small className={`di-guard ${guard.pct >= 85 ? 'good' : guard.pct < 60 ? 'low' : ''}`} title="How much of this session you've been at the PC (no mouse/keys for 2+ min counts as away)">
            🎯 {guard.pct}% at the PC{guard.idleMin ? ` · away ${guard.idleMin} min` : ''}
          </small>
        )}
      </div>
    </>
  )
}
/** "in 4:59" before a meeting, amber in the last 5 minutes (P7); the digits roll (IL5). */
function LiveCountdown({ at }: { at: number }) {
  const now = useNow(1000)
  const left = Math.max(0, Math.round((at - now) / 1000))
  return <Roll className={`di-pill-time ${left <= 300 ? 'soon' : ''}`} text={`in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`} />
}
function LiveRing({ run, size = 22 }: { run: Run; size?: number }) {
  return <SmoothRing from={run.startedAt} to={run.endsAt} size={size} timer freeze={run.pausedAt} />
}

/** A +N reps button: the count runs up and the button gives a small bounce. */
function RepBtn({ r, n = 10, onTap }: { r: IslandSnapshot['reps'][number]; n?: number; onTap: () => void }) {
  const f = useFeel()
  const el = useRef<HTMLButtonElement>(null)
  const was = useRef(r.done)
  useEffect(() => {
    if (r.done > was.current) bump(el.current, f, 1.07)
    was.current = r.done
  }, [r.done, f])
  return (
    <button ref={el} {...tp(`rep:${r.id}`, onTap)} title={`${r.done}/${r.target}`}>
      <span>{r.name}</span>
      <small>
        <CountUp value={r.done} />/{r.target}
      </small>
      <b>+{n}</b>
    </button>
  )
}

/** A water button: a ripple from where you clicked, and a little bounce. */
function WaterBtn({ ml, onTap, children }: { ml: number; onTap: (ml: number) => void; children: ReactNode }) {
  const f = useFeel()
  const [rip, setRip] = useState<{ id: number; x: number; y: number }[]>([])
  return (
    <button
      className="di-wbtn"
      {...tp(`wbtn:${ml}`, (t) => {
        onTap(ml)
        bump(t.el, f, 1.06)
        if (!f.extras) return
        const b = t.el.getBoundingClientRect()
        const id = Date.now()
        setRip((x) => [...x.slice(-2), { id, x: t.keyboard ? b.width / 2 : t.x - b.left, y: t.keyboard ? b.height / 2 : t.y - b.top }])
        window.setTimeout(() => setRip((x) => x.filter((p) => p.id !== id)), 600)
      })}
    >
      {children}
      {rip.map((p) => (
        <i key={p.id} className="di-ripple" style={{ left: p.x, top: p.y }} aria-hidden />
      ))}
    </button>
  )
}

/** What flies into the pill (IL6): a coin for points, a drop for water. */
interface Flight { id: number; kind: 'coin' | 'drop'; text: string }
function FlyIn({ fl, f }: { fl: Flight; f: Feel }) {
  if (!f.extras)
    return (
      <motion.span className={`di-flyin ${fl.kind}`} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 1.4 }} aria-live="polite">
        {fl.text}
      </motion.span>
    )
  // A curve: sideways fast at first, up slowly then fast, landing in the pill.
  return (
    <motion.span
      className={`di-flyin ${fl.kind}`}
      initial={{ x: -78, y: 64, scale: 0.6, opacity: 0 }}
      animate={{ x: 0, y: 0, scale: [0.6, 1.15, 0.55], opacity: [0, 1, 1, 0] }}
      transition={{ x: { duration: 0.58, ease: [0.2, 0.7, 0.4, 1] }, y: { duration: 0.58, ease: [0.6, 0, 0.8, 0.6] }, scale: { duration: 0.6, times: [0, 0.45, 1] }, opacity: { duration: 0.62, times: [0, 0.12, 0.82, 1] } }}
      aria-live="polite"
    >
      {/* The coin flips as it flies; the drop wobbles. */}
      <motion.span className="di-flyin-ico" initial={{ rotateY: 0, rotate: 0 }} animate={fl.kind === 'coin' ? { rotateY: 720 } : { rotate: [0, -14, 10, 0] }} transition={{ duration: 0.58, ease: 'easeOut' }}>
        {fl.kind === 'coin' ? '🪙' : '💧'}
      </motion.span>
      <b>{fl.text}</b>
    </motion.span>
  )
}

export function DesktopIsland() {
  // IC20: the first frame shows the last picture (this session), not an empty pill.
  const [raw, setS] = useState<IslandSnapshot>(() => cachedSnap() ?? EMPTY_ISLAND)
  useEffect(() => cacheSnap(raw), [raw])
  // IC2: a tap shows at once; it shakes back if the app says no.
  const exp = useExpected(raw, () => shake(shape.current, fRef.current.mode !== 'off'))
  const s = exp.snap
  const now = useNow(s.running ? 5000 : 15_000)
  const [place, setPlace] = useState<IslandPlacement>('top')
  // H1: hidden / tucked into a dot / move mode / out of the way.
  const mv = useIslandMove()
  const [basePrefs, setPrefs] = useState<IslandPrefs>(DEFAULT_ISLAND_PREFS)
  // Island 2: your tiles, buttons, profiles and colours (from the snapshot); a profile's own reminders on top of your settings.
  const tapRef = useRef<(a: IslandAction, lbl?: string) => void>(() => {})
  const k = useKit(s, (a, lbl) => tapRef.current(a, lbl))
  const prefs = useMemo(() => k.prefsFor(basePrefs), [basePrefs, k.profile])
  // PL5: your script tiles run on their own slow clock.
  useScriptClock(s)
  // BrimDeck-style look: notch / capsule / thin bar, the clock, the theme (synced).
  const look = useIslandLook(s)
  // The size setting: the desktop sends a scale and the page scales itself (its zoom stays locked).
  const [scale, setScale] = useState(1)
  // Fits the screen (core/islandFit.ts): the desktop says Compact or Normal for the screen the island is on.
  const [sentDensity, setSentDensity] = useState<IslandDensity | null>(null)
  // IP4: the app's colours, for the "Match the app" look.
  const [theme, setTheme] = useState<IslandTheme | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const [text, setText] = useState('')
  const [quietMenu, setQuietMenu] = useState(false)
  // A splash in the glasses on each "+250" (A1, WATER); the shimmer once the day's water is reached.
  const [splash, setSplash] = useState<WaterSplash>({ n: 0, ml: 0 })
  const [shimmer, setShimmer] = useState(0)
  // IL3: a new alert first stretches the pill down a little, then bounces into the peek.
  const [stretch, setStretch] = useState(false)
  const [dropping2, setDropping2] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()
  // IA3, IA6: one feel for every motion (Full / Calm / Off; the system's reduce-motion means Off).
  const f = useMemo(() => feelFor(prefs.motion, !!reduce), [prefs.motion, reduce])
  const fRef = useRef(f)
  fRef.current = f

  // IC9: the last "still the same" from the app window.
  const beatAt = useRef(0)
  const heldSnap = useRef<IslandSnapshot | null>(null)
  // IC10: shown or hidden (the desktop says; the window never throttles itself).
  const [visible, setVisible] = useState(true)
  const pointerLeft = useRef<() => void>(() => {})
  // ---- states: one reducer, one timer ----
  const [ui, setUi] = useState<IslandUi>(ISLAND_UI)
  // IC9: keyboard mode; IC19: faded while you type in another app; the panel's element.
  const [kbd, setKbd] = useState(false)
  const [typingAway, setTypingAway] = useState(false)
  const panelEl = useRef<HTMLDivElement>(null)
  const undoRef = useRef<{ id: string; until: number } | null>(null)
  const doUndoRef = useRef<(id: string) => void>(() => {})
  useEffect(() => {
    if (!kbd) return
    const off = () => setKbd(false)
    window.addEventListener('pointerdown', off, { once: true })
    return () => window.removeEventListener('pointerdown', off)
  }, [kbd])
  const uiRef = useRef(ui)
  // P4: the input adds a Todoist task (Ctrl+Alt+N) instead of talking to Ben.
  const [capture, setCapture] = useState<boolean | 'note'>(false)
  // The command bar lives in the "/" palette now: closed until you press /, type, or tap search.
  const [cmdOpen, setCmdOpen] = useState(false)
  const cmdOpenRef = useRef(false)
  cmdOpenRef.current = cmdOpen
  const timer = useRef<number | null>(null)
  /** Opening: the window takes the keyboard (so typing goes to the palette) and the panel has focus. */
  const focusInput = useCallback(() => {
    desk()?.islandFocus?.()
    window.setTimeout(() => (cmdOpenRef.current ? input.current?.focus() : panelEl.current?.focus({ preventScroll: true })), 40)
  }, [])
  /** The palette with the command bar, focused (and what you started typing in it). */
  const openCmd = useCallback((prefill?: string) => {
    desk()?.islandFocus?.()
    setCmdOpen(true)
    cmdOpenRef.current = true
    if (prefill) setText((t) => t + prefill)
    window.setTimeout(() => input.current?.focus(), 30)
  }, [])
  // IC5: from a press until 150 ms after its release, nothing changes under the
  // pointer: what happens by itself (hover, timers, a new alert) waits.
  const frozen = useRef(false)
  const heldEvents = useRef<IslandUiEvent[]>([])
  const dispatch = useCallback((e: IslandUiEvent) => {
    if (frozen.current && HELD_EVENTS.has(e.type)) {
      heldEvents.current.push(e)
      return
    }
    // IF7, IF11: your hover delay (or click only), how long reminders peek, how long the panel stays.
    const step = islandStep(uiRef.current, e, islandTiming(prefsRef.current))
    // IS23: every change of view, and what caused it.
    if (step.ui.view !== uiRef.current.view) {
      logIslandUi('view', `${uiRef.current.view} → ${step.ui.view} (${e.type})`)
      dbgEvent('view', { from: uiRef.current.view, to: step.ui.view, why: e.type })
    }
    uiRef.current = step.ui
    setUi(step.ui)
    if (step.timer !== undefined) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (step.timer) {
        const next = step.timer.event
        timer.current = window.setTimeout(() => dispatch(next), step.timer.ms)
      }
    }
    if (step.focusInput) focusInput()
  }, [focusInput])
  const close = () => dispatch({ type: 'close' })

  useEffect(() => {
    document.documentElement.classList.add('di-root')
    dropOldIslandUiLog()
    desk()?.onIslandState?.((v) => {
      // IC9: "still the same": only the time it was last heard from.
      if (v && 'beat' in v) {
        dbg.beats++
        beatAt.current = Number((v as IslandBeat).beat) || Date.now()
        return
      }
      dbg.snaps++
      // IC5: a new picture waits while you press a button.
      if (frozen.current) heldSnap.current = v as IslandSnapshot
      else setS(v as IslandSnapshot)
    })
    // IC1: the page itself sees the pointer (pointerOver below); the desktop
    // says when it left the window. An older desktop: it says in and out.
    desk()?.onIslandHover?.((on) => {
      if (desk()?.islandTakeClicks && !on) return pointerLeft.current()
      logIslandUi('hover', on ? 'mouse in' : 'mouse out')
      dispatch({ type: 'hover', on })
    })
    desk()?.onIslandVisible?.((v) => setVisible(v))
    // IS23: the desktop's own lines (click-through, zoom, why it's hidden) go in the island log.
    desk()?.onIslandDiag?.((d) => logIslandUi('desktop', String(d?.line ?? d), { local: true }))
    // IS21: the desktop ended a drag that got stuck.
    desk()?.onIslandDragCancel?.(() => window.dispatchEvent(new Event('island-drag-cancel')))
    desk()?.onIslandPlacement?.(setPlace)
    desk()?.onIslandPrefs?.((p) => {
      // An older desktop may not send the newer settings: they get their defaults.
      setPrefs({ ...p, ...cleanIslandPrefs(p) })
      setScale(Number.isFinite(p.scale) && p.scale! > 0 ? p.scale! : ISLAND_ZOOM[p.size] ?? 1)
      const dens = (p as { density?: unknown }).density
      setSentDensity(dens === 'compact' || dens === 'normal' ? dens : null)
      if (p.theme !== undefined) setTheme(p.theme ?? null)
    })
    desk()?.onIslandToggle?.(() => {
      // IC9: opened from the keyboard: keyboard mode (the mouse ends it).
      setKbd(uiRef.current.view !== 'expanded')
      dispatch({ type: 'toggle' })
    })
    // IC19: you're typing in another app: it fades back.
    desk()?.onIslandTyping?.((on) => setTypingAway(!!on))
    // P4: Ctrl+Alt+N from any app: a box to add a task.
    desk()?.onIslandCapture?.(() => {
      setCapture(true)
      dispatch({ type: 'click' })
      dispatch({ type: 'typing', on: true })
      focusInput()
    })
    // P9: Ctrl+Alt+B: start a voice note to Ben; press again to send it.
    desk()?.onIslandVoice?.(() => {
      dispatch({ type: 'click' })
      window.dispatchEvent(new CustomEvent('island-voice-toggle'))
    })
    desk()?.onIslandBlur?.(() => dispatch({ type: 'blur' }))
    desk()?.islandReady?.()
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        // The palette first, then the island.
        if (cmdOpenRef.current) return closeCmdRef.current()
        dispatch({ type: 'close' })
      }
      // IC10: Ctrl+Z takes back the last log (while "↶ Undo" shows).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(document.activeElement instanceof HTMLInputElement && document.activeElement.value)) {
        const u = undoRef.current
        if (u && u.until > Date.now()) {
          e.preventDefault()
          doUndoRef.current(u.id)
        }
      }
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [dispatch])
  // Not open any more: the keyboard goes back to your app (and the palette closes).
  useEffect(() => {
    const open = ui.view === 'expanded'
    if (!open) {
      input.current?.blur()
      desk()?.islandKeyboard?.(false)
      setCmdOpen(false)
    }
  }, [ui.view])
  const closeCmdRef = useRef<() => void>(() => {})

  // Quiet for a while (Q1) and what Windows says (a call, a full-screen app: Q2, Q3).
  const [q, setQ] = useState<{ until: number; call: boolean; fullscreen: boolean; mic?: boolean; meeting?: boolean; fullscreenMode?: 'hide' | 'dot' | 'show'; maximized?: boolean }>({ until: 0, call: false, fullscreen: false })
  useEffect(() => {
    desk()?.onIslandQuiet?.(setQ)
  }, [])
  const quiet = q.until > Date.now()
  const inCall = !!s.call || q.call
  // The thin bar: a window is maximized on this screen (or you picked the bar).
  const bar = showBar(look, !!q.maximized)
  // The desktop puts the window top-centre, flush with the top, while the bar look is on.
  useEffect(() => {
    desk()?.islandBar?.(bar)
  }, [bar])
  // Captions running (from the meeting strip): a red dot on the Indicator.
  const [captioning, setCaptioning] = useState(false)
  // Hover to open (BrimDeck-style, a switch in Settings → Widgets → Island look): the peek grows into the panel; moving away or Esc closes it.
  useEffect(() => {
    if (look.hoverOpen && ui.view === 'peek' && ui.over && !ui.byAlert && !s.locked) dispatch({ type: 'click' })
  }, [look.hoverOpen, ui.view, ui.over, ui.byAlert, s.locked]) // eslint-disable-line react-hooks/exhaustive-deps
  // IS12: tell the desktop when a meeting from your calendar is on (by its data: a call link or other people, accepted).
  const meetingOn = !!s.inMeeting
  useEffect(() => {
    desk()?.islandCall?.(meetingOn)
    logIslandUi('meeting', meetingOn ? 'a meeting is on (calendar)' : 'no meeting on')
  }, [meetingOn])
  // IS23: why it is hidden, shrunk or dimmed, as it changes.
  const why = [quiet && `quiet until ${new Date(q.until).toTimeString().slice(0, 5)}`, s.call && 'meeting in the calendar', q.call && 'microphone or camera on', q.fullscreen && 'a full-screen app', s.locked && 'locked (PIN) or loading', s.stale && 'last update failed'].filter(Boolean).join(', ')
  useEffect(() => {
    logIslandUi('state', why || 'normal')
  }, [why])
  const setQuiet = (choice: number | 'tomorrow' | null) => {
    desk()?.islandQuiet?.(choice)
    if (choice != null) close()
  }

  // Something new: one rule decides (P1, P3, P4): drop down with its sound,
  // wait silently (a dot; it's in the panel), or not at all.
  const seenAlert = useRef<string | null>(null)
  const lastPeek = useRef(0)
  const held = useRef(0)
  const gateOf = (kind: string, meeting = false, dot = false) => alertGate({ kind, meeting, dot, prefs: prefsRef.current, quiet, call: inCall, lastPeekAt: lastPeek.current, now: Date.now() })
  useEffect(() => {
    const a = s.alert
    if (!a || a.id === seenAlert.current) return
    seenAlert.current = a.id
    // SI6: a suggestion you keep ignoring is only a dot.
    const g = gateOf(a.kind, !!a.meeting, !!a.dot)
    if (g !== 'peek') {
      if (quiet || inCall) held.current += 1
      return
    }
    lastPeek.current = Date.now()
    // IC14: the evening story peeks long enough to be told (~10 s).
    const peekEv: IslandUiEvent = a.kind === 'recap' ? { type: 'alert', ms: RECAP_MS + 1500 } : { type: 'alert' }
    const pref = alertPref(a.kind, !!a.meeting)
    if (prefsRef.current.sound && (!pref || prefsRef.current.kinds[pref].sound) && uiRef.current.view !== 'expanded') playSound(a.kind, prefsRef.current.volume)
    // IL3: from the pill, it stretches down ~8 px first, then drops into the peek with a bounce.
    if (uiRef.current.view === 'compact' && fRef.current.moves) {
      setStretch(true)
      setDropping2(true)
      window.setTimeout(() => {
        setStretch(false)
        // Still the same alert (a newer one restarts this).
        if (seenAlert.current === a.id) dispatch(peekEv)
      }, 130)
      window.setTimeout(() => setDropping2(false), 900)
      return
    }
    dispatch(peekEv)
  }, [s.alert, quiet, inCall, dispatch]) // eslint-disable-line react-hooks/exhaustive-deps
  // Back from quiet or a call: what waited, in one line (P3).
  const wasBusy = useRef(false)
  useEffect(() => {
    const busyNow = quiet || inCall
    if (wasBusy.current && !busyNow && held.current > 0) {
      setToast({ id: 'held', state: 'ok', text: `While you were busy: ${held.current} reminder${held.current === 1 ? '' : 's'} (open the island)` })
      clearToastLater(6000)
      held.current = 0
    }
    wasBusy.current = busyNow
  }, [quiet, inCall]) // eslint-disable-line react-hooks/exhaustive-deps

  const p = useMemo(() => pill(s, now), [s, now])
  // IF4: what the pill shows, in your order.
  const acts = useMemo(() => activities(s, now, prefs.pillOrder), [s, now, prefs.pillOrder])
  // Switch between activities (P6): the dots under the pill, a sideways swipe
  // on the trackpad or the mouse wheel (IL4); the new one slides in from that side.
  const [pick, setPick] = useState<string | null>(null)
  const main: Activity | null = pillBubbles(acts, pick).main
  const swipeAcc = useRef(0)
  const wheelAt = useRef(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const cycle = (d: 1 | -1) => {
    if (acts.length < 2 || !main) return
    const i = acts.indexOf(main)
    setDir(d)
    setPick(acts[(i + d + acts.length) % acts.length].key)
  }
  const pickKey = (key: string) => {
    if (!main || key === main.key) return
    setDir(acts.findIndex((x) => x.key === key) > acts.indexOf(main) ? 1 : -1)
    setPick(key)
  }
  // IC6: Shift + wheel over the timer: ±1 min a notch (sent once you stop); over water: the amount to log.
  const wheelAcc = useRef(0)
  const wheelMin = useRef(0)
  const wheelT = useRef(0)
  const [wheelText, setWheelText] = useState<string | null>(null)
  const [wheelWater, setWheelWater] = useState<number | null>(null)
  const adjustWheel = (e: React.WheelEvent): boolean => {
    if (!e.shiftKey || !main || s.locked) return false
    const r = s.running
    if (!(main.kind === 'timer' && r) && main.kind !== 'water') return false
    const w = wheelSteps(wheelAcc.current, Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX)
    wheelAcc.current = w.acc
    if (!w.steps) return true
    clearTimeout(wheelT.current)
    if (main.kind === 'water') {
      const ml = waterPick(wheelWater ?? prefs.chips.water[0] ?? 250, w.steps)
      setWheelWater(ml)
      setWheelText(`💧 ${ml} ml`)
      wheelT.current = window.setTimeout(() => setWheelText(null), 1200)
      return true
    }
    const m = timerAdjust(r!.endsAt, wheelMin.current + w.steps, r!.pausedAt ?? Date.now())
    wheelMin.current = m
    setWheelText(`${m > 0 ? '+' : m < 0 ? '−' : '±'}${Math.abs(m)} min`)
    wheelT.current = window.setTimeout(() => {
      const total = wheelMin.current
      wheelMin.current = 0
      setWheelText(null)
      if (total && r) tap({ kind: 'setEnd', at: r.endsAt + total * 60_000 })
    }, 700)
    return true
  }
  const onWheel = (e: React.WheelEvent) => {
    if (adjustWheel(e)) return
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY)
    // A trackpad swipe adds up; a mouse wheel notch switches once (then a short pause).
    swipeAcc.current += sideways ? e.deltaX : e.deltaY
    if (Math.abs(swipeAcc.current) < (sideways ? 60 : 50)) return
    const d = swipeAcc.current > 0 ? 1 : -1
    swipeAcc.current = 0
    if (performance.now() - wheelAt.current < 380) return
    wheelAt.current = performance.now()
    cycle(d)
  }
  // IL2: two live things at once (a timer and a meeting soon, or Ben's unread
  // message): the pill plus a small round bubble beside it. The order follows
  // your pill order when you have set one.
  // IC15: three or more live things: the others stack up beside it and fan out on hover.
  const stack = useMemo(() => liveStack(acts, pick, now), [acts, pick, now])
  const bubble: Activity | null = stack.length === 1 ? stack[0] : null
  const run = s.running
  useIslandSounds(place, inCall, run)

  // IP3: nothing live for a while: it tucks away (a tiny dot, or faded); the mouse on it brings it back.
  const lastLive = useRef(Date.now())
  if (isLive(s, now)) lastLive.current = now
  const tuck = s.locked ? 'none' : tuckState({ now, lastLiveAt: lastLive.current, idleMin: prefs.idleMin, idleLook: prefs.idleLook, over: ui.over, view: ui.view })
  useEffect(() => {
    logIslandUi('tuck', tuck === 'none' ? 'awake' : `tucked away (${tuck})`)
  }, [tuck])
  // IF5: a meeting you said yes to starts in N minutes: the panel opens by itself, once.
  const openedFor = useRef<string | null>(null)
  const meetKey = meetingToOpen(s, now, prefs.meetingOpenMin)
  useEffect(() => {
    if (!meetKey || meetKey === openedFor.current || quiet) return
    openedFor.current = meetKey
    logIslandUi('meeting', 'opened by itself before a meeting')
    dispatch({ type: 'autoOpen', ms: 90_000 })
  }, [meetKey, quiet, dispatch])

  // ---- the shape's size: measured from the view inside it, animated with a spring ----
  const shape = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 120, h: 30 })
  const sizeRef = useRef(size)
  sizeRef.current = size
  // IM5: the shape grows with the GPU. Its box takes the new size once (the
  // larger of where it is and where it goes, then the end size); what you see
  // is a clip-path whose width, height and corners spring. Nothing is laid
  // out again while it moves.
  const mw = useMotionValue(size.w)
  const mh = useMotionValue(size.h)
  const mr = useMotionValue<number>(ISLAND_SHAPE.compact.radius)
  const [box, setBox] = useState(size)
  const boxRef = useRef(box)
  boxRef.current = box
  /** The part of the shape you see (screen px), from its box's rect. */
  const visibleRect = useCallback((b: DOMRect, anchor: 'left' | 'right' | 'center') => {
    const kx = b.width / Math.max(1, boxRef.current.w)
    const ky = b.height / Math.max(1, boxRef.current.h)
    const w = Math.min(b.width, mw.get() * kx)
    const h = Math.min(b.height, mh.get() * ky)
    const left = anchor === 'left' ? b.left : anchor === 'right' ? b.right - w : b.left + (b.width - w) / 2
    return { left, top: b.top, width: w, height: h }
  }, [mw, mh])
  // IC12: each view's own element (a view that is still fading out is never the one measured).
  const viewEls = useRef<Partial<Record<string, HTMLElement | null>>>({})
  const viewRef = useMemo(() => {
    const make = (v: string) => (el: HTMLElement | null) => {
      if (el) viewEls.current[v] = el
      else if (viewEls.current[v] && !viewEls.current[v]!.isConnected) viewEls.current[v] = null
    }
    return { compact: make('compact'), peek: make('peek'), expanded: make('expanded') } as Record<string, (el: HTMLElement | null) => void>
  }, [])
  useLayoutEffect(() => {
    const el = viewEls.current[ui.view]
    if (!el) return
    const fit = () => {
      const max = ISLAND_SHAPE.expanded.maxHeight
      setSize((o) => {
        const w = Math.ceil(el.offsetWidth)
        const h = Math.ceil(Math.min(max, el.offsetHeight))
        return o.w === w && o.h === h ? o : { w, h }
      })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ui.view])

  // Where the island takes clicks (IS2, IC1–IC3). Measured once per change (a
  // view opening, a new size, the bubble or the toast), never every frame: the
  // shape where it is now AND where it will end, together, so a peek still
  // growing already takes clicks at its right end. The page checks the pointer
  // against this itself and tells the desktop at once (island:takeClicks); the
  // desktop also gets the boxes (Island debug, and an older desktop's own check).
  const [moving, setMoving] = useState(false)
  const movingRef = useRef(false)
  movingRef.current = moving
  const lastHot = useRef('')
  const rootEl = useRef<HTMLDivElement>(null)
  const target = useRef<Rect[]>([])
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const placeRef = useRef(place)
  placeRef.current = place
  const stretchRef = useRef(false)
  stretchRef.current = stretch
  const evaluateRef = useRef<(force?: boolean) => void>(() => {})
  const sendHot = useCallback((settled = false) => {
    const root = rootEl.current
    const sh = shape.current
    if (!root || !sh) return
    const sc = scaleRef.current || 1
    const pl = placeRef.current
    const box = root.getBoundingClientRect()
    const anchor = pl === 'left' || pl === 'top-left' ? 'left' : pl === 'right' || pl === 'top-right' ? 'right' : 'center'
    // IM5: what you see is the clip inside the shape's box, not the box itself.
    const now = visibleRect(sh.getBoundingClientRect(), anchor)
    const end = finalShapeRect({
      anchor, ax: anchor === 'left' ? box.left : anchor === 'right' ? box.right : box.left + box.width / 2, top: now.top,
      w: sizeRef.current.w * sc, h: (sizeRef.current.h + (stretchRef.current ? 8 : 0)) * sc
    })
    const cur = { x: now.left, y: now.top, w: now.width, h: now.height }
    const rects: Rect[] = [roundOut(settled ? end : unionRect(cur, end))]
    // The bubble, the toast and Island debug's buttons: where they are and their full size around their middle.
    const dy = end.y + end.h - (now.top + now.height)
    for (const el of document.querySelectorAll<HTMLElement>('[data-hot]')) {
      if (el === sh || el.parentElement?.closest('[data-hot]')) continue
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      // Island debug's buttons aren't scaled with the island.
      const k = el.closest('.di') ? sc : 1
      const w = Math.max(r.width, el.offsetWidth * k)
      const h = Math.max(r.height, el.offsetHeight * k)
      const shift = el.classList.contains('di-toast') ? dy : 0
      const full = { x: r.left + r.width / 2 - w / 2, y: r.top + r.height / 2 - h / 2 + shift, w, h }
      rects.push(roundOut(settled ? full : unionRect({ x: r.left, y: r.top, w: r.width, h: r.height }, full)))
    }
    target.current = rects
    dbg.target = rects
    const key = rects.map((b) => `${b.x},${b.y} ${b.w}×${b.h}`).join(' ')
    if (key !== lastHot.current) {
      lastHot.current = key
      desk()?.islandHot?.({ rects })
      if (settled) logIslandUi('click area', key)
    }
    // The shape changed under a resting pointer: check it again.
    evaluateRef.current()
  }, [])
  const hotT = useRef(0)
  /** The area now, and once more after `ms` (when what moved has settled). */
  const pump = useCallback((ms: number) => {
    sendHot()
    clearTimeout(hotT.current)
    hotT.current = window.setTimeout(() => sendHot(!movingRef.current), ms)
  }, [sendHot])
  useEffect(() => () => clearTimeout(hotT.current), [])
  const onStart = () => {
    movingRef.current = true
    setMoving(true)
    sendHot()
  }
  const onDone = () => {
    movingRef.current = false
    setMoving(false)
    sendHot(true)
  }
  // A new size or view: the area it ends at.
  useLayoutEffect(() => {
    sendHot()
  }, [size, ui.view, sendHot])
  useEffect(() => {
    lastHot.current = ''
    pump(400)
  }, [place, prefs.size, scale, pump])
  // A safety net: anything missed (fonts loading, a scrollbar) is caught within 2 s; nothing is sent when nothing changed.
  useEffect(() => {
    const t = window.setInterval(() => sendHot(!movingRef.current), 2000)
    const onResize = () => pump(200)
    window.addEventListener('resize', onResize)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', onResize)
    }
  }, [sendHot, pump])

  // ---- IC1, IC2: take clicks where the island is (the page decides) ----
  // Every mouse move reaches the page (the desktop forwards them even while
  // clicks pass through). On the shape (or within 12 px of it, or less than
  // 400 ms after it left, or while a button is held): take clicks.
  const shield = useRef<Shield>(SHIELD_OFF)
  const lastPtr = useRef<{ x: number; y: number } | null>(null)
  const takeSent = useRef<{ on: boolean; at: number } | null>(null)
  const recheckT = useRef(0)
  const evaluate = useCallback((force = false) => {
    if (!desk()?.islandTakeClicks) return
    const p = lastPtr.current
    let inside = false
    if (p) {
      inside = inRects(p.x, p.y, target.current, SHIELD_PAD)
      if (!inside) {
        const hit = typeof document.elementFromPoint === 'function' ? (document.elementFromPoint(p.x, p.y) as HTMLElement | null) : null
        inside = !!hit?.closest?.('[data-hot]')
      }
    }
    const was = shield.current.take
    const r = shieldStep(shield.current, { inside, pressed: isPressed(), now: Date.now() })
    shield.current = r.st
    clearTimeout(recheckT.current)
    if (r.recheckIn != null) recheckT.current = window.setTimeout(() => evaluateRef.current(), r.recheckIn + 5)
    const on = r.st.take
    const t = Date.now()
    dbg.take = on
    // On change at once; while on, again every half second (the desktop may have reset after a drag).
    if (force || takeSent.current?.on !== on || (on && t - takeSent.current.at > 500)) {
      takeSent.current = { on, at: t }
      desk()?.islandTakeClicks?.(on)
    }
    if (on !== was) {
      dbgEvent(on ? 'take clicks' : 'pass through', p ? { x: Math.round(p.x), y: Math.round(p.y) } : {})
      logIslandUi('hover', on ? 'mouse in' : 'mouse out')
      dispatch({ type: 'hover', on })
    }
  }, [dispatch])
  evaluateRef.current = evaluate
  pointerLeft.current = () => {
    lastPtr.current = null
    dbg.ptr = null
    clearTimeout(recheckT.current)
    const was = shield.current.take
    shield.current = SHIELD_OFF
    dbg.take = false
    takeSent.current = { on: false, at: Date.now() }
    if (was || uiRef.current.over) {
      logIslandUi('hover', 'mouse out (left the window)')
      dbgEvent('left the window')
      dispatch({ type: 'hover', on: false })
    }
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      lastPtr.current = { x: e.clientX, y: e.clientY }
      dbg.ptr = { x: e.clientX, y: e.clientY, at: Date.now() }
      evaluateRef.current()
    }
    const press = () => evaluateRef.current()
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('pointerdown', move, { capture: true, passive: true })
    window.addEventListener('pointerup', press, { capture: true, passive: true })
    const stopTaps = installTaps()
    // IC5: what waited while you pressed comes now.
    const stopPress = onPress((on) => {
      frozen.current = on
      if (on) return
      const evs = heldEvents.current
      heldEvents.current = []
      for (const ev of evs) dispatch(ev)
      if (heldSnap.current) {
        const x = heldSnap.current
        heldSnap.current = null
        setS(x)
      }
      evaluateRef.current()
    })
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerdown', move, true)
      window.removeEventListener('pointerup', press, true)
      stopTaps()
      stopPress()
      clearTimeout(recheckT.current)
    }
  }, [dispatch])
  // IS23: the zoom the click areas are measured in.
  useEffect(() => {
    logIslandUi('zoom', `size ${prefs.size} (page scale ×${scale}), screen scale ×${window.devicePixelRatio}, window ${window.innerWidth}×${window.innerHeight}`)
  }, [prefs.size, scale])

  // ---- drag (the pill, the peek or the panel's header); a plain click still opens ----
  // IS3: a drag needs 8 px and 120 ms held, so a small wobble while clicking is a click.
  // IS21: it always ends (pointer up anywhere, lost capture, the window losing focus).
  const dragged = useRef(false)
  // H1: the round menu closes when you drag well past it (so holding first never blocks a move).
  const ringClose = useRef<() => void>(() => {})
  const jx = useMotionValue(1)
  const jy = useMotionValue(1)
  const jelly = useMemo(() => makeJelly(jx, jy, () => fRef.current), [jx, jy])
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>, quick?: unknown) => {
      // Every press starts clean: an old drag never eats the next click.
      dragged.current = false
      if (e.button !== 0 || !desk()?.islandDrag) return
      const hit = (e.target as HTMLElement).closest('button, input, textarea, a, select, label')
      if (hit && hit !== e.currentTarget) return
      // H1: the grip drags at once (2 px, no hold); the rest needs 8 px and 120 ms.
      const fast = quick === true
      const minPx = fast ? 2 : DRAG_PX
      const minMs = fast ? 0 : DRAG_MS
      const el = e.currentTarget
      const id = e.pointerId
      const sx = e.screenX
      const sy = e.screenY
      const t0 = performance.now()
      let started = false
      let ended = false
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return
        if (document.documentElement.classList.contains('di-ring-open')) {
          // H1: well past the round menu means you want to move it: the menu closes and the drag starts.
          if (Math.hypot(ev.screenX - sx, ev.screenY - sy) < RING_RADIUS + 48) return
          ringClose.current()
          document.documentElement.classList.remove('di-ring-open')
        }
        // IM6: it stretches a little with the drag's speed.
        if (started) return jelly.move(ev)
        if (Math.hypot(ev.screenX - sx, ev.screenY - sy) < minPx || performance.now() - t0 < minMs) return
        started = true
        dragged.current = true
        try { el.setPointerCapture(id) } catch { /* fine */ }
        document.documentElement.classList.add('di-dragging')
        desk()?.islandDrag?.(true)
        logIslandUi('drag', 'started')
      }
      const end = (why: string) => () => {
        if (ended) return
        ended = true
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onCancel)
        el.removeEventListener('lostpointercapture', onLost)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('island-drag-cancel', onStuck)
        try { if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id) } catch { /* fine */ }
        if (started) {
          jelly.end()
          document.documentElement.classList.remove('di-dragging')
          desk()?.islandDrag?.(false)
          logIslandUi('drag', `ended (${why})`)
          pump(400)
        }
      }
      const onUp = end('let go')
      const onCancel = end('cancelled')
      const onLost = end('lost the pointer')
      const onBlur = end('window lost focus')
      const onStuck = end('the desktop ended it')
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onCancel)
      el.addEventListener('lostpointercapture', onLost)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('blur', onBlur)
      window.addEventListener('island-drag-cancel', onStuck)
    }
  }
  /** A click that wasn't the end of a drag (IS3). */
  const clicked = () => {
    if (dragged.current) {
      dragged.current = false
      return false
    }
    return true
  }

  // ---- taps: every one shows what happened ("Saving…", then ✓ or why not) ----
  const [toast, setToast] = useState<{ id: string; state: 'busy' | 'ok' | 'err'; text: string } | null>(null)
  const toastT = useRef<number | null>(null)
  const label = (a: IslandAction): string | null =>
    a.kind === 'water' ? `+${a.ml} ml water`
    : a.kind === 'reps' ? `+${a.n} ${a.name}`
    : a.kind === 'mustdo' ? 'Must-do'
    : a.kind === 'chat' ? 'Sent to Ben'
    : a.kind === 'start' ? `Timer: ${a.subject}`
    : a.kind === 'stop' ? 'Logged'
    : a.kind === 'extend' ? `+${a.minutes} min`
    : a.kind === 'bed' ? (a.time ? `Bed at ${a.time} · Waky` : 'Good night 🌙 · logged in Waky')
    : a.kind === 'wake' ? 'Good morning ☀️ · wake-up logged'
    : a.kind === 'push' ? `${a.block.title}: moved ${Math.abs(a.minutes)} min ${a.minutes < 0 ? 'earlier' : 'later'}`
    : a.kind === 'eventMark' ? (a.mark === 'done' ? `✓ ${a.block.title}: done` : a.mark === 'skip' ? `${a.block.title}: didn't go, noted` : `${a.block.title}: back to open`)
    : a.kind === 'blockKind' ? (a.to === 'event' ? `📅 ${a.title}: an event from now on` : `⏱ ${a.title}: a focus block from now on`)
    : a.kind === 'blockResult' ? (a.result === 'done' ? `✓ ${a.block.title}: done` : a.result === 'half' ? `½ ${a.block.title}: half done` : `${a.block.title}: not done, noted`)
    : a.kind === 'autoFocus' ? (a.on ? 'Focus starts by itself with each block' : 'Auto-start off')
    : a.kind === 'moveBreak' ? `💪 +${a.n} ${a.name} · nice break`
    : a.kind === 'eyeBreaks' ? (a.on ? 'Eye breaks on: every 20 min' : 'Eye breaks off')
    : a.kind === 'closeDay' ? 'Opening Close your day…'
    : a.kind === 'todoDone' ? `✓ ${a.content}`
    : a.kind === 'clipSave' ? (a.to === 'task' ? 'Adding to Todoist…' : 'Saving to Notebook…')
    : a.kind === 'book' ? 'Finding a free slot…'
    : a.kind === 'voice' ? '🎤 Sent to Ben'
    : a.kind === 'pause' ? '⏸ Paused'
    : a.kind === 'resume' ? '▶ Going on'
    : a.kind === 'setEnd' ? 'New end time'
    : a.kind === 'rename' ? `✎ ${a.subject}`
    : a.kind === 'undo' ? '↶ Undoing'
    : a.kind === 'drop' ? (a.file ? 'Adding to today’s note' : 'Saving the link')
    : a.kind === 'nudge' ? nudgeTapLabel(a.op)
    : null
  const clearToastLater = (ms: number) => {
    if (toastT.current) clearTimeout(toastT.current)
    toastT.current = window.setTimeout(() => setToast(null), ms)
  }
  useEffect(() => {
    desk()?.onIslandAck?.((ack) => {
      const lt = dbg.lastTap
      if (lt && lt.id === ack.id) {
        dbg.lastTap = { ...lt, rtt: Date.now() - lt.sentAt, took: ack.tookMs, ok: ack.ok }
        dbgEvent('tap answered', { kind: lt.kind, roundTripMs: dbg.lastTap.rtt, appMs: ack.tookMs ?? null, ok: ack.ok })
      }
      setToast((t) => (t && t.id === ack.id ? { ...t, state: ack.ok ? 'ok' : 'err', text: ack.ok ? (ack.text ?? `✓ ${t.text}`) : `⚠ ${plainError(ack.error)}` } : t))
      exp.ack(ack)
      // IC10: a log that went through: "↶ Undo" for 5 s (and Ctrl+Z).
      const u = ack.ok && undoCand.current?.id === ack.id
      if (u) setUndo({ id: ack.id, until: Date.now() + UNDO_SHOW_MS })
      clearToastLater(ack.ok ? (u ? UNDO_SHOW_MS : ack.text ? 4500 : 2200) : 7000)
    })
  }, [])
  // IC10: the last log you can take back, and the last water tap (the menu's "Undo last").
  const undoCand = useRef<{ id: string } | null>(null)
  const lastWater = useRef<string | null>(null)
  const [undo, setUndo] = useState<{ id: string; until: number } | null>(null)
  undoRef.current = undo
  useEffect(() => {
    if (!undo) return
    const t = window.setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()))
    return () => clearTimeout(t)
  }, [undo])
  const send = (a: IslandAction) => {
    islandActionSound(a, s)
    const t = label(a)
    dbgEvent('tap', { kind: a.kind })
    if (!t) {
      dbg.lastTap = { kind: a.kind, sentAt: Date.now() }
      return desk()?.islandAction?.(a)
    }
    const id = Math.random().toString(36).slice(2, 10)
    dbg.lastTap = { id, kind: a.kind, sentAt: Date.now() }
    setToast({ id, state: 'busy', text: t })
    if (toastT.current) clearTimeout(toastT.current)
    // No answer at all: the app window isn't running (or is stuck).
    toastT.current = window.setTimeout(
      () => setToast((x) => (x && x.id === id && x.state === 'busy' ? { id, state: 'err', text: "⚠ The app didn't answer. Is Life System running? Open it from the tray." } : x)),
      a.kind === 'chat' ? 120_000 : 12_000
    )
    // IC2: what it changes shows now. Reps keep their exercise id in `ex` (the tap's id takes `id`).
    exp.add(id, a)
    if (canUndo(a)) undoCand.current = { id }
    if (a.kind === 'water') lastWater.current = id
    desk()?.islandAction?.(a.kind === 'reps' ? { ...a, ex: a.ex ?? a.id, id } : { ...a, id })
  }
  const doUndo = (of: string) => {
    setUndo(null)
    undoCand.current = null
    if (lastWater.current === of) lastWater.current = null
    send({ kind: 'undo', of })
  }
  doUndoRef.current = doUndo
  const tap = (a: IslandAction, lbl?: string) => {
    if (a.kind === 'kit' || a.kind === 'kitCount') return send(a)
    // HD: wind-down's calm music plays on the island's own player (your calm station, else a calm starter).
    if (a.kind === 'calmMusic') {
      const st = calmStationOf([...(k.kit.music?.stations ?? []), ...STARTER_STATIONS])
      if (st) (islandSound('tap'), musicRun({ op: 'play', station: st }))
      return
    }
    if (a.kind === 'water') (setSplash((x) => ({ n: x.n + 1, ml: a.ml })), play('water'))
    if (lbl === 'Reply') {
      dispatch({ type: 'click' })
      openCmd()
      return send(a)
    }
    send(a)
    if (a.kind === 'open' || a.kind === 'closeDay') {
      desk()?.showApp?.(a.kind === 'open' ? a.page : 'today')
      close()
    }
    // Answered the thing that peeked: it goes back to the pill.
    if (uiRef.current.byAlert && (['dismiss', 'start', 'stop', 'push', 'blockResult', 'eventMark', 'moveBreak', 'clipSave', 'water'].includes(a.kind) || (a.kind === 'nudge' && NUDGE_CLOSES.has(a.op.op)))) close()
  }
  tapRef.current = tap
  // IC4: what Enter will do, live while you type (the same rules as the command bar).
  const [sel, setSel] = useState(0)
  const cmdRaw = useMemo<Suggestion[]>(() => {
    if (capture || !text.trim()) return []
    const t = Date.now()
    const meet = (s.now?.call && s.now.meet) || (s.next?.call && s.next.meet && s.next.start - t < 15 * 60_000 ? s.next.meet : null) || null
    return commandPreview(text, { now: t, running: s.running, tasks: s.tasks ?? [], meet, chips: prefs.chips, reps: s.reps, subject: s.now && !s.now.call ? s.now.title : 'Focus' })
  }, [text, capture, s, prefs.chips])
  // Only "Ask Ben": no list of its own; in the palette it stays first, so Enter still sends it to Ben.
  const sugg = cmdRaw.length === 1 && cmdRaw[0].action.kind === 'chat' ? [] : cmdRaw
  const palSugg = sugg.length ? sugg : cmdRaw
  // The palette: pages, quick logs, automations, stations and island steps.
  const sc = useSc()
  const muTint = useTint(sc, '#d4ff3f')
  const palAll = useMemo(() => paletteItems({
    pages: registeredPages().map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    autos: (s.auto?.buttons ?? []).map((b) => ({ id: b.id, name: b.name, icon: b.icon, fields: b.fields.length })),
    stations: k.kit.music?.stations ?? [],
    chips: prefs.chips,
    reps: s.reps,
    running: !!s.running,
    playing: sc.playing,
    musicLoaded: !!sc.loaded
  }), [s.auto, k.kit.music, prefs.chips, s.reps, s.running, sc.playing, sc.loaded, cmdOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const palList = useMemo(() => {
    if (!cmdOpen || capture) return []
    // What the command bar already offers (Log 500 ml…) isn't listed twice.
    const has = new Set(sugg.map((x) => x.action.kind))
    return filterPalette(palAll, text, text.trim() ? 6 : 8).filter((x) => !(x.run.kind === 'tap' && x.group === 'Do' && has.has(x.run.action.kind)))
  }, [palAll, text, cmdOpen, capture, sugg])
  const runPalette = (x: PaletteItem) => {
    const r = x.run
    setText('')
    setCmdOpen(false)
    cmdOpenRef.current = false
    dispatch({ type: 'typing', on: false })
    if (r.kind === 'page') return void window.dispatchEvent(new CustomEvent('life-island-page', { detail: r.id }))
    if (r.kind === 'tap') return tap(r.action, r.label)
    if (r.kind === 'music') return (islandSound('tap'), musicRun({ op: r.op }))
    if (r.kind === 'station') {
      const st = k.kit.music?.stations.find((y) => y.id === r.id)
      if (st) (islandSound('tap'), musicRun({ op: 'play', station: st }))
      return
    }
    if (r.op === 'quiet') return setQuiet(60)
    if (r.op === 'pin') return dispatch({ type: 'pin' })
    if (r.op === 'app') return (desk()?.showApp?.(), close())
    if (r.op === 'editPill') return setEditing(true)
    if (r.op === 'editPower') return (window.dispatchEvent(new CustomEvent('life-island-page', { detail: 'day' })), setPowerEdit(true))
    if (r.op === 'note' || r.op === 'task') return (setCapture(r.op === 'note' ? 'note' : true), openCmd())
    if (r.op === 'close') return close()
  }
  useEffect(() => setSel(0), [text])
  const closeCmd = () => {
    setCmdOpen(false)
    cmdOpenRef.current = false
    setCapture(false)
    input.current?.blur()
    if (!text.trim()) dispatch({ type: 'typing', on: false })
    window.setTimeout(() => panelEl.current?.focus({ preventScroll: true }), 20)
  }
  closeCmdRef.current = closeCmd
  const runSuggestion = (x: Suggestion) => {
    if (x.action.kind === 'chat') return chat(true)
    setText('')
    dispatch({ type: 'typing', on: false })
    tap(x.action)
    setCmdOpen(false)
  }
  const chat = (asIs = false): void => {
    const t = text.trim()
    const pickItem = !asIs && !capture ? palList[sel - palSugg.length] : undefined
    if (pickItem) return runPalette(pickItem)
    if (!t) return
    const pick = asIs ? null : palSugg[sel]
    if (pick && pick.action.kind !== 'chat') return runSuggestion(pick)
    // P4: in capture mode it's a Todoist task, not a message to Ben.
    if (capture) {
      setText('')
      setCapture(false)
      dispatch({ type: 'typing', on: false })
      send({ kind: 'clipSave', to: capture === 'note' ? 'note' : 'task', text: t, alertId: 'capture' })
      setCmdOpen(false)
      return
    }
    if (s.ben.busy) {
      // IS24: say why nothing happened (your text stays in the box).
      setToast({ id: 'busy', state: 'err', text: 'Ben is still answering' })
      clearToastLater(3000)
      return
    }
    setText('')
    dispatch({ type: 'typing', on: false })
    send({ kind: 'chat', text: t })
    setCmdOpen(false)
  }

  // IS18: no fresh picture for a minute: dim and say so; the next snapshot brings it back.
  const old = !s.locked && s.at > 0 && now - Math.max(s.at, beatAt.current) > STALE_MS
  // IS7: a scene that finishes (the eye break's 20 s) only answers its reminder;
  // it never closes the panel or clears what you pinned or typed.
  const alertDone = (id: string) => {
    send({ kind: 'dismiss', id })
    if (uiRef.current.byAlert && uiRef.current.view === 'peek') dispatch({ type: 'alertEnd' })
  }
  // IS11: a meeting without a call link: quiet until it ends.
  const muteForMeeting = () => {
    const end = s.now?.end ?? Date.now() + 30 * 60_000
    desk()?.islandQuiet?.(Math.max(1, Math.round((end - Date.now()) / 60_000)))
    setToast({ id: 'mute', state: 'ok', text: `🔕 Reminders off until ${hhmm(end)}` })
    clearToastLater(3000)
  }
  const water = s.water
  const mustOpen = s.mustdos.filter((m) => !m.done).length
  const [moon, setMoon] = useState(false)
  const goToBed = () => {
    setMoon(true)
    send({ kind: 'bed' })
    window.setTimeout(() => (setMoon(false), setAsleep(true), close()), 2600)
  }
  const pts = s.points
  // IM4: a short celebration (all must-dos done, the day's water, a focus
  // block ended on time, a new best streak): a burst and the pill stretched
  // wide with what happened, from the difference between two snapshots. Full only.
  const [moment, setMoment] = useState<Moment | null>(null)
  const prevSnap = useRef<IslandSnapshot | null>(null)
  const momentT = useRef(0)
  const celebrated = useRef(new Set<string>())
  useEffect(() => {
    const before = prevSnap.current
    prevSnap.current = s
    const m = momentsFrom(before, s, Date.now()).find((x) => !celebrated.current.has(x.id))
    if (!m) return
    celebrated.current.add(m.id)
    if (!fRef.current.extras || uiRef.current.view === 'expanded') return
    logIslandUi('moment', m.text)
    setMoment(m)
    clearTimeout(momentT.current)
    momentT.current = window.setTimeout(() => setMoment(null), 2600)
    window.setTimeout(() => burstFrom(shape.current, m.colors, 60), 160)
  }, [s])
  useEffect(() => () => clearTimeout(momentT.current), [])
  useIslandSoundEvents({ view: ui.view, snap: s, momentId: moment?.id, toastErr: toast?.state === 'err' ? `${toast.id}:${toast.text}` : null, over: ui.over })
  // Island 2: an eye break / tidy minute countdown or a breathing minute runs on the pill; done, it's noted.
  const [nudgeRun, setNudgeRun] = useState<NudgeRun | null>(null)
  const startNudgeRun = (r: NudgeRun) => {
    setNudgeRun(r)
    close()
  }
  const endNudgeRun = (done: boolean) => {
    const r = nudgeRun
    setNudgeRun(null)
    if (!r) return
    const kind = r.kind
    send({ kind: 'nudge', op: done ? { op: 'tally', kind, ok: true, alertId: r.alertId } : { op: 'close', alertId: r.alertId } })
  }
  // IC13: after "Going to bed", the pill becomes the moon until morning.
  const [asleep, setAsleep] = useState(false)
  useEffect(() => {
    if (asleep && (s.sleep?.wake || s.running)) setAsleep(false)
  }, [asleep, s.sleep?.wake, s.running])
  // IM7: while you drag, where it will snap to.
  const [ghost, setGhost] = useState<string | null>(null)
  // IC17: the pill's edit mode in the panel.
  const [editing, setEditing] = useState(false)
  // MU: the Music page of the opened island (the header's ♫, the music tile, the media row open it).
  useMusicPage(k, () => {
    if (uiRef.current.view !== 'expanded') dispatch({ type: 'click' })
  })
  const savePillOrder = (pillOrder: IslandPrefs['pillOrder']) => {
    setPrefs((p) => ({ ...p, pillOrder }))
    void desk()?.setIslandPrefs?.({ pillOrder })
  }
  // IL6: new points fly into the pill as a spinning coin, water as a drop;
  // the pill gives a small gulp when they land. A reward unlocking gets confetti.
  const [flights, setFlights] = useState<Flight[]>([])
  const fly = useCallback((kind: Flight['kind'], text: string) => {
    if (fRef.current.mode === 'off') return
    const id = Date.now() + Math.random()
    setFlights((x) => [...x.slice(-2), { id, kind, text }])
    window.setTimeout(() => setFlights((x) => x.filter((y) => y.id !== id)), 1500)
    if (fRef.current.moves)
      window.setTimeout(() => {
        bump(shape.current, fRef.current, 1.035)
        pump(450)
      }, 560)
  }, [pump])
  const prevPts = useRef<number | null>(null)
  useEffect(() => {
    const b = s.points?.balance
    if (b == null) return
    const before = prevPts.current
    prevPts.current = b
    if (before != null && b > before) fly('coin', `+${b - before}`)
  }, [s.points?.balance, fly])
  const prevWater = useRef<number | null>(null)
  useEffect(() => {
    const { ml, target } = s.water
    // Only real pictures count (not the empty one before the first snapshot).
    if (s.locked || !s.at) return
    const before = prevWater.current
    prevWater.current = ml
    if (before == null || ml <= before) return
    fly('drop', `+${ml - before} ml`)
    // The day's water reached: the glasses shimmer, once.
    if (target > 0 && before < target && ml >= target) setShimmer((n) => n + 1)
  }, [s.water.ml, s.water.target, fly]) // eslint-disable-line react-hooks/exhaustive-deps
  // Hold 🎤 to talk to Ben (a voice note, like on Telegram).
  const [rec, setRec] = useState<{ r: MediaRecorder; parts: Blob[]; at: number } | null>(null)
  const startRec = async () => {
    if (rec || s.ben.busy) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      const parts: Blob[] = []
      r.ondataavailable = (e) => e.data.size && parts.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (Date.now() - started < 700) return
        const blob = new Blob(parts, { type: r.mimeType.split(';')[0] })
        const fr = new FileReader()
        fr.onload = () => send({ kind: 'voice', mime: blob.type || 'audio/webm', data: String(fr.result).split(',')[1] ?? '' })
        fr.readAsDataURL(blob)
      }
      const started = Date.now()
      r.start()
      setRec({ r, parts, at: started })
      dispatch({ type: 'typing', on: true })
    } catch {
      setToast({ id: 'mic', state: 'err', text: '⚠ No microphone (allow it for Life System in Windows privacy settings)' })
      clearToastLater(6000)
    }
  }
  const stopRec = () => {
    if (!rec) return
    rec.r.stop()
    setRec(null)
    dispatch({ type: 'typing', on: !!text.trim() })
  }
  // P9: the shortcut toggles recording (press to start, press again to send).
  const recRef = useRef({ rec, startRec, stopRec })
  recRef.current = { rec, startRec, stopRec }
  useEffect(() => {
    // JV1: with Voice on, the shortcut is push-to-talk on this PC (no voice note).
    const on = () => (islandVoiceOn() && !recRef.current.rec ? void window.dispatchEvent(new Event('island-voice-ptt')) : recRef.current.rec ? recRef.current.stopRec() : void recRef.current.startRec())
    window.addEventListener('island-voice-toggle', on)
    return () => window.removeEventListener('island-voice-toggle', on)
  }, [])
  // Drop a task (text) on the island: booked in the next free slot today.
  const [dropping, setDropping] = useState(false)
  // IC8: a link (to Notebook, a Todoist task: focus on it), an image or a PDF (today's note) too.
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.types].some((t) => t === 'text/plain' || t === 'text/uri-list' || t === 'Files')) {
        e.preventDefault()
        setDropping(true)
      }
    },
    onDragLeave: () => setDropping(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDropping(false)
      const dt = e.dataTransfer
      const file = dt.files?.[0] ?? null
      // IN48: with the file shelf on, dropped files are kept there (their place on disk, never a copy).
      if (file && k.kit.shelf) {
        void shelfDrop(dt.files).then((ok) => {
          setToast({ id: 'drop', state: ok ? 'ok' : 'err', text: ok ? '🗂 On the file shelf' : '⚠ That file can’t go on the shelf' })
          clearToastLater(2500)
        })
        return
      }
      const uris = (dt.getData('text/uri-list') || '').split(/\r?\n/)
      const text = dt.getData('text/plain').trim()
      const d = classifyDrop({ uris, text, files: file ? [{ name: file.name, type: file.type, size: file.size }] : [] })
      if (d.kind === 'refuse') {
        setToast({ id: 'drop', state: 'err', text: `⚠ ${d.why}` })
        return clearToastLater(4000)
      }
      if (d.kind === 'text') return send({ kind: 'book', text: d.text })
      if (d.kind === 'link' || d.kind === 'todoist') return send({ kind: 'drop', link: d.url })
      if (!file) return
      const fr = new FileReader()
      fr.onload = () => send({ kind: 'drop', file: { name: d.name, mime: d.mime, size: d.size, data: String(fr.result).split(',')[1] ?? '' } })
      fr.readAsDataURL(file)
    }
  }

  // IF10: your quick chips.
  const repN = prefs.chips.reps[0] ?? 10
  const focusMin = prefs.chips.focus[0] ?? 25
  const blocks: Record<IslandSection, ReactNode> = {
    tasks: s.tasks?.length ? (<section className="di-tasks">
                  <span className="di-label">Todoist · next up{s.tasksStale && s.tasksAt ? ` · updated ${Math.max(1, Math.round((now - s.tasksAt) / 60000))} min ago` : ''}</span>
                  {s.tasks.map((t) => (
                    <button key={t.id} className="di-task" {...tp(`task:${t.id}`, () => send({ kind: 'todoDone', id: t.id, content: t.content }))} title="Done: tick it in Todoist">
                      <i />
                      <span>{t.content}</span>
                      {t.time && <small>{t.time}</small>}
                    </button>
                  ))}
                </section>) : null,
    // One morning card: while the good-morning card shows, it carries the wake-up ask (no second "I'm up").
    sleep: s.sleep?.bed || (s.sleep?.wake && s.alert?.kind !== 'morning') ? (<section className={`di-sleep ${s.sleep?.bed ? 'night' : 'day'} ${moon ? 'going' : ''}`}>
                  {s.sleep?.bed ? (
                    <>
                      <span className="di-moon" aria-hidden>🌙<i>✦</i><i>✦</i><i>✦</i></span>
                      <div className="di-sleep-mid">
                        <b>{moon ? 'Sleep well' : 'Bedtime'}</b>
                        <small>{moon ? 'Logged in Waky. See you tomorrow.' : s.windDown ? `Bed at ${s.windDown.bedAt} · ${s.windDown.minutesLeft} min to wind down` : `Target ${s.sleep.target ?? '23:00'} · one tap logs it in Waky`}</small>
                        {s.windDown && !moon && (
                          <ol className="di-steps">
                            <li><button {...tp('closeDay', () => tap({ kind: 'closeDay' }))}>Tomorrow's top 3 + close the day</button></li>
                            <li>Screens off, phone away</li>
                            <li>Tap Going to bed</li>
                          </ol>
                        )}
                      </div>
                      <button className="primary" {...tp('bed', goToBed)} disabled={moon}>🌙 Going to bed</button>
                    </>
                  ) : (
                    <>
                      <span className="di-sun" aria-hidden>☀️</span>
                      <div className="di-sleep-mid">
                        <b>Good morning</b>
                        <small>Log your wake-up in Waky</small>
                      </div>
                      <button className="primary" {...tp('wake', () => tap({ kind: 'wake' }))}>☀️ I'm up</button>
                    </>
                  )}
                </section>) : null,
    points: pts ? (<section className="di-points">
                  <span className="di-pts"><Roll text={String(pts.balance)} up /> pts</span>
                  {pts.goal ? (
                    <div className="di-pts-mid">
                      <div className="di-bar gold pbar"><i style={{ '--p': Math.min(1, pts.balance / pts.goal.price) } as React.CSSProperties} /></div>
                      <small>{pts.balance >= pts.goal.price ? `Ready: ${pts.goal.title} 🎉` : `${pts.goal.price - pts.balance} to ${pts.goal.title}`}</small>
                    </div>
                  ) : (
                    <small className="di-pts-mid">Add a reward to work toward</small>
                  )}
                  <button {...tp('rewards', () => tap({ kind: 'open', page: 'shop' }))}>Rewards</button>
                  {s.money && (
                    <button className={`di-money lv-${s.money.level}`} {...tp('money', () => tap({ kind: 'open', page: 'money' }))} title="Safe to spend today (Finance Helper)">
                      💸 {Math.round(Math.abs(s.money.left) / 100)} lei {s.money.left >= 0 ? 'left' : 'over'}
                    </button>
                  )}
                </section>) : null,

    timer: run ? (<section className="di-timer">
                  <LiveTimer run={run} big guard={s.focusGuard} />
                  <div className="di-actions col">
                    <button className="primary" {...tp('panel:stop', () => tap({ kind: 'stop' }))}>Stop & log</button>
                    <button {...tp('panel:extend', () => tap({ kind: 'extend', minutes: 5 }))}>+5 min</button>
                  </div>
                </section>) : null,
    plan: (<section className="di-plan">
                <div className="di-row">
                  <span className="di-label">Now</span>
                  {s.now ? (
                    <div className="di-block">
                      {run ? <b>{s.now.title}</b> : (
                        <Fly id={`ti-now:${s.now.start}`} pos className="di-title-fly">
                          <b>{s.now.title}</b>
                        </Fly>
                      )}
                      <small>
                        {hhmm(s.now.start)}–{hhmm(s.now.end)} · {minsText(s.now.end - now)} left
                      </small>
                      <div className="di-bar pbar"><i style={{ '--p': Math.max(0, Math.min(1, (now - s.now.start) / (s.now.end - s.now.start))) } as React.CSSProperties} /></div>
                    </div>
                  ) : (
                    <div className="di-block muted">
                      <b>{s.ben.move?.title ?? 'Free time'}</b>
                      <small>{s.ben.move?.sub ?? 'Nothing planned right now.'}</small>
                    </div>
                  )}
                  {s.now && s.now.kind === 'event' && !s.now.call && (
                    // An event (a class, a commute): no timer, just ✓ when you're there.
                    s.now.mark ? (
                      <button className={`di-ev-mark ${s.now.mark}`} {...tp('plan:evundo', () => tap({ kind: 'eventMark', block: s.now!, mark: null }))} title="Tap to undo">
                        {s.now.mark === 'done' ? '✓ Done' : "Didn't go"}
                      </button>
                    ) : (
                      <span className="di-ev-btns">
                        <button className="di-go" {...tp('plan:evdone', () => tap({ kind: 'eventMark', block: s.now!, mark: 'done' }))}>✓ Done</button>
                        <button className="di-ev-skip" {...tp('plan:evskip', () => tap({ kind: 'eventMark', block: s.now!, mark: 'skip' }))}>Didn't go</button>
                      </span>
                    )
                  )}
                  {!run && s.now && !s.now.call && s.now.kind !== 'event' && (
                    <button className="di-go" {...tp('plan:start', () => tap({ kind: 'start', subject: s.now!.title, minutes: Math.max(5, Math.min(90, Math.round((s.now!.end - now) / 60000))) }))}>
                      Start
                    </button>
                  )}
                  {s.now?.call && s.now.meet && (
                    <button className="di-go" {...tp('plan:join', () => tap({ kind: 'join', url: s.now!.meet! }))}>
                      Join
                    </button>
                  )}
                </div>
                {s.next && (
                  <div className="di-row">
                    <span className="di-label">Next</span>
                    <div className="di-block">
                      <b>{s.next.title}</b>
                      <small>
                        {hhmm(s.next.start)}–{hhmm(s.next.end)} · in {minsText(s.next.start - now)}
                        {s.next.kind === 'event' ? ' · event' : ''}
                      </small>
                    </div>
                    {s.next.kind === 'event' && !s.next.call && (
                      <button className={`di-ev-tick ${s.next.mark === 'done' ? 'on' : ''}`} aria-label={s.next.mark === 'done' ? `Undo done: ${s.next.title}` : `Done: ${s.next.title}`} {...tp('plan:nextdone', () => tap({ kind: 'eventMark', block: s.next!, mark: s.next!.mark === 'done' ? null : 'done' }))}>✓</button>
                    )}
                  </div>
                )}
                {(s.maybe ?? []).map((b) => (
                  <div key={`${b.id ?? b.title}:${b.start}`} className="di-row di-maybe" title={b.maybe === 'invite' ? "You haven't answered this invite: it doesn't count until you accept it in your calendar" : 'You said maybe: it shows here, but never as Now'}>
                    <span className="di-label">{b.maybe === 'invite' ? 'Invite' : 'Maybe'}</span>
                    <div className="di-block">
                      <b>{b.title}</b>
                      <small>
                        {hhmm(b.start)}
                        {b.start > now ? ` · in ${minsText(b.start - now)}` : ''}
                        {b.maybe === 'invite' ? ' · Invite: accept?' : ' · maybe'}
                      </small>
                    </div>
                  </div>
                ))}
                <label className="di-auto" title="When a block from your calendar begins, its focus timer starts by itself (not for meetings)">
                  <input type="checkbox" checked={!!s.autoFocus} onChange={(e) => send({ kind: 'autoFocus', on: e.target.checked })} />
                  <span>⚡ Start focus by itself when a block begins</span>
                </label>
              </section>),
    mustdos: s.mustdos.length ? (<section className="di-must">
                  <span className="di-label">Must-dos · {mustOpen ? `${mustOpen} left` : 'all done 🎉'}</span>
                  {s.mustdos.map((m) => (
                    <button key={m.i} className={`di-check ${m.done ? 'done' : ''}`} {...tp(`must:${m.i}`, () => tap({ kind: 'mustdo', i: m.i }))}>
                      <i>{m.done ? '✓' : ''}</i>
                      <span>{m.text}</span>
                    </button>
                  ))}
                </section>) : null,
    logs: (<section className="di-logs">
                <div className="di-water">
                  <Glass pct={water.target ? water.ml / water.target : 0} size={40} splash={splash} shimmer={shimmer} />
                  <div className="di-water-mid">
                    <small>
                      <Roll text={(water.ml / 1000).toFixed(2).replace(/0$/, '')} up /> / {(water.target / 1000).toFixed(1)} L
                    </small>
                    <div className="di-bar water"><i style={{ transform: `scaleX(${water.target ? Math.min(1, water.ml / water.target) : 0})` }} /></div>
                  </div>
                  {prefs.chips.water.slice(0, 3).map((ml) => (
                    <WaterBtn key={ml} ml={ml} onTap={(v) => tap({ kind: 'water', ml: v })}>+{ml}</WaterBtn>
                  ))}
                </div>
                {!!s.reps.length && (
                  <div className="di-reps">
                    {s.reps.map((r) => (
                      <RepBtn key={r.id} r={r} n={repN} onTap={() => tap({ kind: 'reps', id: r.id, name: r.name, n: repN })} />
                    ))}
                  </div>
                )}
                <label className="di-auto" title="Every 20 min at the screen: look at something 6 m away for 20 s">
                  <input type="checkbox" checked={!!s.eyeBreaks} onChange={(e) => send({ kind: 'eyeBreaks', on: e.target.checked })} />
                  <span>👁️ 20-20-20 eye breaks</span>
                </label>
              </section>),
    // IM3: a slow wave while Ben thinks, then his first words fade in.
    ben: s.ben.busy || s.ben.last ? (<section className="di-ben">
                <BenThinking busy={s.ben.busy} step={s.ben.steps[s.ben.steps.length - 1]} last={s.ben.last} onReply={focusInput} />
              </section>) : null
  }
  // ---- compact: the pill ----
  const pillTime = (a: Activity) => {
    if (a.kind === 'timer' && run) return <LiveTimer run={run} />
    if (a.kind === 'next' && a.at && a.at - Date.now() <= 10 * 60_000) return <LiveCountdown at={a.at} />
    // IC13: the minutes to bed roll down in moonlight blue.
    if (a.kind === 'winddown') return <Roll className="di-pill-time moon" text={bedClock(windDownLeft(s, now) ?? 0)} />
    const t = a.kind === 'water' ? '' : a.sub
    return <span className={`di-pill-time ${a.over ? 'over' : ''}`}>{place === 'left' || place === 'right' ? String(t ?? '').replace(/\s*left$/i, '') : t}</span>
  }
  // IF8: what each click does (left / middle / right), your choice.
  const clickAction = (what: ClickAction) => {
    logIslandUi('click', what)
    if (what === 'panel') return dispatch({ type: 'click' })
    if (what === 'app') return desk()?.showApp?.()
    if (what === 'timer') return run ? tap({ kind: 'stop' }) : tap({ kind: 'start', subject: s.now && !s.now.call ? s.now.title : 'Focus', minutes: focusMin })
    // IC7: the menu for what the pill shows (nothing to offer: the panel).
    if (what === 'menu') {
      const items = menuFor(main, s, prefs.chips, !!lastWater.current)
      return items.length ? setMenu(items) : dispatch({ type: 'click' })
    }
    if (quiet) return setQuiet(null)
    dispatch({ type: 'click' })
    setQuietMenu(true)
  }
  // IC7: the menu's picks.
  const [menu, setMenu] = useState<MenuItem[] | null>(null)
  const meetOf = () => (main?.kind === 'next' ? s.next : s.now)?.meet ?? null
  const pickMenu = (m: MenuItem) => {
    setMenu(null)
    if (m.act === 'copyLink') {
      const url = meetOf()
      if (url) desk()?.islandCopy?.(url)
      setToast({ id: 'copy', state: url ? 'ok' : 'err', text: url ? '🔗 Link copied' : '⚠ That meeting has no call link' })
      return clearToastLater(2500)
    }
    if (m.act === 'mute') return muteForMeeting()
    if (m.act === 'undoWater') return void (lastWater.current && doUndo(lastWater.current))
    if (m.act !== 'rename') tap(m.act)
  }
  // IC3: hold the pill for the round menu; slide and let go to fire.
  // H1: Move and Hide in the round menu too.
  const ringList = useMemo(() => [...ringItems(s, prefs.chips), ...ringKitItems(k), { id: 'ring:move', icon: '✥', label: 'Move', act: 'move' as const }, { id: 'ring:hide', icon: '🙈', label: 'Hide 1 h', act: 'hide' as const }], [s, prefs.chips, k.buttons])
  const ringCtl = useRing({
    on: prefs.controls.ring && !s.locked && uiRef.current.view !== 'expanded',
    items: ringList,
    fire: (it: RingItem) => {
      logIslandUi('click', `round menu: ${it.id}`)
      if (it.act === 'ask') {
        dispatch({ type: 'click' })
        return focusInput()
      }
      if (it.act === 'quiet') return clickAction('quiet')
      if (it.act === 'move') return desk()?.islandMoveMode?.()
      if (it.act === 'hide') return desk()?.islandHide?.('1h')
      tap(it.act)
    },
    toLocal: (x, y) => {
      const b = rootEl.current?.getBoundingClientRect()
      const k = scaleRef.current || 1
      return b ? { x: (x - b.left) / k, y: (y - b.top) / k } : { x, y }
    }
  })
  ringClose.current = ringCtl.close
  // IC4: the left click fires on release (the browser's click can get lost while the pill redraws).
  const clickProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      dragProps.onPointerDown(e)
      ringCtl.onPointerDown(e)
    },
    ...tp('pill', () => {
      // The round menu's release is its own (it fires what you slid to).
      if (!clicked() || ringCtl.ringOpen()) return
      if (s.locked) desk()?.showApp?.()
      else clickAction(prefs.clicks.left)
    }),
    // The middle button would start the browser's scroll mode.
    onMouseDown: (e: React.MouseEvent) => { if (e.button === 1) e.preventDefault() },
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      if (s.locked) desk()?.showApp?.()
      else clickAction(prefs.clicks.middle)
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (s.locked) desk()?.showApp?.()
      else clickAction(prefs.clicks.right)
    }
  }
  const nowBlock = s.now
  const icon = (a: Activity, size = 22) =>
    a.kind === 'timer' && run ? <LiveRing run={run} size={size} />
    : a.kind === 'now' && nowBlock && a.key === `now:${nowBlock.start}` ? <SmoothRing from={nowBlock.start} to={nowBlock.end} size={size} />
    : a.kind === 'winddown' ? <Crescent pct={a.pct} size={size - 2} />
    : <ActIcon a={a} face={s.ben.face} size={size} />
  // IL4: the activity you switch to slides in from the side you swiped to.
  // IM9: the title turns like a page (perspective on .di-turn); IM13: the icon
  // and time are the same parts in every activity, so they glide to their new
  // place and swap (Full). Calm: a crossfade; Off: a jump.
  const slide = f.moves ? { enter: {}, center: {}, exit: {} } : { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
  const turn = pageTurn(f)
  const slotFade = { enter: { opacity: 0, scale: 0.7 }, center: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.7 } }
  // IM1: the pill's ends per activity: a calendar tile with the time for a meeting, a drop for water.
  const meetAt = (a: Activity) => (a.kind === 'now' && s.now?.call ? s.now.start : a.kind === 'next' && s.next?.call ? s.next.start : null)
  const rings = todayRings(s)
  const compact = (
    <div
      className={`di-pill kind-${s.locked ? 'locked' : s.ben.busy && main?.kind !== 'timer' ? 'think' : main?.kind ?? 'idle'}`}
      role="button"
      tabIndex={0}
      {...dragProps}
      {...clickProps}
      onKeyDown={(e) => (e.key === 'Enter' ? dispatch({ type: 'click' }) : e.key === 'ArrowRight' ? cycle(1) : e.key === 'ArrowLeft' ? cycle(-1) : undefined)}
      onWheel={onWheel}
      // H1: a double-click tucks it into a small dot (a click on the dot brings it back).
      onDoubleClick={(e) => { e.preventDefault(); dispatch({ type: 'close' }); desk()?.islandHide?.('dot') }}
      aria-label="Open the island (drag to move it, double-click to tuck it away, arrows or the mouse wheel switch)"
    >
      <GripHandle onPointerDown={(e) => { e.stopPropagation(); dragProps.onPointerDown(e, true) }} />
      {/* Music: the artwork ring and equalizer; with nothing else on the pill, the song's title too. */}
      <ScPillBadge music={k.kit.music} title={!main && !s.ben.busy && !s.locked} />
      {s.locked ? (
        <span className="di-pill-text">🔒 Open Life System</span>
      ) : old ? (
        <>
          <span className="di-face-sm">{s.ben.face}</span>
          <span className="di-pill-text di-reconnect">Reconnecting…</span>
        </>
      ) : s.ben.busy && main?.kind !== 'timer' ? (
        // IM3: Ben is thinking: a slow wave in the pill.
        <span className="di-pill-main di-pill-think">
          <span className="di-face-sm">{s.ben.face}</span>
          <ThinkWave />
          <span className="di-pill-text">Ben is thinking…</span>
        </span>
      ) : !main ? (
        <Fly id="ic-idle">
          {/* IC5: today's three rings around Ben's face. */}
          <TodayRing must={rings.must} water={rings.water} focus={rings.focus} size={28}>
            <span className="di-face-sm">{s.ben.face}</span>
          </TodayRing>
        </Fly>
      ) : (
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.span key={main.key} className="di-pill-main" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={f.pop}>
            {meetAt(main) != null && <CalendarCap at={meetAt(main)!} />}
            <Fly id={`ic-${main.key}`}>
              <motion.span className="di-slot" layoutId={flyId(f, 'pill-ic')} variants={f.moves ? slotFade : undefined} transition={f.fly}>{icon(main)}</motion.span>
            </Fly>
            <span className="di-turn">
              <motion.span className="di-turn-in" custom={dir} variants={turn} transition={f.pop}>
                <Fly id={`ti-${main.key}`} pos className="di-pill-title">
                  <Marquee className="di-pill-text" text={main.kind === 'timer' ? main.sub : main.kind === 'next' ? `Next: ${main.text}` : main.kind === 'winddown' ? 'Bed in' : main.text} />
                </Fly>
              </motion.span>
            </span>
            <Fly id={`tm-${main.key}`}>
              <motion.span className="di-slot" layoutId={flyId(f, 'pill-tm')} variants={f.moves ? slotFade : undefined} transition={f.fly}>{pillTime(main)}</motion.span>
            </Fly>
            {main.kind === 'timer' && <StageDots dots={run?.dots} />}
            {main.kind === 'water' && <DropCap pct={main.pct} />}
          </motion.span>
        </AnimatePresence>
      )}
      {!s.locked && !old && <IslandMoveBadge move={s.move} now={now} />}
      {!s.locked && !old && <HealthBadge health={s.health?.today} />}
      {p.dot && <i className={`di-dot ${main?.kind === 'next' && main.at && main.at - now <= 10 * 60_000 ? 'tick' : ''}`} />}
      {acts.length > 1 && !s.locked && (
        <span className="di-dots" aria-hidden>
          {acts.slice(0, 5).map((x) => (
            <i key={x.key} className={x === main ? 'on' : ''} {...tp(`dot:${x.key}`, () => pickKey(x.key))} />
          ))}
        </span>
      )}
      {/* System / AI usage: usage rings, CPU and memory, the 70% / 90% notice (each only when on). */}
      {!s.locked && !old && <SysPill />}
      {!s.locked && look.clock !== 'off' && <IslandClock kind={look.clock} color={look.clockColor || undefined} />}
      {/* IN35: your one-tap buttons (shown while the mouse is on the pill). */}
      {!s.locked && <PillKitButtons k={k} />}
    </div>
  )

  // IL2: the second live thing, a small round bubble beside the pill (click: it becomes the pill).
  const side = place === 'right' || place === 'top-right' ? -1 : 1
  const bubbleIcon = (b: Activity) =>
    b.kind === 'timer' && run ? (
      <>
        <SmoothRing from={run.startedAt} to={run.endsAt} size={26} stroke={2.4} timer />
        <b className="di-bubble-num">{Math.max(0, Math.ceil((run.endsAt - now) / 60_000))}</b>
      </>
    ) : b.kind === 'next' && b.at ? (
      <b className="di-bubble-num soon tick">{Math.max(0, Math.ceil((b.at - now) / 60_000))}m</b>
    ) : (
      <>
        <span className="di-face-sm">{s.ben.face}</span>
        <i className="di-bubble-dot" />
      </>
    )
  const hushedNow = q.until > Date.now() || (inCall && prefs.callMode === 'dot') || (q.fullscreen && q.fullscreenMode === 'dot')
  const bubbleOn = !!bubble && ui.view === 'compact' && !hushedNow && !s.locked && !old
  const bubbleEl = bubbleOn && bubble ? (
    <motion.button
      key="bubble"
      data-hot
      className={`di-bubble kind-${bubble.kind}`}
      title={bubble.kind === 'timer' ? `Timer: ${bubble.sub}` : bubble.kind === 'next' ? `Next: ${bubble.text}` : `Ben: ${bubble.text}`}
      aria-label={bubble.kind === 'timer' ? `Show the timer: ${bubble.sub}` : bubble.kind === 'next' ? `Show next: ${bubble.text}` : "Show Ben's message"}
      initial={f.moves ? { opacity: 0, scale: 0.3, x: side * -24 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={f.moves ? { opacity: 0, scale: 0.3, x: side * -24 } : { opacity: 0 }}
      transition={f.pop}
      onAnimationStart={() => pump(700)}
      onAnimationComplete={() => sendHot(true)}
      {...tp('bubble', () => pickKey(bubble.key))}
    >
      {bubbleIcon(bubble)}
    </motion.button>
  ) : null

  // ---- peek: the alert, or what's on with one action and Ben's last line ----
  // IC20: a press held still opens the panel before the release (a drag still drags).
  const earlyOpen = useEarlyOpen(() => dispatch({ type: 'click' }), DRAG_MS + 60, DRAG_PX)
  const quick = quickButtons(main, s, prefs.chips, now)
  const a = s.alert && gateOf(s.alert.kind) !== 'drop' ? s.alert : null
  const benLine = s.ben.last?.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const peek = a && (ui.byAlert || !main) ? (
    <div className={`di-peek alert kind-${a.kind} mood-${s.ben.mood}`} {...tp('peek', () => clicked() && dispatch({ type: 'click' }))} {...dragProps}>
      {a.kind === 'recap' && a.recap ? <EveningScene recap={a.recap} /> : (!a.nudge || a.nudge.type === 'move') && <AlertScene kind={a.kind} water={s.water} splash={splash} shimmer={shimmer} title={a.title} onAlertDone={() => alertDone(a.id)} />}
      <div className="di-peek-top">
        <span className={`di-peek-face ${a.kind === 'ben' ? 'ben-in' : ''}`}>{a.face ?? (a.kind === 'ben' ? s.ben.face : a.kind === 'over' ? '⏰' : '▶')}</span>
        <div className="di-peek-mid">
          <b>{a.title}</b>
          <small>{a.kind === 'ben' ? <TypeIn key={a.id} text={a.text} /> : a.text}</small>
        </div>
      </div>
      {a.nudge ? (
        <IslandNudgeCard a={a} tap={tap} onRun={startNudgeRun} sound={!!prefs.sound} volume={prefs.volume} />
      ) : a.actions.length > 0 && (
        <div className="di-actions">
          {a.actions.slice(0, 3).map((x) => (
            <button key={x.label} className={x.primary ? 'primary' : ''} {...tp(`peek:alert:${x.label}`, () => tap(x.action, x.label))}>{x.label}</button>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="di-peek" {...tp('peek', () => clicked() && dispatch({ type: 'click' }))} {...dragProps} onPointerDown={(e) => (dragProps.onPointerDown(e), earlyOpen(e))} onWheel={onWheel}>
      <div className="di-peek-top">
        <GripHandle onPointerDown={(e) => { e.stopPropagation(); dragProps.onPointerDown(e, true) }} />
        {main ? (
          <Fly id={`ic-${main.key}`} className="di-peek-ico">
            {(main.kind === 'timer' && run) || main.kind === 'now' ? icon(main, 34) : <span className="di-peek-face">{main.kind === 'ben' ? s.ben.face : icon(main, 24)}</span>}
          </Fly>
        ) : (
          <Fly id="ic-idle">
            <TodayRing must={rings.must} water={rings.water} focus={rings.focus} size={38}>
              <span className="di-peek-face">{s.ben.face}</span>
            </TodayRing>
          </Fly>
        )}
        <div className="di-peek-mid">
          <b>
            {main ? (
              <Fly id={`ti-${main.key}`} pos className="di-title-fly">
                <Marquee text={main.kind === 'timer' ? main.sub : main.text} />
              </Fly>
            ) : (
              s.ben.move?.title ?? 'Nothing running'
            )}
          </b>
          <small>
            {main ? (
              <Fly id={`tm-${main.key}`}>{main.kind === 'timer' && run ? <LiveTimer run={run} /> : main.kind === 'next' && main.at && main.at - now <= 10 * 60_000 ? <LiveCountdown at={main.at} /> : main.sub}</Fly>
            ) : (
              s.ben.move?.sub ?? 'Click for the command center'
            )}
          </small>
        </div>
        {quick.length ? (
          // IC1: the live thing's own buttons (pause / +5 / done, water amounts, a tick box, join / start early).
          <QuickRow btns={quick} onTap={(x) => (tap(x), x.kind === 'water' && setWheelWater(null))} water={wheelWater} />
        ) : run ? (
          <button className="primary" {...tp('peek:stop', () => tap({ kind: 'stop' }))}>Stop & log</button>
        ) : s.now?.call ? (
          // IS11: a meeting is joined, not started as focus.
          s.now.meet ? (
            <button className="primary" {...tp('peek:join', () => tap({ kind: 'join', url: s.now!.meet! }))}>🎥 Join</button>
          ) : (
            <button className="primary" {...tp('peek:mute', muteForMeeting)}>🔕 Mute reminders</button>
          )
        ) : s.now ? (
          <button className="primary" {...tp('peek:start', () => tap({ kind: 'start', subject: s.now!.title, minutes: Math.max(5, Math.min(90, Math.round((s.now!.end - now) / 60000))) }))}>▶ Start</button>
        ) : (
          <button className="primary" {...tp('peek:focus', () => tap({ kind: 'start', subject: 'Focus', minutes: focusMin }))}>▶ Focus {focusMin}</button>
        )}
      </div>
      {benLine && <p className="di-peek-ben"><span>{s.ben.face}</span><Marquee className="di-peek-ben-text" text={benLine} /></p>}
      <ScPeekRow music={k.kit.music} />
      {/* IN35: your one-tap buttons. */}
      {!s.locked && <PillKitButtons k={k} />}
      {/* IC5: today in three numbers (the rings' colours). */}
      {(s.mustdos.length > 0 || s.water.target > 0 || !!s.today) && (
        <p className="di-peek-today">
          {s.mustdos.length > 0 && <span className="tr-must"><i />{s.mustdos.filter((m) => m.done).length}/{s.mustdos.length} must-dos</span>}
          {s.water.target > 0 && <span className="tr-water"><i />{(s.water.ml / 1000).toFixed(1)}/{(s.water.target / 1000).toFixed(1)} L</span>}
          {s.today && <span className="tr-focus"><i />{s.today.focusMin}/{s.today.focusGoal} min focus</span>}
        </p>
      )}
    </div>
  )

  // ---- expanded: the command center (page-first) ----
  const firstRep = s.reps[0]
  // IC9: opened with the shortcut: the keyboard moves around it.
  useKeyboardMode({ on: kbd && ui.view === 'expanded' && !cmdOpen, panel: () => panelEl.current, input: () => input.current, suggesting: () => sugg.length > 0 })
  // A soft ripple from the pointer on every press (Full).
  useRipples(panelEl, f.extras && ui.view === 'expanded')
  // Any key typed while the island is open goes into the palette; "/" opens it.
  useEffect(() => {
    if (ui.view !== 'expanded') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        return openCmd()
      }
      if (startsTyping(e.key, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey }) && !(kbd && /^Arrow/.test(e.key))) {
        e.preventDefault()
        dispatch({ type: 'typing', on: true })
        openCmd(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.view, kbd, openCmd, dispatch])
  // The power row: four one-tap actions you pick (kept on this PC).
  const [power, setPower] = useState<PowerId[]>(() => {
    try {
      return cleanPower(JSON.parse(localStorage.getItem('ls.islandPower') || 'null'))
    } catch {
      return cleanPower(null)
    }
  })
  const [powerEdit, setPowerEdit] = useState(false)
  const savePower = (row: PowerId[]) => {
    setPower(row)
    try {
      localStorage.setItem('ls.islandPower', JSON.stringify(row))
    } catch {
      /* fine */
    }
  }
  const favAuto = (s.auto?.buttons ?? []).filter((b) => !b.fields.length).sort((x, y) => Number(y.fav) - Number(x.fav))[0]
  const waterMl = prefs.chips.water[0] ?? 250
  const powerTile = (id: PowerId): PowerTile => {
    switch (id) {
      case 'focus':
        return run ? { id, icon: '⏹', label: 'Stop & log', sub: run.subject, on: true } : { id, icon: '▶', label: `Focus ${focusMin}`, sub: s.today ? `${s.today.focusMin} / ${s.today.focusGoal} min today` : 'Start a timer' }
      case 'water':
        return { id, icon: '💧', label: `+${waterMl} ml`, sub: `${(water.ml / 1000).toFixed(2).replace(/0$/, '')} / ${(water.target / 1000).toFixed(1)} L` }
      case 'note':
        return { id, icon: '📝', label: 'Quick note', sub: 'Into your notebook' }
      case 'task':
        return { id, icon: '✅', label: 'Add task', sub: 'To Todoist' }
      case 'auto':
        return favAuto ? { id, icon: favAuto.icon || '⚡', label: favAuto.name, sub: favAuto.fav ? 'Favourite automation' : 'Automation' } : { id, icon: '⚡', label: 'Automation', sub: 'Pin one in Settings', off: true }
      case 'reps':
        return firstRep ? { id, icon: '💪', label: `+${repN} ${firstRep.name}`, sub: `${firstRep.done} / ${firstRep.target} today` } : { id, icon: '💪', label: 'Reps', sub: 'No exercise yet', off: true }
      case 'music':
        return sc.loaded ? { id, icon: sc.playing ? '⏸' : '▶', label: sc.playing ? 'Pause' : 'Play', sub: sc.title || sc.station?.name || 'Music', on: sc.playing } : { id, icon: '🎵', label: 'Music', sub: 'Open the Music page' }
      case 'ben':
        return { id, icon: s.ben.face, label: 'Ask Ben', sub: s.ben.busy ? 'Thinking…' : 'Type or talk' }
      case 'quiet':
        return { id, icon: '🌙', label: quiet ? 'Wake up' : 'Quiet 1 h', sub: quiet ? `Quiet until ${hhmm(q.until)}` : 'No reminders', on: quiet }
    }
  }
  const doPower = (id: PowerId, el: HTMLElement) => {
    bump(el, f, 1.05)
    if (id === 'focus') return run ? tap({ kind: 'stop' }) : tap({ kind: 'start', subject: s.now && !s.now.call ? s.now.title : 'Focus', minutes: focusMin })
    if (id === 'water') return tap({ kind: 'water', ml: waterMl })
    if (id === 'note' || id === 'task') return (setCapture(id === 'note' ? 'note' : true), openCmd())
    if (id === 'auto' && favAuto) return tap({ kind: 'auto', op: 'run', id: favAuto.id }, favAuto.name)
    if (id === 'reps' && firstRep) return tap({ kind: 'reps', id: firstRep.id, name: firstRep.name, n: repN })
    if (id === 'music') return sc.loaded ? (islandSound('tap'), musicRun({ op: 'toggle' })) : window.dispatchEvent(new CustomEvent('life-island-page', { detail: 'music' }))
    if (id === 'ben') return openCmd()
    if (id === 'quiet') return quiet ? setQuiet(null) : setQuiet(60)
  }
  // The Day page's hero: the greeting and today's numbers (they count up as the page opens).
  const part = dayPart(now)
  const greeting = part === 'morning' ? 'Good morning' : part === 'day' ? 'Good afternoon' : part === 'evening' ? 'Good evening' : 'Late night'
  const mustDone = s.mustdos.filter((m) => m.done).length
  const heroStats: HeroStat[] = [
    ...(s.mustdos.length ? [{ id: 'must', label: 'Must-dos', value: mustDone, unit: `/${s.mustdos.length}`, pct: mustDone / s.mustdos.length, tone: 'lime' as const }] : []),
    ...(water.target ? [{ id: 'water', label: 'Water', value: water.ml / 1000, decimals: 1, unit: 'L', pct: water.ml / water.target, tone: 'water' as const, onTap: () => tap({ kind: 'water', ml: waterMl }) }] : []),
    ...(s.today ? [{ id: 'focus', label: 'Focus', value: s.today.focusMin, unit: 'min', pct: s.today.focusMin / Math.max(1, s.today.focusGoal), tone: 'violet' as const }] : []),
    ...(!s.today && pts ? [{ id: 'pts', label: 'Points', value: pts.balance, pct: pts.goal ? pts.balance / pts.goal.price : 0, tone: 'gold' as const }] : [])
  ].slice(0, 3)
  const heroSub = (
    <>
      {new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      {s.streak && s.streak.days > 1 ? <span className="dw-streak"> · 🔥 {s.streak.days}-day {s.streak.kind} streak</span> : null}
    </>
  )
  const alertCard = a ? (
    <section className={`di-alert kind-${a.kind}`}>
      {a.kind === 'recap' && a.recap ? <EveningScene recap={a.recap} /> : (!a.nudge || a.nudge.type === 'move') && <AlertScene kind={a.kind} water={s.water} splash={splash} shimmer={shimmer} title={a.title} onAlertDone={() => alertDone(a.id)} />}
      <div className="di-alert-top">
        <span>{a.face ?? (a.kind === 'ben' ? s.ben.face : a.kind === 'over' ? '⏰' : '▶')}</span>
        <b>{a.title}</b>
      </div>
      <p>{a.kind === 'ben' ? <TypeIn key={a.id} text={a.text} /> : a.text}</p>
      {a.nudge ? (
        <IslandNudgeCard a={a} tap={tap} onRun={startNudgeRun} sound={false} volume={prefs.volume} />
      ) : (
        <div className="di-actions">
          {a.actions.map((x) => (
            <button key={x.label} className={x.primary ? 'primary' : ''} {...tp(`alert:${x.label}`, () => tap(x.action, x.label))}>{x.label}</button>
          ))}
        </div>
      )}
    </section>
  ) : null
  const placeholder = capture === 'note' ? 'A quick note for your notebook · Enter saves · Esc cancels' : capture ? 'Add a task: call bank friday 10:00 · Esc to cancel' : 'Log, ask Ben, or go anywhere: water 500 · 30 pushups · music'
  const total = palSugg.length + palList.length
  const cmdForm = (
    <form
      className="di-cmd"
      onSubmit={(e) => {
        e.preventDefault()
        chat()
      }}
    >
      <span className="di-cmd-ico" aria-hidden>
        {capture === 'note' ? '📝' : capture ? '✅' : <svg width="17" height="17" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>}
      </span>
      <input
        ref={input}
        value={text}
        onChange={(e) => (setText(e.target.value), uiRef.current.typing || dispatch({ type: 'typing', on: true }))}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            closeCmd()
            return
          }
          if (total && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setSel((i) => moveChoice(i, total, e.key === 'ArrowDown' ? 1 : -1))
          }
        }}
        onPointerDown={() => desk()?.islandFocus?.()}
        onFocus={() => dispatch({ type: 'typing', on: true })}
        onBlur={() => dispatch({ type: 'typing', on: !!text.trim() })}
      />
      <button type="button" className={`di-mic ${rec ? 'on' : ''}`} aria-label="Hold to talk to Ben" title="Hold to talk to Ben" disabled={s.ben.busy} onPointerDown={(e) => (e.preventDefault(), islandVoiceOn() ? void window.dispatchEvent(new Event('island-voice-ptt')) : void startRec())} onPointerUp={stopRec} onPointerLeave={stopRec}>
        {rec ? '●' : '🎤'}
      </button>
      <button type="button" className="di-send" disabled={!text.trim() || s.ben.busy} aria-label="Send" {...tp('send', () => chat())}>↑</button>
    </form>
  )
  const benStatus = s.ben.busy ? 'thinking…' : s.ben.why ? `${s.ben.mood} · ${s.ben.why}` : s.ben.mood
  const expanded = (
    <div className={`di-panel ${cmdOpen ? 'has-pal' : ''}`} ref={panelEl} role="dialog" aria-label="Life System command center" tabIndex={-1}>
      <IslandBeatGlow />
      <IslandPager
        snap={s}
        tap={tap}
        now={now}
        profile={(basePrefs as { profile?: string }).profile ?? null}
        topProps={dragProps}
        left={
          <span className={`di-me mood-${s.ben.mood} ${s.ben.busy ? 'busy' : ''}`} title={`Ben: ${benStatus}`}>
            <span className="di-face">{s.ben.face}</span>
            <i className="di-me-dot" aria-hidden />
          </span>
        }
        right={
          <div className="di-top-acts">
            <button className="di-icon di-search-btn" {...tp('head:search', () => openCmd())} title="Search, log or ask Ben ( / )" aria-label="Open the palette">
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <kbd>/</kbd>
            </button>
            <button className={`di-icon ${quietMenu || quiet ? 'on' : ''}`} {...tp('head:quiet', () => (quiet ? setQuiet(null) : setQuietMenu((x) => !x)))} title={quiet ? `Quiet until ${new Date(q.until).toTimeString().slice(0, 5)}: wake now` : 'Quiet for a while'}>🌙</button>
            <button className={`di-icon ${ui.pinned ? 'on' : ''}`} {...tp('head:pin', () => dispatch({ type: 'pin' }))} title={ui.pinned ? 'Unpin' : 'Keep open'}>📌</button>
            <button className="di-icon" {...tp('head:app', () => (desk()?.showApp?.(), close()))} title="Open Life System">⤢</button>
            <button className="di-icon" {...tp('head:close', close)} aria-label="Close" title="Close (Esc)">✕</button>
          </div>
        }
        below={
          <>
            {old && <p className="di-reconnect-line">Reconnecting… this is from {hhmm(s.at)}</p>}
            {quietMenu && !quiet && (
              <div className="di-quiet">
                <span>Quiet for</span>
                {([[30, '30 min'], [60, '1 hour'], [120, '2 hours'], ['tomorrow', 'until tomorrow']] as const).map(([c, label]) => (
                  <button key={String(c)} {...tp(`quiet:${c}`, () => (setQuietMenu(false), setQuiet(c)))}>{label}</button>
                ))}
              </div>
            )}
            {a && (
              // Something waits on the Day page: a strip on every other page takes you there.
              <button className="di-alert-strip" {...tp('alert:strip', () => window.dispatchEvent(new CustomEvent('life-island-page', { detail: 'day' })))}>
                <i aria-hidden />
                <span>{a.face ?? '●'}</span>
                <b>{a.title}</b>
                <small>Open on Day</small>
              </button>
            )}
          </>
        }
        day={<>
          <DayHero greeting={greeting} sub={heroSub} stats={heroStats} />
          <PowerRow tiles={power.map(powerTile)} editing={powerEdit} onTap={doPower} onCycle={(i) => savePower(cyclePower(power, i))} onEdit={setPowerEdit} />
          {alertCard}
          {/* HD: wind-down mode, today's Healthy day and (Sundays) the week for your body. */}
          {s.windMode && <WindDownCard mode={s.windMode} tap={tap} playing={!!sc.playing} />}
          {s.health && <HealthCard health={s.health.today} evening={new Date(now).getHours() >= 18} />}
          {s.health?.week && <WeekHealthCard week={s.health.week} />}
          {s.doing && (
            // SI1: what Ben thinks you're doing (a kind, never a title); tap to fix it.
            <button className="di-doing" title="That's not right? Tap to fix" {...tp('doing', () => tap({ kind: 'ctxFix', app: s.doing!.app }))}>
              {s.doing.icon} {s.doing.label}
              {s.doing.detail ? ` · ${s.doing.detail}` : ''}
            </button>
          )}
          {/* AU1: what's playing (only with that switch on in PC & automation). */}
          <IslandMedia />
          <div className="di-chips">
            {prefs.chips.water.map((ml) => (
              <button key={`w${ml}`} {...tp(`chip:w${ml}`, (t) => (tap({ kind: 'water', ml }), bump(t.el, f)))}>💧 +{ml} ml</button>
            ))}
            {firstRep && prefs.chips.reps.map((n) => (
              <button key={`r${n}`} {...tp(`chip:r${n}`, (t) => (tap({ kind: 'reps', id: firstRep.id, name: firstRep.name, n }), bump(t.el, f)))}>💪 +{n} {firstRep.name}</button>
            ))}
            {!run && prefs.chips.focus.map((m) => (
              <button key={`f${m}`} {...tp(`chip:f${m}`, () => tap({ kind: 'start', subject: s.now && !s.now.call ? s.now.title : 'Focus', minutes: m }))}>▶ Focus {m}</button>
            ))}
            {run && <button {...tp('chip:extend', () => tap({ kind: 'extend', minutes: 5 }))}>+5 min</button>}
          </div>
          {prefs.sections.filter((x) => x.on).map((x) => <Fragment key={x.id}>{blocks[x.id]}</Fragment>)}
          {/* Island 2: your tiles and buttons, today's strip, music, the clipboard tray, the file shelf. */}
          <KitTiles k={k} s={s} />
          <IslandAutomations s={s} tap={tap} />
          <MiniCalendar s={s} tap={tap} now={now} />
          <MusicPanel k={k} />
          <ClipTray k={k} tap={tap} />
          <FileShelf k={k} tap={tap} />
          {/* IC17: edit what the pill shows, like a phone's home screen. */}
          {editing ? (
            <PillEditor order={prefs.pillOrder} onChange={savePillOrder} onDone={() => setEditing(false)} />
          ) : (
            <button className="di-edit-open" {...tp('edit:open', () => setEditing(true))}>✎ Edit the pill</button>
          )}
        </>}
      />
      {cmdOpen && (
        <Palette
          form={cmdForm}
          sugg={palSugg}
          items={palList}
          sel={sel}
          note={capture === 'note' ? 'Saved to Notebook → Notes' : capture ? 'Saved to Todoist (a date or time in the text works)' : undefined}
          onPickSuggestion={runSuggestion}
          onPickItem={runPalette}
          onClose={closeCmd}
        />
      )}
      <PanelCorner root={rootEl} scale={scale} />
    </div>
  )

  // Quiet (Q7) or a call in "dot" mode (Q5): a small moon / dot; hold it to see why.
  const until = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
  // A full-screen app with "Small dot" (the desktop hides it for "Hide it").
  const fsDot = q.fullscreen && q.fullscreenMode === 'dot' && !quiet && !(inCall && prefs.callMode === 'dot')
  const hushed = quiet || (inCall && prefs.callMode === 'dot') || fsDot
  const hushIcon = quiet ? '🌙' : fsDot ? '🎬' : '📞'
  const moonPill = (
    <div className="di-moon-pill" role="button" tabIndex={0} {...dragProps} {...clickProps} aria-label={quiet ? `Quiet until ${until(q.until)}` : fsDot ? 'A full-screen app is open' : 'In a call'}>
      <span>{hushIcon}</span>
    </div>
  )
  const moonPeek = (
    <div className="di-peek">
      <div className="di-peek-top">
        <span className="di-peek-face">{hushIcon}</span>
        <div className="di-peek-mid">
          <b>{quiet ? `Quiet until ${until(q.until)}` : fsDot ? 'Full-screen app' : 'In a call'}</b>
          <small>{quiet ? 'No reminders until then. Time-up still waits for you here.' : fsDot ? 'It stays small while a full-screen app is open on this screen.' : s.call ? `${s.call.title} · until ${until(s.call.end)}` : 'Your microphone or camera is on.'}</small>
        </div>
        {quiet && <button className="primary" {...tp('moon:wake', () => setQuiet(null))}>Wake now</button>}
      </div>
    </div>
  )
  // IP3: tucked away as a tiny dot (hover brings the pill back).
  const tuckDot = <div className="di-tuck-dot" role="button" tabIndex={0} {...dragProps} {...clickProps} aria-label="The island is tucked away: hover to see it" />
  // IC13: after "Going to bed" the pill is the moon until the morning.
  const sleepPill = (
    <div className="di-moon-pill di-sleep-pill" role="button" tabIndex={0} {...dragProps} {...clickProps} aria-label="Sleep well">
      <span>🌙</span>
      <small>Sleep well</small>
    </div>
  )
  const showMoment = !!moment && !hushed && !s.locked && !old
  // The thin Indicator: one capsule on the top edge; the timer, music, captions and alerts live inside it.
  const barNow = bar && !ui.over && ui.view === 'compact' && !mv.parked && !hushed
  const indInfo = {
    fill: run ? { from: run.startedAt, to: run.endsAt, freeze: run.pausedAt ?? null } : s.now ? { from: s.now.start, to: s.now.end, soft: true } : null,
    music: !!sc.playing,
    rec: captioning,
    alert: s.alert?.id ?? null
  }
  const views = { compact: mv.parked ? <ParkedDot /> : hushed ? moonPill : barNow ? <IslandIndicator info={indInfo} {...dragProps} {...clickProps} /> : nudgeRun ? <IslandNudgePill run={nudgeRun} onEnd={endNudgeRun} /> : showMoment ? <MomentPill m={moment!} /> : asleep && !main?.kind.match(/timer|now/) ? sleepPill : tuck === 'dot' ? tuckDot : compact, peek: hushed ? moonPeek : peek, expanded }
  const radius = ui.view === 'compact' ? (place === 'left' || place === 'right' ? 20 : ISLAND_SHAPE.compact.radius) : ui.view === 'peek' ? ISLAND_SHAPE.peek.radius : ISLAND_SHAPE.expanded.radius
  // IA3 / IL3: one feel: snappy open, softer close, a bouncy landing for a new alert, a quick stretch before it.
  const transition = stretch ? { type: 'spring' as const, stiffness: 700, damping: 26 } : ui.view === 'compact' ? f.close : dropping2 && ui.view === 'peek' ? f.drop : f.open

  // IA5: the pill lifts a little (and its shadow deepens) while the mouse is on it.
  const lift = useMotionValue(1)
  const liftOn = ui.over && ui.view === 'compact' && f.moves && !stretch
  useEffect(() => {
    const c = animate(lift, liftOn ? 1.03 : 1, liftOn ? f.open : f.close)
    pump(450)
    return () => c.stop()
  }, [liftOn]) // eslint-disable-line react-hooks/exhaustive-deps
  // IM5: spring the visible shape to its new size; the box is set once at the start and once at the end.
  const anchor: 'left' | 'right' | 'center' = place === 'left' || place === 'top-left' ? 'left' : place === 'right' || place === 'top-right' ? 'right' : 'center'
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const clip = useMotionValue('none')
  // The bar look hugs the top edge too: square top corners, round bottom ones (the Indicator, its pill and panel).
  const notchOn = bar || (look.style === 'notch' && (place === 'top' || place.startsWith('top')))
  const notchRef = useRef(notchOn)
  notchRef.current = notchOn
  useLayoutEffect(() => drawClipRef.current(), [notchOn])
  const drawClipRef = useRef<() => void>(() => {})
  const shadeX = useMotionValue(1)
  const shadeY = useMotionValue(1)
  const besideX = useMotionValue(size.w)
  const drawClip = useCallback(() => {
    const b = boxRef.current
    const w = mw.get()
    const h = mh.get()
    const dx = Math.max(0, b.w - w)
    const dy = Math.max(0, b.h - h)
    const an = anchorRef.current
    const l = an === 'left' ? 0 : an === 'right' ? dx : dx / 2
    const r = mr.get().toFixed(2)
    // The notch: square top corners, round bottom ones.
    const rr = notchRef.current ? `0px 0px ${r}px ${r}px` : `${r}px`
    clip.set(dx < 0.25 && dy < 0.25 ? `inset(0px round ${rr})` : `inset(0px ${(dx - l).toFixed(2)}px ${dy.toFixed(2)}px ${l.toFixed(2)}px round ${rr})`)
    shadeX.set((w / Math.max(1, b.w)) * lift.get() * jx.get())
    shadeY.set((h / Math.max(1, b.h)) * jy.get())
    besideX.set(an === 'left' ? w : an === 'right' ? -w : w / 2)
  }, [mw, mh, mr, clip, shadeX, shadeY, besideX, lift, jx, jy])
  useEffect(() => {
    const u = [mw.on('change', drawClip), mh.on('change', drawClip), mr.on('change', drawClip), lift.on('change', drawClip), jx.on('change', drawClip), jy.on('change', drawClip)]
    return () => u.forEach((x) => x())
  }, [mw, mh, mr, lift, jx, jy, drawClip])
  useLayoutEffect(drawClip, [box, anchor, drawClip])
  drawClipRef.current = drawClip
  const shapeH = size.h + (stretch ? 8 : 0)
  const firstSize = useRef(true)
  useLayoutEffect(() => {
    const tw = size.w
    const th = shapeH
    const jump = firstSize.current || f.mode === 'off' || hidden
    firstSize.current = false
    if (jump || (Math.abs(mw.get() - tw) < 0.5 && Math.abs(mh.get() - th) < 0.5 && Math.abs(mr.get() - radius) < 0.5)) {
      mw.jump(tw)
      mh.jump(th)
      mr.jump(radius)
      setBox((o) => (o.w === tw && o.h === th ? o : { w: tw, h: th }))
      drawClip()
      if (movingRef.current) onDone()
      return
    }
    setBox({ w: Math.max(tw, Math.ceil(mw.get())), h: Math.max(th, Math.ceil(mh.get())) })
    onStart()
    let left = 3
    const end = () => {
      if (--left) return
      setBox({ w: tw, h: th })
      onDone()
    }
    const cs = [animate(mw, tw, { ...transition, onComplete: end }), animate(mh, th, { ...transition, onComplete: end }), animate(mr, radius, { ...transition, onComplete: end })]
    return () => cs.forEach((c) => c.stop())
  }, [size.w, shapeH, radius]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the pill: the lift is gone at once, so what flies to the peek or panel lands exactly.
  useLayoutEffect(() => {
    if (ui.view === 'compact' || lift.get() === 1) return
    lift.jump(1)
    if (shape.current) shape.current.style.transform = 'none'
  }, [ui.view, lift])
  // The click area follows every new shape: the stretch, the bubble, the toast (IA1).
  const stackOn = stack.length >= 2 && (ui.view === 'compact' || (ui.view === 'peek' && !ui.byAlert)) && !hushedNow && !s.locked && !old && !showMoment
  const stackOpen = stackOn && ui.over
  useEffect(() => {
    pump(700)
  }, [stretch, dropping2, bubbleOn, toast?.id, toast?.state, pump, ringCtl.ring == null, menu, wheelText, undo, stackOn, stackOpen, stack.length, showMoment, ghost])
  // IP1: the glow pauses while the island is hidden.
  const [docHidden, setDocHidden] = useState(false)
  useEffect(() => {
    const on = () => setDocHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  // IC10: the island window never throttles itself, so the desktop says when it is hidden.
  const hidden = docHidden || !visible
  // Rings and sweeps: every frame only while the shape moves, 4 times a second otherwise, not at all hidden or tucked away.
  useEffect(() => {
    setFrameMode(hidden || tuck !== 'none' || mv.parked ? 'paused' : moving ? 'fast' : 'slow')
  }, [hidden, tuck, moving, mv.parked])
  // IM4: the particles only in Full, never while hidden or tucked away.
  useEffect(() => {
    setParticlesAllowed(f.extras && !hidden && tuck === 'none')
  }, [f.extras, hidden, tuck])
  // IM11, IM12: the pointer near the island (the desktop says, ~30 times a
  // second within 40 px; the page's own pointer moves too): the pill leans
  // 2–3 px toward it (Full) and a tucked-away dot blinks awake.
  const nearRef = useRef(false)
  const leanTo = useCallback((n: { dx: number; dy: number } | null) => {
    const el = rootEl.current
    if (!el) return
    const near = !!n
    if (near !== nearRef.current) {
      nearRef.current = near
      el.classList.toggle('is-near', near)
    }
    const ok = fRef.current.moves && uiRef.current.view === 'compact' && !movingRef.current && !document.documentElement.classList.contains('di-dragging')
    const l = ok ? leanFor(n) : { x: 0, y: 0 }
    el.style.setProperty('--di-lean', `${l.x}px ${l.y}px`)
  }, [])
  useEffect(() => {
    desk()?.onIslandCursor?.((n) => leanTo(n))
    desk()?.onIslandSnapGhost?.((p) => setGhost(p))
    desk()?.onIslandSnapped?.((b) => {
      snapBounceIn(rootEl.current, b, fRef.current)
      pump(800)
    })
    const move = (e: PointerEvent) => {
      leanTo(cursorNear({ x: e.clientX, y: e.clientY }, target.current[0]))
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [leanTo, pump])
  useEffect(() => {
    if (ui.view !== 'compact') leanTo(null)
  }, [ui.view, leanTo])
  useEffect(() => {
    logIslandUi('visible', hidden ? 'hidden: animations paused' : 'shown')
  }, [hidden])
  // Island debug (IC13): Settings → Desktop island → Debug.
  const debugOn = Number((prefs as { debugUntil?: number }).debugUntil ?? 0) > Date.now()
  useEffect(() => {
    dbg.commits++
  })
  dbg.view = ui.view
  dbg.place = place
  dbg.cssScale = scale
  const peekBox = (): Rect | null => {
    const root = rootEl.current
    const sh = shape.current
    if (!root || !sh) return null
    const b = root.getBoundingClientRect()
    const anchor = place === 'left' || place === 'top-left' ? 'left' : place === 'right' || place === 'top-right' ? 'right' : 'center'
    const h = (ui.view === 'peek' ? size.h : 96) * scale
    return finalShapeRect({ anchor, ax: anchor === 'left' ? b.left : anchor === 'right' ? b.right : b.left + b.width / 2, top: sh.getBoundingClientRect().top, w: prefs.peekWidth * scale, h })
  }
  const benUnread = s.ben.unread > 0 && !hushed && !s.locked
  // No desktop size (the website preview, an older desktop): fit the screen the page is on.
  const sentMaxH = (prefs as { panelMaxH?: number }).panelMaxH
  const localFit = islandSizing({ pick: prefs.size, area: { width: window.screen?.availWidth, height: window.screen?.availHeight }, panelWidth: prefs.panelWidth })
  const density: IslandDensity = sentDensity ?? localFit.density
  const panelW = sentMaxH ? prefs.panelWidth : localFit.panelW
  const panelMaxH = sentMaxH || localFit.panelH
  const origin = place === 'left' || place === 'top-left' ? 0 : place === 'right' || place === 'top-right' ? 1 : 0.5
  const edgeOk = !barNow && ui.view !== 'expanded' && !(ui.view === 'peek' && ui.byAlert) && !hushed && !s.locked && !old && !showMoment
  // IM2: while a timer runs the whole outline fills (with a glowing head) instead of the bottom line.
  const sweep = edgeOk && !run && s.now ? <Sweep from={s.now.start} to={s.now.end} /> : null
  const border = edgeOk && run && !moving ? <LiquidBorder from={run.startedAt} to={run.endsAt} freeze={run.pausedAt} w={box.w} h={box.h} r={radius} /> : null
  return (
    <FeelContext.Provider value={f}>
      <ViewContext.Provider value={ui.view}>
      <MotionConfig reducedMotion={f.mode === 'off' ? 'always' : 'never'}>
        <LayoutGroup>
          <div
            ref={rootEl}
            {...dropProps}
            style={{
              ['--di-alpha' as string]: String(prefs.opacity),
              scale: scale === 1 ? undefined : String(scale),
              // IF3: your sizes.
              ['--di-pill-h' as string]: `${prefs.pillHeight}px`,
              ['--di-peek-w' as string]: `${prefs.peekWidth}px`,
              ['--di-panel-w' as string]: `${panelW}px`,
              // The glow follows the music's colour while something plays.
              ...(sc.playing ? { ['--mu-aura' as string]: `${muTint.rgb.r} ${muTint.rgb.g} ${muTint.rgb.b}` } : {}),
              // IN39: the panel's own height on this screen (drag its corner).
              ['--di-panel-maxh' as string]: `${panelMaxH}px`,
              // IP4: the app's colours.
              ...(prefs.look === 'app' && theme ? { ['--app-surface' as string]: theme.surface, ['--app-text' as string]: theme.text, ['--app-accent' as string]: theme.accent, ['--app-accent-text' as string]: theme.accentText } : {})
            }}
            className={`di dens-${density} at-${place} ${place.startsWith('top') ? 'at-topbar' : ''} look-${prefs.look} ${prefs.look === 'app' && theme && !theme.dark ? 'theme-light' : ''} ${tuck !== 'none' ? `tucked tuck-${tuck}` : ''} view-${ui.view} mood-${s.ben.mood} motion-${f.mode} ${ui.over ? 'is-hover' : ''} ${benUnread ? 'ben-unread' : ''} ${hidden ? 'doc-hidden' : ''} ${run ? 'has-timer' : ''} ${run && !run.pausedAt && now > run.endsAt ? 'is-over' : ''} ${run?.pausedAt ? 'is-paused' : ''} ${run?.brk ? 'is-break' : ''} ${kbd ? 'kbd' : ''} ${typingAway && ui.view === 'compact' && !ui.over ? 'typing-away' : ''} ${s.call ? 'in-call' : ''} ${s.windDown ? 'winddown' : ''} ${s.windMode ? `windmode wind-${s.windMode.phase}` : ''} ${dropping ? 'dropping' : ''} ${moving ? 'moving' : ''} ${old ? 'is-old' : ''} tod-${dayPart(now)} ${run ? 'has-border' : ''} ${showMoment ? 'has-moment' : ''} ${mv.classes} ${nudgeRun ? `nudge-${nudgeRun.kind}` : ''} ${lookClasses(k.kit.look, new Date(now))} ${lookRootClasses(look, place, barNow, bar)} ${sc.playing ? 'has-music' : ''}`}
          >
            <motion.div className="di-shade" style={{ width: box.w, height: box.h, borderRadius: notchRadius(notchOn, radius), scaleX: shadeX, scaleY: shadeY, originX: origin, originY: 0 }} aria-hidden>
              <i className="di-breath" />
              <i className="di-glow" />
            </motion.div>
            <motion.div
              ref={shape}
              data-hot
              className="di-shape"
              style={{ width: box.w, height: box.h, borderRadius: notchRadius(notchOn, radius), clipPath: clip, scale: lift, scaleX: jx, scaleY: jy, originX: origin, originY: 0 }}
            >
              <Sky />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={ui.view}
                  ref={viewRef[ui.view]}
                  data-view={ui.view}
                  className={`di-view di-v-${ui.view}`}
                  // IA4: opacity and scale only (no blur): cheap and crisp.
                  // The panel grows out of the notch: its content starts a little smaller and rises into place.
                  initial={f.mode === 'off' ? false : ui.view === 'expanded' && f.moves ? { opacity: 0, scale: 0.94, y: -8 } : { opacity: 0 }}
                  animate={{ opacity: 1, scale: 1, y: 0, transition: ui.view === 'expanded' && f.moves ? { ...f.open, opacity: f.fadeIn } : f.fadeIn }}
                  exit={{ opacity: 0, scale: f.moves ? (ui.view === 'expanded' ? 0.97 : 0.94) : 1, y: f.moves && ui.view !== 'expanded' ? -10 : 0, transition: f.fadeOut }}
                >
                  {views[ui.view]}
                </motion.div>
              </AnimatePresence>
              {border}
              <motion.div className="di-follow" style={{ y: mh }}>{sweep}</motion.div>
            </motion.div>
            <motion.div className={`di-beside at-${anchor}`} style={{ x: besideX }}>
              <AnimatePresence>{stackOn ? null : bubbleEl}</AnimatePresence>
              {stackOn && <LiveStack items={stack} open={stackOpen} side={side as 1 | -1} icon={bubbleIcon} onPick={pickKey} onMoved={(done) => (done ? sendHot(true) : pump(700))} />}
            </motion.div>
            {/* IC20: while the mouse is on the pill, the panel's sections are kept laid out (hidden), so opening has nothing to build. */}
            {ui.over && ui.view !== 'expanded' && !s.locked && (
              <LayoutGroup id="di-warm">
                <div className="di-prewarm" aria-hidden inert>
                  {prefs.sections.filter((x) => x.on).map((x) => <Fragment key={x.id}>{blocks[x.id]}</Fragment>)}
                </div>
              </LayoutGroup>
            )}
            <div className="di-flights" aria-hidden={!flights.length}>
              {flights.map((fl) => (
                <FlyIn key={fl.id} fl={fl} f={f} />
              ))}
            </div>
            {/* IC3: the round menu, around where you hold. */}
            {ringCtl.ring && <RingMenu ring={ringCtl.ring} items={ringList} />}
            <motion.div className="di-follow" style={{ y: mh }}>
            {/* IC7: the menu for this; IC6: the wheel's number. */}
            {menu && <ActMenu items={menu} subject={run?.subject} onPick={pickMenu} onRename={(n) => (setMenu(null), tap({ kind: 'rename', subject: n }))} onClose={() => setMenu(null)} />}
            <WheelBadge text={wheelText} />
            <SnapGhost spot={ghost} />
            {mv.moveMode && <MoveModeBar />}
            {/* Island eyes: the eye (reading / paused / Pause button), only with the eyes on. */}
            <IslandEyesBadge near={ui.over || ui.view === 'expanded'} onLayout={() => sendHot(true)} />
            {/* Meetings: Caption in a call, the caption strip, Help me reply (MT1–MT3, AI17). */}
            <IslandMeet inCall={inCall} title={s.call?.title ?? null} near={ui.over || ui.view !== 'compact'} onLayout={() => sendHot(true)} onCaptioning={setCaptioning} />
            <AnimatePresence>
              {toast && (
                <motion.div key="toast" data-hot className={`di-toast ${toast.state}`} role="status" initial={{ opacity: 0, y: f.moves ? -6 : 0 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: f.moves ? -6 : 0 }} transition={f.pop} onAnimationStart={() => pump(500)} onAnimationComplete={() => sendHot(true)}>
                  {toast.state === 'busy' ? `${toast.text}…` : toast.text}
                  {undo && undo.id === toast.id && toast.state === 'ok' && <UndoButton id={undo.id} onUndo={() => doUndo(undo.id)} />}
                </motion.div>
              )}
            </AnimatePresence>
            {/* JV1–JV5: voice (off until turned on in Settings → Voice). */}
            <IslandVoice snap={s} chips={prefs.chips} tap={tap} onWake={() => dispatch({ type: 'alert', ms: 9000 })} quiet={quiet} inCall={inCall} hidden={hidden} reduced={f.mode === 'off'} onLayout={() => pump(600)} />
            </motion.div>
          </div>
        </LayoutGroup>
        <IslandParticles />
        {/* IN-SC: the SoundCloud player, hidden, outside the panel so it keeps playing. */}
        <ScHost call={!!s.call || inCall} running={!!s.running && !s.running.brk} pauseInFocus={!!s.musicPause} music={k.kit.music} />
        {debugOn && <IslandDebug peek={peekBox()} />}
      </MotionConfig>
      </ViewContext.Provider>
    </FeelContext.Provider>
  )
}
