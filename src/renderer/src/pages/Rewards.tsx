// Rewards: what your points buy, made to make you want to earn them. A hero
// band (points, lei, today, the next reward at your pace), Ben's one line,
// surprises (chests, the weekly mystery reward, coupons) and tabs: For you
// (ready now, saving for with milestones, suggested for you), Unlock by
// doing, All, History and Earn (where points came from, quests, the weekly
// challenge, the graph, badges). Points only come from real, logged actions
// (core/rewardsKit.ts); rewards only spend them; chests and coupons never
// make points from nothing (core/rewardSurprise.ts).
import { PageTabs } from '../PageTabs'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RewardInput, ShopState } from '@shared/api'
import { REWARD_CATEGORIES, redeemBlocker, rewardEmoji, type Reward, type RewardCategory } from '@core/shop'
import { benRewardLine, readyKey, readyLine } from '@core/rewardsKit'
import { ruleTags, type RewardRules } from '@core/rewardGuard'
import { couponFor, type ChestPrize } from '@core/rewardSurprise'
import { dayLabel } from '@core/dates'
import { SHELVES, STARTERS, featuredPick, monthSpendLei, shelfOf, type ShelfId } from '@core/shopShelves'
import { life } from '../bridge'
import { buyToast, redeemReward } from '../redeem'
import { play, soundSuccess } from '../soundKit'
import { useAction, useToast } from '../ui'
import { celebrate } from '../fx'
import { askConfirm } from '../confirmSheet'
import { WalletHero, Balance, type NextUp } from '../rewards/WalletHero'
import { CardMenu, Cover, RewardCard, type CardInfo } from '../rewards/RewardCard'
import { RewardSheet } from '../rewards/RewardSheet'
import { EarnChart } from '../rewards/EarnChart'
import { AffordRow, Badges, BenLine, Challenge, HowToEarn, Quests } from '../rewards/Extras'
import { MysteryCard, PointsFrom, Rail, Reveal, RulesEditor, SavingFor, Section, SuggestRow, Surprises } from '../rewards/More'
import { LockEditor, useUnlocks } from '../rewards/LockEditor'
import { stillMode, useRewardsData } from '../rewards/useRewards'
import { BudgetMeter, Combo, RewardMoneyFix, Shelf, Unwrap } from '../rewards/Shop'
import '../lifeExtras.css'
import '../rewards/rewards.css'
import '../rewards/rewards2.css'
import '../rewards/shop.css'

