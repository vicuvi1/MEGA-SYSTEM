// One reward as a card (RW2, Rewards 2): a photo or drawn cover, the price
// in points and lei, "≈ N min of your work", one status line, one main
// button ("Hold to get it" or "N to go") and a ⋯ menu. Every card has the
// same shape; the note shows on hover. A card locked to "unlock by doing"
// shows its live progress and opens with a small animation; a coupon shows
// the lower price. Buying fills the button, bursts, then flips to "Yours!".
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { REWARD_CATEGORIES, rewardEmoji, type Reward } from '@core/shop'
import { readyLine } from '@core/rewardsKit'
import { hoursOfWork } from '@core/funBudget'
import { barFill, reducedMotion } from '../motionKit'
import { POINTS_PER_LEI, rarityOf } from '@core/shopShelves'
import { HoldButton } from './HoldButton'
import { RarityTag, Ring } from './Shop'
import { CoverArt } from './CoverArt'
import { stillMode, useGrowFrom, type ValueInfo } from './useRewards'

export interface CardInfo {
  /** Why it can't be bought now (points, budget, cooldown, limits, lock), or null. */
  blocked: string | null
  /** A lock: its text, whether it's open, and how far along (0..1). */
  lock: { text: string; met: boolean; progress?: number } | null
  left: number
  /** Just became ready: glow once (RW6). */
  justReady: boolean
  /** Its lock just opened: the unlock animation (once per device and week). */
  unlocking?: boolean
  /** Healthy limits ("2 a day", "With a workout"). */
  tags?: string[]
  /** A coupon makes it cheaper: the price you'd pay and what the coupon is. */
  deal?: { price: number; label: string } | null
}

const fmtLei = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0))

