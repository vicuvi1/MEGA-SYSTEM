// The app background from Custom Center (the active mode's, else your base
// one): a gradient (optionally drifting slowly) or a picture kept on this
// device, under a page-coloured shade so text stays readable. "None" draws
// nothing (Settings → Look → Wallpaper then shows as before). Moves only by
// transform, never with reduced motion, paused while the window is hidden.
import { useEffect, useState, type CSSProperties } from 'react'
import { activeLayout, type Background } from '@core/custom'
import { reducedMotion } from '../motionKit'
import { useLive } from '../live'
import { cachedBackground, loadCustom, useCustom } from './customStore'
import { localUrl } from './localFiles'
import './customBg.css'

/** The CSS for a background (null for none or a picture this device doesn't have). */
export function backgroundCss(b: Background, image: string | null): string | null {
  if (b.kind === 'gradient') return `linear-gradient(${b.angle}deg, ${b.colors.join(', ')})`
  if (b.kind === 'image' && image) return `url("${image.replace(/"/g, '%22')}")`
  return null
}

/** The background on now; re-checked once a minute (a mode may start by schedule). */
export function useActiveBackground(): Background {
  const { setup, loaded } = useCustom()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return loaded ? activeLayout(setup, now).background : cachedBackground()
}

export function CustomBackground() {
  const bg = useActiveBackground()
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => void loadCustom(), [])
  useLive(() => void loadCustom())
  useEffect(() => {
    let live = true
    if (bg.kind === 'image' && bg.image) void localUrl(bg.image).then((u) => live && setImage(u))
    else setImage(null)
    return () => {
      live = false
    }
  }, [bg.kind, bg.image])
  const css = backgroundCss(bg, image)
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('has-cbg', !!css)
    return () => root.classList.remove('has-cbg')
  }, [css])
  if (!css) return null
  const moving = bg.kind === 'gradient' && bg.animate && !reducedMotion()
  const art: CSSProperties = { backgroundImage: css }
  return (
    <div className={`cbg-layer ${moving ? 'cbg-moving' : ''}`} aria-hidden="true" data-cbg={bg.kind}>
      <div className="cbg-art" style={art} />
      <div className="cbg-shade" style={{ opacity: 1 - bg.strength }} />
    </div>
  )
}
