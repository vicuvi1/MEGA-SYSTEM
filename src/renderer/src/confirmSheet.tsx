// "Are you sure?" as a sheet in the app's own look (not the browser's
// pop-up): askConfirm(text) resolves true/false. Esc or a tap outside is
// "no"; Enter is "yes"; focus starts on the safe button.
// askText(text, value) is the same sheet with a text box: it resolves the
// typed text, or null on Cancel. (The desktop app has no browser pop-ups, so
// window.prompt/confirm/alert must never be used.)
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

interface Ask { text: string; ok: string; danger: boolean; input?: string; resolve: (v: boolean) => void }
let typed = ''
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
  useEffect(() => {
    if (!ask) return
    const before = document.activeElement as HTMLElement | null
    if (ask.input !== undefined) {
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
        {ask.input !== undefined && (
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
