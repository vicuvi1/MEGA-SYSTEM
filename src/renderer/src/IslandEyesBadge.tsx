// Island eyes on the island (EY6): a small eye under the pill while an eye
// is reading (it glows), while the eyes are paused (crossed out), or when
// you're on the island. Tap it: Read screen (EY2), Caption (EY3), and the big
// Pause button (1 hour, or until you resume) / Resume. Shown only when the
// eyes are on in Settings → Island eyes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pauseLabel, type PauseChoice } from '@core/eyesGuard'
import type { EyesState } from '../../shared/eyes'
import { onEyesState } from './eyesState'
import { tp } from './islandTap'
import './islandEyes.css'

const WHAT: Record<string, string> = { read: 'Reading the window…', ocr: 'Reading the screen…', caption: 'Looking at the window…' }

export function IslandEyesBadge({ near, onLayout }: { near: boolean; onLayout: () => void }) {
  const eyes = window.desktop?.eyes
  const [s, setS] = useState<EyesState | null>(null)
  const [open, setOpen] = useState(false)
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!eyes) return
    void eyes.get().then((i) => i && setS(i), () => {})
    return onEyesState(setS)
  }, [eyes])
  // A result line shows for a moment.
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(''), 4500)
    return () => clearTimeout(t)
  }, [said])
  const on = !!s?.prefs.on && s.windows
  const paused = !!s && s.pausedUntil > Date.now()
  const reading = s?.reading ?? null
  const shown = on && (near || open || !!reading || paused || !!said)
  // The island's click area follows what's shown.
  const layout = useRef(onLayout)
  layout.current = onLayout
  useLayoutEffect(() => {
    layout.current()
  }, [shown, open, said, reading])
  useEffect(() => {
    if (!near && !said) setOpen(false)
  }, [near, said])
  if (!eyes || !shown || !s) return null
  const pause = (c: PauseChoice) => {
    setOpen(false)
    void eyes.pause(c).then((x) => x && setS({ ...s, ...x }), () => {})
  }
  const run = async (what: 'read' | 'caption') => {
    setOpen(false)
    const r = await (what === 'read' ? eyes.readScreen() : eyes.captionNow()).catch(() => ({ ok: false, said: 'Did not work' }))
    setSaid(r.said || (r.ok ? 'Done' : ''))
  }
  const label = reading ? WHAT[reading] : paused ? pauseLabel(s.pausedUntil, Date.now()) : 'Island eyes'
  return (
    <div className="di-eyes" data-hot>
      <button className={`di-eye ${reading ? 'reading' : ''} ${paused ? 'paused' : ''}`} aria-label={label} title={s.last && !paused ? `Last: ${s.last.summary}` : label} {...tp('eyes:open', () => setOpen((v) => !v))}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          {paused && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="2" />}
        </svg>
        {(reading || paused) && <span>{label}</span>}
      </button>
      {open && (
        <div className="di-eyes-menu" role="menu">
          {paused ? (
            <button role="menuitem" className="primary" {...tp('eyes:resume', () => pause('resume'))}>Resume the eyes</button>
          ) : (
            <>
              <button role="menuitem" {...tp('eyes:read', () => void run('read'))} disabled={!!reading}>Read screen</button>
              {s.prefs.caption && s.model.state === 'ready' && <button role="menuitem" {...tp('eyes:caption', () => void run('caption'))} disabled={!!reading}>Caption</button>}
              <button role="menuitem" className="big" {...tp('eyes:pause1h', () => pause('1h'))}>Pause eyes · 1 h</button>
              <button role="menuitem" {...tp('eyes:pauseAll', () => pause('forever'))}>Pause until I resume</button>
            </>
          )}
        </div>
      )}
      {said && !open && <div className="di-eyes-said" role="status">{said}</div>}
    </div>
  )
}
