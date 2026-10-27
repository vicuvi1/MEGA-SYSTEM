import { useEffect, useRef, useState } from 'react'
import type { EmbeddedApps } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'

export type EmbedKind = 'finance' | 'waky' | 'man' | 'sport'

export const EMBED_LABEL: Record<EmbedKind, string> = { finance: 'Finance Helper', waky: 'Waky', man: 'MAN', sport: 'Sport Track' }

/**
 * Keeps each app open once visited (hidden when not shown), so switching
 * sections doesn't reload it or lose what you were typing.
 */
export function EmbedHost({ active, soundEnabled = true }: { active: EmbedKind | null; soundEnabled?: boolean }) {
  const [info, setInfo] = useState<EmbeddedApps | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visited, setVisited] = useState<EmbedKind[]>([])
  const [waky, setWaky] = useState<{ ok: boolean; error: string | null } | null>(null)

  useEffect(() => {
    life.apps.info().then(setInfo, (e) => setError((e as Error).message))
  }, [])

  useEffect(() => {
    if (active && !visited.includes(active)) setVisited((v) => [...v, active])
    if (active === 'waky' && !waky?.ok) life.apps.startWaky().then(setWaky)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!active && !visited.length) return null

  if (error || !info) {
    return (
      <div className={`embed-host ${active ? 'on' : ''}`}>
        <div className="embed-msg">
          <Icon name="link" size={28} />
          <p>{error ?? 'Opening…'}</p>
        </div>
      </div>
    )
  }

  const src: Record<EmbedKind, { url: string; partition: string }> = { finance: info.finance, man: info.man, waky: info.waky, sport: info.sport }
  return (
    <div className={`embed-host ${active ? 'on' : ''}`}>
      {visited.map((k) => {
        if (k === 'waky' && !waky?.ok) {
          return (
            <div key={k} className="embed-msg" style={{ display: active === k ? undefined : 'none' }}>
              <Icon name="moon" size={28} />
              <p>{waky?.error ?? 'Starting Waky…'}</p>
              {waky?.error && (
                <button className="btn small" onClick={() => life.apps.startWaky().then(setWaky)}>
                  Try again
                </button>
              )}
            </div>
          )
        }
        return <AppFrame key={k} name={EMBED_LABEL[k]} url={src[k].url} partition={src[k].partition} visible={active === k} soundEnabled={soundEnabled} />
      })}
    </div>
  )
}

type WebviewEl = HTMLElement & { reload(): void; loadURL(url: string): Promise<void> }

/**
 * One app's page. If it fails to load (e.g. Waky's server is down) or its
 * page crashes, a card says so with a button to try again.
 */
function AppFrame({ name, url, partition, visible, soundEnabled }: { name: string; url: string; partition: string; visible: boolean; soundEnabled: boolean }) {
  const ref = useRef<WebviewEl | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current as any
    if (!el) return
    const shouldMute = !visible || !soundEnabled
    if (typeof el.setAudioMuted === 'function') {
      try { el.setAudioMuted(shouldMute) } catch {}
    }
    if (shouldMute) {
      try {
        el.executeJavaScript?.(`
          if (typeof window !== 'undefined') {
            if (window.sound && typeof window.sound.stopBGM === 'function') {
              window.sound.stopBGM();
              if (typeof window.updateAnthemUI === 'function') window.updateAnthemUI(0);
            }
            if (window.sound && window.sound.ctx && window.sound.ctx.state === 'running') {
              window.sound.ctx.suspend().catch(() => {});
            }
            if (window.AmbientMusic && typeof window.AmbientMusic.pause === 'function') {
              window.AmbientMusic.pause();
            }
          }
        `).catch(() => {})
      } catch {}
    }
  }, [visible, soundEnabled])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const failed = (e: Event) => {
      const ev = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }
      // -3 is "aborted": a normal navigation inside the app, not a failure.
      if (!ev.isMainFrame || ev.errorCode === -3) return
      setProblem(`${name} didn't load (${ev.errorDescription || ev.errorCode}).`)
      life.app.reportError(`${name} failed to load: ${ev.errorDescription} (${ev.errorCode})`).catch(() => {})
    }
    const gone = (e: Event) => {
      const reason = (e as Event & { details?: { reason?: string } }).details?.reason ?? 'crashed'
      setProblem(`${name} stopped (${reason}).`)
    }
    const loaded = () => {
      setProblem(null)
      const el = ref.current as any
      if (el) {
        const shouldMute = !visible || !soundEnabled
        if (typeof el.setAudioMuted === 'function') {
          try { el.setAudioMuted(shouldMute) } catch {}
        }
        if (shouldMute) {
          try {
            el.executeJavaScript?.(`
              if (typeof window !== 'undefined') {
                if (window.sound && typeof window.sound.stopBGM === 'function') {
                  window.sound.stopBGM();
                  if (typeof window.updateAnthemUI === 'function') window.updateAnthemUI(0);
                }
                if (window.sound && window.sound.ctx && window.sound.ctx.state === 'running') {
                  window.sound.ctx.suspend().catch(() => {});
                }
                if (window.AmbientMusic && typeof window.AmbientMusic.pause === 'function') {
                  window.AmbientMusic.pause();
                }
              }
            `).catch(() => {})
          } catch {}
        }
      }
    }
    el.addEventListener('did-fail-load', failed)
    el.addEventListener('render-process-gone', gone)
    el.addEventListener('did-finish-load', loaded)
    return () => {
      el.removeEventListener('did-fail-load', failed)
      el.removeEventListener('render-process-gone', gone)
      el.removeEventListener('did-finish-load', loaded)
    }
  }, [name, visible, soundEnabled])

  return (
    <>
      <webview ref={ref as never} className="embed" src={url} partition={partition} style={{ display: visible && !problem ? undefined : 'none' }} />
      {visible && problem && (
        <div className="embed-msg">
          <Icon name="bolt" size={28} />
          <p>{problem}</p>
          <p className="hint">Your data in it is safe. Try again, and if it keeps happening, the log in Settings has the details.</p>
          <button
            className="btn primary small"
            onClick={() => {
              setProblem(null)
              const el = ref.current
              if (el) el.loadURL(url).catch(() => el.reload())
            }}
          >
            Try again
          </button>
        </div>
      )}
    </>
  )
}
