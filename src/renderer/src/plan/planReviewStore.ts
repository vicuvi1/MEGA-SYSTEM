// The end-of-day check's records on this page (synced setting plan_review):
// one copy for the check, the plan card's "Yesterday's plan" line and the Week
// tab's trend, read once and kept fresh after a save or an outside change.
import { useEffect, useState } from 'react'
import { EMPTY_REVIEW, type ReviewItem, type ReviewStore } from '@core/planReview'
import { life } from '../bridge'

let cache: ReviewStore | null = null
let loading: Promise<ReviewStore | null> | null = null
const subs = new Set<(s: ReviewStore) => void>()
const tell = (s: ReviewStore) => {
  cache = s
  for (const f of subs) f(s)
}

export function loadReview(force = false): Promise<ReviewStore | null> {
  if (cache && !force) return Promise.resolve(cache)
  if (!life.coach?.planReview) return Promise.resolve(null)
  if (!loading || force)
    loading = life.coach
      .planReview()
      .then((s) => (tell(s), s))
      .catch(() => null)
      .finally(() => (loading = null))
  return loading
}

/** Saves one block's mark (or takes it back) and tells every card on screen. */
export async function saveReview(patch: { day: string; item?: ReviewItem; drop?: string }): Promise<ReviewStore | null> {
  if (!life.coach?.planReview) return null
  const s = await life.coach.planReview(patch)
  tell(s)
  return s
}

/** The records (empty until read, and when this app has no store for them). */
export function useReview(): ReviewStore {
  const [s, set] = useState<ReviewStore>(cache ?? EMPTY_REVIEW)
  useEffect(() => {
    subs.add(set)
    void loadReview()
    const again = () => void loadReview(true)
    window.addEventListener('life-external-changed', again)
    return () => {
      subs.delete(set)
      window.removeEventListener('life-external-changed', again)
    }
  }, [])
  return s
}

export function _resetReview() {
  cache = null
  loading = null
}
