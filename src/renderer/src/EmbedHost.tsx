import { useEffect, useState } from 'react'
import type { EmbeddedApps } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'

export type EmbedKind = 'finance' | 'waky' | 'man'

export const EMBED_LABEL: Record<EmbedKind, string> = { finance: 'Finance Helper', waky: 'Waky', man: 'MAN' }

/**
 * Keeps each app open once visited (hidden when not shown), so switching
 * sections doesn't reload it or lose what you were typing.
 */
export function EmbedHost({ active }: { active: EmbedKind | null }) {
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

  const src: Record<EmbedKind, { url: string; partition: string }> = { finance: info.finance, man: info.man, waky: info.waky }
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
        return <webview key={k} className="embed" src={src[k].url} partition={src[k].partition} style={{ display: active === k ? undefined : 'none' }} />
      })}
    </div>
  )
}
