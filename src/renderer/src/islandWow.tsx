// The opened island's "wow" parts: the Day page's hero (big numbers that
// count up when the page opens), the power row (four one-tap actions you
// pick), the "/" palette over the whole island, and the ripple from the
// pointer on a tap. Motion is transform and opacity only, and follows the
// island's Full / Calm / Off feel (reduced motion is Off).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Suggestion } from '@core/islandCommands'
import type { PaletteItem, PowerId } from '@core/islandPalette'
import { useFeel } from './islandFeel'
import { Suggest } from './islandControls'
import { tp } from './islandTap'
import './islandWow.css'

/** A number that counts up from 0 when it first shows (Full), then follows its value. */
export function CountIn({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const f = useFeel()
  const [shown, setShown] = useState(f.moves ? 0 : value)
  const last = useRef(f.moves ? 0 : value)
  useEffect(() => {
    const from = last.current
    last.current = value
    if (!f.moves || from === value) return setShown(value)
    const t0 = performance.now()
    let id = 0
    const stepFn = (t: number) => {
      const k = Math.min(1, (t - t0) / 650)
      setShown(from + (value - from) * (1 - (1 - k) ** 3))
      if (k < 1) id = requestAnimationFrame(stepFn)
    }
    id = requestAnimationFrame(stepFn)
    return () => cancelAnimationFrame(id)
  }, [value, f.moves])
  return <>{shown.toFixed(decimals)}</>
}

export interface HeroStat {
  id: string
  label: string
  value: number
  decimals?: number
  /** After the number: "/3", "L", "min". */
  unit?: string
  /** 0–1: how full its ring is. */
  pct: number
  tone: 'lime' | 'water' | 'gold' | 'violet'
  onTap?: () => void
}

function StatRing({ pct }: { pct: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <svg className="dw-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r={r} className="bg" />
      <circle cx="18" cy="18" r={r} className="fg" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))} transform="rotate(-90 18 18)" />
    </svg>
  )
}

/** The top of the Day page: the greeting, the date and today's numbers. */
export function DayHero({ greeting, sub, stats }: { greeting: string; sub: ReactNode; stats: HeroStat[] }) {
  return (
    <div className="dw-hero">
      <div className="dw-hello">
        <h2>{greeting}</h2>
        <p>{sub}</p>
      </div>
      <div className="dw-stats">
        {stats.map((x) => (
          <button key={x.id} className={`dw-stat tone-${x.tone}`} {...tp(`hero:${x.id}`, () => x.onTap?.())}>
            <StatRing pct={x.pct} />
            <span className="dw-num">
              <b>
                <CountIn value={x.value} decimals={x.decimals} />
              </b>
              {x.unit && <small>{x.unit}</small>}
            </span>
            <span className="dw-lbl">{x.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export interface PowerTile {
  id: PowerId
  icon: string
  label: string
  sub?: string
  on?: boolean
  off?: boolean
}

/** The four one-tap actions; ✎ lets you change what each one does (tap a tile to cycle it). */
export function PowerRow({ tiles, editing, onTap, onCycle, onEdit }: { tiles: PowerTile[]; editing: boolean; onTap: (id: PowerId, el: HTMLElement) => void; onCycle: (slot: number) => void; onEdit: (on: boolean) => void }) {
  return (
    <section className={`di-power ${editing ? 'editing' : ''}`} aria-label="One-tap actions">
      <div className="dw-power-grid">
        {tiles.map((t, i) => (
          <button
            key={`${i}:${t.id}`}
            className={`dw-tile p-${t.id} ${t.on ? 'on' : ''}`}
            disabled={!editing && t.off}
            title={editing ? 'Tap to change this button' : t.label}
            style={{ ['--i' as string]: i }}
            {...tp(`power:${i}`, (x) => (editing ? onCycle(i) : onTap(t.id, x.el)))}
          >
            <span className="dw-tile-ico" aria-hidden>{t.icon}</span>
            <b>{t.label}</b>
            {t.sub && <small>{t.sub}</small>}
            {editing && <i className="dw-tile-cycle" aria-hidden>⟳</i>}
          </button>
        ))}
      </div>
      <button className="dw-power-edit" {...tp('power:edit', () => onEdit(!editing))} title={editing ? 'Done' : 'Change these buttons'}>
        {editing ? 'Done' : '✎'}
      </button>
    </section>
  )
}

/** One line of the palette list. */
function PaletteRow({ x, on, onPick }: { x: PaletteItem; on: boolean; onPick: () => void }) {
  return (
    <li role="option" aria-selected={on}>
      <button type="button" className={on ? 'on' : ''} {...tp(`pal:${x.id}`, onPick)}>
        <span className="dw-pal-ico">{x.icon}</span>
        <b>{x.label}</b>
        <small>{x.group}</small>
        {x.hint && <kbd>{x.hint}</kbd>}
      </button>
    </li>
  )
}

/**
 * The palette over the whole island: the command bar on top (quick logs and
 * Ben, as always), what Enter does, then everything else you can reach.
 */
export function Palette({ form, sugg, items, sel, onPickSuggestion, onPickItem, onClose, note }: { form: ReactNode; sugg: Suggestion[]; items: PaletteItem[]; sel: number; onPickSuggestion: (s: Suggestion) => void; onPickItem: (x: PaletteItem) => void; onClose: () => void; note?: string }) {
  const n = sugg.length
  return (
    <div className="dw-pal" role="dialog" aria-label="Command palette">
      <button className="dw-pal-back" aria-label="Close the palette" tabIndex={-1} {...tp('pal:back', onClose)} />
      <div className="dw-pal-box">
        {form}
        {note && <p className="dw-pal-note">{note}</p>}
        <Suggest list={sugg} sel={sel < n ? sel : -1} onPick={onPickSuggestion} />
        {!!items.length && (
          <ul className="dw-pal-list" role="listbox" aria-label="Go to or do">
            {items.map((x, i) => (
              <PaletteRow key={x.id} x={x} on={sel === n + i} onPick={() => onPickItem(x)} />
            ))}
          </ul>
        )}
        <p className="dw-pal-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> choose · <kbd>↵</kbd> do it · <kbd>1</kbd>–<kbd>9</kbd> pages · <kbd>Esc</kbd> close
        </p>
      </div>
    </div>
  )
}

/** A soft ripple from the pointer on every press inside the panel (Full only). */
export function useRipples(panel: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = panel.current
    if (!on || !el) return
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const t = (e.target as HTMLElement | null)?.closest?.('button, [data-tap]') as HTMLElement | null
      if (!t || !el.contains(t) || (t as HTMLButtonElement).disabled) return
      const box = el.getBoundingClientRect()
      const k = box.width / Math.max(1, el.offsetWidth)
      const dot = document.createElement('i')
      dot.className = 'dw-ripple'
      dot.style.left = `${(e.clientX - box.left) / k}px`
      dot.style.top = `${(e.clientY - box.top) / k + el.scrollTop}px`
      el.appendChild(dot)
      const a = dot.animate?.([{ transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0.4 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
      if (a) a.onfinish = () => dot.remove()
      else dot.remove()
    }
    el.addEventListener('pointerdown', down)
    return () => el.removeEventListener('pointerdown', down)
  }, [panel, on])
}
