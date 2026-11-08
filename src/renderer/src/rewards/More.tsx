// Rewards 2: the new parts of the page. "Saving for" with milestones,
// "Suggested for you" (from what you actually do), "Unlock by doing" ideas,
// "Where my points came from" this week, the surprises (level chests, the
// weekly mystery reward, coupons) with their reveal, and the healthy limits
// editor. Pure logic: core/rewardActivity, rewardSuggest, rewardGuard,
// rewardSurprise.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Reward } from '@core/shop'
import { readyLine, soonerWith } from '@core/rewardsKit'
import { BANDS, type Suggestion } from '@core/rewardSuggest'
import { PAIRS, type PairId, type RewardRules } from '@core/rewardGuard'
import { couponText, prizeText, type ChestPrize, type Coupon, type MysteryState } from '@core/rewardSurprise'
import { unlockState, type Unlock } from '@core/unlocks'
import type { Activity } from '@core/rewardActivity'
import { barFill, reducedMotion } from '../motionKit'
import { Select } from '../Select'
import { Burst, Cover } from './RewardCard'
import { Ring } from './WalletHero'
import { useGrowFrom } from './useRewards'

/** A row that scrolls sideways, with snap. */
export function Rail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="rx-rail" role="list" aria-label={label}>
      {children}
    </div>
  )
}

export function Section({ title, sub, children, end, className = '' }: { title: string; sub?: ReactNode; children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <section className={`rx-sec ${className}`}>
      <header>
        <h3>{title}</h3>
        {sub && <span className="rx-sub">{sub}</span>}
        {end && <span className="rx-sec-end">{end}</span>}
      </header>
      {children}
    </section>
  )
}

// ---------- Saving for, with milestones ----------

const MILESTONES = [0.25, 0.5, 0.75, 1]
const MS_LABEL = ['¼', '½', '¾', '★']

function GoalRow({ g, balance, perDay, today, main }: { g: Reward; balance: number; perDay: number; today: string; main: boolean }) {
  const have = balance + (g.jar ?? 0)
  const frac = Math.min(1, have / Math.max(1, g.price))
  const grown = useGrowFrom(`goal.${g.id}`, frac)
  const left = Math.max(0, g.price - have)
  const ready = readyLine(today, left, perDay)
  const sooner = main && left > 0 ? soonerWith(left, perDay, 2) : null
  const next = MILESTONES.find((m) => frac < m)
  return (
    <li className={`rx-goalrow ${main ? 'main' : ''} ${left <= 0 ? 'done' : ''}`}>
      <Ring frac={grown} size={46}>
        <Cover r={g} small />
      </Ring>
      <div className="rx-goalrow-main">
        <div className="rx-goalrow-head">
          {main && <span className="rx-kicker">Saving for</span>}
          <b>{g.title}</b>
          <span className="num">
            {Math.min(have, g.price).toLocaleString()} / {g.price.toLocaleString()}
          </span>
        </div>
        <div className="rx-msbar" style={{ '--f': grown } as CSSProperties}>
          <span className="pbar" aria-hidden>
            <i style={barFill(grown)} />
          </span>
          {MILESTONES.map((m, i) => (
            <span key={m} className={`rx-ms ${frac >= m ? 'on' : ''}`} style={{ left: `${m * 100}%` }} title={`${Math.round(m * 100)}%: ${Math.round(g.price * m).toLocaleString()} points`}>
              {MS_LABEL[i]}
            </span>
          ))}
        </div>
        <small className="rx-goalrow-foot">
          {left <= 0 ? (
            'You can get it now 🎉'
          ) : (
            <>
              {next != null && next < 1 ? `${Math.round(g.price * next - have).toLocaleString()} to the ${MS_LABEL[MILESTONES.indexOf(next)]} mark` : `${left.toLocaleString()} to go`}
              {ready ? ` · ${ready[0].toLowerCase()}${ready.slice(1)}` : ''}
              {sooner && sooner.days > 0 ? ` · 2 focus blocks a day → ${sooner.days} day${sooner.days > 1 ? 's' : ''} sooner` : ''}
            </>
          )}
        </small>
      </div>
    </li>
  )
}

export function SavingFor({ goals, balance, perDay, today, onAll }: { goals: Reward[]; balance: number; perDay: number; today: string; onAll: () => void }) {
  return (
    <section className="rx-sec rx-saving" aria-label="Saving for" data-testid="saving-for">
      {goals.length ? (
        <ul className="rx-goals">
          {goals.map((g, i) => (
            <GoalRow key={g.id} g={g} balance={balance} perDay={perDay} today={today} main={i === 0} />
          ))}
        </ul>
      ) : (
        <div className="rx-slim-empty">
          <span>Pick up to 3 things worth working for: a card's ⋯ menu → "Save for this".</span>
          <button type="button" className="rx-btn small" onClick={onAll}>
            See all rewards
          </button>
        </div>
      )}
    </section>
  )
}

// ---------- Suggested for you ----------

const shortLock = (u: Unlock) => unlockState(u, { goals: [], streaks: {}, deeds: {} }).text.replace(/ \(now .*\)$/, '')

