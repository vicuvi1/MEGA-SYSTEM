// Island v2: the split pill. Two live things at once share the pill: the
// main one on the left (a timer, a rest, a meeting about to start), its
// companion on the right (music, water). Each half has its own number,
// its own progress fill (transform only) and its own tap; the music half
// shows play / pause / skip and glows in the album's colour.
// Morphs between one and two halves with the island's one animation system
// (framer-motion layout, the look's "split" timing).
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LiveActivity, SplitPill as Split } from '@core/islandLive'
import { mmss } from '@core/islandLive'
import { tp } from '../islandTap'
import { useFeel } from '../islandFeel'
import { MuIcon } from '../music/MusicUi'
import type { useIslandNowPlaying } from '../IslandMusic'

type NowPlaying = NonNullable<ReturnType<typeof useIslandNowPlaying>>

/** The live number, ticked from `now` (the island's own one-second clock while something is live). */
function valueAt(a: LiveActivity, now: number): string {
  if (!a.at) return a.value
  const sec = (a.at - now) / 1000
  if (a.kind === 'timer') return a.paused ? a.value : mmss(sec)
  if (a.kind === 'workout') return `Rest ${mmss(Math.max(0, sec))}`
  if (a.kind === 'meeting') return sec > 0 && a.value !== 'now' ? `in ${mmss(sec)}` : 'now'
  if (a.kind === 'eyes') return mmss(Math.max(0, sec))
  return a.value
}

export function MediaControls({ np, compact = false }: { np: NowPlaying; compact?: boolean }) {
  const size = compact ? 12 : 15
  return (
    <span className={`v2-media ${compact ? 'compact' : ''}`} role="group" aria-label="Music controls" onPointerDown={(e) => e.stopPropagation()}>
      {!compact && (
        <button type="button" className="v2-media-b" aria-label="Previous" title="Previous" {...tp('v2:media:prev', np.prev)}>
          <MuIcon d="prev" size={size} fill />
        </button>
      )}
      <button type="button" className="v2-media-b main" aria-label={np.playing ? 'Pause' : 'Play'} title={np.playing ? 'Pause' : 'Play'} {...tp('v2:media:toggle', np.toggle)}>
        {np.playing ? (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
        ) : (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
        )}
      </button>
      <button type="button" className="v2-media-b" aria-label="Next" title="Next" {...tp('v2:media:next', np.next)}>
        <MuIcon d="next" size={size} fill />
      </button>
    </span>
  )
}

function Lobe({ side, a, now, np, onTap }: { side: 'left' | 'right'; a: LiveActivity; now: number; np: NowPlaying | null; onTap: (side: 'left' | 'right', a: LiveActivity) => void }) {
  const f = useFeel()
  const music = a.kind === 'music' && np
  return (
    <motion.span
      layout={f.moves ? 'position' : false}
      transition={f.fly}
      className={`rest-item v2-lobe v2-lobe-${side} v2-k-${a.kind} ${a.urgent ? 'urgent' : ''} ${a.paused ? 'paused' : ''}`}
      data-lobe={side}
      data-kind={a.kind}
      title={`${a.label} · ${valueAt(a, now)}`}
      {...tp(`v2:split:${side}`, () => onTap(side, a))}
    >
      {a.progress != null && <i className="v2-lobe-fill" aria-hidden style={{ transform: `scaleX(${a.progress.toFixed(3)})` }} />}
      {music && np.artwork ? <img className="v2-lobe-art" src={np.artwork} alt="" referrerPolicy="no-referrer" /> : <span className="v2-lobe-ico" aria-hidden>{a.icon}</span>}
      <span className="v2-lobe-txt">
        <span className="v2-lobe-label">{a.label}</span>
        <span className="v2-lobe-val">{valueAt(a, now)}</span>
      </span>
      {music && <MediaControls np={np} compact />}
    </motion.span>
  )
}

/** Once a second while a half counts down and the island is shown; nothing at all otherwise. */
function useSecond(on: boolean): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = window.setInterval(() => {
      if (!document.hidden) setN(Date.now())
    }, 1000)
    return () => clearInterval(t)
  }, [on])
  return on ? n : Date.now()
}

/** Both halves of the split pill (or nothing when there aren't two live things). */
export function SplitPillView({ split, np, paused = false, onTap }: { split: Split; np: NowPlaying | null; paused?: boolean; onTap: (side: 'left' | 'right', a: LiveActivity) => void }) {
  const f = useFeel()
  const now = useSecond(!paused && !!(split.left?.at || split.right?.at))
  if (!split.left || !split.right) return null
  // The album's own colour only (no made-up glow without artwork).
  const glow = split.right.kind === 'music' && np?.playing && np.fromArt ? np.rgb : null
  return (
    <span className="v2-split" data-split style={glow ? ({ ['--v2-lobe-glow' as string]: glow } as React.CSSProperties) : undefined}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={split.left.key} className="v2-half" initial={f.mode === 'off' ? false : { opacity: 0, x: f.moves ? -8 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={f.fly}>
          <Lobe side="left" a={split.left} now={now} np={np} onTap={onTap} />
        </motion.span>
      </AnimatePresence>
      <i className="v2-pinch" aria-hidden />
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={split.right.key} className="v2-half" initial={f.mode === 'off' ? false : { opacity: 0, x: f.moves ? 8 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={f.fly}>
          <Lobe side="right" a={split.right} now={now} np={np} onTap={onTap} />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
