// Settings building blocks, one style everywhere: a row with the label and a
// short line on the left and the control on the right; a switch; a segmented
// choice; a list you reorder by dragging; and a "✓ Saved" tick that shows
// for a moment after any change (everything saves at once).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** Call `saved()` after a change; render `<Saved show={flash} />` in the panel head. */
export function useSaved(): [boolean, () => void] {
  const [flash, setFlash] = useState(false)
  const t = useRef<number | null>(null)
  const saved = useCallback(() => {
    setFlash(true)
    if (t.current) clearTimeout(t.current)
    t.current = window.setTimeout(() => setFlash(false), 1600)
  }, [])
  useEffect(() => () => void (t.current && clearTimeout(t.current)), [])
  return [flash, saved]
}

export function Saved({ show }: { show: boolean }) {
  return (
    <span className={`sx-saved ${show ? 'on' : ''}`} aria-live="polite">
      {show ? '✓ Saved' : ''}
    </span>
  )
}

export function Row({ title, hint, children, disabled }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <div className={`sx-row ${disabled ? 'off' : ''}`}>
      <div className="sx-label">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      {children && <div className="sx-control">{children}</div>}
    </div>
  )
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`sx-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  )
}

export function Segmented<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="sx-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => v !== value && onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export interface ReorderItem {
  id: string
  label: string
  hint?: string
  on: boolean
}

/**
 * A list you reorder by dragging the ⠿ handle (or Alt + ↑/↓ on a focused
 * row), each with a switch to show or hide it.
 */
export function ReorderList({ items, onChange, label }: { items: ReorderItem[]; onChange: (next: ReorderItem[]) => void; label: string }) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const moveTo = (id: string, before: string | null) => {
    const from = items.findIndex((x) => x.id === id)
    if (from < 0) return
    const rest = items.filter((x) => x.id !== id)
    const at = before ? rest.findIndex((x) => x.id === before) : rest.length
    const next = [...rest.slice(0, at), items[from], ...rest.slice(at)]
    if (next.some((x, i) => x.id !== items[i].id)) onChange(next)
  }
  const step = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = items.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <ul className="sx-list" aria-label={label}>
      {items.map((x, i) => (
        <li
          key={x.id}
          tabIndex={0}
          className={`${x.on ? '' : 'off'} ${drag === x.id ? 'dragging' : ''} ${over === x.id && drag && drag !== x.id ? 'over' : ''}`}
          draggable
          onDragStart={(e) => {
            setDrag(x.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', x.id)
          }}
          onDragOver={(e) => {
            if (!drag) return
            e.preventDefault()
            setOver(x.id)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (drag) moveTo(drag, x.id)
            setDrag(null)
            setOver(null)
          }}
          onDragEnd={() => (setDrag(null), setOver(null))}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault()
              step(i, e.key === 'ArrowUp' ? -1 : 1)
            }
          }}
          aria-label={`${x.label}${x.on ? '' : ' (hidden)'}. Drag, or Alt + arrow keys, to move.`}
        >
          <span className="sx-grip" aria-hidden>
            ⠿
          </span>
          <span className="sx-label">
            <b>{x.label}</b>
            {x.hint && <small>{x.hint}</small>}
          </span>
          <Switch on={x.on} label={`Show ${x.label}`} onChange={(v) => onChange(items.map((y) => (y.id === x.id ? { ...y, on: v } : y)))} />
        </li>
      ))}
    </ul>
  )
}
