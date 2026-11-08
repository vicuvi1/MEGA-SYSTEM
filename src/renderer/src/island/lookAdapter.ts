// Island v2: the ONE place the island gets its looks and widget switches.
// Today it serves the built-in defaults (core/islandLooks.ts), which keep the
// island exactly as it was. The Custom Center plugs in later with one call:
//
//   import { setLookSource } from './island/lookAdapter'
//   setLookSource({
//     looks: (now) => islandLooksFrom(activeLayout(now)),   // Partial<IslandLooks>
//     widgets: (now) => islandWidgetsFrom(widgetState()),     // Partial<IslandWidgets>
//   })
//
// Whatever a source returns is cleaned (bad or missing values become the
// defaults), so a half-finished setup can never break the island.
import { useMemo, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { cleanLooks, cleanWidgets, DEFAULT_LOOKS, DEFAULT_WIDGETS, LOOK_SCALE, type IslandLooks, type IslandWidgets } from '@core/islandLooks'
import { feelPatch } from '@core/islandMotion'
import type { Feel } from '../islandFeel'

export type { IslandLooks, IslandWidgets } from '@core/islandLooks'

export interface LookSource {
  looks?: (now: Date) => Partial<IslandLooks> | null | undefined
  widgets?: (now: Date) => Partial<IslandWidgets> | null | undefined
}

let source: LookSource | null = null
let version = 0
const subs = new Set<() => void>()
const bump = () => {
  version++
  for (const f of subs) f()
}

/** Plug a source in (the Custom Center); null goes back to the defaults. Returns the undo. */
export function setLookSource(s: LookSource | null): () => void {
  source = s
  bump()
  return () => {
    if (source === s) setLookSource(null)
  }
}

/** The source's values changed (a new layout, a saved setup): read them again. */
export function looksChanged(): void {
  bump()
}

const merge = <T extends object>(base: T, part: unknown): T => (part && typeof part === 'object' ? { ...base, ...(part as Partial<T>) } : base)

/** The looks for this moment, cleaned. */
export function islandLooks(now = new Date()): IslandLooks {
  if (!source?.looks) return DEFAULT_LOOKS
  try {
    return cleanLooks(merge(DEFAULT_LOOKS, source.looks(now)))
  } catch {
    return DEFAULT_LOOKS
  }
}

/** The widget switches for this moment, cleaned. */
export function islandWidgets(now = new Date()): IslandWidgets {
  if (!source?.widgets) return DEFAULT_WIDGETS
  try {
    return cleanWidgets(merge(DEFAULT_WIDGETS, source.widgets(now)))
  } catch {
    return DEFAULT_WIDGETS
  }
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}
const getVersion = () => version

/**
 * Looks and widgets for the island, read again when the source changes or
 * the minute turns (a layout can change by the time of day). `minute` comes
 * from the island's own clock, so no extra timer runs.
 */
export function useIslandLookAdapter(minute: number): { looks: IslandLooks; widgets: IslandWidgets } {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion)
  return useMemo(() => {
    const now = new Date(minute * 60_000)
    return { looks: islandLooks(now), widgets: islandWidgets(now) }
  }, [v, minute]) // eslint-disable-line react-hooks/exhaustive-deps
}

const FONT: Record<IslandLooks['font'], string | undefined> = {
  system: undefined,
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif",
  mono: "ui-monospace, 'Cascadia Code', 'Consolas', monospace",
  serif: "ui-serif, 'Georgia', serif"
}

/**
 * The CSS custom properties a look sets on the island's root. With the
 * defaults this is empty except what the island already did, so nothing
 * changes until a look is chosen.
 */
export function lookStyle(l: IslandLooks, musicRgb: string | null): CSSProperties {
  const out: Record<string, string> = {}
  if (l.accent) out['--v2-accent'] = l.accent
  if (l.radius != null) out['--v2-radius'] = `${l.radius}px`
  if (l.blur !== DEFAULT_LOOKS.blur) out['--v2-blur'] = `${l.blur}px`
  const f = FONT[l.font]
  if (f) out['--v2-font'] = f
  out['--v2-num'] = l.numbers === 'tabular' ? 'tabular-nums' : 'normal'
  if (LOOK_SCALE[l.size] !== 1) out['--v2-scale'] = String(LOOK_SCALE[l.size])
  const glow = l.glow === 'off' ? null : l.glow === 'music' ? musicRgb : l.accent ? hexToRgb(l.accent) : '212 255 63'
  if (glow) out['--v2-glow'] = glow
  out['--v2-glow-a'] = l.glow === 'strong' ? '0.55' : l.glow === 'off' ? '0' : '0.32'
  return out as CSSProperties
}

/** The root classes a look adds (font, numbers, glow strength). */
export function lookV2Classes(l: IslandLooks): string {
  return `v2-font-${l.font} v2-num-${l.numbers} v2-glow-${l.glow} v2-size-${l.size}`
}

/**
 * The island's one animation system with the look's motion on top: each
 * moment (open, close, peek, split, notify, tap) may have its own style,
 * speed and bounce. "Off" or reduced motion stays instant; "auto" changes nothing.
 */
export function withLookFeel(f: Feel, l: IslandLooks): Feel {
  if (f.mode === 'off') return f
  const p = feelPatch(l.motion)
  if (!Object.keys(p).length) return f
  return { ...f, ...(p as Partial<Feel>) }
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
