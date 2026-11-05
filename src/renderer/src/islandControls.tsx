// The island's controls, the page part (IC1–IC10, IC20): quick buttons on the
// peek, taps that show at once (and shake back when they fail), the round
// menu, the command bar's suggestions, the right-click menu, the wheel's
// number, stage dots, undo, keyboard moves, and the first frame from cache.
// Every button fires through tp() (on release); every overlay is data-hot, so
// it is in the island's click areas. The pure rules are in core/islandCommands.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyExpected, keyMove, ringLayout, ringPick, RING_HOLD_MS, RING_MOVE_PX, settleExpected, type Expected, type MenuItem, type QuickBtn, type RingItem, type Suggestion } from '@core/islandCommands'
import type { IslandAck, IslandAction, IslandSnapshot } from '@core/islandModel'
import { tp } from './islandTap'
import './islandControls.css'

// ---- IC20: the first frame from the last snapshot ---------------------------

const CACHE = 'ls.islandSnap'
/** The last snapshot of this window's session (null: none, or too old to show). */
export function cachedSnap(): IslandSnapshot | null {
  try {
    const v = sessionStorage.getItem(CACHE)
    const s = v ? (JSON.parse(v) as IslandSnapshot) : null
    // Only a fresh-ish picture (10 min), never a locked one; it is replaced by the first real snapshot.
    return s && !s.locked && Date.now() - s.at < 10 * 60_000 ? s : null
  } catch {
    return null
  }
}
let cacheT = 0
export function cacheSnap(s: IslandSnapshot): void {
  if (s.locked || !s.at) return
  clearTimeout(cacheT)
  cacheT = window.setTimeout(() => {
    try {
      sessionStorage.setItem(CACHE, JSON.stringify(s))
    } catch {
      /* fine */
    }
  }, 300)
}

/**
 * IC20: the peek opens while you still hold the mouse: as soon as the press
 * has stayed put for `ms` (so a drag, which needs 8 px, still drags), not
 * only on the release. A quick click opens on its release as before.
 */
export function useEarlyOpen(open: () => void, ms: number, px: number) {
  const t = useRef(0)
  useEffect(() => () => clearTimeout(t.current), [])
  return (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, a')) return
    clearTimeout(t.current)
    const x = e.clientX
    const y = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x, ev.clientY - y) > px) moved = true
    }
    const stop = () => {
      clearTimeout(t.current)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', stop)
    t.current = window.setTimeout(() => {
      stop()
      if (!moved && !document.documentElement.classList.contains('di-dragging')) open()
    }, ms)
  }
}

// ---- IC2: taps show at once -------------------------------------------------

/**
 * The snapshot with every tap still on its way already applied. A tap stays
 * until its answer: ok, it goes with the next snapshot (so nothing jumps
 * back); not ok, it goes at once and `onFail` shakes the shape.
 */
export function useExpected(raw: IslandSnapshot, onFail: () => void) {
  const [list, setList] = useState<Expected[]>([])
  const failRef = useRef(onFail)
  failRef.current = onFail
  // A new snapshot: what was answered is in it now.
  useEffect(() => {
    setList((l) => (l.length ? settleExpected(l, Date.now()) : l))
  }, [raw])
  // A tap whose answer never comes is dropped after 15 s.
  useEffect(() => {
    if (!list.length) return
    const t = window.setTimeout(() => setList((l) => settleExpected(l, Date.now())), 15_500)
    return () => clearTimeout(t)
  }, [list])
  const add = useCallback((id: string, action: IslandAction) => setList((l) => [...l.slice(-8), { id, action, at: Date.now() }]), [])
  const ack = useCallback((a: IslandAck) => {
    setList((l) => {
      const e = l.find((x) => x.id === a.id)
      if (!e) return l
      if (!a.ok) {
        window.setTimeout(() => failRef.current(), 0)
        return l.filter((x) => x.id !== a.id)
      }
      return l.map((x) => (x.id === a.id ? { ...x, ackedAt: Date.now() } : x))
    })
  }, [])
  const snap = useMemo(() => (list.length ? applyExpected(raw, list) : raw), [raw, list])
  return { snap, add, ack, pending: list.length }
}

/** A small "no" shake (the tap didn't work), on the GPU. */
export function shake(el: HTMLElement | null, on = true): void {
  if (!el || !on || typeof el.animate !== 'function') return
  el.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '5px 0' }, { translate: '-3px 0' }, { translate: '0 0' }], { duration: 340, easing: 'ease-out' })
}

// ---- IC1: quick buttons ------------------------------------------------------

