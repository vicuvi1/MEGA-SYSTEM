// The opened island fits the screen it is on (laptops vs big monitors).
// Pure: no Electron, no DOM. Everything here is in LOGICAL pixels (DIP): the
// work area Electron reports already has Windows' scaling applied, so a
// 1920×1080 laptop at 150 % is a 1280×720 screen here.
//
// Two layers decide the size:
// - the density: 'compact' is genuinely tighter (smaller type, less padding,
//   smaller rings and chips; see island-fit.css), 'normal' is the roomy look;
// - the zoom: the whole island scaled a little up on very big screens.
// "Auto (fits your screen)" picks both from the work area; Compact / Normal /
// Large, or a panel you resized by its corner, win over Auto.

export type IslandDensity = 'compact' | 'normal'
export type IslandSizePick = 'auto' | 'compact' | 'normal' | 'large'
export interface WorkArea { width: number; height: number }

/** Below this work-area width (or height) the screen counts as a laptop: Compact. */
export const LAPTOP_BELOW = { width: 1400, height: 760 }
/** From this work-area width the screen is big: the island grows a little. */
export const BIG_FROM = 2400
/** The panel's own limits (CSS px before the zoom). */
export const FIT_PANEL = { minW: 440, maxW: 720, minH: 320, maxH: 900 }
/** Room the window needs around the panel (the pill above it, the glow). */
const ROOM = { w: 40, h: 100 }

export interface IslandFit {
  /** Which size Auto picked, for Settings ("Auto: Compact for this screen"). */
  pick: 'compact' | 'normal' | 'large'
  density: IslandDensity
  /** CSS zoom of the whole island. */
  zoom: number
  /** The panel's size (CSS px before the zoom). */
  panelW: number
  panelH: number
}

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)))
const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)

/** A screen's physical size and scaling → its logical size (what Electron's workAreaSize gives). */
export function logicalArea(physW: number, physH: number, scaleFactor: number): WorkArea {
  const s = finite(scaleFactor, 1)
  return { width: Math.round(finite(physW, 1920) / s), height: Math.round(finite(physH, 1080) / s) }
}

/** The tallest panel that still fits under the pill on this screen (CSS px before the zoom). */
export function panelRoom(wa: WorkArea, zoom: number): { w: number; h: number } {
  const z = finite(zoom, 1)
  return { w: Math.max(FIT_PANEL.minW, Math.floor(finite(wa.width, 1920) / z) - ROOM.w), h: Math.max(FIT_PANEL.minH, Math.floor(finite(wa.height, 1040) / z) - ROOM.h) }
}

/**
 * What Auto picks for a work area: a laptop (narrower than 1400 or lower than
 * 760) gets Compact, a panel of 460–500 px and at most ~70 % of the screen's
 * height (the pages scroll inside); a normal monitor gets the roomy 600 px
 * panel; a very big one (2400+ wide) the same look a little larger.
 */
export function fitIsland(area: WorkArea): IslandFit {
  const wa = { width: finite(area?.width, 1920), height: finite(area?.height, 1040) }
  if (wa.width < LAPTOP_BELOW.width || wa.height < LAPTOP_BELOW.height) {
    return { pick: 'compact', density: 'compact', zoom: 1, panelW: clamp(wa.width * 0.37, 460, 500), panelH: clamp(Math.min(520, wa.height * 0.7), FIT_PANEL.minH, panelRoom(wa, 1).h) }
  }
  if (wa.width >= BIG_FROM) {
    const zoom = 1.1
    return { pick: 'large', density: 'normal', zoom, panelW: 620, panelH: clamp(Math.min(620, (wa.height * 0.6) / zoom), FIT_PANEL.minH, panelRoom(wa, zoom).h) }
  }
  return { pick: 'normal', density: 'normal', zoom: 1, panelW: 600, panelH: clamp(Math.min(580, wa.height * 0.72), FIT_PANEL.minH, panelRoom(wa, 1).h) }
}

/** The zoom each explicit pick uses (Auto takes it from the screen). */
export const PICK_ZOOM: Record<'compact' | 'normal' | 'large', number> = { compact: 1, normal: 1, large: 1.15 }
/** The panel width each explicit pick starts with (Settings → Quick pick). */
export const PICK_PANEL_W: Record<'compact' | 'normal' | 'large', number> = { compact: 480, normal: 600, large: 640 }

export interface IslandSizing { pick: 'compact' | 'normal' | 'large'; auto: boolean; density: IslandDensity; zoom: number; panelW: number; panelH: number }

/**
 * The size the island uses now. `pick` is your Quick pick; `panelWidth` the
 * Panel width slider (used by an explicit pick); `resized` the size you
 * dragged the panel's corner to on this screen (wins over everything). The
 * result never goes past the screen: the panel always fits under the pill.
 */
export function islandSizing(o: { pick: IslandSizePick | string | undefined; area: WorkArea; panelWidth?: number; resized?: { w: number; h: number } | null }): IslandSizing {
  const fit = fitIsland(o.area)
  const auto = !(o.pick === 'compact' || o.pick === 'normal' || o.pick === 'large')
  const pick = auto ? fit.pick : (o.pick as 'compact' | 'normal' | 'large')
  const density: IslandDensity = auto ? fit.density : pick === 'compact' ? 'compact' : 'normal'
  const zoom = auto ? fit.zoom : PICK_ZOOM[pick]
  const room = panelRoom(o.area, zoom)
  const defH = auto ? fit.panelH : density === 'compact' ? Math.min(520, Math.round(finite(o.area?.height, 1040) * 0.7)) : 560
  const defW = auto ? fit.panelW : finite(o.panelWidth, PICK_PANEL_W[pick])
  const r = o.resized && Number.isFinite(o.resized.w) && Number.isFinite(o.resized.h) ? o.resized : null
  const w = clamp(r ? r.w : defW, FIT_PANEL.minW, Math.min(FIT_PANEL.maxW, room.w))
  const h = clamp(r ? r.h : defH, FIT_PANEL.minH, Math.min(FIT_PANEL.maxH, room.h))
  return { pick, auto, density, zoom, panelW: w, panelH: h }
}

/** A short key, so the desktop only re-sends the size when it really changed. */
export const sizingKey = (s: IslandSizing) => `${s.density}|${s.zoom}|${s.panelW}x${s.panelH}`

/** Settings' label for Auto: "Auto (fits your screen) · Compact here". */
export function autoLabel(s: Pick<IslandSizing, 'pick' | 'auto'> | null | undefined): string {
  if (!s?.auto) return 'Auto (fits your screen)'
  return `Auto (fits your screen) · ${s.pick === 'compact' ? 'Compact' : s.pick === 'large' ? 'Large' : 'Normal'} here`
}
