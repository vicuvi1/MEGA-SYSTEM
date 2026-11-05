// Settings → Plugins → Gmail: the extra read-only permission on top of your
// Google Calendar sign-in (the calendar stays connected).
import { useEffect, useState } from 'react'
import { life } from '../../renderer/src/bridge'
import { useAction } from '../../renderer/src/ui'

export function GmailSettings() {
  const act = useAction()
  const [st, setSt] = useState<{ connected: boolean; gmail?: boolean; configured: boolean } | null>(null)
  useEffect(() => {
    life.google?.status().then(setSt).catch(() => setSt({ configured: false, connected: false }))
  }, [])
  if (!st) return null
  return (
    <div className="pl-fields">
      {!st.configured ? (
        <div className="pl-need">Google isn't set up on the server yet (Settings → Connections).</div>
      ) : !st.connected ? (
        <div className="pl-need">Connect Google Calendar first (Settings → Connections), then come back here.</div>
      ) : st.gmail ? (
        <div className="pl-status">Gmail is connected (read-only). Life System never sends email.</div>
      ) : (
        <>
          <div className="pl-muted">Google will ask once more, to let Life System read your mail (read-only). Your calendar stays connected.</div>
          <div className="pl-actions">
            <button className="btn small primary" onClick={() => void act(() => life.plugins!.connectGmail())}>
              Connect Gmail
            </button>
          </div>
        </>
      )}
    </div>
  )
}
