// The Body boost data on this device (life.coach.bodyPlus), refreshed when
// the body log changes anywhere (this page, Today, the island, Telegram via
// the live sync).
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import type { BodyPlusView } from '../../../main/bodyPlus'

const EVENTS = ['life-body-changed', 'life-sport-changed', 'life-external-changed', 'life-water-changed']

export function useBodyPlus(): [BodyPlusView | null, (v: BodyPlusView) => void, () => void] {
  const [v, setV] = useState<BodyPlusView | null>(null)
  const load = useCallback(() => {
    life.coach?.bodyPlus
      ?.view()
      .then(setV)
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [load])
  return [v, setV, load]
}

/** Soreness you tapped today (this device only; 1 fresh … 5 very sore). */
export const SORE_KEY = 'ls.soreness'
export function readSoreness(day: string): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(SORE_KEY) || 'null')
    return v && v.day === day ? Number(v.v) : null
  } catch {
    return null
  }
}