export function QuickRow({ btns, onTap, water }: { btns: QuickBtn[]; onTap: (a: IslandAction) => void; water?: number | null }) {
  return (
    <div className="di-quick" role="group" aria-label="Quick actions">
      {btns.map((b, i) => {
        // IC6: the amount picked with Shift + wheel shows on the first water button.
        const action: IslandAction = water && i === 0 && b.action.kind === 'water' ? { kind: 'water', ml: water } : b.action
        const label = water && i === 0 && b.action.kind === 'water' ? `💧 +${water}` : b.label
        return b.check ? (
          <button key={b.id} className="di-qcheck" {...tp(b.id, () => onTap(action))} title={b.title}>
            <i />
            <span>{label}</span>
          </button>
        ) : (
          <button key={b.id} className={b.primary ? 'primary' : ''} {...tp(b.id, () => onTap(action))} title={b.title}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** IC11: the flow's stage dots (focus · break · next), the one on now lit. */
export function StageDots({ dots }: { dots: { n: number; at: number } | null | undefined }) {
  if (!dots || dots.n < 2) return null
  return (
    <span className="di-stages" aria-label={`Part ${dots.at + 1} of ${dots.n}`}>
      {Array.from({ length: dots.n }, (_, i) => (
        <i key={i} className={i === dots.at ? 'on' : i < dots.at ? 'done' : ''} />
      ))}
    </span>
  )
}

// ---- IC3: the round menu -------------------------------------------------------

/** x, y: where it opened (screen of the page, for pointing); lx, ly: the same inside the island (for drawing). */
/** How far the round menu's items sit from where you hold. */
export const RING_RADIUS = 92
export interface RingState { x: number; y: number; lx: number; ly: number; pick: number }

/**
 * Hold the pill: after RING_HOLD_MS without moving, the round menu opens
 * around the pointer; slide to an item and let go to fire it. Moving first
 * (a drag) or letting go early cancels it. `on` is false while it may not open.
 */
export function useRing(o: { on: boolean; items: RingItem[]; fire: (it: RingItem) => void; toLocal: (x: number, y: number) => { x: number; y: number } }) {
  const [ring, setRing] = useState<RingState | null>(null)
  const ringRef = useRef<RingState | null>(null)
  ringRef.current = ring
  const opts = useRef(o)
  opts.current = o
  const hold = useRef<{ t: number; x: number; y: number; id: number } | null>(null)
  // While it is open, a drag never starts (you are sliding to an item).
  useEffect(() => {
    document.documentElement.classList.toggle('di-ring-open', !!ring)
  }, [ring])
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.t)
    hold.current = null
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const h = hold.current
      if (h && e.pointerId === h.id && Math.hypot(e.clientX - h.x, e.clientY - h.y) > RING_MOVE_PX) cancelHold()
      const r = ringRef.current
      if (!r) return
      const pick = ringPick(e.clientX - r.x, e.clientY - r.y, opts.current.items.length, 22, true)
      if (pick !== r.pick) setRing({ ...r, pick })
    }
    const up = () => {
      cancelHold()
      const r = ringRef.current
      if (!r) return
      // The pill's own release sees the menu still open (and does nothing); then it closes.
      window.setTimeout(() => setRing(null), 0)
      const it = r.pick >= 0 ? opts.current.items[r.pick] : null
      if (it && !it.disabled) opts.current.fire(it)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (cancelHold(), setRing(null))
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', () => (cancelHold(), setRing(null)))
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
    }
  }, [])
  /** The pill's pointerdown: start the hold. */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!opts.current.on || e.button !== 0) return
    cancelHold()
    const { clientX: x, clientY: y, pointerId: id } = e
    hold.current = {
      x, y, id,
      t: window.setTimeout(() => {
        hold.current = null
        if (document.documentElement.classList.contains('di-dragging')) return
        // Kept inside the window sideways (a docked pill sits at its edge).
        const cx = Math.min(Math.max(x, RING_RADIUS + 34), Math.max(RING_RADIUS + 34, window.innerWidth - RING_RADIUS - 34))
        const l = opts.current.toLocal(cx, y)
        setRing({ x: cx, y, lx: l.x, ly: l.y, pick: -1 })
      }, RING_HOLD_MS)
    }
  }
  return { ring, ringOpen: () => !!ringRef.current, onPointerDown, close: () => setRing(null) }
}

/** The round menu itself: items around the pointer, the one you point at grows. */
export function RingMenu({ ring, items, radius = RING_RADIUS }: { ring: RingState; items: RingItem[]; radius?: number }) {
  // A fan below where you hold (the pill sits at the screen's edge).
  const pts = ringLayout(items.length, radius, true)
  const w = radius * 2 + 64
  const h = radius + 64
  return (
    <div className="di-ringmenu" data-hot style={{ left: ring.lx - w / 2, top: ring.ly - 32, width: w, height: h }} role="menu" aria-label="Quick menu: slide and let go">
      <i className="di-ring-hub" style={{ top: 32 }} />
      {items.map((it, i) => (
        <span key={it.id} role="menuitem" aria-disabled={it.disabled || undefined} className={`di-ring-item ${i === ring.pick ? 'on' : ''} ${it.disabled ? 'off' : ''}`} style={{ left: w / 2 + pts[i].x, top: 32 + pts[i].y, animationDelay: `${i * 18}ms` }}>
          <b>{it.icon}</b>
          <small>{it.label}</small>
        </span>
      ))}
    </div>
  )
}