export function Cover({ r, small = false }: { r: Pick<Reward, 'imageUrl' | 'emoji' | 'category' | 'title'>; small?: boolean }) {
  const [broken, setBroken] = useState(false)
  const cat = r.category ?? 'fun'
  return (
    <div className={`rx-cover cat-${cat} ${small ? 'small' : ''}`}>
      {r.imageUrl && !broken ? (
        <img src={r.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <>
          {!small && <CoverArt cat={cat} />}
          <span className="rx-emoji" aria-hidden>
            {rewardEmoji(r)}
          </span>
        </>
      )}
    </div>
  )
}

/** A burst of sparks from the button (transform and opacity only). */
export function Burst() {
  return (
    <span className="rx-burst" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <i key={i} style={{ '--a': `${i * 30}deg`, '--d': `${(i % 3) * 40}ms` } as CSSProperties} />
      ))}
      <b />
    </span>
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
  drag,
  compact = false,
  pick = false
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
  /** The smaller card in a row ("Ready now"). */
  compact?: boolean
  /** Today's pick: a highlighted card on its shelf (shown once). */
  pick?: boolean
}) {
  const el = useRef<HTMLElement>(null)
  const [flipped, setFlipped] = useState(false)
  const [burst, setBurst] = useState(false)
  const price = info.deal?.price ?? r.price
  const have = balance + (r.jar ?? 0)
  const frac = Math.min(1, have / Math.max(1, price))
  const grown = useGrowFrom(`r${r.id}`, frac)
  const lei = price / POINTS_PER_LEI
  const hours = r.realCost > 0 ? hoursOfWork(price / POINTS_PER_LEI, value.hourlyLei) : null
  const ready = !info.blocked
  const locked = !!info.lock && !info.lock.met
  const eta = info.left > 0 ? readyLine(today, info.left, perDay) : null
  const cat = REWARD_CATEGORIES.find((c) => c.id === r.category)

  useEffect(() => {
    if (!flipped) return
    const t = setTimeout(() => setFlipped(false), 1700)
    return () => clearTimeout(t)
  }, [flipped])
  useEffect(() => {
    if (!burst) return
    const t = setTimeout(() => setBurst(false), 900)
    return () => clearTimeout(t)
  }, [burst])

  const buy = async () => {
    const ok = await onBuy(el.current!)
    // The burst is short and you asked for it (it plays in calm mode too); the flip waits for full motion.
    if (!ok || reducedMotion()) return
    setBurst(true)
    if (!stillMode()) setTimeout(() => setFlipped(true), 380)
  }

  const status = ready
    ? info.lock?.met
      ? 'Unlocked: ready for you'
      : info.deal
        ? `${info.deal.label}: ready`
        : 'Ready for you'
    : locked
      ? info.lock!.text
      : info.left > 0
        ? eta ?? `${Math.round(frac * 100)}% there`
        : info.blocked
  const tags = [...(r.goalRank ? [`★ Saving for${r.goalRank > 1 ? ` #${r.goalRank}` : ''}`] : cat ? [cat.label] : []), ...(info.tags ?? []), ...(r.oneTime ? ['Once'] : r.cooldownDays ? [`Every ${r.cooldownDays} d`] : [])]

  return (
    <article
      ref={el}
      className={`rx-card rar-${rarityOf(r.price)} ${pick ? 'pick' : ''} ${compact ? 'compact' : ''} ${ready ? 'ready' : ''} ${locked ? 'locked' : ''} ${r.goalRank ? 'goal' : ''} ${flipped ? 'flipped' : ''} ${info.justReady ? 'just-ready' : ''} ${info.unlocking ? 'unlocking' : ''} ${drag?.over ? 'drop-over' : ''}`}
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      data-reward={r.id}
      title={r.note ?? undefined}
    >
      <div className="rx-flip">
        <div className="rx-front">
          <div className="rx-top">
            <Cover r={r} />
            <div className="rx-badges">
              {info.deal && <span className="rx-tag deal">🎟️ {info.deal.price === 0 ? 'Free' : info.deal.label.replace(' coupon', '')}</span>}
              {tags.slice(0, compact || (info.lock && info.lock.met) || info.deal ? 1 : 2).map((t, i) => (
                <span key={t} className={`rx-tag ${i === 0 && r.goalRank ? 'goal' : ''}`}>
                  {t}
                </span>
              ))}
            </div>
            {info.lock && (
              <span className={`rx-lock ${info.lock.met ? 'open' : ''}`} title={info.lock.text}>
                {info.lock.met ? '🔓' : '🔒'}
              </span>
            )}
            <div className="rx-menu-slot">{menu}</div>
            {pick && <span className="sh-picktag">★ Today's pick</span>}
            <RarityTag price={r.price} />
            {!ready && info.left > 0 && <Ring have={have} price={price} />}
          </div>
          <div className="rx-body">
            <b className="rx-title">{r.title}</b>
            <div className="rx-chips">
              <span className="rx-price" title={`${r.price.toLocaleString()} points`}>
                <i className="coin-dot" aria-hidden />
                {info.deal ? (
                  <>
                    <s>{r.price.toLocaleString()}</s> {price.toLocaleString()}
                  </>
                ) : (
                  r.price.toLocaleString()
                )}
                <small> · {lei > 0 ? `≈ ${fmtLei(lei)} lei` : 'free'}</small>
              </span>
              {!compact && hours != null && <span className="rx-hours">≈ {hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours < 10 ? hours.toFixed(1).replace('.0', '') : Math.round(hours)} h`} of your work</span>}
            </div>
            {locked && info.lock?.progress != null ? (
              <div className="rx-lockbar" aria-label={info.lock.text}>
                <span className="rx-mini pbar" aria-hidden>
                  <i style={barFill(info.lock.progress)} />
                </span>
                <p className="rx-why">{status}</p>
              </div>
            ) : compact && ready && !info.deal ? null : (
              <p className={`rx-why ${ready ? 'ok' : ''}`}>{status}</p>
            )}
            {(r.jar ?? 0) > 0 && <p className="rx-jar">🫙 {r.jar!.toLocaleString()} set aside</p>}
            {extra}
            <div className="rx-act">
              {ready ? (
                <HoldButton label={`Hold to get ${r.title}`} onDone={() => void buy()}>
                  {info.deal?.price === 0 ? 'Hold to get it free' : 'Hold to get it'}
                </HoldButton>
              ) : (
                <button type="button" className="rx-togo" aria-disabled="true" title={info.blocked ?? ''}>
                  {info.left > 0 ? (
                    <>
                      <b>{info.left.toLocaleString()}</b> to go
                    </>
                  ) : locked ? (
                    '🔒 Unlock by doing'
                  ) : (
                    'Not yet'
                  )}
                </button>
              )}
              {burst && <Burst />}
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

/** The ⋯ menu on a card: Edit, Lock, Limits, Saving for, Jar, Remove. */
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
