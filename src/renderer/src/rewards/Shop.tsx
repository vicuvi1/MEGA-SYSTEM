// The shop front of Rewards: the "on a roll" combo, the monthly budget meter
// (a soft warning only), today's featured reward, the category shelves and the
// unwrap moment after a buy.
// All of it shows work you already did; nothing here makes or multiplies points.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { RARITY_LABEL, SHELVES, STARTERS, budgetMeter, rarityOf, type ShelfId } from '@core/shopShelves'
import { barFill } from '../motionKit'
import { Rail } from './More'
import { life } from '../bridge'
import type { RewardMoneyRow } from '@core/funBudget'

/** "On a roll": the days in a row you did real work, shown like a game combo. */
export function Combo({ days }: { days: number }) {
  return (
    <div className={`sh-combo ${days > 0 ? 'on' : ''}`} data-testid="combo" title="Days in a row with real focus work. It only counts work you did.">
      <span className="sh-combo-x num">×{days}</span>
      <span className="sh-combo-text">
        <b>{days > 0 ? 'On a roll' : 'No roll yet'}</b>
        <small>{days > 0 ? `${days} day${days === 1 ? '' : 's'} in a row` : 'Do one focus session today'}</small>
      </span>
    </div>
  )
}

/**
 * Real money spent on fun this month against the budget (buys with points only
 * do not count: they are not money). A soft warning: it never blocks a buy.
 */
export function BudgetMeter({ spent, budget, onSet }: { spent: number; budget: number | null; onSet: (lei: number) => void }) {
  const m = budgetMeter(spent, budget)
  const total = budget != null && budget > 0 ? budget : 500
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState('')
  return (
    <div className={`sh-budget ${m.state}`} data-testid="budget-meter" title="Real money spent on fun this month. Only money you really paid counts: buying with points is not spending.">
      <div className="sh-budget-head">
        <b>
          Real money spent <span className="num">{Math.round(spent).toLocaleString()} / {total.toLocaleString()} lei</span>
        </b>
        {!edit && (
          <button type="button" className="rx-btn small ghost" onClick={() => { setV(String(total)); setEdit(true) }}>
            Change
          </button>
        )}
      </div>
      <div className="sh-bar pbar thin" aria-hidden>
        <i style={barFill(m.frac)} />
      </div>
      {edit ? (
        <div className="rx-row">
          <input className="short" inputMode="numeric" aria-label="Monthly budget in lei" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} />
          <button type="button" className="rx-btn small primary" disabled={!(Number(v) > 0)} onClick={() => { onSet(Number(v)); setEdit(false) }}>
            Save
          </button>
          <button type="button" className="rx-btn small ghost" onClick={() => setEdit(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <small className="sh-budget-line">{m.line}</small>
      )}
    </div>
  )
}

/** Rarity label for a card. */
export function RarityTag({ price }: { price: number }) {
  const r = rarityOf(price)
  return <span className={`sh-rar rar-${r}`}>{RARITY_LABEL[r]}</span>
}

/** A ring with "340 / 600" for what you can't afford yet. */
export function Ring({ have, price }: { have: number; price: number }) {
  const frac = Math.min(1, Math.max(0, have / Math.max(1, price)))
  const R = 15
  const C = 2 * Math.PI * R
  return (
    <span className="sh-ring" title={`${Math.min(have, price).toLocaleString()} of ${price.toLocaleString()} points`}>
      <svg viewBox="0 0 36 36" aria-hidden focusable="false">
        <circle cx="18" cy="18" r={R} className="bg" />
        <circle cx="18" cy="18" r={R} className="fg" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 18 18)" />
      </svg>
      <span className="sh-ring-t num">
        {Math.min(have, price).toLocaleString()} / {price.toLocaleString()}
      </span>
    </span>
  )
}

