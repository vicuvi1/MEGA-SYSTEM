// PL6: pages in the opened island. Swipe or drag sideways, scroll sideways
// (or Shift + wheel), press Ctrl+←/→ or [ ], or click a page dot. Only the
// page you see is drawn: the others are not mounted, so nothing on them runs
// or animates while hidden.
//
// The page API (kept tiny on purpose; see docs/AI_HANDOFF.md → Island pages):
//
//   import { registerIslandPage } from './widgets/islandPages'
//   registerIslandPage({ id: 'music', title: 'Music', icon: '🎵', render: (ctx) => <MyMusic snap={ctx.snap} tap={ctx.tap} /> })
//
// - id: lower-case letters, digits and "-" (a page with the same id replaces the old one).
// - render(ctx): ctx.snap is the island snapshot, ctx.tap sends an island action,
//   ctx.now is the time, ctx.day is the Day page's own content (only Day uses it).
// - order (optional): where a new page goes before you reorder it (lower = earlier).
// - It returns a function that takes the page away again.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import { autoPage, cleanPagesPrefs, isPageId, keyDir, stepPage, swipeDir, visiblePages, wheelDir } from '@core/widgets/pages'
import { tp } from '../islandTap'
import './islandPages.css'

export interface IslandPageCtx {
  snap: IslandSnapshot
  tap: (a: IslandAction, label?: string) => void
  now: number
  /** The Day page's content (the island's own sections, tiles and calendar). */
  day: ReactNode
}

export interface IslandPage {
  id: string
  title: string
  /** An emoji or one short symbol. */
  icon: string
  render: (ctx: IslandPageCtx) => ReactNode
  order?: number
}

const pages = new Map<string, IslandPage & { seq: number }>()
const subs = new Set<() => void>()
let seq = 0
let version = 0
const changed = () => {
  version++
  subs.forEach((f) => f())
}

/** Adds (or replaces) an island page. Returns a function that removes it. */
export function registerIslandPage(p: IslandPage): () => void {
  if (!isPageId(p.id)) throw new Error(`Island page id "${p.id}" must be lower-case letters, digits or "-"`)
  const entry = { ...p, seq: pages.get(p.id)?.seq ?? seq++ }
  pages.set(p.id, entry)
  changed()
  return () => {
    if (pages.get(p.id) === entry) {
      pages.delete(p.id)
      changed()
    }
  }
}

/** The pages registered now, by their `order` (then by when they came). */
export function registeredPages(): IslandPage[] {
  return [...pages.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50) || a.seq - b.seq)
}
const useRegistered = () => {
  useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => version)
  return registeredPages()
}

// ---- The built-in pages ----

registerIslandPage({ id: 'day', title: 'Day', icon: '☀️', order: 0, render: (ctx) => ctx.day })
// A placeholder: the music builder registers the real one with the same id.
registerIslandPage({
  id: 'music',
  title: 'Music',
  icon: '🎵',
  order: 10,
  render: () => (
    <div className="ip-empty">
      <b>🎵 Music</b>
      <small>Your music is coming to this page. For now your SoundCloud stations are on the Day page.</small>
    </div>
  )
})

const LAST = 'ls.islandPage'
const readLast = () => {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}
const saveLast = (id: string) => {
  try {
    localStorage.setItem(LAST, id)
  } catch {
    /* fine */
  }
}

/** The opened island's pages: dots on top, one page below. */
export function IslandPager({ snap, tap, now, day, profile }: { snap: IslandSnapshot; tap: IslandPageCtx['tap']; now: number; day: ReactNode; profile?: string | null }) {
  const all = useRegistered()
  const prefs = useMemo(() => cleanPagesPrefs((snap.widgets as any)?.pages), [JSON.stringify((snap.widgets as any)?.pages ?? null)])
  const shown = useMemo(() => visiblePages(prefs, all.map((p) => p.id)), [prefs, all])
  // Opening: the page for this time / profile when it follows one, else the one you left it on.
  const [cur, setCur] = useState<string>(() => autoPage(prefs, { hour: new Date().getHours(), profile }, shown) ?? readLast() ?? 'day')
  const [dir, setDir] = useState(0)
  const page = shown.includes(cur) ? cur : shown[0]
  const go = (id: string) => {
    if (id === page) return
    setDir(shown.indexOf(id) > shown.indexOf(page) ? 1 : -1)
    setCur(id)
    saveLast(id)
  }
  const step = (d: number) => d && go(stepPage(shown, page, d))
  const stepRef = useRef(step)
  stepRef.current = step
  const goRef = useRef(go)
  goRef.current = go

  // Another part of the island asks for a page (the Music button: event "life-island-page" with its id).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string' && isPageId(id)) goRef.current(id)
    }
    window.addEventListener('life-island-page', onAsk)
    return () => window.removeEventListener('life-island-page', onAsk)
  }, [])

  // Keys (while the island is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inText = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const d = keyDir(e.key, e.ctrlKey || e.metaKey, inText)
      if (!d) return
      e.preventDefault()
      stepRef.current(d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Swipe / drag sideways.
  const drag = useRef<{ x: number; y: number; at: number; id: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, textarea, select, iframe, [data-noswipe]')) return
    drag.current = { x: e.clientX, y: e.clientY, at: Date.now(), id: e.pointerId }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId) return
    const width = (e.currentTarget as HTMLElement).clientWidth || 400
    step(swipeDir(e.clientX - d.x, e.clientY - d.y, Date.now() - d.at, width))
  }
  // The wheel: one page per scroll gesture (a short pause between).
  const wheelAt = useRef(0)
  const onWheel = (e: React.WheelEvent, dots = false) => {
    const d = dots ? (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? Math.sign(e.deltaY) : Math.sign(e.deltaX)) : wheelDir(e.deltaX, e.deltaY, e.shiftKey)
    if (!d) return
    e.stopPropagation()
    if (Date.now() - wheelAt.current < 350) return
    wheelAt.current = Date.now()
    step(d)
  }

  const shownPages = shown.map((id) => all.find((p) => p.id === id)!).filter(Boolean)
  const active = shownPages.find((p) => p.id === page)
  if (shownPages.length <= 1) return <>{active?.render({ snap, tap, now, day })}</>
  return (
    <div className="ip-pager" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (drag.current = null)} onWheel={(e) => onWheel(e)}>
      <nav className="ip-dots" role="tablist" aria-label="Island pages (swipe, Shift + wheel, Ctrl+← →)" onWheel={(e) => onWheel(e, true)}>
        {shownPages.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === page} className={p.id === page ? 'on' : ''} title={p.title} {...tp(`page:${p.id}`, () => go(p.id))}>
            <span aria-hidden>{p.icon}</span>
            <i>{p.title}</i>
          </button>
        ))}
      </nav>
      <div key={page} className={`ip-page ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}`} role="tabpanel" aria-label={active?.title}>
        {active?.render({ snap, tap, now, day })}
      </div>
    </div>
  )
}
