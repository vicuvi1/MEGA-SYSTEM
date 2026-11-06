// Faces in the chat: Ben's drawn avatar (a few looks, all original inline
// SVG, no photos of real people) with a live presence ring, and your own
// avatar (your photo, or your initials on a gradient). The looks are one
// synced setting (`coach_looks`), so every device shows the same faces.
import { useEffect, useId, useState, type CSSProperties } from 'react'
import { life } from './bridge'
import { useLive } from './live'
import { getUiPrefs } from './uiPrefs'
import { AVATAR_MAX_CHARS, DEFAULT_LOOKS, initials, type BenLook, type CoachLooks } from '@core/coachLooks'
import './benAvatar.css'

export type Presence = 'idle' | 'thinking' | 'typing'

const ACC = 'var(--accent, #c8f135)'
const mix = (pct: number, other: string) => `color-mix(in srgb, ${ACC} ${pct}%, ${other})`

/** One of Ben's looks, drawn on a 64×64 disc. */
export function BenFace({ look }: { look: BenLook }) {
  const id = useId().replace(/:/g, '')
  const bg = (
    <radialGradient id={`${id}bg`} cx="50%" cy="38%" r="70%">
      <stop offset="0" style={{ stopColor: mix(26, '#1a2130') }} />
      <stop offset="0.65" stopColor="#10151e" />
      <stop offset="1" stopColor="#090c12" />
    </radialGradient>
  )
  const disc = <circle cx="32" cy="32" r="32" fill={`url(#${id}bg)`} />
  if (look === 'bot')
    return (
      <>
        <defs>
          {bg}
          <linearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f3f6fb" />
            <stop offset="1" stopColor="#aeb7c6" />
          </linearGradient>
        </defs>
        {disc}
        <path d="M32 17V11" stroke="#9aa3b5" strokeWidth="2" strokeLinecap="round" />
        <circle className="ba-led" cx="32" cy="9.5" r="3" style={{ fill: ACC }} />
        <rect x="10" y="28" width="5" height="11" rx="2.5" fill="#8a94a6" />
        <rect x="49" y="28" width="5" height="11" rx="2.5" fill="#8a94a6" />
        <rect x="14" y="17" width="36" height="32" rx="12" fill={`url(#${id}m)`} />
        <rect x="18.5" y="24.5" width="27" height="15" rx="7.5" fill="#0c1017" />
        <g className="ba-look"><g className="ba-lid"><g className="ba-eyes">
          <rect x="24" y="28.5" width="5" height="7" rx="2.5" style={{ fill: ACC }} />
          <rect x="35" y="28.5" width="5" height="7" rx="2.5" style={{ fill: ACC }} />
        </g></g></g>
        <g className="ba-smile"><rect className="ba-mouth" x="27.5" y="43" width="9" height="2.2" rx="1.1" fill="#7d879a" /></g>
        <path d="M17 52c3 5 9 8 15 8s12-3 15-8" style={{ fill: mix(70, '#0c1017') }} opacity="0.9" />
      </>
    )
  if (look === 'coach')
    return (
      <>
        <defs>
          {bg}
          <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: mix(85, 'white') }} />
            <stop offset="1" style={{ stopColor: mix(80, '#2b3a00') }} />
          </linearGradient>
        </defs>
        {disc}
        <path d="M9 64c2-10 11-15 23-15s21 5 23 15Z" style={{ fill: ACC }} />
        <path d="M9 64c2-10 11-15 23-15s21 5 23 15Z" fill="#000" opacity="0.18" />
        <path d="M25 49.5 32 57l7-7.5" fill="none" stroke="#f5f7fb" strokeWidth="1.4" opacity="0.85" />
        <rect x="29.6" y="56" width="5" height="3.4" rx="1.2" fill="#dfe4ec" />
        <rect x="28.5" y="44" width="7" height="6" rx="2" fill="#e9b88f" />
        <circle cx="19.4" cy="34" r="2.7" fill="#e9b88f" />
        <circle cx="44.6" cy="34" r="2.7" fill="#e9b88f" />
        <circle cx="32" cy="33" r="13" fill="#f3c9a1" />
        <path d="M18.6 30c0-9.5 6-14.5 13.4-14.5S45.4 20.5 45.4 30Z" fill={`url(#${id}c)`} />
        <path d="M17 30.2Q32 25.6 47 30.2Q32 33.6 17 30.2Z" style={{ fill: mix(60, '#1c2600') }} />
        <circle cx="32" cy="15.6" r="1.6" style={{ fill: mix(60, '#1c2600') }} />
        <path d="M24.3 33.2l4 .7M39.7 33.2l-4 .7" stroke="#4a3322" strokeWidth="1.5" strokeLinecap="round" />
        <g className="ba-look"><g className="ba-lid"><g className="ba-eyes">
          <ellipse cx="27" cy="36.4" rx="1.6" ry="2" fill="#2a1d14" />
          <ellipse cx="37" cy="36.4" rx="1.6" ry="2" fill="#2a1d14" />
        </g></g></g>
        <circle cx="23.4" cy="40" r="2" fill="#ff8f8f" opacity="0.28" />
        <circle cx="40.6" cy="40" r="2" fill="#ff8f8f" opacity="0.28" />
        <g className="ba-smile"><path className="ba-mouth" d="M28.6 41.2q3.4 2.6 6.8 0" fill="none" stroke="#7a3b2a" strokeWidth="1.6" strokeLinecap="round" /></g>
      </>
    )
  if (look === 'fox')
    return (
      <>
        <defs>
          {bg}
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffab5c" />
            <stop offset="1" stopColor="#ee6a26" />
          </linearGradient>
        </defs>
        {disc}
        <path d="M14 12 27.5 21 18.5 31Z" fill="#f27a32" />
        <path d="M16.8 16.5 24.2 21.6 19 27.2Z" fill="#2b1a12" />
        <path d="M50 12 36.5 21 45.5 31Z" fill="#f27a32" />
        <path d="M47.2 16.5 39.8 21.6 45 27.2Z" fill="#2b1a12" />
        <path d="M13.5 27Q13.5 20 21.5 20H42.5Q50.5 20 50.5 27L48.5 37Q44.5 47 32 53Q19.5 47 15.5 37Z" fill={`url(#${id}f)`} />
        <path d="M15.5 35.5Q23 37 27.5 44.5L32 53Q19.5 47 15.5 37Z" fill="#fff3e6" />
        <path d="M48.5 35.5Q41 37 36.5 44.5L32 53Q44.5 47 48.5 37Z" fill="#fff3e6" />
        <path d="M26.5 41Q32 37.4 37.5 41L32 51.5Z" fill="#fff3e6" />
        <path d="M32 23.2l2 3-2 3-2-3Z" style={{ fill: ACC }} />
        <g className="ba-look"><g className="ba-lid"><g className="ba-eyes">
          <ellipse cx="25" cy="33" rx="2.3" ry="2.8" fill="#1b1410" />
          <ellipse cx="39" cy="33" rx="2.3" ry="2.8" fill="#1b1410" />
          <circle cx="25.8" cy="32" r="0.8" fill="#fff" />
          <circle cx="39.8" cy="32" r="0.8" fill="#fff" />
        </g></g></g>
        <g className="ba-smile"><ellipse className="ba-mouth" cx="32" cy="47" rx="2.6" ry="1.9" fill="#1b1410" /></g>
      </>
    )
  // The default: a glowing orb with a face.
  return (
    <>
      <defs>
        {bg}
        <radialGradient id={`${id}o`} cx="36%" cy="30%" r="75%">
          <stop offset="0" style={{ stopColor: mix(30, 'white') }} />
          <stop offset="0.45" style={{ stopColor: ACC }} />
          <stop offset="1" style={{ stopColor: mix(55, '#0f5132') }} />
        </radialGradient>
      </defs>
      {disc}
      <circle cx="32" cy="33" r="21.5" fill={`url(#${id}o)`} />
      <ellipse cx="24.5" cy="23.5" rx="7" ry="3.6" fill="#fff" opacity="0.42" transform="rotate(-28 24.5 23.5)" />
      <g className="ba-look"><g className="ba-lid"><g className="ba-eyes">
        <rect x="24.2" y="28" width="4.8" height="8.4" rx="2.4" fill="#142004" />
        <rect x="35" y="28" width="4.8" height="8.4" rx="2.4" fill="#142004" />
      </g></g></g>
      <circle cx="21.6" cy="38" r="2.5" fill="#ff7a90" opacity="0.32" />
      <circle cx="42.4" cy="38" r="2.5" fill="#ff7a90" opacity="0.32" />
      <g className="ba-smile"><path className="ba-mouth" d="M27.6 40q4.4 3.6 8.8 0" fill="none" stroke="#142004" strokeWidth="2.2" strokeLinecap="round" /></g>
      <path d="M51 12.5l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1Z" style={{ fill: ACC }} opacity="0.9" />
    </>
  )
}

