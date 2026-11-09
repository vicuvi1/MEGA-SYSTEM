// The Day page's one row of quick actions (core/islandDay.ts): water with its
// progress, push-ups with today's count, focus. Big targets, one tap logs
// through the island's normal actions (the change shows at once, Undo takes
// it back), a double click logs once. Your Custom Center widgets replace the
// matching button, so nothing shows twice.
import { useRef } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import { instantAllowed, pushupsOf } from '@core/islandInstant'
import type { QuickId } from '@core/islandDay'
import { tp } from '../islandTap'
import { bump, useFeel } from '../islandFeel'

export function DayQuick({ ids, s, waterMl, repN, focusMin, onLog }: { ids: QuickId[]; s: IslandSnapshot; waterMl: number; repN: number; focusMin: number; onLog: (a: IslandAction) => void }) {
  const f = useFeel()
  const last = useRef<{ key: string; at: number } | null>(null)
  if (!ids.length) return null
  const log = (key: string, a: IslandAction, el: HTMLElement) => {
    const now = Date.now()
    if (!instantAllowed(last.current, key, now)) return
    last.current = { key, at: now }
    bump(el, f)
    onLog(a)
  }
  const w = s.water
  const wp = w.target ? Math.min(1, w.ml / w.target) : 0
  const p = pushupsOf(s)
  const rep = s.reps.find((r) => r.id === p.id)
  return (
    <section className="di-quick" aria-label="Quick actions" data-quick={ids.join(' ')}>
      {ids.includes('water') && (
        <button className="di-q di-q-water" data-quick-water title={`Log ${waterMl} ml of water`} {...tp('quick:water', (t) => log('water', { kind: 'water', ml: waterMl }, t.el))}>
          <i className="di-q-fill" style={{ transform: `scaleY(${wp})` }} aria-hidden />
          <b>💧 +{waterMl}</b>
          <small>{(w.ml / 1000).toFixed(1)}{w.target ? ` / ${(w.target / 1000).toFixed(1)}` : ''} L</small>
        </button>
      )}
      {ids.includes('reps') && (
        <button className="di-q di-q-reps" title={`Log ${repN} ${p.name}`} {...tp('quick:reps', (t) => log('reps', { kind: 'reps', id: p.id, name: p.name, n: repN }, t.el))}>
          <b>💪 +{repN}</b>
          <small>{rep ? `${rep.done}${rep.target ? ` / ${rep.target}` : ''} ${p.name.toLowerCase()}` : p.name}</small>
        </button>
      )}
      {ids.includes('focus') && (
        <button className="di-q di-q-focus" title={`Start a ${focusMin} min focus${s.now && !s.now.call ? `: ${s.now.title}` : ''}`} {...tp('quick:focus', (t) => log('focus', { kind: 'start', subject: s.now && !s.now.call ? s.now.title : 'Focus', minutes: focusMin }, t.el))}>
          <b>▶ {focusMin} min</b>
          <small>Focus</small>
        </button>
      )}
    </section>
  )
}

