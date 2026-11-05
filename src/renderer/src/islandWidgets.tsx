// The desktop island's live widgets and small motions: Ben's thinking wave
// (IM3), the celebration pill (IM4), jelly drag (IM6), the snap ghost and
// bounce (IM7), leaning toward the mouse (IM11, IM12), the evening story
// (IC14), the stack of live things (IC15) and the pill's edit mode (IC17).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, Reorder, animate, motion, type MotionValue } from 'framer-motion'
import { PILL_LABEL, type Activity, type IslandRecap, type PillItem } from '@core/islandModel'
import { recapLine, type Moment } from '@core/islandMoments'
import { CountUp, Glass, Roll, TypeIn } from './IslandScenes'
import { useFeel, wavePath, type Feel } from './islandFeel'
import { tp } from './islandTap'

// ---- IM3: Ben thinking ----
const WAVE = wavePath(60, 2.6, 9)
const WAVE2 = wavePath(30, 1.8, 9)
/** A slow wave (the water's) while Ben thinks; it slides with transform only. */
export function ThinkWave({ width = 34 }: { width?: number }) {
  return (
    <span className="di-think" style={{ width }} aria-hidden>
      <svg viewBox="0 -4 120 13" preserveAspectRatio="none">
        <path d={WAVE2} className="w2" transform="translate(0 1) scale(2 1)" />
        <path d={WAVE} className="w1" transform="translate(0 2)" />
      </svg>
    </span>
  )
}
/**
 * IM3: Ben's part of the panel: the wave and what he is doing while he
 * thinks, then his first words fading in as they arrive.
 */
