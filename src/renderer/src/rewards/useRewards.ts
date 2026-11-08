// The Rewards page's live data: the insights (graph, streak, challenge,
// badges), today's quests, and what a point is worth. Reloads whenever points
// move anywhere in the app.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuestState, ShopState, ShopValue } from '@shared/api'
import type { RewardsInsights } from '../../../main/shop'
import type { RewardsMore } from '../web/rewardsMore'
import { pointValue, type PointValue } from '@core/pointValue'
import { life } from '../bridge'
import { reducedMotion } from '../motionKit'

export interface ValueInfo {
  value: PointValue
  /** Lei you earn an hour of work, when known (for "≈ 3 h of your work"). */
  hourlyLei: number | null
}


export function useRewardsData(state: ShopState) {
  const [insights, setInsights] = useState<RewardsInsights | null>(null)
  const [quests, setQuests] = useState<QuestState | null>(null)
  const [remote, setRemote] = useState<ShopValue | null>(null)
  const [more, setMore] = useState<RewardsMore | null>(null)
  const load = useCallback(() => {
    life.shop.more?.().then(setMore).catch(() => {})
    life.shop.insights?.().then(setInsights).catch(() => {})
    life.wallet.quests().then(setQuests).catch(() => {})
    // What a point is worth (from your fun budget); if it can't be read, the
    // shared formula from your usual earning.
    life.shop.value?.().then(setRemote).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('life-wallet-changed', load)
    return () => window.removeEventListener('life-wallet-changed', load)
  }, [load])
  // The page's own changes (a buy, a save) refresh the numbers too.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    load()
  }, [state.balance, state.rewards.length, load])
  const value: ValueInfo = remote?.value
    ? { value: remote.value, hourlyLei: remote.hourlyLei ?? null }
    : { value: pointValue({ funBudgetLei: null, earnPerDay: state.earnPerDay ?? 0 }), hourlyLei: null }
  return { insights, quests, value, shopValue: remote, setShopValue: setRemote, more, setMore, reload: load }
}

/** Calm mode or "reduce motion": the page stays still (no flying coins, no flips). */
export const stillMode = () => reducedMotion() || (typeof document !== 'undefined' && document.documentElement.classList.contains('calm'))

/**
 * A bar that grows from the last value you saw (RW8): it first draws at the
 * remembered fraction, then moves to the new one on the next frame (the
 * bar's own transform transition does the rest). Remembered per device.
 */
export function useGrowFrom(key: string, value: number): number {
  const store = `ls.rw.seen.${key}`
  const [shown, setShown] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(store)
      const v = Number(raw)
      return raw != null && Number.isFinite(v) ? v : 0
    } catch {
      return value
    }
  })
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(value))
    try {
      localStorage.setItem(store, String(value))
    } catch {
      /* a convenience only */
    }
    return () => cancelAnimationFrame(raf)
  }, [store, value])
  return shown
}
