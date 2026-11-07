// The island's "alive" layer: small, original, cheap visuals on top of the
// existing pill. Everything here moves with transform and opacity only, stops
// while hidden, and stands still with reduced motion (the island's `motion-off`).
// Data comes from the snapshot's optional fields (declared below until the
// shared type has them all): when a field is missing its piece just isn't drawn.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { lineAt } from '@core/lyrics'
import { toggleFav, type Fav } from '@core/music'
import type { IslandSnapshot } from '@core/islandModel'
import { getState, subscribe, sc } from './music/engine'
import { posNow } from './music/MusicUi'
import { useLyrics } from './music/players'
import { useTicker, useWave } from './music/hooks'
import type { KitState } from './IslandTiles'
import './island-alive.css'

// ---- the contract (optional snapshot fields) ----
export type DayState = 'ontrack' | 'behind' | 'drifting' | 'rest'
export interface AliveFields {
  dayState?: DayState
  top3?: { title: string; done: boolean }[]
  pointsFx?: { id: string; delta: number; label: string }
  next3h?: { at: number | string; title: string; kind: string }[]
  shield?: { on: boolean; held: number }
  story?: { lines: string[]; stats: { focusMin: number; waterMl: number; done: number } }
}
export type AliveSnap = IslandSnapshot & AliveFields
export const aliveOf = (s: IslandSnapshot) => s as AliveSnap

const DAY_STATES: DayState[] = ['ontrack', 'behind', 'drifting', 'rest']
export const dayStateOf = (s: IslandSnapshot): DayState | null => {
  const d = aliveOf(s).dayState
  return d && DAY_STATES.includes(d) ? d : null
}

// ---- Ben's face ----
export type BenFeel = 'happy' | 'thumbs' | 'sleepy' | 'hyped' | 'worried'

/** Which face Ben wears: a fresh point wins, then worry, then the night, then a streak. */
export function benFeel(o: { fx: boolean; dayState: DayState | null; hour: number; streak: number; atRisk: boolean }): BenFeel {
  if (o.fx) return 'thumbs'
  if (o.dayState === 'drifting') return 'worried'
  if (o.hour >= 22 || o.hour < 5) return 'sleepy'
  if (o.streak >= 3 && !o.atRisk) return 'hyped'
  return 'happy'
}

const INK = '#10130a'

