// Rewards: what your points buy, made to make you want to earn them. A hero
// wallet with the goal you're saving for, Ben's one line, photo cards you
// hold to buy, tabs (Can get now / Saving for / All / History), daily quests,
// the weekly challenge, level chests, the earnings graph and badges.
// Points only come from real, logged actions (see core/rewardsKit.ts).
import { PageTabs } from '../PageTabs'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RewardInput, ShopState } from '@shared/api'
import { REWARD_CATEGORIES, redeemBlocker, rewardEmoji, type Reward, type RewardCategory } from '@core/shop'
import { benRewardLine, readyKey } from '@core/rewardsKit'
import { dayLabel } from '@core/dates'
import { life } from '../bridge'
import { buyToast, redeemReward } from '../redeem'
import { play, soundSuccess } from '../soundKit'
import { useAction, useToast } from '../ui'
import { celebrate } from '../fx'
import { askConfirm } from '../confirmSheet'
import { WalletHero, Balance } from '../rewards/WalletHero'
import { CardMenu, Cover, RewardCard, type CardInfo } from '../rewards/RewardCard'
import { RewardSheet } from '../rewards/RewardSheet'
import { EarnChart } from '../rewards/EarnChart'
import { AffordRow, Badges, BenLine, Challenge, Chests, HowToEarn, Quests } from '../rewards/Extras'
import { LockEditor, useUnlocks } from '../rewards/LockEditor'
import { stillMode, useRewardsData } from '../rewards/useRewards'
import '../lifeExtras.css'
import '../rewards/rewards.css'

type Tab = 'now' | 'saving' | 'all' | 'history' | 'earn'
const TABS: { id: Tab; label: string; title: string }[] = [
  { id: 'now', label: 'Can get now', title: 'Rewards you can afford now (1)' },
  { id: 'saving', label: 'Saving for', title: 'Your goals and jars (2)' },
  { id: 'all', label: 'All', title: 'Every reward (3)' },
  { id: 'history', label: 'History', title: 'What you bought (4)' },
  { id: 'earn', label: 'Quests', title: 'Daily quests, the weekly challenge, your earnings and badges (5)' }
]
const TAB_KEY = 'ls.rw.tab'
const readTab = (): Tab | null => {
  try {
    const t = localStorage.getItem(TAB_KEY) as Tab | null
    return t && TABS.some((x) => x.id === t) ? t : null
  } catch {
    return null
  }
}