export function SuggestCard({ s, onAdd, onHide, adding }: { s: Suggestion; onAdd: () => void; onHide: () => void; adding: boolean }) {
  const st = s.starter
  const extras = [st.unlock ? `🔒 ${shortLock(st.unlock)}` : null, st.rules?.pair ? `🤝 ${PAIRS[st.rules.pair].tag}` : null, st.rules?.perDay ? `⏱ ${st.rules.perDay === 1 ? 'Once' : `${st.rules.perDay}×`} a day` : null].filter(Boolean) as string[]
  return (
    <article className={`rx-sug band-${st.band}`} role="listitem" data-key={st.key}>
      <div className="rx-sug-top">
        <Cover r={{ title: st.title, emoji: st.emoji, category: st.category, imageUrl: null }} />
        <span className="rx-tag">{BANDS[st.band].label}</span>
        <button type="button" className="rx-sug-x" aria-label={`Not for me: ${st.title}`} title="Not for me" onClick={onHide}>
          ✕
        </button>
      </div>
      <div className="rx-sug-body">
        <b className="rx-title">{st.title}</b>
        <span className="rx-price">
          <i className="coin-dot" aria-hidden /> {st.points.toLocaleString()}
          <small> · {st.lei ? `≈ ${st.lei.toLocaleString()} lei` : 'free'}</small>
        </span>
        <p className="rx-sug-why">{s.reason}</p>
        {extras.length > 0 && <p className="rx-sug-extra">{extras.join(' · ')}</p>}
        <button type="button" className="rx-btn primary small rx-sug-add" disabled={adding} onClick={onAdd}>
          {adding ? 'Adding…' : '+ Add to my rewards'}
        </button>
      </div>
    </article>
  )
}

export function SuggestRow({ list, onAdd, onHide, title = 'Suggested for you', sub }: { list: Suggestion[]; onAdd: (key: string) => Promise<void>; onHide: (key: string) => void; title?: string; sub?: string }) {
  const [adding, setAdding] = useState<string | null>(null)
  if (!list.length) return null
  return (
    <Section title={title} sub={sub ?? 'From what you did this week'} className="rx-suggest">
      <Rail label={title}>
        {list.map((s) => (
          <SuggestCard
            key={s.starter.key}
            s={s}
            adding={adding === s.starter.key}
            onAdd={() => {
              setAdding(s.starter.key)
              void onAdd(s.starter.key).finally(() => setAdding(null))
            }}
            onHide={() => onHide(s.starter.key)}
          />
        ))}
      </Rail>
    </Section>
  )
}

// ---------- Where my points came from ----------

export function PointsFrom({ a }: { a: Activity }) {
  const total = a.areas.reduce((s, x) => s + x.points, 0)
  const seen = useGrowFrom('pf.seen', 1)
  return (
    <section className="rx-panel rx-from">
      <header>
        <h3>Where my points came from</h3>
        <span className="rx-sub">This week · {total.toLocaleString()} earned</span>
      </header>
      {total ? (
        <>
          <div className="rx-from-bar" aria-hidden>
            {a.areas.map((x) => (
              <i key={x.id} style={{ flexGrow: x.points, background: x.color }} />
            ))}
          </div>
          <ul className="rx-from-list">
            {a.areas.map((x) => (
              <li key={x.id}>
                <span className="rx-from-ico" aria-hidden>
                  {x.emoji}
                </span>
                <span className="rx-from-name">{x.label}</span>
                <span className="rx-mini pbar" aria-hidden>
                  <i style={{ ...barFill(seen * x.share), background: x.color }} />
                </span>
                <b className="num">{x.points.toLocaleString()}</b>
                <small className="num">{Math.round(x.share * 100)}%</small>
              </li>
            ))}
          </ul>
          <p className="rx-sub">
            Spent {a.spentWeek.toLocaleString()} this week{a.funSpentWeek ? `, ${a.funSpentWeek.toLocaleString()} of it on fun` : ''}.
          </p>
        </>
      ) : (
        <p className="rx-sub">Nothing earned yet this week. A focus block, a workout or a must-do starts it.</p>
      )}
    </section>
  )
}

// ---------- Surprises: chests, the mystery reward, coupons ----------

