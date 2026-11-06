// The island's look, BrimDeck-style (inspiration only, no code from it):
// three collapsed styles (Notch on the top edge, Capsule = the floating
// pill, a thin bar while a window is maximized), an optional clock in the
// pill (Simple, Seven-segment, Serif, your colour) and eight themes. All
// from the synced setting (Settings → Widgets → Island look), so every PC
// looks the same. Light: the clock redraws once a minute; nothing loops.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { IslandSnapshot } from '@core/islandModel'
import { cleanLook, type ClockStyle, type IslandLookPrefs } from '@core/widgets/settings'
import { dayMark, dayOffset, dayWords, nextZoneIndex, worldLine, ZONE_BACK_MS, zoneName, zoneTime, type ClockZone } from '@core/worldClock'
import { onFrame, ringColor, useFeel } from '../islandFeel'
import { Roll } from '../IslandScenes'
import { tp } from '../islandTap'
import './islandLook.css'

export function useIslandLook(s: IslandSnapshot): IslandLookPrefs {
  const raw = (s.widgets as { look?: unknown } | undefined)?.look
  return useMemo(() => cleanLook(raw, 'notch'), [JSON.stringify(raw ?? null)])
}

/** Is the thin bar showing now (style "indicator", or a maximized window with that switch on)? */
export const showBar = (look: IslandLookPrefs, maximized: boolean) => look.style === 'indicator' || (look.maxBar && maximized)

/**
 * The classes for the island's root. The notch only fits at the top of the screen.
 * `inBar`: the thin-bar context (the shape hugs the top edge, also while it is open);
 * `bar`: the Indicator itself is showing (no hover, no panel).
 */
export function lookRootClasses(look: IslandLookPrefs, place: string, bar: boolean, inBar = bar): string {
  const top = place === 'top' || place.startsWith('top')
  return [`th-${look.theme}`, look.style === 'notch' && top ? 'style-notch' : `style-${look.style === 'notch' ? 'capsule' : look.style}`, inBar ? 'in-bar' : '', bar ? 'is-bar' : ''].filter(Boolean).join(' ')
}

/** CSS radius for the shape: square top corners for the notch. */
export const notchRadius = (on: boolean, r: number): string | number => (on ? `0px 0px ${r}px ${r}px` : r)

/** What the thin Indicator shows, folded into its one shape. */
export interface IndicatorInfo {
  /** A timer (strong fill) or the current block (faint fill): the capsule fills left to right. */
  fill: { from: number; to: number; freeze?: number | null; soft?: boolean } | null
  /** Music is playing: a tiny equalizer at the left end. */
  music: boolean
  /** Captions are running: a red dot at the right end. */
  rec: boolean
  /** Something new (its id): one short accent pulse. */
  alert: string | null
}

/** The capsule filling up: one transform on one element (no second line). Amber in the last 5 minutes. */
function IndicatorFill({ from, to, freeze = null, soft = false }: NonNullable<IndicatorInfo['fill']>) {
  const f = useFeel()
  const el = useRef<HTMLElement>(null)
  useEffect(() => {
    let last = -1
    let lastColor = '-'
    const draw = (t0: number) => {
      const t = freeze ?? t0
      const node = el.current
      if (!node) return
      const pct = Math.min(1, Math.max(0, (t - from) / Math.max(1, to - from)))
      if (Math.abs(pct - last) >= 0.0005) {
        node.style.transform = `scaleX(${pct.toFixed(4)})`
        last = pct
      }
      const color = soft ? '' : (ringColor(to - t) ?? '')
      if (color !== lastColor) {
        node.style.background = color
        lastColor = color
      }
    }
    if (f.mode === 'off') {
      draw(Date.now())
      const i = window.setInterval(() => draw(Date.now()), 1000)
      return () => clearInterval(i)
    }
    return onFrame(draw)
  }, [from, to, freeze, soft, f])
  return <i ref={el} className={`di-ind-fill ${soft ? 'soft' : ''}`} aria-hidden />
}

/**
 * The thin Indicator (a window is maximized, or you picked the bar): ONE small
 * capsule on the top edge. A timer fills it, music adds a 3-bar equalizer, captions
 * a red dot, something new one accent pulse. Hover grows it into the pill; click opens.
 */
