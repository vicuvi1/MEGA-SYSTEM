// "A new version is out": the web app checks /version.json every few minutes
// and when you come back to the tab. A tab left open for hours would otherwise
// keep running old code. Hidden tab → reloads by itself; visible → a bar.
import { useEffect, useState } from 'react'
import { BACK_KEY, backToNewest } from './goBack'

declare const __BUILD_ID__: string
const MINE = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : ''

async function latest(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    return String((await r.json())?.build ?? '') || null
  } catch {
    return null
  }
}

const wentBackFrom = (): string | null => {
  try {
    return localStorage.getItem(BACK_KEY)
  } catch {
    return null
  }
}

export function NewVersionBar() {
  const [ready, setReady] = useState(false)
  const [back, setBack] = useState(false)
  useEffect(() => {
    if (!MINE || (typeof window !== 'undefined' && (window as any).life)) return
    let stop = false
    const check = async () => {
      const b = await latest()
      if (stop || !b || b === MINE) return
      // You went back from this version: say so once, don't reload into it.
      const from = wentBackFrom()
      if (from && b === from) return setBack(true)
      if (from) localStorage.removeItem(BACK_KEY)
      if (document.visibilityState === 'hidden') window.location.reload()
      else setReady(true)
    }
    const t = setInterval(() => void check(), 4 * 60_000)
    const onVis = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    void check()
    return () => {
      stop = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])
  if (back)
    return (
      <div className="nv-bar" role="status">
        <span>↩ You're on the previous version until a fix is out.</span>
        <button className="btn small" onClick={backToNewest}>
          Try the newest
        </button>
      </div>
    )
  if (!ready) return null
  return (
    <div className="nv-bar" role="status">
      <span>✨ A new version of Life System is ready.</span>
      <button className="btn primary small" onClick={() => window.location.reload()}>
        Reload now
      </button>
    </div>
  )
}