/**
 * Ben's face. `ring` adds the presence ring: it breathes when idle and a
 * gradient sweeps around it while he thinks or types; `online` adds the dot;
 * `live` lets him blink (only the one big face in the header does).
 */
export function BenAvatar({ look, size = 32, state = 'idle', ring = false, online = false, live = false, className = '' }: { look?: BenLook; size?: number; state?: Presence; ring?: boolean; online?: boolean; live?: boolean; className?: string }) {
  const [looks] = useCoachLooks()
  return (
    <span className={`ba ${state} ${live ? 'live' : ''} ${ring ? 'ringed' : ''} ${className}`} style={{ '--ba': `${size}px` } as CSSProperties} aria-hidden>
      {ring && <i className="ba-glow" />}
      {ring && <i className="ba-ring" />}
      <svg className="ba-face" viewBox="0 0 64 64">
        <BenFace look={look ?? looks.ben} />
      </svg>
      {online && <i className="ba-dot" />}
    </span>
  )
}

/** Your face: your photo, or your initials on a gradient. */
export function MeAvatar({ size = 32, photo, onPick, className = '' }: { size?: number; photo?: string | null; onPick?: () => void; className?: string }) {
  const [looks] = useCoachLooks()
  const src = photo === undefined ? looks.me : photo
  const body = src ? <img src={src} alt="" draggable={false} /> : <b>{initials(getUiPrefs().name)}</b>
  const style = { '--ba': `${size}px` } as CSSProperties
  if (onPick)
    return (
      <button type="button" className={`me-av ${className}`} style={style} onClick={onPick} title="Your photo: tap to change" aria-label="Change your photo">
        {body}
      </button>
    )
  return (
    <span className={`me-av ${className}`} style={style} aria-hidden>
      {body}
    </span>
  )
}

