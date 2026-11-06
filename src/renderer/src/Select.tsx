// A drop-down that looks like the app's own inputs and reads well in every
// theme (the system list of a plain <select> came out white with faint text
// on Windows). Use it like a <select>: the same <option>/<optgroup> children,
// `value`, and `onChange(e)` with `e.target.value`.
//
// Keyboard: Enter / Space / Alt+↓ / ↓ open it; ↑ ↓ Home End PageUp PageDown
// move; Enter or Space picks; Escape closes; Tab picks and moves on; typing
// letters jumps to the matching option (also while it is closed). Screen
// readers hear a combobox with a listbox of options.
import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './select.css'

type Opt = { value: string; label: ReactNode; text: string; disabled: boolean; group?: string }
export type SelectChange = { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } }

export interface SelectProps {
  value?: string | number | null
  defaultValue?: string | number
  onChange?: (e: SelectChange) => void
  children?: ReactNode
  className?: string
  style?: CSSProperties
  disabled?: boolean
  id?: string
  name?: string
  title?: string
  autoFocus?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  onFocus?: () => void
  onBlur?: () => void
  /** Shown when the value matches no option. */
  placeholder?: string
}

const textOf = (n: ReactNode): string => {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children)
  return ''
}

/** The options, read from <option> / <optgroup> children (fragments and arrays too). */
export function readOptions(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return
    const el = c as ReactElement<any>
    if (el.type === Fragment) return void readOptions(el.props.children, group, out)
    if (el.type === 'optgroup') return void readOptions(el.props.children, String(el.props.label ?? ''), out)
    if (el.type === 'option') {
      const label = el.props.children
      const text = textOf(label)
      out.push({ value: String(el.props.value ?? text), label: label ?? text, text, disabled: !!el.props.disabled, group })
    }
  })
  return out
}

/** The option a typed prefix points to, starting after `from` (wraps round), or -1. */
export function typeAhead(opts: { text: string; disabled: boolean }[], prefix: string, from: number): number {
  const p = prefix.toLowerCase()
  if (!p) return -1
  const n = opts.length
  // The same letter again cycles through the options starting with it.
  const same = p.length > 1 && [...p].every((ch) => ch === p[0])
  const want = same ? p[0] : p
  for (let k = 1; k <= n; k++) {
    const i = (from + (same || p.length === 1 ? k : k - 1) + n) % n
    if (!opts[i].disabled && opts[i].text.trim().toLowerCase().startsWith(want)) return i
  }
  return -1
}

