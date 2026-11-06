// The island's look, BrimDeck-style (inspiration only, no code from it):
// three collapsed styles (Notch on the top edge, Capsule = the floating
// pill, a thin bar while a window is maximized), an optional clock in the
// pill (Simple, Seven-segment, Serif, your colour) and eight themes. All
// from the synced setting (Settings → Widgets → Island look), so every PC
// looks the same. Light: the clock redraws once a minute; nothing loops.
import { useEffect, useMemo, useState } from 'react'
import type { IslandSnapshot } from '@core/islandModel'
import { cleanLook, type ClockStyle, type IslandLookPrefs } from '@core/widgets/settings'
import './islandLook.css'

export function useIslandLook(s: IslandSnapshot): IslandLookPrefs {
  const raw = (s.widgets as { look?: unknown } | undefined)?.look
  return useMemo(() => cleanLook(raw, 'notch'), [JSON.stringify(raw ?? null)])
}

/** Is the thin bar showing now (style "indicator", or a maximized window with that switch on)? */
export const showBar = (look: IslandLookPrefs, maximized: boolean) => look.style === 'indicator' || (look.maxBar && maximized)

/** The classes for the island's root. The notch only fits at the top of the screen. */
export function lookRootClasses(look: IslandLookPrefs, place: string, bar: boolean): string {
  const top = place === 'top' || place.startsWith('top')
  return [`th-${look.theme}`, look.style === 'notch' && top ? 'style-notch' : `style-${look.style === 'notch' ? 'capsule' : look.style}`, bar ? 'is-bar' : ''].filter(Boolean).join(' ')
}

/** CSS radius for the shape: square top corners for the notch. */
export const notchRadius = (on: boolean, r: number): string | number => (on ? `0px 0px ${r}px ${r}px` : r)

/** The thin bar (it opens like the pill: hover or click). */
export function IslandBar(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="di-bar" role="button" tabIndex={0} aria-label="The island (a window is maximized): hover or click to open" {...props}>
      <i />
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

/** The pill's clock. */
export function IslandClock({ kind, color }: { kind: ClockStyle; color?: string }) {
  const d = useMinute()
  if (kind === 'off') return null
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`
  const style = color ? ({ ['--clock' as string]: color } as React.CSSProperties) : undefined
  if (kind === 'segment')
    return (
      <span className="di-clock seg" style={style} aria-label={hm}>
        <Digit d={hm[0]} />
        <Digit d={hm[1]} />
        <i className="di-seg-colon" />
        <Digit d={hm[3]} />
        <Digit d={hm[4]} />
      </span>
    )
  return <span className={`di-clock ${kind}`} style={style}>{hm}</span>
}
