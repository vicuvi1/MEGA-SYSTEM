// Coins fly to the wallet (RW5): when points are earned anywhere in the app,
// a few coin dots (at most 6) fly from where you just tapped to the balance
// pill in the top bar, which gives a small bump while its number ticks up.
// Transform and opacity only (the Web Animations API, one short flight);
// nothing in calm mode, with "reduce motion" or in a hidden window. A lucky
// gift for a must-do (RG7) also gets its own toast.
import { useEffect, useRef } from 'react'
import type { LedgerEntry } from '@shared/api'
import { isExtra } from '@core/rewardsKit'
import { useToast } from '../ui'
import { stillMode } from './useRewards'
import './coinFlight.css'

const MAX_DOTS = 6
const FLIGHT_MS = 620

let lastPress: { x: number; y: number; at: number } | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPress = { x: e.clientX, y: e.clientY, at: Date.now() }), { capture: true, passive: true })
}

/** How many dots a gain gets: one per 5 points, 1 to 6. */
export const dotsFor = (gain: number) => (gain > 0 ? Math.max(1, Math.min(MAX_DOTS, Math.ceil(gain / 5))) : 0)

export function flyCoins(gain: number, to: Element | null, from?: { x: number; y: number } | null): void {
  if (typeof document === 'undefined' || document.hidden || stillMode() || !to) return
  const n = dotsFor(gain)
  if (!n) return
  const end = to.getBoundingClientRect()
  if (!end.width) return
  const start = from ?? (lastPress && Date.now() - lastPress.at < 3000 ? lastPress : { x: innerWidth / 2, y: innerHeight * 0.66 })
  const tx = end.left + Math.min(18, end.width / 2)
  const ty = end.top + end.height / 2
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('i')
    dot.className = 'rx-fly'
    dot.style.left = `${start.x - 7}px`
    dot.style.top = `${start.y - 7}px`
    document.body.appendChild(dot)
    const dx = tx - start.x
    const dy = ty - start.y
    // A gentle arc: the middle of the flight bows out to one side.
    const bow = (i % 2 ? 1 : -1) * (24 + i * 7)
    const anim = dot.animate(
      [
        { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
        { transform: `translate(${dx * 0.45 + bow}px, ${dy * 0.45 - 40}px) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.2 }
      ],
      { duration: FLIGHT_MS, delay: i * 55, easing: 'cubic-bezier(0.5, 0, 0.6, 1)', fill: 'both' }
    )
    anim.onfinish = anim.oncancel = () => dot.remove()
  }
  setTimeout(() => {
    to.classList.remove('rx-bump')
    void (to as HTMLElement).offsetWidth
    to.classList.add('rx-bump')
  }, FLIGHT_MS - 80)
}

/** Watches the balance; mounted once, next to the top bar's points pill. */
export function CoinFlight({ balance, recent }: { balance: number; recent: LedgerEntry[] }) {
  const prev = useRef<number | null>(null)
  const seenLucky = useRef<number | null>(null)
  const toast = useToast()
  useEffect(() => {
    const p = prev.current
    prev.current = balance
    if (p == null || balance <= p) return
    flyCoins(balance - p, document.querySelector('.tb-me'))
  }, [balance])
  useEffect(() => {
    const lucky = recent.find((e) => e.kind !== 'undo' && isExtra(e, 'lucky'))
    if (!lucky) return
    if (seenLucky.current == null) return void (seenLucky.current = lucky.id)
    if (lucky.id <= seenLucky.current) return
    seenLucky.current = lucky.id
    toast(`🍀 Lucky +${lucky.coins}! A small gift for finishing a must-do.`, 'good')
  }, [recent, toast])
  // First render: remember the newest lucky gift so an old one never toasts.
  useEffect(() => {
    if (seenLucky.current == null) seenLucky.current = recent.find((e) => isExtra(e, 'lucky'))?.id ?? 0
  }, [])
  return null
}
