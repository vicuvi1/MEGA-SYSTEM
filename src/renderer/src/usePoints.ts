// Point amounts shown on screen come from the real rules (Settings → rules),
// never from numbers typed into a label. One shared load for every page.
import { useEffect, useState } from 'react'
import type { Rule } from '@core/rules'
import { life } from './bridge'

let cache: Rule[] | null = null
let loading: Promise<Rule[]> | null = null

/** pts('sleep.up_on_time', 10) → the rule's points now (the fallback until the rules load). */
export function usePoints(): (id: string, fallback: number) => number {
  const [rules, setRules] = useState<Rule[] | null>(cache)
  useEffect(() => {
    if (cache) return
    loading ??= life.rules.list().then((r) => (cache = r))
    loading.then(setRules).catch(() => {})
  }, [])
  return (id, fallback) => rules?.find((r) => r.id === id && r.enabled)?.coins ?? (rules ? 0 : fallback)
}

/** Forget the cached rules (after you edit one). */
export const resetPoints = () => {
  cache = null
  loading = null
}
