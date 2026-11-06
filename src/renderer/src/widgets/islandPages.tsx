// PL6: pages in the opened island. Swipe or drag sideways, scroll sideways
// (or Shift + wheel), press 1–9, Ctrl+←/→ or [ ], or click a tab. Only the
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import { autoPage, cleanPagesPrefs, isPageId, keyDir, stepPage, swipeDir, visiblePages, wheelDir } from '@core/widgets/pages'
import { pageKey } from '@core/islandPalette'
import { islandPageSound } from '../islandSounds'
import { tp } from '../islandTap'
import { useFeel } from '../islandFeel'
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

/** Past the first or last page the drag gives less and less (a rubber band). */
export const rubber = (dx: number, width: number) => (dx * 0.5) / (1 + Math.abs(dx) / Math.max(120, width * 0.5))
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SPRINGY = 'cubic-bezier(0.34, 1.4, 0.64, 1)'

export interface IslandPagerProps {
  snap: IslandSnapshot
  tap: IslandPageCtx['tap']
  now: number
  day: ReactNode
  profile?: string | null
  /** Before the tabs in the top bar (Ben's avatar) and after them (search, actions). */
  left?: ReactNode
  right?: ReactNode
  /** Under the top bar, above the pages (the command bar, the quiet menu). */
  below?: ReactNode
  /** Props for the top bar itself (drag to move the island). */
  topProps?: React.HTMLAttributes<HTMLDivElement>
  /** A page opened (for the sound). */
  onPage?: (id: string) => void
}

/**
 * The opened island: a slim top bar (your avatar, the page tabs with a
 * sliding indicator, the actions) and one page below that has the rest of
 * the height. Pages slide with a little depth: the old one moves a third of
 * the way and dims, the new one comes in from the side and grows to full size.
 * A drag follows your finger, flicks carry on, and the ends give like a
 * rubber band. Keys: 1–9 jump to a page, Ctrl+← → or [ ] step.
 */
