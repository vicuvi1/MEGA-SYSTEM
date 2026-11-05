// JV5: the voice wave. A small canvas drawn at ~30 fps with
// requestAnimationFrame (so it stops by itself in a hidden window), only while
// someone is talking; your voice in the accent colour, Ben's in his. No CSS
// animation, nothing on layout.
import { useEffect, useRef } from 'react'

export function VoiceWave({ level, active, width = 132, height = 30, reduced = false }: { level: () => { me: number; ben: number }; active: boolean; width?: number; height?: number; reduced?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = width * dpr
    c.height = height * dpr
    g.scale(dpr, dpr)
    const bars = 22
    const h = new Float32Array(bars)
    let raf = 0
    let last = 0
    let t = 0
    const style = getComputedStyle(c)
    const me = style.getPropertyValue('--voice-me').trim() || '#7dd3fc'
    const ben = style.getPropertyValue('--voice-ben').trim() || '#c4b5fd'
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 33) return
      last = now
      t += 0.12
      const l = level()
      const who = l.ben > l.me ? 'ben' : 'me'
      const v = reduced ? 0 : Math.max(l.me, l.ben)
      g.clearRect(0, 0, width, height)
      g.fillStyle = who === 'ben' ? ben : me
      const bw = width / bars
      for (let i = 0; i < bars; i++) {
        // A soft travelling shape, its height following the voice.
        const shape = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.55 + t * (who === 'ben' ? 1.3 : 1.8)))
        const target = Math.max(0.08, v * shape)
        h[i] += (target - h[i]) * 0.35
        const bh = Math.max(2, h[i] * (height - 4))
        g.globalAlpha = 0.55 + 0.45 * h[i]
        const x = i * bw + bw * 0.2
        const r = Math.min(bw * 0.3, 3)
        g.beginPath()
        g.roundRect(x, (height - bh) / 2, bw * 0.6, bh, r)
        g.fill()
      }
      if (!active) cancelAnimationFrame(raf)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, width, height, level, reduced])
  return <canvas ref={ref} className="voice-wave" style={{ width, height }} aria-hidden />
}