// One copy for the whole page, so every face updates together.
let cached: CoachLooks | null = null
let loading: Promise<void> | null = null
const EVENT = 'life-coach-looks'
const publish = (x: CoachLooks) => {
  const changed = JSON.stringify(x) !== JSON.stringify(cached)
  cached = x
  if (changed) window.dispatchEvent(new CustomEvent(EVENT, { detail: x }))
}
const loadLooks = () =>
  (loading ??= (life.coach?.looks?.() ?? Promise.resolve(null))
    .then((x) => void (x && publish(x)))
    .catch(() => {})
    .finally(() => (loading = null)))

/**
 * The chat's looks: [looks, save(patch)]. Every face shares one copy; pass
 * `watch` in the one place that should re-read it when data changes.
 */
export function useCoachLooks(watch = false): [CoachLooks, (patch: Partial<CoachLooks>) => Promise<boolean>] {
  const [v, setV] = useState<CoachLooks>(cached ?? DEFAULT_LOOKS)
  useEffect(() => {
    const on = (e: Event) => setV((e as CustomEvent<CoachLooks>).detail)
    window.addEventListener(EVENT, on)
    if (cached) setV(cached)
    else void loadLooks()
    return () => window.removeEventListener(EVENT, on)
  }, [])
  useLive(() => watch && void loadLooks())
  const save = async (patch: Partial<CoachLooks>) => {
    const next = await life.coach?.setLooks?.(patch)
    if (!next) return false
    publish(next)
    return true
  }
  return [v, save]
}

/** A photo you picked, cropped to a square and shrunk to 128 px on this device (about 5–15 KB). */
export async function avatarFromFile(f: File): Promise<string> {
  const src = URL.createObjectURL(f)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const w = img.naturalWidth || 1
    const h = img.naturalHeight || 1
    const s = Math.min(w, h)
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    if (!g) throw new Error('This browser cannot read photos')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 128, 128)
    for (const q of [0.86, 0.74, 0.6, 0.45]) {
      const url = c.toDataURL('image/jpeg', q)
      if (url.length <= AVATAR_MAX_CHARS) return url
    }
    throw new Error('That photo is too big, try another one')
  } catch (e) {
    throw new Error((e as Error).message || 'Could not read that photo')
  } finally {
    URL.revokeObjectURL(src)
  }
}