/** The reveal: a chest (or a mystery box) shakes, opens, and shows what's inside. */
export function Reveal({ prize, box, onClose }: { prize: ChestPrize; box: 'chest' | 'mystery'; onClose: () => void }) {
  const [open, setOpen] = useState(reducedMotion())
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="rx-sheet-wrap rx-reveal-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`rx-reveal ${open ? 'open' : ''}`} role="dialog" aria-label="What was inside">
        <div className="rx-reveal-rays" aria-hidden />
        <span className="rx-reveal-box" aria-hidden>
          {box === 'chest' ? '🧰' : '🎁'}
        </span>
        {open && <Burst />}
        <div className="rx-reveal-prize">
          <span className="rx-reveal-emoji" aria-hidden>
            {prize.kind === 'coins' ? '✨' : prize.kind === 'free' ? '🎟️' : '🏷️'}
          </span>
          <b>{prizeText(prize)}</b>
          <small>{prize.kind === 'coins' ? 'Added to your points.' : prize.kind === 'free' ? 'A coupon for 14 days: it pays the points for this one, once.' : 'A coupon for 14 days: it comes off your next buy.'}</small>
          <button type="button" className="rx-btn primary" onClick={onClose} autoFocus>
            Nice
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function Surprises({ chests, mystery, coupons, today, onChest, onMystery }: { chests: number[]; mystery: MysteryState | null; coupons: Coupon[]; today: string; onChest: (level: number) => Promise<void>; onMystery: () => Promise<void> }) {
  const [opening, setOpening] = useState<string | null>(null)
  const busy = useRef(false)
  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    setOpening(key)
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 420))
    try {
      await fn()
    } finally {
      busy.current = false
      setOpening(null)
    }
  }
  const showMystery = !!mystery?.ready
  if (!chests.length && !showMystery && !coupons.length) return null
  return (
    <section className="rx-panel rx-surprise" title="Chests and coupons never make points from nothing: a chest gives its small bonus or a coupon that makes a reward cheaper or free">
      <div className="rx-surprise-row">
        <span className="rx-surprise-label">
          <b>Surprises</b>
        </span>
        {chests.map((l) => (
          <button key={l} type="button" className={`rx-chest ${opening === `c${l}` ? 'opening' : ''}`} onClick={() => void run(`c${l}`, () => onChest(l))} aria-label={`Open the level ${l} chest`}>
            <span className="rx-chest-ico" aria-hidden>
              🧰
            </span>
            <small>Level {l}</small>
          </button>
        ))}
        {showMystery && (
          <button type="button" className={`rx-chest mystery ${opening === 'm' ? 'opening' : ''}`} onClick={() => void run('m', onMystery)} aria-label="Open the weekly mystery reward">
            <span className="rx-chest-ico" aria-hidden>
              🎁
            </span>
            <small>Top 3 done</small>
          </button>
        )}
        {coupons.map((c) => {
          const t = couponText(c, today)
          return (
            <span key={c.id} className="rx-coupon">
              <b>{t.title}</b>
              <small>{t.left}</small>
            </span>
          )
        })}
      </div>
    </section>
  )
}

/** The mystery reward's progress, on the Earn tab. */
export function MysteryCard({ m }: { m: MysteryState }) {
  return (
    <section className="rx-panel rx-mystery">
      <header>
        <h3>🎁 Weekly mystery reward</h3>
        <span className="rx-sub">{m.claimed ? 'Opened this week ✓' : m.total ? `${m.done} of ${m.total} done` : 'No top 3 yet'}</span>
      </header>
      <p className="rx-sub">{m.claimed ? 'A new one comes with next week’s top 3.' : m.ready ? 'All three done: open your mystery box in Surprises above.' : m.total ? 'Finish all of this week’s top 3 and a mystery box opens: a free treat from your list or a discount. Never points.' : 'Pick your top 3 for the week on Today; finish all three and a mystery box opens.'}</p>
      {m.total > 0 && !m.claimed && (
        <span className="rx-mini pbar" aria-hidden>
          <i style={barFill(m.done / m.total)} />
        </span>
      )}
    </section>
  )
}

// ---------- Healthy limits ----------

export function RulesEditor({ cur, onSave, onDone }: { cur: RewardRules | undefined; onSave: (r: RewardRules | null) => Promise<boolean>; onDone: () => void }) {
  const [perDay, setPerDay] = useState(cur?.perDay ?? 0)
  const [pair, setPair] = useState<PairId | ''>(cur?.pair ?? '')
  const save = async (r: RewardRules | null) => {
    if (await onSave(r)) onDone()
  }
  return (
    <div className="rx-lock-edit">
      <p className="rx-sub">Healthy limits keep fun fun. "Pair it" saves a treat for a day you did the hard thing.</p>
      <div className="row">
        <Select value={String(perDay)} onChange={(e) => setPerDay(Number(e.target.value))} aria-label="Most a day">
          <option value="0">No daily limit</option>
          <option value="1">Once a day</option>
          <option value="2">2 a day</option>
          <option value="3">3 a day</option>
        </Select>
        <Select value={pair} onChange={(e) => setPair(e.target.value as PairId | '')} aria-label="Pair it with">
          <option value="">Any day</option>
          {(Object.keys(PAIRS) as PairId[]).map((p) => (
            <option key={p} value={p}>
              Only after {PAIRS[p].label}
            </option>
          ))}
        </Select>
      </div>
      <div className="row">
        <button type="button" className="rx-btn primary small" onClick={() => void save(perDay || pair ? { ...(perDay ? { perDay } : {}), ...(pair ? { pair } : {}) } : null)}>
          Save limits
        </button>
        {cur && (
          <button type="button" className="rx-btn small" onClick={() => void save(null)}>
            Remove limits
          </button>
        )}
        <button type="button" className="rx-btn small ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
