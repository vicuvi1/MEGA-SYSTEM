import { useMoneyHidden } from './privacy'

/** "12 lei left" for the island: dots while money amounts are hidden (money/privacy.ts). */
export function IslandMoneyLeft({ left }: { left: number }) {
  const hidden = useMoneyHidden()
  return <>💸 {hidden ? '••••' : Math.round(Math.abs(left) / 100)} lei {left >= 0 ? 'left' : 'over'}</>
}
