// "A new version is out": the web app checks /version.json every few minutes
// and when you come back to the tab. A tab left open for hours would otherwise
// keep running old code. Hidden tab → reloads by itself; visible → a bar.
import { useEffect, useState } from 'react'
import { BACK_KEY, backToNewest } from './goBack'
import { quietReloadDue } from '@core/nightCare'

declare const __BUILD_ID__: string
const MINE = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : ''
const LOADED_AT = Date.now()

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
  // LT22: the server has a newer database: this page may not save until it reloads.
  const [mustReload, setMustReload] = useState(false)
  useEffect(() => {
    const on = () => {
      setMustReload(true)
      // CL5: the desktop app installs its waiting update now (or fetches it), with a notice.
      void (window as any).desktop?.schemaOld?.()
    }
    window.addEventListener('life-schema-old', on)
    return () => window.removeEventListener('life-schema-old', on)
  }, [])
  // CL9: a tab left open for days (or grown heavy) starts fresh while hidden at 04:00.
  // Waiting changes are kept on this device, so nothing is lost. The desktop app does this itself.
  useEffect(() => {
    if ((window as any).desktop) return
    const t = setInterval(() => {
      const heap = (performance as any).memory?.usedJSHeapSize as number | undefined
      if (quietReloadDue({ hidden: document.visibilityState === 'hidden', hour: new Date().getHours(), ageMs: Date.now() - LOADED_AT, heapBytes: heap })) window.location.reload()
    }, 5 * 60_000)
    return () => clearInterval(t)
  }, [])
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
  if (mustReload)
    return (
      <div className="nv-bar" role="alert">
        <span>✨ A new version is out — please reload. Changes are not saved until you do.</span>
        <button className="btn primary small" onClick={() => window.location.reload()}>
          Reload now
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
