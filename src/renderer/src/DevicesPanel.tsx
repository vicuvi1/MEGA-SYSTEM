// Settings → Security: every device signed in and every passkey, with last use (A6).
// "Sign out" ends just that device; the one you're on is marked.
import { useEffect, useState } from 'react'
import type { DeviceList } from '@shared/api'
import { life } from './bridge'
import { askConfirm } from './confirmSheet'
import { timeAgo } from './ui'

export function DevicesPanel() {
  const [list, setList] = useState<DeviceList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    life.auth.devices?.().then(setList, (e) => setErr(e.message || 'Could not load devices'))
  }, [])
  if (!life.auth.devices) return null
  const act = async (p: Promise<DeviceList> | undefined) => {
    if (!p) return
    try {
      setList(await p)
      setErr(null)
    } catch (e: any) {
      setErr(e.message || 'That did not work')
    }
  }
  return (
    <div className="devices-panel" style={{ margin: '0.5rem 0 1rem' }}>
      <strong>Your devices</strong>
      {err && <p className="hint small" style={{ color: 'var(--danger, #e55)' }}>{err}</p>}
      {!list && !err && <p className="hint small">Loading…</p>}
      {list && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.4rem 0' }}>
          {list.devices.length === 0 && <li className="hint small">Devices show here after their next sign-in.</li>}
          {list.devices.map((d) => (
            <li key={d.sid} className="row" style={{ gap: '0.6rem', alignItems: 'center', padding: '0.3rem 0' }}>
              <span style={{ flex: 1 }}>
                {d.label} {d.sid === list.current && <span className="chip small">this device</span>}
                <span className="hint small"> · last used {timeAgo(new Date(d.lastSeen).toISOString())}</span>
              </span>
              {d.sid !== list.current && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={async () => {
                    if (await askConfirm(`Sign out ${d.label}? It will need the PIN again.`, { ok: 'Sign out' })) act(life.auth.revokeDevice?.(d.sid))
                  }}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
          {list.passkeys.map((k) => (
            <li key={k.id} className="row" style={{ gap: '0.6rem', alignItems: 'center', padding: '0.3rem 0' }}>
              <span style={{ flex: 1 }}>
                🔐 {k.label}
                <span className="hint small"> · fingerprint / face, added {timeAgo(new Date(k.created).toISOString())}</span>
              </span>
              <button
                type="button"
                className="btn ghost small"
                onClick={async () => {
                  if (await askConfirm('Remove this passkey? That device unlocks with the PIN until you set it up again.', { ok: 'Remove' })) act(life.auth.removePasskey?.(k.id))
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