/** One shelf: a header you can fold, and a rail of cards; an empty shelf offers starter items you can edit. */
export function Shelf({ id, cards, preview, open, adding, onToggle, onStarter, onAdd }: { id: ShelfId; cards: ReactNode[]; preview: string; open: boolean; adding: boolean; onToggle: () => void; onStarter: (id: ShelfId) => void; onAdd: () => void }) {
  const s = SHELVES.find((x) => x.id === id)!
  return (
    <section className={`rx-sec sh-shelf ${open ? 'open' : 'shut'}`} data-shelf={id}>
      <header>
        <button type="button" className="sh-shelf-head" aria-expanded={open} onClick={onToggle}>
          <span className="sh-chev" aria-hidden>{open ? '▾' : '▸'}</span>
          <h3>
            <span aria-hidden>{s.emoji}</span> {s.label}
          </h3>
          {!open && cards.length > 0 && <span className="sh-count num">{cards.length}</span>}
          <span className="rx-sub">{cards.length ? `${cards.length} on the shelf${open ? '' : ` · ${preview}`}` : s.blurb}</span>
        </button>
      </header>
      {open &&
        (cards.length ? (
          <Rail label={s.label}>{cards}</Rail>
        ) : (
          <div className="rx-slim-empty sh-empty">
            <span>Empty shelf. Add a few starter items (change names and prices any time) or your own.</span>
            <span className="sh-empty-btns">
              <button type="button" className="rx-btn small primary" disabled={adding} onClick={() => onStarter(id)}>
                Add {STARTERS[id].length} starter item{STARTERS[id].length === 1 ? '' : 's'}
              </button>
              <button type="button" className="rx-btn small" onClick={onAdd}>
                + Your own
              </button>
            </span>
          </div>
        ))}
    </section>
  )
}

/** The moment after a buy: a chest opens and coins pop. Skipped in calm mode and with reduced motion. */
export function Unwrap({ emoji, title, onDone }: { emoji: string; title: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1900)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="sh-unwrap" aria-hidden data-testid="unwrap">
      <div className="sh-chest">
        <svg viewBox="0 0 120 100" focusable="false">
          <rect x="14" y="48" width="92" height="46" rx="8" className="box" />
          <rect x="14" y="62" width="92" height="8" className="band" />
          <g className="lid">
            <path d="M14 48a46 30 0 0 1 92 0z" className="lidtop" />
            <rect x="52" y="44" width="16" height="14" rx="3" className="lock" />
          </g>
        </svg>
        <span className="sh-prize">{emoji}</span>
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} className="sh-coin" style={{ '--a': `${i * (360 / 14)}deg`, '--d': `${(i % 4) * 50}ms` } as CSSProperties} />
        ))}
      </div>
      <b className="sh-unwrap-t">{title}</b>
    </div>
  )
}

/**
 * Points-only fix (2026-11-08): reward buys that went into Finance Helper as
 * real spending before. Shown to you with a "From Rewards (points)" tag; they
 * leave Finance only when you tap Remove and say yes (never silently).
 */
export function RewardMoneyFix({ onRemove }: { onRemove: (ids?: string[]) => Promise<boolean> }) {
  const [rows, setRows] = useState<RewardMoneyRow[] | null>(null)
  const load = () => void life.shop.rewardMoney?.().then(setRows).catch(() => setRows([]))
  useEffect(load, [])
  if (!rows?.length) return null
  const total = Math.round(rows.reduce((t, r) => t + r.lei, 0))
  const go = async (ids?: string[]) => {
    if (await onRemove(ids)) load()
  }
  return (
    <section className="sh-moneyfix" data-testid="reward-money-fix" aria-label="Reward buys in Finance">
      <b>
        {rows.length} reward buy{rows.length === 1 ? ' is' : 's are'} in Finance as real spending ({total.toLocaleString('en-US')} lei)
      </b>
      <small>Buying with points is not real money, so these should not count as spending. Keep any you really paid for.</small>
      <ul>
        {rows.slice(0, 12).map((r) => (
          <li key={r.id}>
            <span className="sh-moneyfix-tag">From Rewards (points)</span>
            <span className="sh-moneyfix-what">
              {r.date.slice(5)} · {r.note.replace(/^Reward:\s*/, '')}
            </span>
            <span className="num">{r.lei.toLocaleString('en-US')} lei</span>
            <button type="button" className="rx-btn small ghost" onClick={() => void go([r.id])}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 12 && <small>and {rows.length - 12} more</small>}
      <button type="button" className="rx-btn small primary" onClick={() => void go()}>
        Remove all reward entries from Finance
      </button>
    </section>
  )
}
