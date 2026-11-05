// The smaller parts of the Rewards page: Ben's one line (RW9), daily quests
// (RG2), the weekly challenge (RG5), level chests that shake open (RW8),
// badges (RG8), what you can afford soon (RG4) and the "How to earn" sheet.
import { useEffect, useState, type CSSProperties } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { createPortal } from 'react-dom'
import type { QuestState } from '@shared/api'
import type { Reward } from '@core/shop'
import { affordChips, CHALLENGE_BONUS, LUCKY, STREAK_BONUS, type Badge, type ChallengeState } from '@core/rewardsKit'
import { POINT_RULES } from '../../../main/points'
import { BenAvatar } from '../BenAvatar'
import { barFill } from '../motionKit'
import { Cover } from './RewardCard'
import { useGrowFrom } from './useRewards'

export function BenLine({ text }: { text: string }) {
  return (
    <div className="rx-ben" aria-live="polite">
      <BenAvatar size={40} ring />
      <m.p key={text} className="rx-ben-say" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <b>Ben</b> {text}
      </m.p>
    </div>
  )
}

function Bar({ id, frac }: { id: string; frac: number }) {
  const g = useGrowFrom(id, frac)
  return (
    <span className="rx-mini pbar" aria-hidden>
      <i style={barFill(g)} />
    </span>
  )
}

export function Quests({ q, onClaim }: { q: QuestState; onClaim: () => void }) {
  return (
    <section className="rx-panel rx-quests">
      <header>
        <h3>Daily quests</h3>
        <span className="rx-sub">All 3 = +{q.bonus.coins}</span>
      </header>
      <ul>
        {q.quests.map((x) => (
          <li key={x.id} className={x.done ? 'done' : ''}>
            <span className="rx-q-check" aria-hidden>{x.done ? '✓' : ''}</span>
            <span className="rx-q-title">{x.title}</span>
            <span className="rx-q-n num">
              {x.progress}/{x.goal}
            </span>
            <Bar id={`q.${q.day}.${x.id}`} frac={x.progress / x.goal} />
          </li>
        ))}
      </ul>
      {q.claimed ? (
        <p className="rx-sub ok">Claimed today ✓</p>
      ) : (
        <button type="button" className={`rx-btn ${q.allDone ? 'primary glow' : ''}`} disabled={!q.allDone} onClick={onClaim}>
          {q.allDone ? `Claim +${q.bonus.coins}` : `${q.quests.filter((x) => x.done).length} of 3 done`}
        </button>
      )}
    </section>
  )
}

export function Challenge({ c, onClaim }: { c: ChallengeState; onClaim: () => void }) {
  return (
    <section className="rx-panel rx-challenge">
      <header>
        <h3>Weekly challenge</h3>
        <span className="rx-sub">{c.daysLeft} day{c.daysLeft === 1 ? '' : 's'} left</span>
      </header>
      <p className="rx-ch-title">{c.title}</p>
      <div className="rx-ch-row">
        <Bar id={`ch.${c.week}`} frac={c.progress / c.goal} />
        <span className="num">
          {c.progress}/{c.goal}
        </span>
      </div>
      <p className="rx-sub">Picked from your weakest area last week. Pays +{CHALLENGE_BONUS} once, only for things you really logged.</p>
      {c.paid ? (
        <p className="rx-sub ok">Won this week ✓ +{c.bonus}</p>
      ) : (
        c.done && (
          <button type="button" className="rx-btn primary glow" onClick={onClaim}>
            Claim +{c.bonus}
          </button>
        )
      )}
    </section>
  )
}