export function Rewards({ state, onState, onWallet }: { state: ShopState; onState: (s: ShopState) => void; onWallet: () => void }) {
  const act = useAction()
  const toast = useToast()
  const [locks, reloadLocks] = useUnlocks()
  const { insights, quests, value, reload } = useRewardsData(state)
  const [tab, setTabNow] = useState<Tab | null>(readTab)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { page?: string; tab?: string } | undefined
      if (d?.page === 'shop' && TABS.some((x) => x.id === d.tab)) setTabNow(d.tab as Tab)
    }
    window.addEventListener('life-open-tab', on)
    return () => window.removeEventListener('life-open-tab', on)
  }, [])
  const [cat, setCat] = useState<RewardCategory | null>(null)
  const [only, setOnly] = useState<number[] | null>(null)
  const [sheet, setSheet] = useState<Reward | 'new' | null>(null)
  const [locking, setLocking] = useState<number | null>(null)
  const [jarFor, setJarFor] = useState<number | null>(null)
  const [how, setHow] = useState(false)
  const [justBought, setJustBought] = useState<string | null>(null)
  const [justReady, setJustReady] = useState<Set<number>>(new Set())
  // Cards flipping to "Yours!" stay where they are until the flip is over.
  const [flipping, setFlipping] = useState<Map<number, Reward>>(new Map())
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  const today = state.today ?? insights?.today ?? new Date().toISOString().slice(0, 10)
  const perDay = state.earnPerDay ?? 0
  const live = useMemo(() => state.rewards.filter((r) => !r.archived), [state.rewards])
  const goals = useMemo(() => live.filter((r) => r.goalRank).sort((a, b) => (a.goalRank ?? 0) - (b.goalRank ?? 0)), [live])

  const infoOf = (r: Reward): CardInfo => {
    const ls = locks?.states[String(r.id)]
    const lock = ls ? { text: ls.text, met: ls.met } : null
    const blocked = redeemBlocker({ reward: r, balance: state.balance, level: state.level, monthSpent: state.monthSpent, budget: state.budget, buys: state.buys?.[r.id] ?? [], today }) ?? (lock && !lock.met ? lock.text : null)
    return { blocked, lock, left: Math.max(0, r.price - state.balance - (r.jar ?? 0)), justReady: justReady.has(r.id) }
  }
  const infos = new Map(live.map((r) => [r.id, infoOf(r)]))
  const readyList = live.filter((r) => !infos.get(r.id)!.blocked)
  const shownTab: Tab = tab ?? (readyList.length ? 'now' : 'all')
  const setTab = (t: Tab) => {
    setTabNow(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* a convenience only */
    }
  }

  // RW6: a reward that just became affordable (or whose lock opened) glows
  // once, with a soft chime and a toast. Once per reward and buy, remembered
  // in a synced setting. The very first time, today's ready ones are noted quietly.
  const announced = useRef(false)
  useEffect(() => {
    if (!insights || !locks) return
    const seen = new Set(insights.readySeen)
    const fresh = readyList.filter((r) => !seen.has(readyKey(r.id, state.buys?.[r.id]?.length ?? 0)))
    if (!fresh.length) return
    const keys = fresh.map((r) => readyKey(r.id, state.buys?.[r.id]?.length ?? 0))
    const quiet = !insights.readySeen.length && !announced.current
    announced.current = true
    void life.shop.markReady?.(keys).then(reload).catch(() => {})
    if (quiet) return
    setJustReady(new Set(fresh.map((r) => r.id)))
    play('remindReward')
    toast(fresh.length === 1 ? `${rewardEmoji(fresh[0])} ${fresh[0].title} is ready` : `${fresh.length} rewards are ready`, 'good')
    const t = setTimeout(() => setJustReady(new Set()), 1600)
    return () => clearTimeout(t)
  }, [insights, locks, readyList.map((r) => r.id).join(',')])

  useEffect(() => {
    if (!justBought) return
    const t = setTimeout(() => setJustBought(null), 8000)
    return () => clearTimeout(t)
  }, [justBought])

  const save = async (input: RewardInput) => {
    const s = await act(() => life.shop.save(input), input.id ? 'Reward updated' : 'Reward added')
    if (s) onState(s)
    return !!s
  }
  const setGoals = async (ids: number[], msg?: string) => {
    if (!life.shop.setGoals) return
    const s = await act(() => life.shop.setGoals!(ids), msg)
    if (s) onState(s)
  }
  const toggleGoal = (r: Reward) => {
    const ids = goals.map((g) => g.id)
    if (ids.includes(r.id)) return void setGoals(ids.filter((x) => x !== r.id), 'No longer saving for it')
    if (ids.length >= 3) return toast('Up to 3 goals: take one off first', 'info')
    void setGoals([...ids, r.id], `Saving for ${r.title}`)
  }
  const remove = async (r: Reward) => {
    setSheet(null)
    const s = await act(() => life.shop.archive(r.id))
    if (!s) return
    onState(s)
    toast(`${r.title} removed`, 'info', {
      label: 'Undo',
      run: () => void (life.shop.restore ? life.shop.restore(r.id) : life.shop.save({ ...r, id: r.id } as RewardInput).then(() => life.shop.state())).then(onState).catch(() => {})
    })
  }
  const buy = async (r: Reward, el: HTMLElement): Promise<boolean> => {
    const s = await act(() => redeemReward(r.id))
    if (!s) return false
    celebrate(el, 'reward')
    play('reward')
    setJustBought(r.title)
    toast(buyToast(s, `${rewardEmoji(r)} ${r.title}: yours. You earned it.`), 'good')
    if (!stillMode()) {
      setFlipping((x) => new Map(x).set(r.id, r))
      setTimeout(
        () =>
          setFlipping((x) => {
            const n = new Map(x)
            n.delete(r.id)
            return n
          }),
        1900
      )
    }
    onState(s)
    onWallet()
    return true
  }
  const undoBuy = async (ledgerId: number, title: string) => {
    if (!(await askConfirm(`Undo buying ${title}? Your points come back.`, { ok: 'Undo buy', danger: false }))) return
    const s = await act(() => life.shop.undoBuy!(ledgerId), 'Points are back')
    if (s) {
      onState(s)
      onWallet()
    }
  }
  const jar = async (r: Reward, amount: number, out = false) => {
    const fn = out ? life.shop.jarTake : life.shop.jarAdd
    if (!fn) return
    const s = await act(() => fn(r.id, amount), out ? 'Back in your wallet' : `🫙 ${amount} set aside for ${r.title}`)
    if (s) {
      onState(s)
      onWallet()
      setJarFor(null)
    }
  }
  const fun = async (min: number) => {
    const ok = await act(() => life.focus.fun(min, 'Fun'), `Enjoy ${min} minutes of fun 🎮`)
    if (ok) {
      soundSuccess()
      onWallet()
    }
  }
  const claimQuests = async () => {
    const ok = await act(() => life.wallet.claimQuests(), 'Quests done: bonus added 🎯')
    if (ok) {
      celebrate(null, 'reward')
      play('levelUp')
      onWallet()
      reload()
    }
  }
  const claimChallenge = async () => {
    if (!life.shop.claimChallenge) return
    const r = await act(() => life.shop.claimChallenge!(), 'Weekly challenge won 🏆')
    if (r) {
      celebrate(null, 'reward')
      play('levelUp')
      onState(r.state)
      onWallet()
    }
  }
  const openChest = async (level: number): Promise<number | null> => {
    const r = await act(() => life.shop.openChest(level))
    if (!r) return null
    play('levelUp')
    onState(r.state)
    onWallet()
    return r.coins
  }

  // Drag to reorder (RF3), on the All tab.
  const reorderTo = async (targetId: number) => {
    const from = dragId
    setDragId(null)
    setOverId(null)
    if (from == null || from === targetId || !life.shop.reorder) return
    const ids = sorted(live).map((r) => r.id).filter((x) => x !== from)
    ids.splice(ids.indexOf(targetId), 0, from)
    const s = await act(() => life.shop.reorder!(ids))
    if (s) onState(s)
  }

  const menuFor = (r: Reward) => {
    const isGoal = !!r.goalRank
    const items: { label: string; run: () => void; danger?: boolean }[] = [
      { label: 'Edit', run: () => setSheet(r) },
      { label: isGoal ? 'Stop saving for it' : 'Save for this', run: () => toggleGoal(r) }
    ]
    if (isGoal && r.goalRank! > 1) items.push({ label: 'Make it my main goal', run: () => void setGoals([r.id, ...goals.filter((g) => g.id !== r.id).map((g) => g.id)], `${r.title} is your main goal`) })
    if (life.shop.jarAdd) items.push({ label: (r.jar ?? 0) > 0 ? 'Savings jar…' : 'Set points aside…', run: () => setJarFor(jarFor === r.id ? null : r.id) })
    if (locks) items.push({ label: locks.locks[String(r.id)] ? 'Change lock' : 'Lock it to a goal', run: () => setLocking(locking === r.id ? null : r.id) })
    if (r.productUrl) items.push({ label: 'Open link', run: () => window.open(r.productUrl!, '_blank', 'noopener') })
    items.push({ label: 'Remove', danger: true, run: () => void remove(r) })
    return <CardMenu items={items} />
  }

  const extraFor = (r: Reward) => (
    <>
      {locking === r.id && (
        <LockEditor
          rewardId={r.id}
          view={locks}
          onDone={() => {
            setLocking(null)
            reloadLocks()
          }}
        />
      )}
      {jarFor === r.id && <JarEditor r={r} balance={state.balance} onPut={(n) => void jar(r, n)} onTake={(n) => void jar(r, n, true)} onClose={() => setJarFor(null)} />}
    </>
  )

  const card = (r: Reward, draggable = false) => (
    <RewardCard
      key={r.id}
      r={r}
      info={infos.get(r.id) ?? { blocked: null, lock: null, left: 0, justReady: false }}
      balance={state.balance}
      perDay={perDay}
      today={today}
      value={value}
      menu={menuFor(r)}
      extra={extraFor(r)}
      onBuy={(el) => buy(r, el)}
      drag={
        draggable && life.shop.reorder
          ? {
              onDragStart: () => setDragId(r.id),
              onDragOver: (e) => {
                e.preventDefault()
                if (overId !== r.id) setOverId(r.id)
              },
              onDrop: () => void reorderTo(r.id),
              over: overId === r.id && dragId !== r.id
            }
          : undefined
      }
    />
  )

  const list = (() => {
    let xs = shownTab === 'now' ? live.filter((r) => !infos.get(r.id)!.blocked || flipping.has(r.id)) : shownTab === 'saving' ? [...goals, ...live.filter((r) => !r.goalRank && (r.jar ?? 0) > 0)] : sorted(live)
    // A one-time reward just bought has left the list: keep it for its flip.
    for (const [id, r] of flipping) if (!xs.some((x) => x.id === id)) xs = [...xs, r]
    if (shownTab === 'all' && cat) xs = xs.filter((r) => r.category === cat)
    if (only && shownTab !== 'history') xs = live.filter((r) => only.includes(r.id))
    return xs
  })()
  const usedCats = REWARD_CATEGORIES.filter((c) => live.some((r) => r.category === c.id))
  const goal = goals[0] ?? null
  const ben = benRewardLine({
    goal: goal ? { title: goal.title, left: Math.max(0, goal.price - state.balance - (goal.jar ?? 0)) } : null,
    perDay,
    today,
    todayEarned: insights?.earnings.today ?? 0,
    readyCount: readyList.length,
    justBought,
    streak: insights?.focusStreak ?? 0
  })
  const counts: Record<Tab, number> = { now: readyList.length, saving: goals.length, all: live.length, history: state.recent.filter((x) => !x.undone).length, earn: 0 }

  return (
    <div className="rx">
      <div className="rx-amb" aria-hidden>
        <i className="a" />
        <i className="b" />
        <i className="c" />
      </div>

      <div className="rx-stick">
        <span className="rx-stick-bal">
          <i className="rx-coin" aria-hidden />
          <Balance n={state.balance} />
        </span>
        <span className={`rx-pill today ${(insights?.earnings.today ?? 0) > 0 ? 'on' : ''}`}>+{insights?.earnings.today ?? 0} today</span>
        <button type="button" className="rx-btn primary small" onClick={() => setSheet('new')}>
          + Add
        </button>
      </div>

      <WalletHero balance={state.balance} goals={goals} perDay={perDay} today={today} insights={insights} value={value} onFun={(m) => void fun(m)} onHow={() => setHow(true)} onAdd={() => setSheet('new')} />

      <div className="rx-layout rx-one">
        <div className="rx-main">
          <BenLine text={ben} />
          <Chests levels={state.chests} onOpen={openChest} />

          <PageTabs
            page="shop"
            label="Rewards"
            tabs={TABS.map((t) => ({ id: t.id, label: t.label, title: t.title, count: t.id === 'earn' ? null : counts[t.id] || null }))}
            value={shownTab}
            onChange={(id) => {
              setTab(id as Tab)
              setOnly(null)
            }}
          />

          {shownTab !== 'history' && shownTab !== 'earn' && <AffordRow rewards={live} balance={state.balance} perDay={perDay} onPick={setOnly} />}

          {shownTab === 'all' && usedCats.length > 1 && !only && (
            <div className="rx-cats filter" role="group" aria-label="Category">
              <button type="button" className={`rx-chip ${!cat ? 'on' : ''}`} onClick={() => setCat(null)}>
                Everything
              </button>
              {usedCats.map((c) => (
                <button key={c.id} type="button" className={`rx-chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          )}

          {shownTab === 'earn' ? (
            <div className="rx-earn">
              {quests && <Quests q={quests} onClaim={() => void claimQuests()} />}
              {insights && <Challenge c={insights.challenge} onClaim={() => void claimChallenge()} />}
              {insights && (
                <section className="rx-panel">
                  <header>
                    <h3>Your earnings</h3>
                    <span className="rx-sub">30 days</span>
                  </header>
                  <EarnChart e={insights.earnings} />
                </section>
              )}
              {insights && <Badges list={insights.badges} />}
            </div>
          ) : shownTab === 'history' ? (
            <History recent={state.recent} currency={state.currency} onUndo={life.shop.undoBuy ? (id, t) => void undoBuy(id, t) : null} />
          ) : (
            <>
              {!list.length && (
                <div className="rx-empty">
                  {shownTab === 'now' ? (
                    <>
                      <b>Nothing ready yet</b>
                      <span>{goal ? `${Math.max(0, goal.price - state.balance - (goal.jar ?? 0)).toLocaleString()} points to go for ${goal.title}. One focus block is +15.` : 'Earn a few points and something will be ready.'}</span>
                    </>
                  ) : shownTab === 'saving' ? (
                    <>
                      <b>Not saving for anything yet</b>
                      <span>Pick up to 3 goals with a card's ⋯ menu. The first one shows on Today.</span>
                    </>
                  ) : (
                    <>
                      <b>No rewards yet</b>
                      <span>Add something you really want: a game, headphones, a dinner out.</span>
                    </>
                  )}
                  <button type="button" className="rx-btn primary" onClick={() => (shownTab === 'all' ? setSheet('new') : setTab('all'))}>
                    {shownTab === 'all' ? '+ Add a reward' : 'See all rewards'}
                  </button>
                </div>
              )}
              <div className="rx-grid">{list.map((r) => card(r, shownTab === 'all' && !cat && !only))}</div>
              {shownTab === 'all' && life.shop.reorder && live.length > 1 && <p className="rx-sub rx-drag-hint">Drag a card to change the order.</p>}
            </>
          )}
        </div>

      </div>

      {sheet && (
        <RewardSheet
          reward={sheet === 'new' ? null : sheet}
          all={live}
          value={value}
          currency={state.currency}
          onSave={save}
          onClose={() => setSheet(null)}
          onRemove={sheet === 'new' ? undefined : () => void remove(sheet)}
        />
      )}
      {how && <HowToEarn streak={insights?.focusStreak ?? 0} onClose={() => setHow(false)} />}
    </div>
  )
}

/** Your order first (drag to reorder), then cheapest first. */
function sorted(rs: Reward[]): Reward[] {
  return [...rs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.price - b.price)
}

function JarEditor({ r, balance, onPut, onTake, onClose }: { r: Reward; balance: number; onPut: (n: number) => void; onTake: (n: number) => void; onClose: () => void }) {
  const need = Math.max(0, r.price - (r.jar ?? 0))
  const [n, setN] = useState(String(Math.min(balance, need, 50) || ''))
  const v = Math.floor(Number(n) || 0)
  return (
    <div className="rx-jar-edit">
      <p className="rx-sub">Points in a jar wait for this reward only. You can take them back out any time.</p>
      <div className="rx-row">
        <input value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Points" className="short" />
        <button type="button" className="rx-btn primary small" disabled={!(v > 0) || v > balance || v > need} onClick={() => onPut(v)}>
          Put in
        </button>
        {(r.jar ?? 0) > 0 && (
          <button type="button" className="rx-btn small" disabled={!(v > 0) || v > (r.jar ?? 0)} onClick={() => onTake(v)}>
            Take out
          </button>
        )}
        <button type="button" className="rx-btn small ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function History({ recent, currency, onUndo }: { recent: ShopState['recent']; currency: string; onUndo: ((ledgerId: number, title: string) => void) | null }) {
  if (!recent.length)
    return (
      <div className="rx-empty">
        <b>Nothing bought yet</b>
        <span>Your first reward will show here.</span>
      </div>
    )
  return (
    <ul className="rx-history">
      {recent.map((x, i) => (
        <li key={x.ledgerId ?? i} className={x.undone ? 'undone' : ''}>
          <Cover r={{ title: x.title, emoji: x.emoji ?? null, imageUrl: x.imageUrl ?? null, category: (x.category as RewardCategory) ?? null }} small />
          <span className="rx-h-text">
            <b>{x.title}</b>
            <small>
              {dayLabel(x.day)}
              {x.realCost ? ` · ${x.realCost} ${currency === 'MDL' ? 'lei' : currency}` : ''}
              {x.undone ? ' · undone' : ''}
            </small>
          </span>
          {x.coins ? <span className="rx-h-pts num">−{x.coins.toLocaleString()}</span> : null}
          {onUndo && !x.undone && x.ledgerId && (
            <button type="button" className="rx-btn small ghost" onClick={() => onUndo(x.ledgerId!, x.title)}>
              Undo buy
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
