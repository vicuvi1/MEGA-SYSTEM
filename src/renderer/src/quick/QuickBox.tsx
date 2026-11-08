// The quick-add box: one line, a live preview chip of what Enter will do,
// Tab for the other readings, Up for the last lines, Esc to close. The same
// box is drawn in the app (Ctrl+Space, the Log button), on the website, and in
// the desktop's own small window (the global shortcut).
import { useEffect, useMemo, useRef, useState } from 'react'
import { routeOptions, type Route, type RouteCtx } from '@core/quickRoute'
import './quick.css'

export interface QuickBoxProps {
  ctx: RouteCtx | null
  history: string[]
  /** `index`: which reading (Tab) was picked. */
  onSubmit: (line: string, r: Route, index: number) => void
  onClose: () => void
  /** The desktop window draws no dimmed backdrop (it floats over other apps). */
  bare?: boolean
}

const ICON: Record<Route['kind'], string> = {
  reps: '💪',
  water: '💧',
  food: '🍽',
  task: '✓',
  focus: '⏱',
  note: '📝',
  habit: '✔',
  money: '¤',
  ask: '?'
}

export function QuickBox({ ctx, history, onSubmit, onClose, bare }: QuickBoxProps) {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const [back, setBack] = useState(-1)
  const [sure, setSure] = useState(false)
  const [shake, setShake] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const opts = useMemo(() => (ctx ? routeOptions(text, ctx) : []), [text, ctx])
  const pick = opts[Math.min(sel, Math.max(0, opts.length - 1))] ?? null

  const change = (v: string) => {
    setText(v)
    setSel(0)
    setSure(false)
  }

  const submit = () => {
    if (!pick) return
    if (pick.kind === 'ask') return setShake((n) => n + 1)
    if (pick.confirm && !sure) return setSure(true)
    onSubmit(text, pick, Math.min(sel, opts.length - 1))
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return onClose()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      return submit()
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (opts.length > 1) {
        setSel((s) => (s + (e.shiftKey ? -1 : 1) + opts.length) % opts.length)
        setSure(false)
      }
      return
    }
    // Up = the last line again (and further back); Down comes forward.
    if (e.key === 'ArrowUp' && history.length && (!text || back >= 0)) {
      e.preventDefault()
      const i = Math.min(back + 1, history.length - 1)
      setBack(i)
      return change(history[i])
    }
    if (e.key === 'ArrowDown' && back >= 0) {
      e.preventDefault()
      const i = back - 1
      setBack(i)
      return change(i >= 0 ? history[i] : '')
    }
  }

  const box = (
    <div className={`qa-box${shake ? ' qa-shake' : ''}`} key={shake} role="dialog" aria-modal="true" aria-label="Quick add" onClick={(e) => e.stopPropagation()}>
      <div className="qa-row">
        <span className="qa-icon" aria-hidden>
          {pick ? ICON[pick.kind] : '+'}
        </span>
        <input
          ref={input}
          className="qa-input"
          value={text}
          onChange={(e) => {
            setBack(-1)
            change(e.target.value)
          }}
          onKeyDown={onKey}
          placeholder="Type anything: 50 pushups, 500 ml, task lab report tomorrow 2h, focus 25…"
          aria-label="Quick add"
          aria-describedby="qa-chip"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="qa-kbd" aria-hidden>
          Enter
        </kbd>
      </div>
      <div className="qa-chips" id="qa-chip" aria-live="polite">
        {!ctx && <span className="qa-chip qa-muted">Loading…</span>}
        {ctx && !text && <span className="qa-chip qa-muted">Up: repeat last · Tab: other ideas · Esc: close</span>}
        {opts.map((o, i) => (
          <button
            key={o.chip}
            type="button"
            tabIndex={-1}
            className={`qa-chip${i === sel ? ' on' : ''}${o.kind === 'ask' ? ' qa-ask' : ''}`}
            data-kind={o.kind}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (i === sel ? submit() : (setSel(i), setSure(false)))}
          >
            {i === sel && sure ? `${o.chip} · press Enter again` : o.chip}
          </button>
        ))}
      </div>
    </div>
  )
  if (bare) return box
  return (
    <div className="qa-back" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}>{box}</div>
    </div>
  )
}
