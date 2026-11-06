// The wallpaper behind the whole app (Settings → Look → Wallpaper): the
// picture, a page-coloured shade over it so text stays readable, and, only
// with "Gentle motion" on, a slow drift and a light effect (rain, stars,
// petals, snow, leaves). Static by default; nothing moves while the window is
// hidden (html.doc-hidden) or when the system asks for less motion.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { wallpaperInfo, wallpaperLook, wallpaperShows, type WallpaperFx } from '@core/wallpaper'
import { useLive } from '../live'
import { reducedMotion } from '../motionKit'
import { artUrl } from './art'
import { loadWallpaper, useWallpaper } from './wallpaperStore'
import './wallpaper.css'

/** html[data-theme], followed live. */
function useThemeName(): 'dark' | 'light' {
  const read = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [t, setT] = useState<'dark' | 'light'>(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setT(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return t
}

/** The picture's CSS background for an id (your picture for "photo"). */
export function wallpaperBackground(id: string, photo: string | null): string | null {
  const url = id === 'photo' ? photo : artUrl(id)
  return url ? `url("${url.replace(/"/g, '%22')}")` : null
}

export function WallpaperLayer({ page }: { page: string }) {
  const { prefs, photo, preview } = useWallpaper()
  const theme = useThemeName()
  useEffect(() => void loadWallpaper(), [])
  useLive(() => void loadWallpaper())
  const id = preview ?? prefs.id
  const on = preview ? true : wallpaperShows(prefs, page, !!photo)
  const bg = on ? wallpaperBackground(id, photo) : null
  const info = wallpaperInfo(id)
  const look = wallpaperLook(prefs, theme, info)
  const moving = prefs.motion && !reducedMotion()

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('has-wp', !!bg)
    if (info && bg) root.style.setProperty('--wp-accent', info.accent)
    else root.style.removeProperty('--wp-accent')
    return () => {
      root.classList.remove('has-wp')
      root.style.removeProperty('--wp-accent')
    }
  }, [bg, info])

  if (!bg) return null
  const art: CSSProperties = { backgroundImage: bg, opacity: look.art, filter: look.blur ? `blur(${look.blur}px)` : undefined, inset: look.blur ? -look.blur * 2.5 : 0 }
  return (
    <div className={`wp-layer ${moving ? 'wp-moving' : ''}`} aria-hidden="true" data-wp={id}>
      <div className="wp-art" style={art} />
      {moving && info?.fx && <WallpaperEffect kind={info.fx} />}
      <div className="wp-shade" style={{ opacity: look.shade }} />
    </div>
  )
}

/** A seeded random, so the effect looks the same every time. */
function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

const FX_COUNT: Record<WallpaperFx, number> = { rain: 46, stars: 34, petals: 18, snow: 40, leaves: 12 }

/** Light drops, dots or petals; each moves only by transform and opacity. */
function WallpaperEffect({ kind }: { kind: WallpaperFx }) {
  const bits = useMemo(() => {
    const r = seeded(kind.length * 7919 + 13)
    return Array.from({ length: FX_COUNT[kind] }, (_, i) => ({
      key: i,
      style: {
        '--x': `${(r() * 100).toFixed(2)}%`,
        '--y': `${(r() * 100).toFixed(2)}%`,
        '--d': `${(-r() * 20).toFixed(2)}s`,
        '--t': `${(0.7 + r() * 0.6).toFixed(2)}`,
        '--s': `${(0.6 + r() * 0.8).toFixed(2)}`
      } as CSSProperties
    }))
  }, [kind])
  return (
    <div className={`wp-fx wp-fx-${kind}`}>
      {bits.map((b) => (
        <i key={b.key} style={b.style} />
      ))}
    </div>
  )
}