export function BenThinking({ busy, step, last, onReply }: { busy: boolean; step?: string; last?: { text: string; at: string } | null; onReply: () => void }) {
  const f = useFeel()
  const text = last?.text.replace(/<[^>]+>/g, '') ?? ''
  // Only words that arrive after the wave was showing type in; an old line just shows.
  const waited = useRef(false)
  if (busy) waited.current = true
  const typeIn = waited.current && !busy
  return (
    <AnimatePresence mode="wait" initial={false}>
      {busy ? (
        <motion.p key="wave" className="di-thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: f.mode === 'off' ? 0 : 0.18 } }}>
          <ThinkWave />
          <em>{step ?? 'thinking'}…</em>
        </motion.p>
      ) : (
        <motion.div key={`said:${last?.at ?? ''}`} className="di-ben-said" initial={{ opacity: 0, y: f.moves ? 4 : 0 }} animate={{ opacity: 1, y: 0 }} transition={f.fadeIn}>
          {text && <p className="di-last">{typeIn ? <TypeIn text={text} /> : text}</p>}
          <button className="di-reply" {...tp('reply', onReply)}>Reply</button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---- IM4: a celebration ----
/** The pill stretched wide for a moment: "All 3 done". */
export function MomentPill({ m }: { m: Moment }) {
  const f = useFeel()
  return (
    <div className={`di-pill di-moment kind-${m.kind}`} role="status" aria-live="polite">
      <motion.span className="di-moment-ico" initial={f.moves ? { scale: 0.3, rotate: -30 } : false} animate={{ scale: 1, rotate: 0 }} transition={f.drop}>
        {m.icon}
      </motion.span>
      <motion.b className="di-moment-text" initial={f.moves ? { opacity: 0, x: 8 } : false} animate={{ opacity: 1, x: 0 }} transition={{ ...f.fadeIn, delay: 0.12 }}>
        {m.text}
      </motion.b>
    </div>
  )
}

// ---- IM6: jelly drag ----
/** How much the island stretches for a drag speed (px/s): at most 6 %, mostly along the way it moves (pure: tested). */
export function jellyScale(vx: number, vy: number, max = 0.06): { sx: number; sy: number } {
  const k = 1 / 2600
  const ax = Math.min(max, Math.abs(vx) * k)
  const ay = Math.min(max, Math.abs(vy) * k)
  // Stretch along the move, a little thinner across it.
  return { sx: 1 + ax - ay * 0.5, sy: 1 + ay - ax * 0.5 }
}
/** IM6: follows the pointer's speed while dragging; springs back when you let go. */
export function makeJelly(jx: MotionValue<number>, jy: MotionValue<number>, f: () => Feel) {
  let last: { x: number; y: number; t: number } | null = null
  let vx = 0
  let vy = 0
  return {
    move(ev: { screenX: number; screenY: number }) {
      if (!f().moves) return
      const t = performance.now()
      if (last && t > last.t) {
        const dt = (t - last.t) / 1000
        // Smoothed, so one jumpy event doesn't wobble it.
        vx = vx * 0.6 + ((ev.screenX - last.x) / dt) * 0.4
        vy = vy * 0.6 + ((ev.screenY - last.y) / dt) * 0.4
        const s = jellyScale(vx, vy)
        jx.set(s.sx)
        jy.set(s.sy)
      }
      last = { x: ev.screenX, y: ev.screenY, t }
    },
    end() {
      last = null
      vx = 0
      vy = 0
      if (jx.get() === 1 && jy.get() === 1) return
      const spring = f().moves ? { type: 'spring' as const, stiffness: 520, damping: 11 } : { duration: 0 }
      animate(jx, 1, spring)
      animate(jy, 1, spring)
    }
  }
}

// ---- IM7: the snap ghost and the bounce ----
const SPOT_LABEL: Record<string, string> = { 'top-left': '↖ Top left', top: '↑ Top center', 'top-right': '↗ Top right', left: '⇤ Docks left', right: '⇥ Docks right', free: '✥ Stays here' }
/** While you drag: where it will snap to. */
export function SnapGhost({ spot }: { spot: string | null }) {
  const f = useFeel()
  return (
    <AnimatePresence>
      {spot && (
        <motion.span key="ghost" className={`di-ghost spot-${spot}`} initial={{ opacity: 0, y: f.moves ? -4 : 0 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={f.pop} aria-live="polite">
          <i className="di-ghost-pill" aria-hidden />
          {SPOT_LABEL[spot] ?? spot}
        </motion.span>
      )}
    </AnimatePresence>
  )
}
/** IM7: after the window jumped to its spot, the island plays the last bit of the way with a bounce (Full). */
export function snapBounceIn(el: HTMLElement | null, b: { dx: number; dy: number }, f: Feel) {
  if (!el || !f.moves || typeof el.animate !== 'function' || (!b.dx && !b.dy)) return
  const at = (k: number) => `${(b.dx * k).toFixed(1)}px ${(b.dy * k).toFixed(1)}px`
  el.animate([{ translate: at(1) }, { translate: at(-0.14), offset: 0.55 }, { translate: at(0.05), offset: 0.8 }, { translate: '0px 0px' }], { duration: 620, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', composite: 'replace' })
}

// ---- IM11, IM12: leaning toward the mouse ----
/** The lean (CSS px) for the pointer's offset: 2–3 px toward it, a little less up and down (pure: tested). */
export function leanFor(near: { dx: number; dy: number } | null, max = 3): { x: number; y: number } {
  if (!near) return { x: 0, y: 0 }
  const len = Math.hypot(near.dx, near.dy) || 1
  const k = Math.min(1, len / 60)
  return { x: Number(((near.dx / len) * max * k).toFixed(2)), y: Number(((near.dy / len) * max * 0.6 * k).toFixed(2)) }
}

// ---- IC14: the evening story ----
/** How long each part of the story shows (ms), and all of it. */
export const RECAP_STEP_MS = 2500
export const RECAP_MS = RECAP_STEP_MS * 4
/**
 * IC14: the day told in ~10 seconds: the must-dos counting up, the glass
 * filling, the focus minutes rolling, then all three together. Tap to skip
 * to the end. Off: the end at once.
 */
export function EveningScene({ recap }: { recap: IslandRecap }) {
  const f = useFeel()
  const [step, setStep] = useState(f.mode === 'off' ? 3 : 0)
  useEffect(() => {
    if (step >= 3) return
    const t = window.setTimeout(() => setStep((s) => Math.min(3, s + 1)), RECAP_STEP_MS)
    return () => clearTimeout(t)
  }, [step])
  const pct = recap.waterTarget ? recap.waterMl / recap.waterTarget : 0
  const part = (k: number, node: ReactNode) => (
    <motion.div key={k} className="ev-part" initial={f.moves ? { opacity: 0, y: 10, scale: 0.96 } : { opacity: 0 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={f.moves ? { opacity: 0, y: -8 } : { opacity: 0 }} transition={f.pop}>
      {node}
    </motion.div>
  )
  return (
    <div className="sc ev-scene" role="img" aria-label={recapLine(recap)} {...tp('recap:skip', () => setStep(3))} title="Tap to skip">
      <AnimatePresence mode="wait" initial={false}>
        {step === 0 && part(0, <><b className="ev-big"><CountUp value={recap.mustDone} />/{recap.mustTotal || 0}</b><small>must-dos done</small></>)}
        {step === 1 && part(1, <><Glass pct={pct} size={44} label={false} /><small><Roll text={(recap.waterMl / 1000).toFixed(1)} up /> L of water</small></>)}
        {step === 2 && part(2, <><b className="ev-big"><Roll text={String(recap.focusMin)} up /> min</b><small>of focus{recap.focusGoal ? ` · goal ${recap.focusGoal}` : ''}</small></>)}
        {step === 3 && part(3, (
          <div className="ev-all">
            <span><b>{recap.mustDone}/{recap.mustTotal || 0}</b><small>must-dos</small></span>
            <span><b>{(recap.waterMl / 1000).toFixed(1)} L</b><small>water</small></span>
            <span><b>{recap.focusMin}m</b><small>focus</small></span>
            {!!recap.streak && <span><b>🔥{recap.streak}</b><small>streak</small></span>}
          </div>
        ))}
      </AnimatePresence>
      <span className="ev-dots" aria-hidden>
        {[0, 1, 2, 3].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}
      </span>
    </div>
  )
}

// ---- IC15: the stack of live things ----
/**
 * IC15: three or more live things: the others sit as a small stack beside
 * the pill and fan out on hover; a click on one makes it the pill. Each is
 * clickable (data-hot), so the click area follows them.
 */
export function LiveStack({ items, open, side, icon, onPick, onMoved }: { items: Activity[]; open: boolean; side: 1 | -1; icon: (a: Activity) => ReactNode; onPick: (key: string) => void; onMoved: (done: boolean) => void }) {
  const f = useFeel()
  const step = 38
  return (
    <span className={`di-stack ${open ? 'open' : ''}`}>
      {items.map((a, i) => {
        const fanned = { x: side * i * step, y: 0, scale: 1, opacity: 1 }
        const stacked = { x: side * i * 7, y: i * 2, scale: 1 - i * 0.12, opacity: 1 - i * 0.2 }
        return (
          <motion.button
            key={a.key}
            data-hot
            className={`di-bubble di-stack-b kind-${a.kind}`}
            style={{ zIndex: items.length - i }}
            title={a.kind === 'next' ? `Next: ${a.text}` : a.text}
            aria-label={`Show ${a.kind === 'timer' ? `the timer: ${a.sub}` : a.text}`}
            initial={f.moves ? { opacity: 0, scale: 0.3, x: side * -24 } : { opacity: 0 }}
            animate={open || !f.moves ? fanned : stacked}
            exit={f.moves ? { opacity: 0, scale: 0.3 } : { opacity: 0 }}
            transition={f.moves ? { ...f.pop, delay: open ? i * 0.04 : (items.length - 1 - i) * 0.03 } : f.pop}
            onAnimationStart={() => onMoved(false)}
            onAnimationComplete={() => onMoved(true)}
            {...tp(`stack:${a.key}`, () => onPick(a.key))}
          >
            {icon(a)}
          </motion.button>
        )
      })}
    </span>
  )
}

// ---- IC17: edit the pill like a phone's home screen ----
/**
 * IC17: in the open panel: the pill's items wobble; drag to reorder, tap the
 * dot to show or hide one. Saved to your island settings (pillOrder) as you go.
 */
export function PillEditor({ order, onChange, onDone }: { order: { id: PillItem; on: boolean }[]; onChange: (o: { id: PillItem; on: boolean }[]) => void; onDone: () => void }) {
  const f = useFeel()
  const [items, setItems] = useState(order)
  const saveT = useRef(0)
  useEffect(() => setItems(order), [order])
  const commit = (next: { id: PillItem; on: boolean }[]) => {
    setItems(next)
    clearTimeout(saveT.current)
    saveT.current = window.setTimeout(() => onChange(next), 350)
  }
  useEffect(() => () => clearTimeout(saveT.current), [])
  return (
    <section className={`di-edit ${f.moves ? 'wobbly' : ''}`} aria-label="Edit what the pill shows">
      <div className="di-edit-top">
        <span className="di-label">The pill · drag to reorder, tap to show or hide</span>
        <button className="primary" {...tp('edit:done', () => (clearTimeout(saveT.current), onChange(items), onDone()))}>Done</button>
      </div>
      <Reorder.Group axis="y" values={items} onReorder={commit} className="di-edit-list" as="ul">
        {items.map((x, i) => (
          <Reorder.Item key={x.id} value={x} className={`di-edit-item ${x.on ? 'on' : 'off'}`} style={{ ['--i' as string]: i }} as="li">
            <span className="di-edit-wob">
              <span className="di-edit-grip" aria-hidden>⋮⋮</span>
              <span className="di-edit-name">{PILL_LABEL[x.id]}</span>
            </span>
            <button className={`di-edit-toggle ${x.on ? 'on' : ''}`} aria-label={x.on ? `Hide ${PILL_LABEL[x.id]}` : `Show ${PILL_LABEL[x.id]}`} {...tp(`edit:${x.id}`, () => commit(items.map((y) => (y.id === x.id ? { ...y, on: !y.on } : y))))}>
              {x.on ? '−' : '+'}
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </section>
  )
}
