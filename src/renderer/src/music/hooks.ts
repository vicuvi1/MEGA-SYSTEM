// MU: small helpers for the Music views: the colour of the artwork, the real
// waveform, and the stations' remembered artwork. Each fetches once per
// track (cached), and only while a Music view is open.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { fakeWave, glowColor, pickColor, safeArt, waveBars, waveJsonUrl, type Rgb } from '@core/music'

// ---- the artwork's colour ----
const colors = new Map<string, Rgb | null>()
/**
 * The main colour of the artwork, from a 24×24 canvas sample. SoundCloud's
 * image host normally allows this (CORS); if the image can't be read (the
 * canvas is "tainted"), it is null and the view uses the accent colour.
 */
export function useArtColor(url: string): Rgb | null {
  const [c, setC] = useState<Rgb | null>(() => colors.get(url) ?? null)
  useEffect(() => {
    if (!url) return setC(null)
    if (colors.has(url)) return setC(colors.get(url) ?? null)
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.decoding = 'async'
    img.onload = () => {
      let out: Rgb | null = null
      try {
        const cv = document.createElement('canvas')
        cv.width = cv.height = 24
        const g = cv.getContext('2d', { willReadFrequently: true })
        if (g) {
          g.drawImage(img, 0, 0, 24, 24)
          out = glowColor(pickColor(g.getImageData(0, 0, 24, 24).data, { r: 0, g: 0, b: 0 }))
        }
      } catch {
        out = null // cross-origin and blocked: the accent colour instead
      }
      if (colors.size > 60) colors.clear()
      colors.set(url, out)
      if (live) setC(out)
    }
    img.onerror = () => {
      colors.set(url, null)
      if (live) setC(null)
    }
    img.src = url
    return () => {
      live = false
    }
  }, [url])
  return url ? c : null
}

// ---- the waveform ----
const waves = new Map<string, number[] | null>()
/**
 * The track's real waveform (SoundCloud's numbers from wave.sndcdn.com, the
 * only host the page may fetch it from), scaled to `bars`. Until it arrives,
 * or if it can't be fetched, a calm made-up shape (`real: false`).
 */
export function useWave(waveUrl: string, seed: string, bars: number): { bars: number[]; real: boolean } {
  const url = waveJsonUrl(waveUrl)
  const [samples, setSamples] = useState<number[] | null>(() => (url ? waves.get(url) ?? null : null))
  useEffect(() => {
    if (!url) return setSamples(null)
    if (waves.has(url)) return setSamples(waves.get(url) ?? null)
    const ac = new AbortController()
    fetch(url, { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const xs = Array.isArray(j?.samples) ? (j.samples as unknown[]).slice(0, 4000).map((x) => Number(x) || 0) : null
        if (waves.size > 40) waves.clear()
        waves.set(url, xs)
        setSamples(xs)
      })
      .catch(() => {
        if (!ac.signal.aborted) waves.set(url, null)
        setSamples(null)
      })
    return () => ac.abort()
  }, [url])
  return samples ? { bars: waveBars(samples, bars), real: true } : { bars: fakeWave(seed || 'music', bars), real: false }
}

// ---- each station's last artwork (this device) ----
const ART_KEY = 'ls.musicStationArt'
let arts: Record<string, string> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(ART_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
})()
const artSubs = new Set<() => void>()
if (typeof window !== 'undefined') {
  // The island remembered one (the app window shares this storage).
  window.addEventListener('storage', (e) => {
    if (e.key !== ART_KEY) return
    try {
      const v = JSON.parse(e.newValue ?? '{}')
      arts = v && typeof v === 'object' ? v : {}
    } catch {
      arts = {}
    }
    artSubs.forEach((f) => f())
  })
}
export function rememberStationArt(stationUrl: string, art: string) {
  const a = safeArt(art)
  // The first artwork seen stays the station's picture (it doesn't flicker with every track).
  if (!stationUrl || !a || arts[stationUrl]) return
  const keys = Object.keys(arts)
  arts = { ...(keys.length > 40 ? {} : arts), [stationUrl]: a }
  try {
    localStorage.setItem(ART_KEY, JSON.stringify(arts))
  } catch {
    /* private window */
  }
  artSubs.forEach((f) => f())
}
export const useStationArt = () => useSyncExternalStore((f) => (artSubs.add(f), () => void artSubs.delete(f)), () => arts, () => arts)

/** Re-renders a few times a second while `on` (for the sleep timer's countdown). */
export function useTicker(on: boolean, ms = 1000): number {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => !document.hidden && setT(Date.now()), ms)
    return () => clearInterval(id)
  }, [on, ms])
  return t
}
