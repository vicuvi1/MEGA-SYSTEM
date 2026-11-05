// One-line money quick add (MF1), shared by the Money hub, the Today pill and
// Ctrl+K: "45 food maib", "120+45 groceries yesterday", "+500 salary".
// Finance Helper's own parser reads it and the record lands in its data (the
// main lei wallet unless you name an account), the same path as Telegram.
import { useCallback, useEffect, useRef, useState } from 'react'
import { life } from './bridge'
import { celebrate } from './fx'
import { reducedMotion } from './motionKit'
import { soundCoin, soundSpend } from './soundKit'
import { useToast } from './ui'
import type { QuickAdded, QuickPreview } from './web/moneyApi'
import './money.css'

const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`

/** What the typed line would log (debounced), or null. */
export function useMoneyPreview(text: string): QuickPreview | null {
  const [p, setP] = useState<QuickPreview | null>(null)
  useEffect(() => {
    const t = text.trim()
    if (!t || !/\d/.test(t) || !life.finance) return setP(null)
    let live = true
    const id = setTimeout(() => {
      life.finance!.preview(t).then((r) => live && setP(r)).catch(() => live && setP(null))
    }, 120)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [text])
  return p
}

/**
 * Saves a line; plays the coin (or spend) sound, bursts when the day's first
 * log pays points, and offers Undo. Returns what was added, or null.
 */
export function useAddMoney(): (text: string, from?: Element | null) => Promise<QuickAdded | null> {
  const toast = useToast()
  return useCallback(async (text: string, from?: Element | null) => {
    if (!life.finance) {
      toast('Quick add needs the web app', 'bad')
      return null
    }
    try {
      const r = await life.finance.quickAdd(text)
      if (r.paid > 0) {
        soundCoin()
        celebrate(from ?? null, 'reward')
      } else if (r.type === 'income') soundCoin()
      else soundSpend()
      const undo = { label: 'Undo', run: () => void life.finance!.undo(r.txId, r.ledgerId).then(() => window.dispatchEvent(new CustomEvent('life-money-changed'))).catch(() => toast('Could not undo that', 'bad')) }
      toast(`${r.line}${r.paid > 0 ? ` · +${r.paid} points` : ''}`, 'good', undo)
      window.dispatchEvent(new CustomEvent('life-money-changed', { detail: r }))
      return r
    } catch (e) {
      toast((e as Error).message, 'bad')
      return null
    }
  }, [toast])
}

/** The amount flies from where you typed into the ring (transform + opacity only). */
export function flyTo(from: Element | null, to: Element | null, text: string): Promise<void> {
  if (!from || !to || reducedMotion() || document.hidden) return Promise.resolve()
  const a = from.getBoundingClientRect()
  const b = to.getBoundingClientRect()
  const el = document.createElement('span')
  el.className = 'mh-fly'
  el.textContent = text
  el.style.left = `${a.left + 16}px`
  el.style.top = `${a.top + a.height / 2 - 14}px`
  document.body.appendChild(el)
  const dx = b.left + b.width / 2 - (a.left + 16) - 30
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  const anim = el.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 40}px) scale(1.08)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0 }
    ],
    { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  )
  return anim.finished.then(
    () => el.remove(),
    () => el.remove()
  )
}

/** The box: type, see what it will log, Enter saves. */
export function QuickAddBox({ onAdded, compact = false, autoFocus = false, placeholder }: { onAdded?: (r: QuickAdded, input: HTMLElement | null) => void; compact?: boolean; autoFocus?: boolean; placeholder?: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const preview = useMoneyPreview(text)
  const add = useAddMoney()
  const save = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    const r = await add(text, input.current)
    setBusy(false)
    if (r) {
      setText('')
      onAdded?.(r, input.current)
    }
  }
  return (
    <div className={`mq ${compact ? 'compact' : ''}`}>
      <div className="mq-row">
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          enterKeyHint="done"
          aria-label="Quick add money"
          placeholder={placeholder ?? '45 food · 120+45 groceries yesterday · +500 salary'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void save()
            }
          }}
        />
        <button className="mq-go" disabled={!preview || busy} onClick={() => void save()} aria-label="Add">
          {busy ? '…' : 'Add'}
        </button>
      </div>
      <div className="mq-preview" aria-live="polite">
        {preview ? (
          <>
            <b className={preview.type === 'income' ? 'in' : ''}>
              {preview.type === 'income' ? '+' : '−'}
              {lei(preview.amount)}
            </b>
            <span>{preview.category}</span>
            {preview.account && <span>{preview.account}</span>}
            {preview.daysAgo > 0 && <span>yesterday</span>}
          </>
        ) : (
          <small>{text.trim() ? 'Add an amount, like "45 food"' : 'Goes to Finance Helper · name an account to use it ("45 food maib")'}</small>
        )}
      </div>
    </div>
  )
}

type PillState = { left: number; level: string } | null
const pillOf = (h: { hero: { perDay: number; leftToday: number; dayLevel: string } } | null): PillState => (h && h.hero.perDay > 0 ? { left: h.hero.leftToday, level: h.hero.dayLevel } : null)

/** Today (MF11): "120 lei left today" with a quick add that opens on tap. */
export function MoneyPill() {
  const [v, setV] = useState<PillState>(null)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const load = () =>
      life.finance
        ?.hub()
        .then((h) => setV(pillOf(h)))
        .catch(() => setV(null))
    void load()
    const names = ['life-money-changed', 'life-finance-changed']
    const on = (e: Event) => {
      const h = (e as CustomEvent).detail?.view
      if (h) setV(pillOf(h))
      else void load()
    }
    for (const n of names) window.addEventListener(n, on)
    return () => names.forEach((n) => window.removeEventListener(n, on))
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!v || !life.finance) return null
  return (
    <div className="money-pill-wrap" ref={wrap}>
      <span className={`money-pill lv-${v.level}`}>
        <span aria-hidden="true">💸</span>
        <b>{v.left >= 0 ? `${lei(v.left)} left today` : `${lei(-v.left)} over today`}</b>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Add spending">
          + Add
        </button>
      </span>
      {open && (
        <div className="money-pop">
          <QuickAddBox compact autoFocus onAdded={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
