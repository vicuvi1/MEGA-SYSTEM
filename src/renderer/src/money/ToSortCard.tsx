// Money phase 5: the "To sort" card on the Money page. Captured payments
// wait here with their 3 best category chips and "Other…"; one tap files one
// and teaches the merchant's rule. The ones the rules are sure about were
// filed by themselves: they show under "Filed by itself" with OK, a different
// category, or Undo. Recurring bills that are due wait for one tap too.
// Every tap has Undo in its toast. Nothing here pays points by itself.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useToast } from '../ui'
import { moneyText, typedBani } from '@core/moneyText'
import type { SortDone } from '../web/moneySort'
import type { Chip, SortView } from '../web/moneySortCore'
import './sort.css'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')
function when(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const y = new Date(today.getTime() - 86400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const day = same(d, today) ? 'Today' : same(d, y) ? 'Yesterday' : `${d.getDate()} ${SHORT[d.getMonth()]}`
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dayText = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`
const LEVEL: Record<string, string> = { sure: 'sure', maybe: 'maybe', guess: 'guess' }
const chipText = (c: Chip) => `${c.emoji ? `${c.emoji} ` : ''}${c.name}`
/** Payments shown before "Show N more" (the card stays short on the Today tab). */
const SHOW = 3

export function ToSortCard() {
  const [v, setV] = useState<SortView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [other, setOther] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const toast = useToast()
  const load = useCallback(() => {
    if (!life.moneySort) return
    life.moneySort
      .view()
      .then(setV)
      .catch(() => setV(null))
  }, [])
  useEffect(() => {
    load()
    const names = ['life-finance-changed', 'life-moneysort-changed']
    for (const n of names) window.addEventListener(n, load)
    return () => names.forEach((n) => window.removeEventListener(n, load))
  }, [load])
  const act = async (key: string, fn: () => Promise<SortDone>) => {
    if (busy) return
    setBusy(key)
    setOther(null)
    try {
      const r = await fn()
      setV(r.view)
      toast(r.line, 'good', {
        label: 'Undo',
        run: () =>
          void life
            .moneySort!.undo(r.undo)
            .then(setV)
            .catch(() => toast('Could not undo that', 'bad'))
      })
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }
  if (!life.moneySort || !v || (!v.pending.length && !v.auto.length && !v.bills.length)) return null
  const api = life.moneySort
  const n = v.pending.length + v.bills.length
  const shown = all ? v.pending : v.pending.slice(0, SHOW)
  const typedFor = (id: string) => ({ amount: typedBani(typed[id] ?? '') })
  return (
    <section className="mh-card ts-card" data-testid="tosort" aria-label="To sort">
      <header className="mh-head">
        <h2>📥 To sort{n ? ` · ${n}` : ''}</h2>
        <span className="mh-hint">One tap files it and teaches the rule</span>
      </header>
      {shown.map((p) => {
        const noAmount = p.needsAmount && !typedFor(p.id).amount
        const file = (cat: string) => void act(`f${p.id}`, () => api.file(p.id, cat, p.needsAmount ? typedFor(p.id) : undefined))
        return (
        <div key={p.id} className="ts-row" data-testid="ts-item" data-id={p.id}>
          <div className="ts-top">
            {p.needsAmount ? (
              <input className="ts-amtin" inputMode="decimal" placeholder={`Amount, ${p.currency}`} aria-label="Amount (the notification could not be read)" data-testid="ts-amount" value={typed[p.id] ?? ''} onChange={(e) => setTyped((t) => ({ ...t, [p.id]: e.target.value }))} />
            ) : (
              <b className="ts-amt">
                {p.type === 'income' ? '+' : '−'}
                {moneyText(p.amount, p.currency)}
              </b>
            )}
            <span className="ts-merch" title={p.raw || p.merchant}>
              {p.needsAmount ? `Couldn't read: ${p.raw || p.merchant || 'a payment'}` : p.merchant || 'Payment'}
            </span>
            <small className="ts-when">
              {when(p.at)}
              {p.source && p.source !== 'unknown' ? ` · ${p.source}` : ''}
              {p.last4 ? ` *${p.last4}` : ''}
            </small>
          </div>
          <div className="ts-chips">
            {p.chips.map((c, i) => (
              <button key={c.id} className={`ts-chip${i === 0 && p.level !== 'guess' ? ' top' : ''}`} data-testid="ts-chip" data-cat={c.id} disabled={!!busy || noAmount} onClick={() => file(c.id)}>
                {chipText(c)}
                {i === 0 && <i className={`ts-lv lv-${p.level}`}>{LEVEL[p.level]}</i>}
              </button>
            ))}
            {other === p.id ? (
              <select className="ts-other" autoFocus aria-label="Pick a category" defaultValue="" onChange={(e) => e.target.value && file(e.target.value)} onBlur={() => setOther(null)}>
                <option value="" disabled>
                  Pick a category…
                </option>
                {v.categories
                  .filter((c) => c.type === p.type)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {chipText(c)}
                    </option>
                  ))}
              </select>
            ) : (
              <button className="ts-chip ghost" data-testid="ts-other" disabled={!!busy || noAmount} onClick={() => setOther(p.id)}>
                Other…
              </button>
            )}
            <button className="ts-x" aria-label="Not mine: remove from To sort" title="Not mine" disabled={!!busy} onClick={() => void act(`x${p.id}`, () => api.dismiss(p.id))}>
              ✕
            </button>
          </div>
        </div>
        )
      })}
      {v.pending.length > SHOW && (
        <button className="ts-more" data-testid="ts-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show ${v.pending.length - SHOW} more`}
        </button>
      )}
      {v.auto.length > 0 && (
        <>
          <h3 className="ts-sub">Filed by itself</h3>
          {v.auto.map((a) => (
            <div key={a.id} className="ts-row auto" data-testid="ts-auto" data-id={a.id}>
              <div className="ts-top">
                <b className="ts-amt">−{moneyText(a.amount, a.currency)}</b>
                <span className="ts-merch">{a.merchant || 'Payment'}</span>
                <small className="ts-when">{when(a.at)}</small>
              </div>
              <div className="ts-chips">
                <span className="ts-filed" data-testid="ts-auto-cat">
                  <i className="ts-autotag">auto</i> {chipText(a.category)}
                </span>
                <button className="ts-chip top" data-testid="ts-ok" disabled={!!busy} onClick={() => void act(`o${a.id}`, () => api.confirmAuto(a.id))}>
                  ✓ OK
                </button>
                {a.chips.map((c) => (
                  <button key={c.id} className="ts-chip" disabled={!!busy} onClick={() => void act(`o${a.id}`, () => api.confirmAuto(a.id, c.id))}>
                    {chipText(c)}
                  </button>
                ))}
                <button className="ts-chip ghost" data-testid="ts-undo" disabled={!!busy} onClick={() => void act(`u${a.id}`, () => api.undoAuto(a.id))}>
                  Undo
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {v.bills.length > 0 && (
        <>
          <h3 className="ts-sub">Bills due</h3>
          {v.bills.map((b) => (
            <div key={`${b.ruleId}|${b.date}`} className="ts-row bill" data-testid="ts-bill" data-id={b.ruleId}>
              <div className="ts-top">
                <b className="ts-amt">−{moneyText(b.amount, b.currency)}</b>
                <span className="ts-merch">{b.note || 'Bill'}</span>
                <small className="ts-when">
                  due {dayText(b.date)} · {chipText(b.category)}
                  {b.more ? ` · ${b.more} more after it` : ''}
                </small>
              </div>
              <div className="ts-chips">
                <button className="ts-chip top" data-testid="ts-bill-ok" disabled={!!busy} onClick={() => void act(`b${b.ruleId}`, () => api.confirmBill(b.ruleId, b.date))}>
                  ✓ Paid
                </button>
                <button className="ts-chip ghost" disabled={!!busy} onClick={() => void act(`s${b.ruleId}`, () => api.skipBill(b.ruleId, b.date))}>
                  Didn't happen
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
