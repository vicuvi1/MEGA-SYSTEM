// "Are you sure?" as a sheet in the app's own look (not the browser's
// pop-up): askConfirm(text) resolves true/false. Esc or a tap outside is
// "no"; Enter is "yes"; focus starts on the safe button.
// askText(text, value) is the same sheet with a text box: it resolves the
// typed text, or null on Cancel. askSwitch(text, label, value) adds a switch
// (off at first); the text box shows only when it is on. (The desktop app has no browser pop-ups, so
// window.prompt/confirm/alert must never be used.)
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

interface Ask { text: string; ok: string; danger: boolean; input?: string; toggle?: string; hint?: string; resolve: (v: boolean) => void }
let typed = ''
let switched = false
let current: Ask | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function askConfirm(text: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => {
    current = { text, ok: opts.ok ?? 'Yes', danger: opts.danger ?? true, resolve }
    emit()
  })
}

export async function askText(text: string, value = '', opts: { ok?: string } = {}): Promise<string | null> {
  current?.resolve(false)
  typed = value
  const yes = await new Promise<boolean>((resolve) => {
    current = { text, ok: opts.ok ?? 'Save', danger: false, input: value, resolve }
    emit()
  })
  return yes ? typed : null
}

/** A sheet with a switch (off at first) and, when it is on, a text box. null = Cancel. */
export async function askSwitch(text: string, label: string, value = '', opts: { ok?: string; hint?: string } = {}): Promise<{ on: boolean; text: string } | null> {
  current?.resolve(false)
  typed = value
  switched = false
  const yes = await new Promise<boolean>((resolve) => {
    current = { text, ok: opts.ok ?? 'Save', danger: false, input: value, toggle: label, hint: opts.hint, resolve }
    emit()
  })
  return yes ? { on: switched, text: typed } : null
}

const answer = (v: boolean) => {
  const a = current
  current = null
  emit()
  a?.resolve(v)
}

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current,
    () => null
  )
  const cancelRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!ask) return
    const before = document.activeElement as HTMLElement | null
    setOn(false)
    if (ask.toggle) cancelRef.current?.focus()
    else if (ask.input !== undefined) {
      setText(ask.input)
      typed = ask.input
      setTimeout(() => inputRef.current?.select(), 0)
    } else cancelRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false)
      else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') answer(true)
    }
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
      before?.focus?.()
    }
  }, [ask])
  if (!ask) return null
  return (
    <div className="cs-back" onMouseDown={() => answer(false)}>
      <div className="cs-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cs-text" onMouseDown={(e) => e.stopPropagation()}>
        <p id="cs-text">{ask.text}</p>
        {ask.toggle && (
          <label className="cs-switch" data-testid="cs-switch">
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => {
                setOn(e.target.checked)
                switched = e.target.checked
                if (e.target.checked) setTimeout(() => inputRef.current?.select(), 0)
              }}
            />
            <span>{ask.toggle}</span>
          </label>
        )}
        {ask.toggle && ask.hint && !on && <small className="cs-hint">{ask.hint}</small>}
        {ask.input !== undefined && (!ask.toggle || on) && (
          <input
            ref={inputRef}
            className="cs-input"
            aria-labelledby="cs-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              typed = e.target.value
            }}
          />
        )}
        <div className="cs-row">
          <button ref={cancelRef} className="btn ghost" onClick={() => answer(false)}>
            Cancel
          </button>
          <button className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)}>
            {ask.ok}
          </button>
        </div>
      </div>
    </div>
  )
}