export function IslandPager({ snap, tap, now, day, profile, left, right, below, topProps, onPage }: IslandPagerProps) {
  const f = useFeel()
  const all = useRegistered()
  const prefs = useMemo(() => cleanPagesPrefs((snap.widgets as any)?.pages), [JSON.stringify((snap.widgets as any)?.pages ?? null)])
  const shown = useMemo(() => visiblePages(prefs, all.map((p) => p.id)), [prefs, all])
  // Opening: the page for this time / profile when it follows one, else the one you left it on.
  const [cur, setCur] = useState<string>(() => autoPage(prefs, { hour: new Date().getHours(), profile }, shown) ?? readLast() ?? 'day')
  // The carousel: the page you leave stays a moment (its parts don't reload) while the new one comes in.
  const [leaving, setLeaving] = useState<{ id: string; dir: number; n: number; from: number; v: number } | null>(null)
  const page = shown.includes(cur) ? cur : shown[0]
  const pageRef = useRef(page)
  pageRef.current = page
  const shownRef = useRef(shown)
  shownRef.current = shown
  const go = (id: string, from = 0, v = 0) => {
    if (id === pageRef.current || !shownRef.current.includes(id)) return
    const d = shownRef.current.indexOf(id) > shownRef.current.indexOf(pageRef.current) ? 1 : -1
    islandPageSound(d)
    setLeaving((l) => ({ id: pageRef.current, dir: d, n: (l?.n ?? 0) + 1, from, v }))
    setCur(id)
    saveLast(id)
    onPage?.(id)
  }
  const step = (d: number, from = 0, v = 0) => d && go(stepPage(shownRef.current, pageRef.current, d), from, v)
  const goRef = useRef(go)
  goRef.current = go
  const stepRef = useRef(step)
  stepRef.current = step

  // The slide itself (Web Animations: transform and opacity only, then nothing runs).
  const stage = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const l = leaving
    const el = stage.current
    if (!l || !el) return
    const inEl = el.querySelector<HTMLElement>(':scope > .ip-page:not(.ip-out)')
    const outEl = el.querySelector<HTMLElement>(':scope > .ip-out')
    const w = el.clientWidth || 500
    const done = () => setLeaving((x) => (x === l ? null : x))
    if (f.mode === 'off' || !inEl?.animate) return void done()
    if (!f.moves) {
      // Calm: a soft crossfade.
      inEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
      const a = outEl?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' })
      const t = window.setTimeout(done, 210)
      return () => (clearTimeout(t), a?.cancel())
    }
    // A flick finishes faster; a slow drag lands gently.
    const ms = Math.round(Math.max(220, Math.min(380, 380 - Math.abs(l.v) * 120)))
    const startX = l.dir * w + l.from
    inEl.animate([{ transform: `translateX(${startX}px) scale(0.94)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: ms, easing: EASE_OUT })
    const a = outEl?.animate(
      [{ transform: `translateX(${l.from}px)`, opacity: 1 }, { transform: `translateX(${-l.dir * w * 0.32}px) scale(0.92)`, opacity: 0 }],
      { duration: ms, easing: EASE_OUT, fill: 'forwards' }
    )
    const t = window.setTimeout(done, ms + 20)
    return () => (clearTimeout(t), a?.cancel())
  }, [leaving?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  // The tabs' indicator glides to the tab you picked (FLIP: it takes its new place, then moves there from the old one).
  const nav = useRef<HTMLElement>(null)
  const ind = useRef<HTMLElement>(null)
  const lastInd = useRef<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const n = nav.current
    const i = ind.current
    const b = n?.querySelector<HTMLElement>('button.on')
    if (!n || !i || !b) return
    const x = b.offsetLeft
    const w = b.offsetWidth
    i.style.width = `${w}px`
    i.style.transform = `translateX(${x}px)`
    const old = lastInd.current
    lastInd.current = { x, w }
    if (old && (old.x !== x || old.w !== w) && f.mode !== 'off' && i.animate) {
      i.animate([{ transform: `translateX(${old.x}px) scaleX(${old.w / Math.max(1, w)})` }, { transform: `translateX(${x}px)` }], { duration: f.moves ? 360 : 200, easing: f.moves ? SPRINGY : 'ease-out' })
    }
    n.classList.toggle('over', n.scrollWidth > n.clientWidth + 2)
    // Keep the tab in view when there are many.
    if (b.offsetLeft < n.scrollLeft) n.scrollLeft = b.offsetLeft - 8
    else if (b.offsetLeft + w > n.scrollLeft + n.clientWidth) n.scrollLeft = b.offsetLeft + w - n.clientWidth + 8
  })

  // Another part of the island asks for a page (the Music button, the palette: event "life-island-page" with its id).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string' && isPageId(id)) goRef.current(id)
    }
    window.addEventListener('life-island-page', onAsk)
    return () => window.removeEventListener('life-island-page', onAsk)
  }, [])

  // Keys (while the island is open): 1–9 a page, Ctrl+← → or [ ] a step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inText = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (!inText && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const i = pageKey(e.key, shownRef.current.length)
        if (i != null) {
          e.preventDefault()
          goRef.current(shownRef.current[i])
          return
        }
      }
      const d = keyDir(e.key, e.ctrlKey || e.metaKey, inText)
      if (!d) return
      e.preventDefault()
      stepRef.current(d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Swipe / drag sideways: the page follows the pointer.
  const drag = useRef<{ x: number; y: number; at: number; id: number; live: boolean; dx: number; lastX: number; lastAt: number; v: number } | null>(null)
  const livePage = () => stage.current?.querySelector<HTMLElement>(':scope > .ip-page:not(.ip-out)') ?? null
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, textarea, select, iframe, [data-noswipe], .di-panel-corner')) return
    drag.current = { x: e.clientX, y: e.clientY, at: Date.now(), id: e.pointerId, live: false, dx: 0, lastX: e.clientX, lastAt: Date.now(), v: 0 }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.live) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      d.live = true
      document.documentElement.classList.add('ip-swiping')
    }
    const t = Date.now()
    if (t > d.lastAt) d.v = (e.clientX - d.lastX) / (t - d.lastAt)
    d.lastX = e.clientX
    d.lastAt = t
    const w = stage.current?.clientWidth || 400
    const i = shownRef.current.indexOf(pageRef.current)
    const atEnd = (dx > 0 && i <= 0) || (dx < 0 && i >= shownRef.current.length - 1)
    d.dx = atEnd || !f.moves ? rubber(dx, w) : dx
    const el = livePage()
    if (el && f.mode !== 'off') {
      el.style.transform = `translateX(${d.dx}px)`
      el.style.opacity = String(1 - Math.min(0.45, Math.abs(d.dx) / w))
    }
  }
  const endDrag = (e: React.PointerEvent, cancel = false) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId) return
    document.documentElement.classList.remove('ip-swiping')
    const el = livePage()
    const reset = () => {
      if (!el) return
      el.style.transform = ''
      el.style.opacity = ''
    }
    const width = stage.current?.clientWidth || 400
    const dir = cancel ? 0 : swipeDir(e.clientX - d.x, e.clientY - d.y, Date.now() - d.at, width)
    const next = dir ? stepPage(shownRef.current, pageRef.current, dir) : pageRef.current
    if (next !== pageRef.current) {
      reset()
      step(dir, d.live ? d.dx : 0, d.v)
      return
    }
    // Not far enough (or the first / last page): back into place with a little bounce.
    if (d.live && el && el.animate && f.mode !== 'off') {
      const from = d.dx
      reset()
      el.animate([{ transform: `translateX(${from}px)`, opacity: el.style.opacity || 1 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRINGY })
    } else reset()
  }
  // The wheel: one page per scroll gesture (a short pause between).
  const wheelAt = useRef(0)
  const onWheel = (e: React.WheelEvent, tabs = false) => {
    const d = tabs ? (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? Math.sign(e.deltaY) : Math.sign(e.deltaX)) : wheelDir(e.deltaX, e.deltaY, e.shiftKey)
    if (!d) return
    e.stopPropagation()
    if (Date.now() - wheelAt.current < 350) return
    wheelAt.current = Date.now()
    step(d)
  }

  const shownPages = shown.map((id) => all.find((p) => p.id === id)!).filter(Boolean)
  const active = shownPages.find((p) => p.id === page)
  const many = shownPages.length > 1
  return (
    <div className={`ip-pager ${many ? '' : 'one'}`} data-page={page}>
      <div className="ip-top" {...topProps}>
        {left}
        {many ? (
          <nav ref={nav} className="ip-dots" role="tablist" aria-label="Island pages (1–9, swipe, Shift + wheel, Ctrl+← →)" onWheel={(e) => onWheel(e, true)}>
            <i ref={ind} className="ip-ind" aria-hidden />
            {shownPages.map((p, i) => (
              <button key={p.id} role="tab" aria-selected={p.id === page} className={p.id === page ? 'on' : ''} title={p.title} aria-keyshortcuts={i < 9 ? String(i + 1) : undefined} {...tp(`page:${p.id}`, () => go(p.id))}>
                <span aria-hidden>{p.icon}</span>
                <i>{p.title}</i>
              </button>
            ))}
          </nav>
        ) : (
          <span className="ip-solo">{active?.title}</span>
        )}
        {right}
      </div>
      {below}
      <div ref={stage} className="ip-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => endDrag(e)} onPointerCancel={(e) => endDrag(e, true)} onWheel={(e) => onWheel(e)}>
        {/* Keyed by page: the page you leave keeps its parts (nothing reloads) while it slides out. */}
        {[...(leaving && leaving.id !== page && shown.includes(leaving.id) ? [leaving.id] : []), page].map((id) =>
          id === page ? (
            <div key={id} className="ip-page" data-page={id} role="tabpanel" aria-label={active?.title}>
              {active?.render({ snap, tap, now, day })}
            </div>
          ) : (
            <div key={id} className="ip-page ip-out" aria-hidden inert>
              {all.find((p) => p.id === id)?.render({ snap, tap, now, day })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
