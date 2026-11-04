// Sport Track (the embedded app) → Life System's Body log (pure, tested).

/** Sport Track's record → workout items (never empty: a session counts as one item). */
export function sportItems(w: any): { exerciseId: string; name: string; unit: string; amount: number; sets?: { reps: number; weight: number }[] }[] {
  const items = (Array.isArray(w?.items) ? w.items : [])
    .map((it: any) => ({ exerciseId: String(it?.exerciseId || it?.name || 'sport').slice(0, 60), name: String(it?.name || '').trim().slice(0, 60), unit: String(it?.unit || 'reps').slice(0, 12), amount: Math.round(Number(it?.amount) || 0), ...(Array.isArray(it?.sets) ? { sets: it.sets.slice(0, 20) } : {}) }))
    .filter((it: any) => it.name && it.amount > 0)
  if (items.length) return items.slice(0, 30)
  const n = Math.max(1, Math.round(parseFloat(String(w?.amount ?? '')) || 1))
  const unit = String(w?.amount ?? '').replace(/^[\d.\s]+/, '').trim().slice(0, 12) || 'session'
  return [{ exerciseId: 'sport_session', name: String(w?.title || 'Workout').slice(0, 60), unit, amount: n }]
}

