// One reward as a photo card (RW2): a photo or emoji cover, the price in
// points and lei, "≈ N h of your work", a progress bar along the bottom
// edge, one main button ("Hold to get it" or "N to go") and a ⋯ menu.
// Buying flips the card to "Yours!" (RW7); becoming affordable makes it glow
// once and the lock pop (RW6).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { REWARD_CATEGORIES, rewardEmoji, type Reward } from '@core/shop'
import { readyLine } from '@core/rewardsKit'
import { leiForPoints } from '@core/pointValue'
import { hoursOfWork } from '@core/funBudget'
import { barFill } from '../motionKit'
import { HoldButton } from './HoldButton'
import { stillMode, useGrowFrom, type ValueInfo } from './useRewards'

export interface CardInfo {
  /** Why it can't be bought now (points, budget, cooldown, lock), or null. */
  blocked: string | null
  /** A lock: its text and whether it's open. */
  lock: { text: string; met: boolean } | null
  left: number
  /** Just became ready: glow once (RW6). */
  justReady: boolean
}

const fmtLei = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0))

export function Cover({ r, small = false }: { r: Pick<Reward, 'imageUrl' | 'emoji' | 'category' | 'title'>; small?: boolean }) {
  const [broken, setBroken] = useState(false)
  const cat = r.category ?? 'fun'
  return (
    <div className={`rx-cover cat-${cat} ${small ? 'small' : ''}`}>
      {r.imageUrl && !broken ? <img src={r.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <span className="rx-emoji" aria-hidden>{rewardEmoji(r)}</span>}
    </div>
  )
}

export function RewardCard({
  r,
  info,
  balance,
  perDay,
  today,
  value,
  menu,
  extra,
  onBuy,
  drag
}: {
  r: Reward
  info: CardInfo
  balance: number
  perDay: number
  today: string
  value: ValueInfo
  menu: ReactNode
  extra?: ReactNode
  onBuy: (el: HTMLElement) => Promise<boolean>
  drag?: { onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void; over: boolean }
}) {
  const el = useRef<HTMLElement>(null)
  const [flipped, setFlipped] = useState(false)
  const have = balance + (r.jar ?? 0)
  const frac = Math.min(1, have / Math.max(1, r.price))
  const grown = useGrowFrom(`r${r.id}`, frac)
  const lei = r.realCost > 0 ? r.realCost : leiForPoints(r.price, value.value)
  const hours = r.realCost > 0 ? hoursOfWork(r.realCost, value.hourlyLei) : null
  const ready = !info.blocked
  const eta = info.left > 0 ? readyLine(today, info.left, perDay) : null
  const cat = REWARD_CATEGORIES.find((c) => c.id === r.category)

  useEffect(() => {
    if (!flipped) return
    const t = setTimeout(() => setFlipped(false), 1700)
    return () => clearTimeout(t)
  }, [flipped])

  const buy = async () => {
    const ok = await onBuy(el.current!)
    if (ok && !stillMode()) setFlipped(true)
  }

  return (
    <article
      ref={el}
      className={`rx-card ${ready ? 'ready' : ''} ${r.goalRank ? 'goal' : ''} ${flipped ? 'flipped' : ''} ${info.justReady ? 'just-ready' : ''} ${drag?.over ? 'drop-over' : ''}`}
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      data-reward={r.id}
    >
      <div className="rx-flip">
        <div className="rx-front">
          <div className="rx-top">
            <Cover r={r} />
            <div className="rx-badges">
              {r.goalRank ? <span className="rx-tag goal">★ Saving for{r.goalRank > 1 ? ` #${r.goalRank}` : ''}</span> : cat ? <span className="rx-tag">{cat.label}</span> : null}
              {r.bundle?.length ? <span className="rx-tag">Bundle</span> : null}
              {r.oneTime ? <span className="rx-tag">Once</span> : r.cooldownDays ? <span className="rx-tag">Every {r.cooldownDays} d</span> : null}
            </div>
            {info.lock && <span className={`rx-lock ${info.lock.met ? 'open' : ''}`} title={info.lock.text}>{info.lock.met ? '🔓' : '🔒'}</span>}
            <div className="rx-menu-slot">{menu}</div>
          </div>
          <div className="rx-body">
            <b className="rx-title">{r.title}</b>
            <div className="rx-chips">
              <span className="rx-price" title={`${r.price.toLocaleString()} points`}>
                <i className="coin-dot" aria-hidden /> {r.price.toLocaleString()}
                <small> · ≈ {fmtLei(lei)} lei</small>
              </span>
              {hours != null && <span className="rx-hours">≈ {hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours < 10 ? hours.toFixed(1).replace('.0', '') : Math.round(hours)} h`} of your work</span>}
            </div>
            {r.note && <p className="rx-note">{r.note}</p>}
            {(r.jar ?? 0) > 0 && <p className="rx-jar">🫙 {r.jar!.toLocaleString()} set aside in its jar</p>}
            <p className={`rx-why ${ready ? 'ok' : ''}`}>{ready ? (info.lock?.met ? 'Unlocked and ready' : 'Ready for you') : info.left > 0 ? eta ?? `${Math.round(frac * 100)}% there` : info.blocked}</p>
            {extra}
            <div className="rx-act">
              {ready ? (
                <HoldButton label={`Hold to get ${r.title}`} onDone={() => void buy()}>
                  Hold to get it
                </HoldButton>
              ) : (
                <button type="button" className="rx-togo" aria-disabled="true" title={info.blocked ?? ''}>
                  {info.left > 0 ? (
                    <>
                      <b>{info.left.toLocaleString()}</b> to go
                    </>
                  ) : info.lock && !info.lock.met ? (
                    'Locked'
                  ) : (
                    'Not yet'
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="rx-edge pbar" aria-hidden>
            <i style={barFill(grown)} />
          </div>
        </div>
        <div className="rx-back" aria-hidden={!flipped}>
          <span className="rx-back-emoji">{rewardEmoji(r)}</span>
          <b>Yours!</b>
          <small>You earned it.</small>
        </div>
      </div>
    </article>
  )
}

/** The ⋯ menu on a card: Edit, Lock, Saving for, Jar, Remove. */
export function CardMenu({ items }: { items: { label: string; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="rx-menu" ref={box}>
      <button type="button" className="rx-dots" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="rx-pop" role="menu" style={{ '--n': items.length } as CSSProperties}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false)
                it.run()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
