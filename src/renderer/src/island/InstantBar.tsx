// Island v2: instant buttons and scroll-to-number counters. One click logs
// (+10 / +25 / +50 push-ups, +250 ml, start 25 min focus) through the
// island's normal tap, which shows the change at once and offers Undo.
// A counter changes with the mouse wheel (rest the mouse on it, scroll to 37,
// click to log) or the arrow keys. Nothing here pays points by itself.
import { useRef, useState } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import type { InstantId } from '@core/islandLooks'
import { instantAllowed, instantButtons, pushupsOf, scrubAction } from '@core/islandInstant'
import { SCRUB, scrubKey, scrubWheel, type ScrubKind } from '@core/islandScrub'
import { tp } from '../islandTap'
import { bump, useFeel } from '../islandFeel'

type Log = (a: IslandAction, key: string) => void

function ScrubCounter({ kind, s, onLog, guard }: { kind: ScrubKind; s: IslandSnapshot; onLog: Log; guard: (key: string) => boolean }) {
  const spec = SCRUB[kind]
  const f = useFeel()
  const [v, setVal] = useState(spec.start)
  // Wheel events can come faster than a redraw: the latest value lives in a ref too.
  const cur = useRef(spec.start)
  const setV = (n: number) => {
    cur.current = n
    setVal(n)
  }
  const acc = useRef(0)
  const what = kind === 'reps' ? pushupsOf(s).name : kind === 'water' ? 'water' : 'focus'
  const log = (el: HTMLElement) => {
    if (!guard(`scrub:${kind}`)) return
    bump(el, f)
    onLog(scrubAction(kind, cur.current, s), `scrub:${kind}`)
  }
  return (
    <button
      type="button"
      className={`v2-scrub v2-scrub-${kind}`}
      data-scrub={kind}
      data-value={v}
      title={`Scroll to change, click to log ${v} ${spec.unit === 'reps' ? what : `${spec.unit} ${what}`}`}
      aria-label={`${v} ${spec.unit} ${what}. Scroll or use the arrow keys to change, click to log`}
      onWheel={(e) => {
        e.stopPropagation()
        const r = scrubWheel(cur.current, acc.current, e.deltaY, spec, e.shiftKey)
        acc.current = r.acc
        if (r.changed) setV(r.value)
      }}
      onKeyDown={(e) => {
        const n = scrubKey(cur.current, e.key, spec)
        if (n == null) return
        e.preventDefault()
        e.stopPropagation()
        setV(n)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      {...tp(`v2:scrub:${kind}`, (t) => log(t.el))}
    >
      <span className="v2-scrub-n">{v}</span>
      <span className="v2-scrub-u">{spec.unit}</span>
      <i className="v2-scrub-arrows" aria-hidden>
        <b>▲</b>
        <b>▼</b>
      </i>
    </button>
  )
}

export function InstantBar({ s, ids, scrub, onLog }: { s: IslandSnapshot; ids: InstantId[]; scrub: boolean; onLog: Log }) {
  const f = useFeel()
  const last = useRef<{ key: string; at: number } | null>(null)
  const guard = (key: string) => {
    const now = Date.now()
    if (!instantAllowed(last.current, key, now)) return false
    last.current = { key, at: now }
    return true
  }
  const btns = instantButtons(ids, s)
  if (!btns.length) return null
  const push = btns.filter((b) => b.scrub === 'reps')
  const other = btns.filter((b) => b.scrub !== 'reps')
  const fire = (key: string, a: IslandAction, el: HTMLElement) => {
    if (!guard(key)) return
    bump(el, f)
    onLog(a, key)
  }
  return (
    <div className="v2-instant" role="group" aria-label="Log in one click" onPointerDown={(e) => e.stopPropagation()}>
      {push.length > 0 && (
        <span className="v2-instant-group">
          <span className="v2-instant-ico" title={pushupsOf(s).name} aria-hidden>💪</span>
          {push.map((b) => (
            <button key={b.id} type="button" className="v2-instant-b" data-instant={b.id} title={b.title} {...tp(`v2:instant:${b.id}`, (t) => fire(b.id, b.action, t.el))}>
              {b.label}
            </button>
          ))}
          {scrub && <ScrubCounter kind="reps" s={s} onLog={onLog} guard={guard} />}
        </span>
      )}
      {other.length > 0 && (
        <span className="v2-instant-group">
          {other.map((b) => (
            <button key={b.id} type="button" className={`v2-instant-b ${b.scrub === 'focus' ? 'focus' : 'water'}`} data-instant={b.id} title={b.title} {...tp(`v2:instant:${b.id}`, (t) => fire(b.id, b.action, t.el))}>
              {b.scrub === 'water' ? '💧 ' : ''}
              {b.label}
            </button>
          ))}
          {scrub && other.some((b) => b.scrub === 'water') && <ScrubCounter kind="water" s={s} onLog={onLog} guard={guard} />}
        </span>
      )}
    </div>
  )
}