/** A tiny round character, drawn in SVG (original art). */
export function BenFace({ feel, size = 22 }: { feel: BenFeel; size?: number }) {
  return (
    <svg className={`alive-ben-svg f-${feel}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <radialGradient id="alive-ben-g" cx="40%" cy="32%" r="75%">
          <stop offset="0" stopColor="#f3ff9a" />
          <stop offset="1" stopColor="#c6f036" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="url(#alive-ben-g)" />
      <ellipse cx="7.2" cy="15.6" rx="1.7" ry="1.1" fill="#ff9a8a" opacity="0.55" />
      <ellipse cx="16.8" cy="15.6" rx="1.7" ry="1.1" fill="#ff9a8a" opacity="0.55" />
      {feel === 'sleepy' ? (
        <>
          <path d="M6.6 10.8 Q8.6 12.6 10.6 10.8" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M13.4 10.8 Q15.4 12.6 17.4 10.8" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
          <ellipse cx="12" cy="16.4" rx="1.3" ry="1" fill={INK} />
        </>
      ) : feel === 'thumbs' ? (
        <>
          <path d="M6.8 11 Q8.7 8.4 10.6 11" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M13.4 11 Q15.3 8.4 17.2 11" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8.4 14.6 Q12 18.4 15.6 14.6" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : feel === 'worried' ? (
        <>
          <g className="alive-eyes">
            <ellipse cx="8.6" cy="11" rx="1.3" ry="1.7" fill={INK} />
            <ellipse cx="15.4" cy="11" rx="1.3" ry="1.7" fill={INK} />
          </g>
          <path d="M6.4 7.6 L10.6 8.9 M17.6 7.6 L13.4 8.9" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M8.4 17 Q10.2 15 12 16.8 T15.6 16.6" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : feel === 'hyped' ? (
        <>
          <g className="alive-eyes">
            <ellipse cx="8.6" cy="10.6" rx="1.5" ry="2" fill={INK} />
            <ellipse cx="15.4" cy="10.6" rx="1.5" ry="2" fill={INK} />
          </g>
          <circle cx="9.1" cy="9.9" r="0.55" fill="#fff" />
          <circle cx="15.9" cy="9.9" r="0.55" fill="#fff" />
          <path d="M7.4 14 Q12 20.6 16.6 14 Z" fill={INK} />
        </>
      ) : (
        <>
          <g className="alive-eyes">
            <ellipse cx="8.6" cy="11" rx="1.3" ry="1.8" fill={INK} />
            <ellipse cx="15.4" cy="11" rx="1.3" ry="1.8" fill={INK} />
          </g>
          <path d="M8.6 14.6 Q12 17.8 15.4 14.6" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {feel === 'thumbs' && (
        <g className="alive-thumb">
          <rect x="14.2" y="15.2" width="8.4" height="7.2" rx="2.2" fill="#ffe08a" stroke={INK} strokeWidth="1.1" />
          <path d="M16.4 15.2 V11.8 a1.7 1.7 0 0 1 3.4 0 V15.2" fill="#ffe08a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        </g>
      )}
      {feel === 'sleepy' && <text className="alive-z" x="17.5" y="7" fontSize="6.5" fontWeight="700" fill="#a9c4ff">z</text>}
      {feel === 'worried' && <path className="alive-sweat" d="M19.2 5.2 q1.6 2.2 0 3.4 q-1.6 -1.2 0 -3.4z" fill="#6fc4ff" />}
      {feel === 'hyped' && (
        <>
          <path className="alive-spark s1" d="M3.4 4.2 v2.6 M2.1 5.5 h2.6" stroke="#fff3a0" strokeWidth="1" strokeLinecap="round" />
          <path className="alive-spark s2" d="M20.6 3.4 v2.2 M19.5 4.5 h2.2" stroke="#fff3a0" strokeWidth="1" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

/** Ben on the pill: his mood follows the day, and a new point makes him cheer. */
export function AliveBen({ s, now, fx }: { s: IslandSnapshot; now: number; fx: boolean }) {
  const feel = benFeel({ fx, dayState: dayStateOf(s), hour: new Date(now).getHours(), streak: s.streak?.days ?? 0, atRisk: !!s.streak?.atRisk })
  return (
    <span className={`alive-ben f-${feel}`} data-feel={feel} aria-hidden>
      <BenFace feel={feel} />
    </span>
  )
}

// ---- gaming: a calm live counter (amber near the limit, red over it; never flashing) ----
/** ok / near (from 80 % of the limit) / over (pure). */
export function gamingLevel(sessionMin: number, limitMin?: number): 'ok' | 'near' | 'over' {
  if (!limitMin || limitMin <= 0) return 'ok'
  return sessionMin >= limitMin ? 'over' : sessionMin >= limitMin * 0.8 ? 'near' : 'ok'
}
const playMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${Math.max(0, Math.round(m))} min`)

export function GamingChip({ g }: { g?: IslandSnapshot['gaming'] }) {
  if (!g?.on) return null
  const lv = gamingLevel(g.sessionMin, g.limitMin)
  return (
    <span className={`alive-gaming lv-${lv}`} title={`Playing ${g.app}`}>
      <i aria-hidden>🎮</i>
      <span>{g.app} · {playMin(g.sessionMin)}</span>
    </span>
  )
}

// ---- progress orbit: the top 3 as dots around the pill's lower edge ----
export function OrbitDots({ top3 }: { top3?: AliveFields['top3'] }) {
  if (!top3 || !top3.length) return null
  const list = top3.slice(0, 3)
  return (
    <span className="alive-orbit" data-orbit={list.length} role="img" aria-label={`Top ${list.length}: ${list.filter((t) => t.done).length} done`}>
      {list.map((t, i) => (
        <i key={i} className={`alive-dot ${t.done ? 'done' : ''}`} title={t.title} style={{ '--i': i - (list.length - 1) / 2 } as CSSProperties} />
      ))}
    </span>
  )
}

// ---- liquid timer: the focus time drains like water inside the pill ----
/** How full the glass is, 1 at the start, 0 at the end (pure). */
export function liquidLevel(run: { startedAt: number; endsAt: number; pausedAt?: number | null }, now: number): number {
  const at = run.pausedAt ?? now
  const total = Math.max(1, run.endsAt - run.startedAt)
  return Math.max(0, Math.min(1, 1 - (at - run.startedAt) / total))
}

export function LiquidFill({ run, now, animate }: { run: { startedAt: number; endsAt: number; pausedAt?: number | null; brk?: boolean }; now: number; animate: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const level = liquidLevel(run, now)
  const live = animate && !run.pausedAt && level > 0 && !run.brk
  const { startedAt, endsAt, pausedAt } = run
  useEffect(() => {
    const e = el.current
    if (!e) return
    const lvl = liquidLevel({ startedAt, endsAt, pausedAt }, Date.now())
    e.style.transform = `translateY(${(1 - lvl) * 100}%)`
    if (!live || typeof e.animate !== 'function') return
    // One animation for the whole drain: nothing ticks while it runs.
    const a = e.animate([{ transform: `translateY(${(1 - lvl) * 100}%)` }, { transform: 'translateY(100%)' }], { duration: Math.max(1, endsAt - Date.now()), easing: 'linear', fill: 'forwards' })
    return () => a.cancel()
  }, [startedAt, endsAt, pausedAt, live])
  return (
    <div className={`alive-liquid ${run.brk ? 'is-break' : ''} ${live ? 'is-live' : ''}`} aria-hidden>
      <div className="alive-level" ref={el} style={{ transform: `translateY(${(1 - level) * 100}%)` }}>
        <svg className="alive-wave" viewBox="0 0 120 8" preserveAspectRatio="none">
          <path d="M0 4 Q15 0 30 4 T60 4 T90 4 T120 4 V8 H0 Z" />
        </svg>
        <i className="alive-body" />
      </div>
    </div>
  )
}

// ---- celebrations: "+10 ⚡" flies into Ben; the size of the point decides the show ----
export type FxSize = 'ripple' | 'burst' | 'big'
/** A habit is a ripple, a must-do a burst, a big one more (pure). */
export function fxSize(delta: number): FxSize {
  return delta >= 25 ? 'big' : delta >= 8 ? 'burst' : 'ripple'
}

/** True for ~2.4 s after each new `pointsFx.id` (not for the one already there at load). */
export function usePointsFx(fx: AliveFields['pointsFx']) {
  const seen = useRef<string | number | null | undefined>(undefined)
  const [cur, setCur] = useState<NonNullable<AliveFields['pointsFx']> | null>(null)
  const id = fx?.id
  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = id ?? null
      return
    }
    if (id == null || id === seen.current || !fx) return
    seen.current = id
    setCur(fx)
    const t = window.setTimeout(() => setCur(null), 2400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return cur
}

export function PointsFly({ fx }: { fx: NonNullable<AliveFields['pointsFx']> }) {
  const size = fxSize(fx.delta)
  const layer = useRef<HTMLDivElement>(null)
  // Where Ben's badge is, measured once: the label flies there and the ripple starts there.
  useLayoutEffect(() => {
    const l = layer.current
    if (!l) return
    const ben = l.closest('.di')?.querySelector<HTMLElement>('.alive-ben')
    const lr = l.getBoundingClientRect()
    let bx = 0
    let by = l.offsetHeight / 2
    if (ben) {
      const br = ben.getBoundingClientRect()
      const k = br.width / Math.max(1, ben.offsetWidth)
      bx = (br.left + br.width / 2 - lr.left) / k
      by = (br.top + br.height / 2 - lr.top) / k
    }
    l.style.setProperty('--bx', `${bx}px`)
    l.style.setProperty('--by', `${by}px`)
    l.style.setProperty('--dx', `${bx}px`)
    l.style.setProperty('--dy', `${by - (l.offsetHeight + 6)}px`)
  }, [fx.id])
  return (
    <div className="alive-fxlayer" ref={layer} aria-hidden>
      <span className={`alive-ring ${size}`} />
      {size !== 'ripple' && (
        <span className={`alive-burst ${size}`}>
          {Array.from({ length: size === 'big' ? 12 : 8 }, (_, i) => (
            <i key={i} style={{ '--a': `${(360 / (size === 'big' ? 12 : 8)) * i}deg` } as CSSProperties} />
          ))}
        </span>
      )}
      <span className="alive-plus" data-fx={fx.id} title={fx.label}>
        +{fx.delta} ⚡
      </span>
    </div>
  )
}

// ---- hover peek: the next three hours, and the gestures ----
const hhmm = (at: number | string) => {
  if (typeof at === 'string') return at
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const HINT_KEY = 'ls.islandGestureHint'
const readHint = () => {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}
const markHint = () => {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    /* private window */
  }
}

export const SWIPE_PX = 48
export const HOLD_MS = 650
/** What a finished press was (pure): 'right' / 'left' for a clear sideways swipe. */
export function swipeOf(dx: number, dy: number): 'right' | 'left' | null {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) * 0.6) return null
  return dx > 0 ? 'right' : 'left'
}

export function ShieldBadge({ shield }: { shield?: AliveFields['shield'] }) {
  if (!shield?.on) return null
  return <span className="alive-shield" title="Interruptions held back while you focus">🛡 {shield.held > 0 ? `${shield.held} held` : 'on'}</span>
}

export interface GestureHandlers {
  water: () => void
  snooze: () => void
  focus: () => void
}

/** The mini timeline card: shows after a 400 ms dwell; swipe right = water, left = snooze, hold = focus. */
export function HoverTimeline({ s, now, g, onLayout }: { s: IslandSnapshot; now: number; g: GestureHandlers; onLayout?: () => void }) {
  const a = aliveOf(s)
  const items = (a.next3h ?? []).slice(0, 3)
  const [shown, setShown] = useState(false)
  const [msg, setMsg] = useState('')
  const [hint, setHint] = useState(() => !readHint())
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 400)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (shown) onLayout?.()
  }, [shown, onLayout])
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(''), 1400)
    return () => clearTimeout(t)
  }, [msg])

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    // The card has its own gestures: no window drag, no early open.
    e.stopPropagation()
    if (e.button !== 0) return
    const el = e.currentTarget
    const sx = e.clientX
    const sy = e.clientY
    let dx = 0
    let dy = 0
    let held = false
    try { el.setPointerCapture(e.pointerId) } catch { /* fine */ }
    const hold = window.setTimeout(() => {
      if (Math.hypot(dx, dy) < 8) {
        held = true
        setMsg('Focus block started')
        markHint()
        setHint(false)
        g.focus()
      }
    }, HOLD_MS)
    const move = (ev: PointerEvent) => {
      dx = ev.clientX - sx
      dy = ev.clientY - sy
      if (card.current) card.current.style.transform = `translateX(${Math.max(-28, Math.min(28, dx * 0.4))}px)`
    }
    const end = (ev: PointerEvent) => {
      clearTimeout(hold)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      if (card.current) card.current.style.transform = ''
      if (ev.type === 'pointercancel' || held) return
      const sw = swipeOf(dx, dy)
      if (!sw) return
      markHint()
      setHint(false)
      if (sw === 'right') (setMsg('+250 ml logged'), g.water())
      else (setMsg('Snoozed 30 min'), g.snooze())
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const slim = !items.length && !a.shield?.on
  if (!shown || slim) return null
  const span = 3 * 3600_000
  return (
    <div className="alive-peekcard" data-noswipe data-peekcard ref={card} onPointerDown={down} role="group" aria-label="Next 3 hours">
      <div className="alive-peekhead">
        <b>Next 3 hours</b>
        <ShieldBadge shield={a.shield} />
      </div>
      {items.length > 0 && (
        <>
          <div className="alive-track" aria-hidden>
            {items.map((it, i) => {
              const f = typeof it.at === 'number' ? Math.max(0, Math.min(1, (it.at - now) / span)) : (i + 0.5) / 3
              return <i key={i} className={`k-${it.kind}`} style={{ '--x': `${f * 100}%` } as CSSProperties} />
            })}
          </div>
          <ul>
            {items.map((it, i) => (
              <li key={i} className={`k-${it.kind}`}>
                <time>{hhmm(it.at)}</time>
                <span>{it.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={`alive-gmsg ${msg ? 'on' : ''}`} role="status">{msg}</div>
      {hint && !msg && <small className="alive-hint">Swipe right: water · left: snooze · hold: focus</small>}
    </div>
  )
}

// ---- Now Playing+ ----
const BARS = 14
export function Visualizer({ playing, levels }: { playing: boolean; levels: number[] }) {
  return (
    <span className={`alive-eq ${playing ? 'on' : 'off'}`} aria-hidden>
      {levels.map((l, i) => (
        <i key={i} style={{ '--hi': Math.max(0.28, Math.min(1, l)), '--d': `${-(i * 0.137) % 0.9}s`, '--p': `${0.46 + (i % 4) * 0.07}s` } as CSSProperties} />
      ))}
    </span>
  )
}

export function NowPlayingPlus({ k }: { k: KitState }) {
  const s = useSyncExternalStore(subscribe, getState, getState)
  const music = k.kit.music
  const active = s.loaded && !!s.station && !!(s.title || s.station)
  // The track's own waveform, read around where the song is: real levels; made-up only until they arrive.
  const wave = useWave(s.waveUrl, s.url || s.title, 96)
  useTicker(active && s.playing, 1000)
  const lines = useLyrics(s.title, s.artist, s.dur, active && !!music.lyrics)
  const levels = useMemo(() => {
    const at = s.dur ? Math.floor((posNow(s) / s.dur) * wave.bars.length) : 0
    const peak = Math.max(0.01, ...wave.bars)
    return Array.from({ length: BARS }, (_, i) => (wave.bars[Math.min(wave.bars.length - 1, at + i)] ?? 0.4) / peak)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave.bars, s.pos, s.posAt, s.dur])
  if (!active) return null
  const liked = !!s.url && music.favs.some((x) => x.url === s.url)
  const line = lines ? lineAt(lines, posNow(s)) : -1
  const like = () => s.url && k.save({ ...k.kit, music: { ...music, favs: toggleFav(music.favs, { url: s.url, title: s.title, artist: s.artist, artwork: s.artwork } as Fav) } })
  return (
    <section className={`alive-np ${s.playing ? 'is-playing' : ''}`} aria-label="Now playing">
      <Visualizer playing={s.playing} levels={levels} />
      <div className="alive-np-mid">
        <b title={s.title}>{s.title || s.station?.name}</b>
        <small>{line >= 0 && lines ? lines[line].text : s.artist || (s.playing ? 'Playing' : 'Paused')}</small>
      </div>
      <button type="button" className="alive-ib" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => sc.toggle()}>{s.playing ? '⏸' : '▶'}</button>
      <button type="button" className="alive-ib" aria-label="Skip" onClick={() => sc.next()}>⏭</button>
      {s.url && (
        <button type="button" className={`alive-ib like ${liked ? 'on' : ''}`} aria-pressed={liked} aria-label={liked ? 'Remove from favourites' : 'Like'} onClick={like}>{liked ? '♥' : '♡'}</button>
      )}
    </section>
  )
}

// ---- swipeable mini widgets ----
interface MiniCard { id: string; node: ReactNode }

function Ring({ pct, label, sub }: { pct: number; label: string; sub: string }) {
  const r = 15
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(1, pct))
  return (
    <div className="alive-mini-body">
      <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--alive-acc, #d4ff3f)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
      <b>{label}</b>
      <small>{sub}</small>
    </div>
  )
}

export function miniCards(s: IslandSnapshot, now: number): MiniCard[] {
  const w = s.glance
  const out: MiniCard[] = []
  const ml = w?.waterMl ?? s.water.ml
  const goal = w?.waterGoal ?? s.water.target
  if (goal > 0) {
    const p = Math.max(0, Math.min(1, ml / goal))
    out.push({
      id: 'water',
      node: (
        <div className="alive-mini-body">
          <span className="alive-glass" aria-hidden>
            <i style={{ transform: `translateY(${(1 - p) * 100}%)` }} />
          </span>
          <b>{(ml / 1000).toFixed(1)} L</b>
          <small>of {(goal / 1000).toFixed(1)} L water</small>
        </div>
      )
    })
  }
  if (w && w.habitsTotal > 0) {
    out.push({
      id: 'habits',
      node: (
        <div className="alive-mini-body">
          <span className="alive-habits" aria-hidden>
            {Array.from({ length: Math.min(12, w.habitsTotal) }, (_, i) => <i key={i} className={i < w.habitsDone ? 'on' : ''} />)}
          </span>
          <b>{w.habitsDone}/{w.habitsTotal}</b>
          <small>habits today</small>
        </div>
      )
    })
  }
  const nx = s.now && s.now.end > now ? s.now : s.next
  if (nx) {
    const mins = Math.round((nx.start - now) / 60000)
    out.push({
      id: 'next',
      node: (
        <div className="alive-mini-body">
          <span className="alive-ico" aria-hidden>📅</span>
          <b title={nx.title}>{nx.title}</b>
          <small>{nx === s.now ? 'on now' : mins < 60 ? `in ${Math.max(0, mins)} min` : `at ${hhmm(nx.start)}`}</small>
        </div>
      )
    })
  }
  const money = w?.moneyLeft ?? s.money?.left ?? null
  if (money != null) {
    out.push({
      id: 'money',
      node: (
        <div className={`alive-mini-body ${money < 0 ? 'neg' : ''}`}>
          <span className="alive-ico" aria-hidden>💸</span>
          <b>{Math.round(money)}</b>
          <small>{money < 0 ? 'over today' : 'left today'}</small>
        </div>
      )
    })
  }
  const gm = aliveOf(s).gaming
  if (gm && (gm.todayMin > 0 || gm.weekMin > 0 || gm.on)) {
    out.push({
      id: 'gaming',
      node: (
        <div className={`alive-mini-body lv-${gamingLevel(gm.todayMin, gm.limitMin)}`}>
          <span className="alive-ico" aria-hidden>🎮</span>
          <b>{playMin(gm.todayMin)}</b>
          <small>today · {playMin(gm.weekMin)} this week</small>
        </div>
      )
    })
  }
  const pg = w?.proteinG ?? s.protein?.g
  const pgoal = w?.proteinGoal ?? s.protein?.goal
  if (pg != null && pgoal && pgoal > 0) out.push({ id: 'protein', node: <Ring pct={pg / pgoal} label={`${Math.round(pg)} g`} sub={`of ${Math.round(pgoal)} g protein`} /> })
  return out
}

export function MiniWidgets({ s, now }: { s: IslandSnapshot; now: number }) {
  const cards = miniCards(s, now)
  const [i, setI] = useState(0)
  const row = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const onScroll = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const r = row.current
      if (r) setI(Math.round(r.scrollLeft / Math.max(1, r.scrollWidth / Math.max(1, r.children.length))))
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  if (cards.length < 2) return null
  return (
    // data-noswipe: sideways here scrolls the cards, not the island's pages.
    <section className="alive-minis" data-noswipe aria-label="Today at a glance">
      <div className="alive-mini-row" ref={row} onScroll={onScroll} tabIndex={0}>
        {cards.map((c) => (
          <article key={c.id} className={`alive-mini m-${c.id}`}>{c.node}</article>
        ))}
      </div>
      <div className="alive-mini-dots" aria-hidden>
        {cards.map((c, n) => <i key={c.id} className={n === i ? 'on' : ''} />)}
      </div>
    </section>
  )
}

// ---- the daily story (23:00): a 15-second recap, skippable ----
export const STORY_MS = 15_000
const storyKey = (d: Date) => `ls.islandStory.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const storySeen = (d: Date) => {
  try {
    return localStorage.getItem(storyKey(d)) === '1'
  } catch {
    return false
  }
}
const storyMark = (d: Date) => {
  try {
    localStorage.setItem(storyKey(d), '1')
  } catch {
    /* private window */
  }
}

/** The story plays once a day from 23:00, when the snapshot has one (or when asked: the event). */
export function useDailyStory(s: IslandSnapshot, now: number, allowed: boolean) {
  const [on, setOn] = useState(false)
  const story = aliveOf(s).story
  const d = new Date(now)
  const due = !!story && allowed && d.getHours() >= 23 && !storySeen(d)
  useEffect(() => {
    if (due && !on) {
      storyMark(d)
      setOn(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due])
  useEffect(() => {
    const play = () => story && setOn(true)
    window.addEventListener('life-island-story', play)
    return () => window.removeEventListener('life-island-story', play)
  }, [story])
  return { on: on && !!story, story, end: () => setOn(false) }
}

export function DailyStory({ story, onEnd }: { story: NonNullable<AliveFields['story']>; onEnd: () => void }) {
  const frames = useMemo(() => {
    const lines = story.lines.filter(Boolean).slice(0, 4)
    return [...lines.map((t) => ({ text: t, stats: false })), { text: '', stats: true }]
  }, [story])
  const [n, setN] = useState(0)
  const per = STORY_MS / frames.length
  useEffect(() => {
    const t = window.setTimeout(() => (n + 1 >= frames.length ? onEnd() : setN(n + 1)), per)
    return () => clearTimeout(t)
  }, [n, frames.length, per, onEnd])
  const st = story.stats
  const f = frames[n]
  return (
    <div className="alive-story" data-hot role="dialog" aria-label="Your day in 15 seconds">
      <i className="alive-story-bar" style={{ animationDuration: `${STORY_MS}ms` }} aria-hidden />
      <div className="alive-story-frame" key={n}>
        {f.stats ? (
          <div className="alive-story-stats">
            <span><b>{st.focusMin}</b> min focus</span>
            <span><b>{(st.waterMl / 1000).toFixed(1)}</b> L water</span>
            <span><b>{st.done}</b> done</span>
          </div>
        ) : (
          <p>{f.text}</p>
        )}
      </div>
      <button type="button" className="alive-story-skip" onClick={onEnd}>Skip</button>
    </div>
  )
}

// ---- the new alert kinds ----
export const ALIVE_ALERTS = ['pulse', 'countdown', 'streakRisk', 'mirror', 'weather', 'gaming'] as const
export function AlertFx({ kind, text = '' }: { kind: string; text?: string }) {
  if (!(ALIVE_ALERTS as readonly string[]).includes(kind)) return null
  const sunny = kind === 'weather' && /sun|clear|light|warm/i.test(text)
  return (
    <span className={`alive-afx k-${kind}`} aria-hidden>
      {kind === 'pulse' && (
        <svg viewBox="0 0 32 32">
          <circle className="r1" cx="16" cy="16" r="6" />
          <circle className="r2" cx="16" cy="16" r="6" />
          <circle cx="16" cy="16" r="4" fill="currentColor" />
        </svg>
      )}
      {kind === 'countdown' && (
        <svg viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
          <path className="hand" d="M16 16 V7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="16" cy="16" r="2" fill="currentColor" />
        </svg>
      )}
      {kind === 'streakRisk' && (
        <svg viewBox="0 0 32 32">
          <path className="flame" d="M16 3 C18 9 25 11 25 19 a9 9 0 0 1 -18 0 C7 14 11 12 12 8 C13.5 10 14.5 10 14.5 10 C15.5 8 16 6 16 3z" fill="currentColor" />
          <path className="core" d="M16 15 C17.5 18 20 18.5 20 21.5 a4 4 0 0 1 -8 0 C12 19 15 18 16 15z" fill="#fff3c4" />
        </svg>
      )}
      {kind === 'mirror' && (
        <svg viewBox="0 0 32 32">
          <rect x="6" y="3" width="20" height="26" rx="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect className="sheen" x="-6" y="3" width="6" height="26" fill="currentColor" opacity="0.5" transform="skewX(-18)" />
        </svg>
      )}
      {kind === 'gaming' && (
        <svg viewBox="0 0 32 32">
          <rect className="pad" x="4" y="10" width="24" height="13" rx="6.5" fill="currentColor" opacity="0.85" />
          <path d="M10 13.5 v6 M7 16.5 h6" stroke="#10130a" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="21" cy="15" r="1.4" fill="#10130a" />
          <circle cx="24" cy="18" r="1.4" fill="#10130a" />
        </svg>
      )}
      {kind === 'weather' && !sunny && (
        <svg viewBox="0 0 32 32">
          <path d="M9 17 a5 5 0 0 1 1.5 -9.6 A7 7 0 0 1 24 9.5 A4.2 4.2 0 0 1 23 17z" fill="currentColor" opacity="0.85" />
          <path className="d1" d="M11 20 l-1.2 3" stroke="#6fc4ff" strokeWidth="1.8" strokeLinecap="round" />
          <path className="d2" d="M16 20 l-1.2 3" stroke="#6fc4ff" strokeWidth="1.8" strokeLinecap="round" />
          <path className="d3" d="M21 20 l-1.2 3" stroke="#6fc4ff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
      {kind === 'weather' && sunny && (
        <svg viewBox="0 0 32 32">
          <g className="rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M16 3 v3 M16 26 v3 M3 16 h3 M26 16 h3 M7 7 l2 2 M23 23 l2 2 M25 7 l-2 2 M9 23 l-2 2" />
          </g>
          <circle cx="16" cy="16" r="5.5" fill="currentColor" />
        </svg>
      )}
    </span>
  )
}
