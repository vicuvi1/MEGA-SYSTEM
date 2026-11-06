// The signed-in SoundCloud view (desktop) sits over the Music page's "Your
// SoundCloud" tab. It is a separate view drawn on top of the page, so the
// page tells the desktop where its box is. These are the small sums for that:
//  - the box's place in the page (CSS pixels) → the view's place on the
//    window. Electron places views in window pixels ("DIP"), which already
//    include Windows' display scaling (125 %, 150 %…), so only the app's own
//    zoom (Ctrl + / Ctrl −) has to be multiplied in. Edges are rounded, not
//    the width, so the view never ends one pixel short of the box.
//  - how tall the box is: from where it starts down to the bottom of the
//    window, less a small margin.
//  - whether something of ours (a menu, a dialog, the search box, a toast)
//    lies over the box: the view would hide it, so it steps aside meanwhile.
//  - the view's zoom: 100 % by default; the old 80 % default moves to 100 %
//    unless you picked a zoom yourself.

export type Box = { x: number; y: number; width: number; height: number }
export type Rect = { left: number; top: number; right: number; bottom: number }

/** The box (CSS pixels from the page's top-left) → the view's bounds in window pixels. */
export function toWindowBounds(r: Rect, zoom: number): Box {
  const k = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const x = Math.round(r.left * k)
  const y = Math.round(r.top * k)
  return { x, y, width: Math.max(0, Math.round(r.right * k) - x), height: Math.max(0, Math.round(r.bottom * k) - y) }
}

/** The part of the box you can see inside the page's scrolling area (it may be scrolled partly out). */
export function clip(box: Rect, area: Rect): Rect {
  return { left: Math.max(box.left, area.left), top: Math.max(box.top, area.top), right: Math.min(box.right, area.right), bottom: Math.min(box.bottom, area.bottom) }
}

/** The box's height: from its top to the window's bottom, less the margin; never under min. */
export function fillHeight(o: { viewport: number; top: number; margin?: number; min?: number }): number {
  const h = Math.floor(o.viewport - o.top - (o.margin ?? 16))
  return Math.max(o.min ?? 320, Number.isFinite(h) ? h : 0)
}

/** Does any of these (shown) rectangles lie over the box? A sliver under 2 px doesn't count. */
export function covered(box: Rect, over: Rect[]): boolean {
  return over.some((o) => Math.min(box.right, o.right) - Math.max(box.left, o.left) > 2 && Math.min(box.bottom, o.bottom) - Math.max(box.top, o.top) > 2)
}

/** A short key for "where the view goes": a new one means tell the desktop again. */
export const boundsKey = (r: Rect, dpr: number, hidden: boolean) => (hidden ? 'hidden' : `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}@${Math.round(dpr * 1000)}`)

export const SCWEB_ZOOM_DEFAULT = 1
/** The zoom we used to start at (before the view filled the tab). */
export const SCWEB_ZOOM_OLD_DEFAULT = 0.8

/** The view's zoom from the saved file: yours if you picked one, else 100 % (the old 80 % default included). */
export function savedZoom(j: { zoom?: unknown; zoomSet?: unknown } | null | undefined, clean: (z: unknown) => number): number {
  if (!j || j.zoom === undefined || j.zoom === null) return SCWEB_ZOOM_DEFAULT
  const z = clean(j.zoom)
  if (j.zoomSet === true) return z
  return Math.abs(z - SCWEB_ZOOM_OLD_DEFAULT) < 0.001 ? SCWEB_ZOOM_DEFAULT : z
}