export function Chests({ levels, onOpen }: { levels: number[]; onOpen: (level: number) => Promise<number | null> }) {
  const [opening, setOpening] = useState<number | null>(null)
  const [won, setWon] = useState<{ level: number; coins: number } | null>(null)
  useEffect(() => {
    if (!won) return
    const t = setTimeout(() => setWon(null), 2400)
    return () => clearTimeout(t)
  }, [won])
  if (!levels.length && !won) return null
  const open = async (level: number) => {
    if (opening) return
    setOpening(level)
    await new Promise((r) => setTimeout(r, 420))
    const coins = await onOpen(level)
    setOpening(null)
    if (coins != null) setWon({ level, coins })
  }
  return (
    <section className="rx-panel rx-chests">
      <header>
        <h3>Level chests</h3>
        <span className="rx-sub">One for each level you reached</span>
      </header>
      <div className="rx-chest-row">
        {levels.map((l) => (
          <button key={l} type="button" className={`rx-chest ${opening === l ? 'opening' : ''}`} onClick={() => void open(l)} aria-label={`Open the level ${l} chest`}>
            <span className="rx-chest-ico" aria-hidden>🧰</span>
            <small>Level {l}</small>
          </button>
        ))}
        <AnimatePresence>
          {won && (
            <m.div key={won.level} className="rx-chest-won" initial={{ opacity: 0, scale: 0.6, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }}>
              ✨ +{won.coins}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

export function Badges({ list }: { list: Badge[] }) {
  const got = list.filter((b) => b.earned).length
  return (
    <section className="rx-panel rx-badges-panel">
      <header>
        <h3>Badges</h3>
        <span className="rx-sub">
          {got} of {list.length} · just for show, no points
        </span>
      </header>
      <ul className="rx-badge-grid">
        {list.map((b) => (
          <li key={b.id} className={b.earned ? 'on' : ''} title={`${b.title}: ${b.hint}`} style={{ '--p': b.progress } as CSSProperties}>
            <span className="rx-badge-ico" aria-hidden>{b.emoji}</span>
            <small>{b.title}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AffordRow({ rewards, balance, perDay, onPick }: { rewards: Reward[]; balance: number; perDay: number; onPick: (ids: number[] | null) => void }) {
  const chips = affordChips(rewards, balance, perDay)
  const [on, setOn] = useState<string | null>(null)
  return (
    <div className="rx-afford" role="group" aria-label="What can I afford">
      <span className="rx-afford-label">What can I afford?</span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`rx-chip ${on === c.id ? 'on' : ''}`}
          disabled={c.id !== 'now' && !(perDay > 0)}
          title={c.id !== 'now' && !(perDay > 0) ? 'After a few days of earning' : c.items.map((r) => r.title).join(', ') || 'Nothing yet'}
          onClick={() => {
            const next = on === c.id ? null : c.id
            setOn(next)
            onPick(next ? c.items.map((r) => r.id) : null)
          }}
        >
          {c.label} <b>{c.items.length}</b>
        </button>
      ))}
      {on && (
        <span className="rx-afford-faces" aria-hidden>
          {chips
            .find((c) => c.id === on)!
            .items.slice(0, 5)
            .map((r) => (
              <Cover key={r.id} r={r} small />
            ))}
        </span>
      )}
    </div>
  )
}

export function HowToEarn({ onClose, streak }: { onClose: () => void; streak: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="rx-sheet-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <m.div className="rx-sheet small" role="dialog" aria-label="How to earn" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}>
        <header className="rx-sheet-head">
          <h3>How to earn</h3>
          <button type="button" className="rx-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <ul className="rx-rules">
          {POINT_RULES.map((r) => (
            <li key={r.id}>
              <b>{r.value}</b>
              <span>{r.label}</span>
              <small>{r.hint}</small>
            </li>
          ))}
        </ul>
        <h4>Small extras, always for real work</h4>
        <ul className="rx-rules extras">
          <li>
            <b>+{Math.round(STREAK_BONUS.pct * 100)}%</b>
            <span>Focus streak</span>
            <small>
              {STREAK_BONUS.days}+ days of focus in a row add {Math.round(STREAK_BONUS.pct * 100)}% to each timed session (at most +{STREAK_BONUS.max}). {streak >= STREAK_BONUS.days ? `You have it: ${streak} days.` : `You're at ${streak}.`}
            </small>
          </li>
          <li>
            <b>+{LUCKY.coins}</b>
            <span>Lucky gift</span>
            <small>About 1 in 8 finished must-dos, at most {LUCKY.dailyCap} a day. Untick or undo the must-do and it goes too.</small>
          </li>
          <li>
            <b>+{CHALLENGE_BONUS}</b>
            <span>Weekly challenge</span>
            <small>One goal a week from your weakest area, paid once.</small>
          </li>
        </ul>
        <p className="rx-sub">Fun time costs 1 point a minute. A 50-minute focus block (+15) buys 15 minutes of guilt-free fun.</p>
      </m.div>
    </div>,
    document.body
  )
}