export function IslandIndicator({ info, ...props }: { info: IndicatorInfo } & React.HTMLAttributes<HTMLDivElement>) {
  const says = [info.fill && !info.fill.soft ? 'a timer is running' : '', info.music ? 'music is playing' : '', info.rec ? 'captioning' : '', info.alert ? 'something new' : ''].filter(Boolean).join(', ')
  return (
    <div
      className={`di-ind ${info.fill && !info.fill.soft ? 'has-fill' : ''} ${info.music ? 'has-eq' : ''} ${info.rec ? 'has-rec' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`The island${says ? ` (${says})` : ''}: hover or click to open`}
      {...props}
    >
      {info.fill && <IndicatorFill {...info.fill} />}
      {info.music && (
        <span className="di-ind-eq" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      )}
      {info.rec && <span className="di-ind-rec" aria-hidden />}
      {info.alert && <span key={info.alert} className="di-ind-ping" aria-hidden />}
    </div>
  )
}

const two = (n: number) => String(n).padStart(2, '0')
/** Redraws on the minute, nothing more. */
function useMinute(): Date {
  const [d, setD] = useState(() => new Date())
  useEffect(() => {
    let t = 0
    const next = () => {
      t = window.setTimeout(() => (setD(new Date()), next()), 60_000 - (Date.now() % 60_000) + 50)
    }
    next()
    return () => clearTimeout(t)
  }, [])
  return d
}

// Seven segments: a b c d e f g.
const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' }
const PATH: Record<string, string> = { a: 'M2 1h6', b: 'M9 2v6', c: 'M9 10v6', d: 'M2 17h6', e: 'M1 10v6', f: 'M1 2v6', g: 'M2 9h6' }
function Digit({ d }: { d: string }) {
  const on = SEG[d] ?? ''
  return (
    <svg className="di-seg" viewBox="0 0 10 18" aria-hidden>
      {Object.keys(PATH).map((k) => <path key={k} d={PATH[k]} className={on.includes(k) ? 'on' : ''} />)}
    </svg>
  )
}

// ---- Other time zones: which one the clock shows now (0 = your time), shared by every clock on the island ----
let zoneIdx = 0
let backT = 0
const zoneSubs = new Set<() => void>()
const setZoneIdx = (i: number) => {
  if (i === zoneIdx) return
  zoneIdx = i
  for (const f of zoneSubs) f()
}
const subZone = (f: () => void) => (zoneSubs.add(f), () => void zoneSubs.delete(f))
const getZone = () => zoneIdx
/** The clock shows the next zone (your time → zone 1 → … → your time). `back`: your time again after 30 s. */
export function nextClockZone(count: number, back: boolean): void {
  clearTimeout(backT)
  setZoneIdx(nextZoneIndex(zoneIdx, count))
  if (back && zoneIdx !== 0) backT = window.setTimeout(() => setZoneIdx(0), ZONE_BACK_MS)
}
/** Which zone the clock shows: null for your own time. */
function useClockZone(zones: ClockZone[]): ClockZone | null {
  const i = useSyncExternalStore(subZone, getZone, getZone)
  return i > 0 && i <= zones.length ? zones[i - 1] : null
}

function SegClock({ hm, style, flip = '' }: { hm: string; style?: React.CSSProperties; flip?: string }) {
  return (
    // A new zone flips in (CSS; none with less motion); the minute just redraws.
    <span key={flip} className={`di-clock seg ${flip ? 'di-wflip' : ''}`} style={style} aria-label={hm}>
      <Digit d={hm[0]} />
      <Digit d={hm[1]} />
      <i className="di-seg-colon" />
      <Digit d={hm[3]} />
      <Digit d={hm[4]} />
    </span>
  )
}

/**
 * The pill's clock. With other time zones set, a tap shows the next one (the
 * panel doesn't open), a small tag says which and the day when it differs,
 * and resting the mouse on it lists every zone.
 */
export function IslandClock({ kind, color, zones = [], back = true, onTap }: { kind: ClockStyle; color?: string; zones?: ClockZone[]; back?: boolean; onTap?: () => void }) {
  const d = useMinute()
  const zone = useClockZone(zones)
  const [all, setAll] = useState(false)
  const hoverT = useRef(0)
  useEffect(() => () => clearTimeout(hoverT.current), [])
  if (kind === 'off') return null
  const hm = zone ? zoneTime(d, zone.tz) : `${two(d.getHours())}:${two(d.getMinutes())}`
  const style = color ? ({ ['--clock' as string]: color } as React.CSSProperties) : undefined
  if (!zones.length) return kind === 'segment' ? <SegClock hm={hm} style={style} /> : <span className={`di-clock ${kind}`} style={style}>{hm}</span>
  const off = zone ? dayOffset(d, zone.tz) : 0
  const mark = dayMark(off)
  const line = worldLine(d, zones)
  const step = () => {
    // Tapping through zones: the list of all of them steps aside until the mouse comes back.
    clearTimeout(hoverT.current)
    setAll(false)
    nextClockZone(zones.length, back)
    onTap?.()
  }
  return (
    <span
      className={`di-wclock ${zone ? 'is-away' : ''}`}
      style={style}
      role="button"
      tabIndex={0}
      // Empty: the pill's own tooltip doesn't cover the list of zones.
      title=""
      aria-label={`${zone ? `${zoneName(zone)} ${hm}${off ? `, ${dayWords(off)}` : ''}` : `Your time ${hm}`}. ${line}. Tap for the next time zone`}
      {...tp('clock:zone', step)}
      // Two quick taps are two zones, not the pill's double-click (which tucks the island away).
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        step()
      }}
      onPointerEnter={() => {
        clearTimeout(hoverT.current)
        hoverT.current = window.setTimeout(() => setAll(true), 600)
      }}
      onPointerLeave={() => {
        clearTimeout(hoverT.current)
        setAll(false)
      }}
    >
      {kind === 'segment' ? <SegClock hm={hm} flip={zone?.tz ?? 'local'} /> : <Roll className={`di-clock ${kind}`} text={hm} />}
      {zone && (
        <span className="di-wclock-tag" key={zone.tz}>
          {zoneName(zone)}
          {mark && <b aria-hidden>{mark}</b>}
        </span>
      )}
      {all && <span className="di-wclock-all" role="tooltip" title={line}>{line}</span>}
    </span>
  )
}

/** The panel's world clock: one time per zone, your time first. */
export function WorldClockRow({ zones }: { zones: ClockZone[] }) {
  const d = useMinute()
  if (!zones.length) return null
  return (
    <section className="di-world" aria-label="World clock">
      <span className="di-world-z here">
        <small>Local</small>
        <b>{zoneTime(d)}</b>
      </span>
      {zones.map((z) => {
        const off = dayOffset(d, z.tz)
        return (
          <span key={z.tz} className="di-world-z" title={z.tz.replace(/_/g, ' ')}>
            <small>{zoneName(z)}</small>
            <b>
              {zoneTime(d, z.tz)}
              {off !== 0 && <i title={dayWords(off)}>{dayMark(off)}</i>}
            </b>
          </span>
        )
      })}
    </section>
  )
}