// ---- IC4: suggestions under the command bar -------------------------------------

export function Suggest({ list, sel, onPick }: { list: Suggestion[]; sel: number; onPick: (s: Suggestion) => void }) {
  if (!list.length) return null
  return (
    <ul className="di-suggest" role="listbox" aria-label="What Enter does">
      {list.map((x, i) => (
        <li key={x.id} role="option" aria-selected={i === sel}>
          <button type="button" className={i === sel ? 'on' : ''} {...tp(`sug:${x.id}`, () => onPick(x))}>
            <span>{x.icon}</span>
            <b>{x.label}</b>
            {x.hint && <small>{x.hint}</small>}
            {i === sel && <kbd>↵</kbd>}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---- IC7: the menu for one activity --------------------------------------------

export function ActMenu({ items, onPick, onRename, onClose, subject }: { items: MenuItem[]; onPick: (m: MenuItem) => void; onRename: (name: string) => void; onClose: () => void; subject?: string }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(subject ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) window.setTimeout(() => ref.current?.focus(), 30)
  }, [renaming])
  return (
    <div className="di-actmenu" data-hot role="menu" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {renaming ? (
        <form
          className="di-rename"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onRename(name.trim())
          }}
        >
          <input ref={ref} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onPointerDown={() => window.desktop?.islandFocus?.()} aria-label="New name" />
          <button type="button" className="primary" {...tp('menu:rename:ok', () => name.trim() && onRename(name.trim()))}>Save</button>
        </form>
      ) : (
        items.map((m) => (
          <button key={m.id} role="menuitem" disabled={m.disabled} {...tp(m.id, () => (m.act === 'rename' ? (window.desktop?.islandFocus?.(), setRenaming(true)) : onPick(m)))}>
            {m.label}
          </button>
        ))
      )}
      <button className="di-actmenu-x" aria-label="Close" {...tp('menu:close', onClose)}>✕</button>
    </div>
  )
}

/** IC6: the number the wheel is picking, floating by the pill. */
export function WheelBadge({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <span className="di-wheelnum" data-hot aria-live="polite">
      {text}
    </span>
  )
}

/** IC10: "↶ Undo" for a few seconds after a log (in the toast under the pill). */
export function UndoButton({ id, onUndo }: { id: string; onUndo: () => void }): ReactNode {
  return (
    <button className="di-undo" {...tp(`undo:${id}`, onUndo)} title="Take it back (Ctrl+Z)">
      ↶ Undo
    </button>
  )
}

// ---- IC9: keyboard mode -----------------------------------------------------------

/**
 * Opened with the shortcut: the keyboard moves around the panel. Arrows go
 * between sections (from the command bar too, when it has no suggestions),
 * 1–9 fire the chips, / goes back to the command bar; focus rings show.
 */
export function useKeyboardMode(o: { on: boolean; panel: () => HTMLElement | null; input: () => HTMLInputElement | null; suggesting: () => boolean }) {
  const opts = useRef(o)
  opts.current = o
  useEffect(() => {
    if (!o.on) return
    const key = (e: KeyboardEvent) => {
      const p = opts.current.panel()
      if (!p || e.ctrlKey || e.altKey || e.metaKey) return
      const input = opts.current.input()
      const inInput = document.activeElement === input
      const typing = inInput && !!input?.value
      // In the command bar: only arrows with no suggestions (and nothing typed) leave it.
      if (inInput && (typing || opts.current.suggesting() || !/^Arrow(Down|Up)$/.test(e.key))) return
      if (document.activeElement instanceof HTMLInputElement && !inInput) return
      const sections = [...p.querySelectorAll<HTMLElement>(':scope > section, :scope > .di-chips')]
      const cur = sections.findIndex((s) => s.contains(document.activeElement))
      const m = keyMove(e.key, inInput ? -1 : cur, sections.length)
      if (!m) return
      if (m.command) {
        e.preventDefault()
        input?.focus()
        return
      }
      if (m.chip != null) {
        const chip = p.querySelectorAll<HTMLButtonElement>('.di-chips button')[m.chip]
        if (!chip) return
        e.preventDefault()
        chip.click()
        return
      }
      if (m.focus != null) {
        const s = sections[m.focus]
        const target = s?.matches('button') ? s : s?.querySelector<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')
        if (!target) return
        e.preventDefault()
        target.focus()
        target.scrollIntoView({ block: 'nearest' })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [o.on])
}