export function Select(props: SelectProps) {
  const { onChange, children, className, style, disabled, id, name, title, autoFocus, onFocus, onBlur, placeholder } = props
  const opts = useMemo(() => readOptions(children), [children])
  const controlled = props.value !== undefined
  const [own, setOwn] = useState(() => String(props.defaultValue ?? opts.find((o) => !o.disabled)?.value ?? ''))
  const value = controlled ? String(props.value ?? '') : own
  const sel = opts.findIndex((o) => o.value === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(sel)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean; vh: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ s: '', at: 0 })
  const uid = useId()
  const listId = `${id ?? 'sel'}-${uid.replace(/:/g, '')}-list`

  const pick = useCallback(
    (i: number) => {
      const o = opts[i]
      if (!o || o.disabled) return
      if (!controlled) setOwn(o.value)
      if (o.value !== value) onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } })
    },
    [opts, controlled, value, onChange, name]
  )
  const step = (from: number, dir: 1 | -1, far = 1) => {
    let i = from
    let moved = from
    for (let k = 0; k < opts.length && far > 0; k++) {
      i = Math.max(0, Math.min(opts.length - 1, i + dir))
      if (!opts[i].disabled) {
        moved = i
        far--
      }
      if (i === 0 || i === opts.length - 1) break
    }
    return moved
  }
  const firstEnabled = (dir: 1 | -1) => {
    const idx = opts.map((_, i) => i)
    return (dir === 1 ? idx : idx.reverse()).find((i) => !opts[i].disabled) ?? -1
  }

  // Place the list under the button, or above it when there is more room there; never off screen.
  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect()
    if (!b) return
    // Worked out in screen pixels, then divided by the page zoom (the website's zoom is CSS zoom on the page).
    const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = vh - b.bottom - 8
    const above = b.top - 8
    const want = Math.min(320 * z, opts.length * 36 * z + 12)
    const up = below < Math.min(want, 180 * z) && above > below
    // Wide enough for the longest choice on one line (up to 360 px), never narrower than the button.
    const longest = opts.reduce((m, o) => Math.max(m, o.text.length), 0)
    const width = Math.min(Math.max(b.width, Math.min(360, Math.max(180, longest * 7.4 + 52)) * z), vw - 16)
    // Lined up with the button's right edge when it sits on the right (Settings rows), else its left edge.
    const left = Math.max(8, Math.min(b.left + b.width / 2 > vw / 2 ? b.right - width : b.left, vw - width - 8))
    const maxHeight = Math.max(120 * z, Math.min(320 * z, up ? above : below))
    setPos({ left: left / z, width: width / z, maxHeight: maxHeight / z, up, top: (up ? b.top - 4 : b.bottom + 4) / z, vh: vh / z })
  }, [opts])

  const show = () => {
    if (disabled || !opts.length) return
    setActive(sel >= 0 && !opts[sel].disabled ? sel : firstEnabled(1))
    place()
    setOpen(true)
  }
  const close = (focus = true) => {
    setOpen(false)
    if (focus) btn.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place])
  useEffect(() => {
    if (!open) return
    const out = (e: Event) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || list.current?.contains(t)) return
      setOpen(false)
    }
    // A scroll somewhere else (not inside the list) moves the button: follow it.
    const scrolled = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return
      place()
    }
    document.addEventListener('pointerdown', out, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('pointerdown', out, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', scrolled, true)
    }
  }, [open, place])
  // Keep the active option in view.
  useEffect(() => {
    if (!open || active < 0) return
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return
    const k = e.key
    if (!open) {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp' || (k === 'ArrowDown' && e.altKey)) {
        e.preventDefault()
        show()
        return
      }
      if (k === 'Home' || k === 'End') {
        e.preventDefault()
        pick(firstEnabled(k === 'Home' ? 1 : -1))
        return
      }
    } else {
      if (k === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (k === 'Enter' || (k === ' ' && !typed.current.s)) {
        e.preventDefault()
        pick(active)
        close()
        return
      }
      if (k === 'Tab') {
        pick(active)
        close(false)
        return
      }
      const moves: Record<string, () => number> = {
        ArrowDown: () => (e.altKey ? active : step(active, 1)),
        ArrowUp: () => step(active, -1),
        Home: () => firstEnabled(1),
        End: () => firstEnabled(-1),
        PageDown: () => step(active, 1, 8),
        PageUp: () => step(active, -1, 8)
      }
      if (moves[k]) {
        e.preventDefault()
        if (k === 'ArrowUp' && e.altKey) {
          pick(active)
          close()
          return
        }
        setActive(moves[k]())
        return
      }
    }
    // Type-ahead: letters jump to the matching option.
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (k !== ' ' || typed.current.s)) {
      e.preventDefault()
      const now = Date.now()
      const s = (now - typed.current.at < 700 ? typed.current.s : '') + k
      typed.current = { s, at: now }
      const from = open ? active : sel
      const i = typeAhead(opts, s, from < 0 ? -1 : from)
      if (i >= 0) {
        if (open) setActive(i)
        else pick(i)
      }
    }
  }

  const cur = sel >= 0 ? opts[sel] : null
  const activeId = open && active >= 0 ? `${listId}-${active}` : undefined
  let lastGroup: string | undefined

  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        name={name}
        title={title}
        autoFocus={autoFocus}
        className={`ui-select ${className ?? ''} ${open ? 'open' : ''}`}
        style={style}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        data-value={value}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        onFocus={onFocus}
        onBlur={(e) => {
          if (open && list.current?.contains(e.relatedTarget as Node)) return
          onBlur?.()
        }}
      >
        <span className={`ui-select-value ${cur ? '' : 'ph'}`}>{cur ? cur.label : (placeholder ?? '')}</span>
        <svg className="ui-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={props['aria-label']}
            tabIndex={-1}
            className={`ui-select-list ${pos.up ? 'up' : ''}`}
            style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, ...(pos.up ? { bottom: pos.vh - pos.top } : { top: pos.top }) }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {opts.map((o, i) => {
              const head = o.group !== undefined && o.group !== lastGroup ? o.group : null
              lastGroup = o.group
              return (
                <Fragment key={`${o.value}-${i}`}>
                  {head !== null && (
                    <li className="ui-select-group" role="presentation">
                      {head}
                    </li>
                  )}
                  <li
                    id={`${listId}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={i === sel}
                    aria-disabled={o.disabled || undefined}
                    className={`ui-select-opt ${i === active ? 'active' : ''} ${i === sel ? 'sel' : ''} ${o.disabled ? 'off' : ''} ${o.group !== undefined ? 'in-group' : ''}`}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onClick={() => {
                      if (o.disabled) return
                      pick(i)
                      close()
                    }}
                  >
                    <span>{o.label}</span>
                    {i === sel && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 12l5 5L20 6" />
                      </svg>
                    )}
                  </li>
                </Fragment>
              )
            })}
          </ul>,
          document.body
        )}
    </>
  )
}