type Tab = 'now' | 'unlock' | 'all' | 'history' | 'earn'
const TABS: { id: Tab; label: string; title: string }[] = [
  { id: 'now', label: 'Shop', title: 'Shelves of rewards, today\'s pick and ideas for you (1)' },
  { id: 'unlock', label: 'Unlock by doing', title: 'Rewards that open when you really did the work (2)' },
  { id: 'all', label: 'All', title: 'Every reward (3)' },
  { id: 'history', label: 'History', title: 'What you bought (4)' },
  { id: 'earn', label: 'Earn', title: 'Where your points came from, quests, the weekly challenge, your earnings and badges (5)' }
]
const UNLOCK_SEEN = 'ls.rw.unlockSeen'
const readSeen = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(UNLOCK_SEEN) || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
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
  const { insights, quests, value, shopValue, setShopValue, more, setMore, reload } = useRewardsData(state)
  const [unwrap, setUnwrap] = useState<{ emoji: string; title: string; n: number } | null>(null)
  const [stocking, setStocking] = useState(false)
  const [openShelves, setOpenShelves] = useState<ShelfId[] | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('ls.rw.shelves') || 'null')
      return Array.isArray(v) ? v.map(String).filter((x): x is ShelfId => SHELVES.some((sh) => sh.id === x)) : null
    } catch {
      return null
    }
  })
  const [ruling, setRuling] = useState<number | null>(null)
  const [reveal, setReveal] = useState<{ prize: ChestPrize; box: 'chest' | 'mystery' } | null>(null)
  const [unlocking, setUnlocking] = useState<Set<number>>(new Set())
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

  const coupons = state.coupons ?? []
  const infoOf = (r: Reward): CardInfo => {
    const ls = locks?.states[String(r.id)]
    const lock = ls ? { text: ls.text, met: ls.met, progress: ls.progress } : null
    const d = couponFor(r, coupons)
    const deal = d.coupon ? { price: d.price, label: d.coupon.kind === 'free' ? 'Free with a coupon' : `−${d.coupon.pct}% coupon` } : null
    const priced = deal ? { ...r, price: d.price } : r
    const guard = state.guards?.[r.id] ?? null
    const blocked = redeemBlocker({ reward: priced, balance: state.balance, level: state.level, monthSpent: state.monthSpent, budget: state.budget, buys: state.buys?.[r.id] ?? [], today }) ?? guard ?? (lock && !lock.met ? lock.text : null)
    return { blocked, lock, left: Math.max(0, priced.price - state.balance - (r.jar ?? 0)), justReady: justReady.has(r.id), unlocking: unlocking.has(r.id), tags: ruleTags(state.rules?.[String(r.id)]), deal }
  }
  const infos = new Map(live.map((r) => [r.id, infoOf(r)]))
  const readyList = live.filter((r) => !infos.get(r.id)!.blocked)
  const shownTab: Tab = tab ?? 'now'
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
  // Keys already marked this visit (the save is on its way), and rewards you just bought:
  // a repeatable one that is still ready after a buy is not "newly ready".
  const marked = useRef(new Set<string>())
  const bought = useRef(new Set<number>())
  useEffect(() => {
    if (!insights || !locks) return
    const seen = new Set([...insights.readySeen, ...marked.current])
    const all = readyList.filter((r) => !seen.has(readyKey(r.id, state.buys?.[r.id]?.length ?? 0)))
    if (!all.length) return
    const keys = all.map((r) => readyKey(r.id, state.buys?.[r.id]?.length ?? 0))
    for (const k of keys) marked.current.add(k)
    const fresh = all.filter((r) => !bought.current.has(r.id))
    const quiet = !insights.readySeen.length && !announced.current
    announced.current = true
    void life.shop.markReady?.(keys).then(reload).catch(() => {})
    if (quiet || !fresh.length) return
    setJustReady(new Set(fresh.map((r) => r.id)))
    play('remindReward')
    toast(fresh.length === 1 ? `${rewardEmoji(fresh[0])} ${fresh[0].title} is ready` : `${fresh.length} rewards are ready`, 'good')
    const t = setTimeout(() => setJustReady(new Set()), 1600)
    return () => clearTimeout(t)
  }, [insights, locks, readyList.map((r) => r.id).join(',')])

  // Rewards 2: a lock that just opened plays its unlock once (per device, per week for weekly deeds).
  useEffect(() => {
    if (!locks) return
    const week = more?.activity.week ?? ''
    const seen = new Set(readSeen())
    const fresh = live.filter((r) => {
      const st = locks.states[String(r.id)]
      return st?.met && !seen.has(`${r.id}:${week}`)
    })
    if (!fresh.length) return
    try {
      localStorage.setItem(UNLOCK_SEEN, JSON.stringify([...seen, ...fresh.map((r) => `${r.id}:${week}`)].slice(-200)))
    } catch {
      /* a convenience only */
    }
    if (stillMode()) return
    setUnlocking(new Set(fresh.map((r) => r.id)))
    play('levelUp')
    toast(fresh.length === 1 ? `🔓 ${fresh[0].title} unlocked: you did the work` : `🔓 ${fresh.length} rewards unlocked`, 'good')
    const t = setTimeout(() => setUnlocking(new Set()), 1800)
    return () => clearTimeout(t)
  }, [locks, more?.activity.week, live.map((r) => r.id).join(',')])

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
    bought.current.add(r.id)
    celebrate(el, 'reward')
    play('reward')
    setJustBought(r.title)
    if (!stillMode()) setUnwrap({ emoji: rewardEmoji(r), title: `${r.title}: yours`, n: Date.now() })
    window.setTimeout(() => play('coin'), 260)
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
  // Points-only fix: old reward buys in Finance as spending leave only after a yes.
  const removeRewardMoney = async (ids?: string[]): Promise<boolean> => {
    if (!life.shop.removeRewardMoney) return false
    const one = ids?.length === 1
    const ok = await askConfirm(one ? 'Remove this reward entry from Finance? The buy stays in your History and its points stay spent.' : 'Remove all reward entries from Finance? They were bought with points, not real money. The buys stay in your History and their points stay spent.', { ok: one ? 'Remove it' : 'Remove all' })
    if (!ok) return false
    const r = await act(() => life.shop.removeRewardMoney!(ids))
    if (!r) return false
    toast(`Removed ${r.removed} reward entr${r.removed === 1 ? 'y' : 'ies'} from Finance (${Math.round(r.lei)} lei)`, 'good')
    void reload()
    return true
  }
  const setBudget = async (lei: number) => {
    if (!life.shop.setFunBudget) return
    const v = await act(() => life.shop.setFunBudget({ lei, source: 'manual' }), 'Monthly budget saved')
    if (v) setShopValue(v)
  }
  // An empty shelf: add its starter items one by one (never touches rewards you already have).
  const stock = async (id: ShelfId) => {
    setStocking(true)
    try {
      const have = new Set(live.map((r) => r.title.trim().toLowerCase()))
      let last: ShopState | null = null
      for (const it of STARTERS[id]) {
        if (have.has(it.title.toLowerCase())) continue
        last = await life.shop.save({ title: it.title, price: it.price, tier: 'bronze', realCost: it.realCost, pinned: false, note: it.note, emoji: it.emoji, category: it.category, currency: state.currency || 'MDL' })
      }
      if (last) {
        onState(last)
        toast('Starter items added: change names and prices any time', 'good')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add them', 'bad')
    } finally {
      setStocking(false)
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
  const openChest = async (level: number) => {
    const r = await act(async () => (life.shop.openChestPrize ? life.shop.openChestPrize(level) : life.shop.openChest(level).then((x) => ({ prize: { kind: 'coins' as const, coins: x.coins }, state: x.state }))))
    if (!r) return
    play('levelUp')
    setReveal({ prize: r.prize, box: 'chest' })
    onState(r.state)
    onWallet()
  }
  const openMystery = async () => {
    if (!life.shop.claimMystery) return
    const r = await act(() => life.shop.claimMystery!())
    if (!r) return
    play('levelUp')
    setReveal({ prize: r.prize, box: 'mystery' })
    onState(r.state)
    reload()
  }
  const addSuggestion = async (key: string) => {
    if (!life.shop.addSuggestion) return
    const s = await act(() => life.shop.addSuggestion!(key), 'Added to your rewards')
    if (!s) return
    onState(s)
    reloadLocks()
    reload()
  }
  const hideSuggestion = async (key: string) => {
    if (!life.shop.hideSuggestion) return
    const m = await act(() => life.shop.hideSuggestion!(key))
    if (m) setMore(m)
  }
  const saveRules = async (id: number, rules: RewardRules | null) => {
    if (!life.shop.setRules) return false
    const s = await act(() => life.shop.setRules!(id, rules), rules ? 'Limits saved' : 'Limits removed')
    if (s) onState(s)
    return !!s
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
    if (locks) items.push({ label: locks.locks[String(r.id)] ? 'Change lock' : 'Unlock by doing…', run: () => setLocking(locking === r.id ? null : r.id) })
    if (life.shop.setRules) items.push({ label: state.rules?.[String(r.id)] ? 'Change healthy limits' : 'Healthy limits…', run: () => setRuling(ruling === r.id ? null : r.id) })
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
      {ruling === r.id && <RulesEditor cur={state.rules?.[String(r.id)]} onSave={(x) => saveRules(r.id, x)} onDone={() => setRuling(null)} />}
      {jarFor === r.id && <JarEditor r={r} balance={state.balance} onPut={(n) => void jar(r, n)} onTake={(n) => void jar(r, n, true)} onClose={() => setJarFor(null)} />}
    </>
  )

  const card = (r: Reward, draggable = false, compact = false, pick = false) => (
    <RewardCard
      key={r.id}
      pick={pick}
      compact={compact}
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
    let xs = sorted(live)
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
  const lockedIds = new Set(Object.keys(locks?.locks ?? {}).map(Number))
  const lockedList = live.filter((r) => lockedIds.has(r.id)).sort((a, b) => Number(!!locks?.states[String(a.id)]?.met) - Number(!!locks?.states[String(b.id)]?.met))
  const counts: Record<Tab, number> = { now: readyList.length, unlock: lockedList.filter((r) => !locks?.states[String(r.id)]?.met).length, all: live.length, history: state.recent.filter((x) => !x.undone).length, earn: 0 }
  const readyNow = [...readyList, ...[...flipping.values()].filter((r) => !readyList.some((x) => x.id === r.id))]
  // The next reward you'll have at your pace: the closest one only points stand between.
  const next: NextUp | null = (() => {
    const waiting = live.filter((r) => {
      const i = infos.get(r.id)!
      return i.blocked && i.left > 0 && !(i.lock && !i.lock.met)
    })
    // The main goal has its own row in "Saving for": the small box names a different reward.
    const mainId = goals[0]?.id
    const pick = waiting.filter((r) => r.id !== mainId).sort((a, b) => infos.get(a.id)!.left - infos.get(b.id)!.left)[0] ?? readyList.find((r) => r.id !== mainId)
    if (!pick) return null
    const left = infos.get(pick.id)!.left
    return { reward: pick, line: !infos.get(pick.id)!.blocked ? 'Ready now' : readyLine(today, left, perDay) ?? `${left.toLocaleString()} to go` }
  })()
  const shelves = Object.fromEntries(SHELVES.map((sh) => [sh.id, [] as Reward[]])) as Record<ShelfId, Reward[]>
  for (const r of live) shelves[shelfOf(r)].push(r)
  for (const id of Object.keys(shelves) as ShelfId[]) shelves[id].sort((a, b) => Number(!!infos.get(a.id)!.blocked) - Number(!!infos.get(b.id)!.blocked) || a.price - b.price)
  const featured = featuredPick(live.filter((r) => !r.goalRank), today)
  if (featured) shelves[shelfOf(featured)].sort((a, b) => Number(b.id === featured.id) - Number(a.id === featured.id))
  const pickShelf = featured ? shelfOf(featured) : null
  const shelfOpen = new Set<ShelfId>(openShelves ?? [...(pickShelf ? [pickShelf] : []), ...SHELVES.map((sh) => sh.id).filter((id) => id !== pickShelf && shelves[id].length > 0)].slice(0, 1))
  const toggleShelf = (id: ShelfId) => {
    const next = new Set(shelfOpen)
    if (!next.delete(id)) next.add(id)
    setOpenShelves([...next])
    try {
      localStorage.setItem('ls.rw.shelves', JSON.stringify([...next]))
    } catch {
      /* a convenience only */
    }
  }
  const [ideasOpen, setIdeasOpen] = useState(() => {
    try {
      return localStorage.getItem('ls.rw.ideas') === '1'
    } catch {
      return false
    }
  })
  const toggleIdeas = () => {
    setIdeasOpen(!ideasOpen)
    try {
      localStorage.setItem('ls.rw.ideas', ideasOpen ? '0' : '1')
    } catch {
      /* a convenience only */
    }
  }
  const benText = more?.pace.line ?? ben

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

      <WalletHero balance={state.balance} insights={insights} value={value} next={next} hideEmptyNext={!!goal} coupons={coupons.length} onFun={(m) => void fun(m)} onHow={() => setHow(true)} onAdd={() => setSheet('new')} ben={<BenLine text={benText} />} />

      <div className="sh-top">
        <SavingFor goals={goals} balance={state.balance} perDay={perDay} today={today} onAll={() => setTab('all')} />
        <Combo days={insights?.focusStreak ?? 0} />
        <BudgetMeter spent={shopValue?.funSpentLei ?? monthSpendLei(state.recent, today.slice(0, 7))} budget={shopValue?.funBudgetLei ?? null} onSet={(n) => void setBudget(n)} />
      </div>
      <RewardMoneyFix onRemove={removeRewardMoney} />

      <div className="rx-layout rx-one">
        <div className="rx-main">
          <Surprises chests={state.chests} mystery={more?.mystery ?? null} coupons={coupons} today={today} onChest={openChest} onMystery={openMystery} />

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

          {shownTab === 'now' && (
            <div className="rx-foryou sh-more" role="tabpanel" data-tabpanel="now">
              <div className="sh-shelves">
              {SHELVES.filter((sh) => sh.id !== 'big' || shelves[sh.id].length > 0).map((sh) => (
                <Shelf key={sh.id} id={sh.id} cards={shelves[sh.id].map((r) => card(r, false, true, r.id === featured?.id))} preview={shelves[sh.id].slice(0, 4).map((r) => rewardEmoji(r)).join(' ')} open={shelfOpen.has(sh.id)} onToggle={() => toggleShelf(sh.id)} adding={stocking} onStarter={(id) => void stock(id)} onAdd={() => setSheet('new')} />
              ))}
              {more && more.suggestions.length > 0 && (
                <section className={`rx-sec sh-shelf ${ideasOpen ? 'open' : 'shut'}`}>
                  <header>
                    <button type="button" className="sh-shelf-head" aria-expanded={ideasOpen} onClick={toggleIdeas}>
                      <span className="sh-chev" aria-hidden>{ideasOpen ? '▾' : '▸'}</span>
                      <h3>Suggested for you</h3>
                      <span className="rx-sub">{more.suggestions.length} ideas from what you did this week</span>
                    </button>
                  </header>
                  {ideasOpen && <SuggestRow list={more.suggestions} onAdd={addSuggestion} onHide={(k) => void hideSuggestion(k)} title="Suggested for you" />}
                </section>
              )}
              </div>
            </div>
          )}

          {shownTab === 'unlock' && (
            <div className="rx-unlock" role="tabpanel" data-tabpanel="unlock">
              <p className="rx-sub rx-unlock-intro">These open when you really did it: a workout streak, hours of focus, nights on time. Your points still count; only the buy waits.</p>
              {lockedList.length ? (
                <div className="rx-grid">{lockedList.map((r) => card(r))}</div>
              ) : (
                <div className="rx-slim-empty">
                  <span>No reward is locked yet. Add an idea below, or use any card's ⋯ menu → "Unlock by doing…".</span>
                </div>
              )}
              {more && <SuggestRow list={more.unlockIdeas} onAdd={addSuggestion} onHide={(k) => void hideSuggestion(k)} title="Ideas to unlock by doing" sub="Each one comes with its lock" />}
            </div>
          )}

          {shownTab === 'all' && (
            <div className="rx-all" role="tabpanel" data-tabpanel="all">
              <AffordRow rewards={live} balance={state.balance} perDay={perDay} onPick={setOnly} />
              {usedCats.length > 1 && !only && (
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
              {!list.length && (
                <div className="rx-empty">
                  <b>No rewards yet</b>
                  <span>Add something you really want, or pick one from Suggested for you.</span>
                  <button type="button" className="rx-btn primary" onClick={() => setSheet('new')}>
                    + Add a reward
                  </button>
                </div>
              )}
              <div className="rx-grid">{list.map((r) => card(r, !cat && !only))}</div>
              {life.shop.reorder && live.length > 1 && <p className="rx-sub rx-drag-hint">Drag a card to change the order.</p>}
            </div>
          )}

          {shownTab === 'history' && (
            <div role="tabpanel" data-tabpanel="history">
              <History recent={state.recent} currency={state.currency} onUndo={life.shop.undoBuy ? (id, t) => void undoBuy(id, t) : null} />
            </div>
          )}

          {shownTab === 'earn' && (
            <div className="rx-earn" role="tabpanel" data-tabpanel="earn">
              {more && <PointsFrom a={more.activity} />}
              <div className="rx-earn-col">
                {insights && <Challenge c={insights.challenge} onClaim={() => void claimChallenge()} />}
                {more && <MysteryCard m={more.mystery} />}
              </div>
              {quests && <Quests q={quests} onClaim={() => void claimQuests()} />}
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
      {unwrap && <Unwrap key={unwrap.n} emoji={unwrap.emoji} title={unwrap.title} onDone={() => setUnwrap(null)} />}
      {reveal && <Reveal prize={reveal.prize} box={reveal.box} onClose={() => setReveal(null)} />}
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
