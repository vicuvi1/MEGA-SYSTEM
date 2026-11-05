// Settings → Plugins → Phone health numbers: make a key for each phone and
// copy the how-to for an iOS Shortcut or an Android automation.
import { useEffect, useState } from 'react'
import { life } from '../../renderer/src/bridge'
import { askConfirm } from '../../renderer/src/confirmSheet'
import { timeAgo, useAction } from '../../renderer/src/ui'

type Key = { id: string; label: string; created: number; lastUsed: number | null }

export function HealthSettings() {
  const act = useAction()
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [label, setLabel] = useState('My phone')
  const [fresh, setFresh] = useState<string | null>(null)
  const load = () => void life.plugins?.healthKeys({ op: 'list' }).then((r) => setKeys(r.keys ?? [])).catch(() => setKeys([]))
  useEffect(load, [])
  const url = `${location.origin}/api/cron?job=health`
  const make = async () => {
    const r = await act(() => life.plugins!.healthKeys({ op: 'new', label }), 'Key made: copy it now')
    if (r?.key) {
      setFresh(r.key)
      load()
    }
  }
  const drop = async (k: Key) => {
    if (!(await askConfirm(`Remove the key "${k.label}"? That phone stops sending numbers until you give it a new key.`, { ok: 'Remove' }))) return
    await act(() => life.plugins!.healthKeys({ op: 'drop', id: k.id }), 'Removed')
    load()
  }
  const copy = (t: string) => void act(() => navigator.clipboard.writeText(t), 'Copied')
  const key = fresh ?? '<your key>'
  const curl = `curl -X POST "${url}" -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"steps": 8000, "weight": 72.5, "sleepHours": 7.5}'`
  return (
    <div className="pl-fields">
      <div className="pl-muted">Each phone gets its own key. Only a fingerprint of it is kept on the server, so it's shown once.</div>
      {keys?.length ? (
        <ul className="pl-list">
          {keys.map((k) => (
            <li key={k.id}>
              <b>{k.label}</b> · {k.lastUsed ? `last used ${timeAgo(new Date(k.lastUsed).toISOString())}` : 'not used yet'}{' '}
              <button className="btn small ghost" onClick={() => void drop(k)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pl-actions">
        <label className="pl-field" style={{ flex: 1 }}>
          <span>Name of the phone</span>
          <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button className="btn small primary" style={{ alignSelf: 'end' }} onClick={() => void make()}>
          Make a key
        </button>
      </div>
      {fresh && (
        <>
          <span className="pl-muted">Your new key (copy it now; it won't be shown again):</span>
          <code className="pl-code">{fresh}</code>
          <div className="pl-actions">
            <button className="btn small" onClick={() => copy(fresh)}>
              Copy key
            </button>
          </div>
        </>
      )}
      <details>
        <summary className="pl-muted">iPhone: make the Shortcut</summary>
        <ol className="pl-steps">
          <li>Shortcuts → Automation → New → Time of Day (e.g. 22:00, daily) → Run Immediately.</li>
          <li>Add "Find Health Samples": Steps, start date is today → "Calculate Statistics": Sum.</li>
          <li>Optional: "Find Health Samples": Weight, latest 1; and Sleep (hours of last night).</li>
          <li>
            Add "Get Contents of URL": <code>{url}</code>, method POST, header <code>Authorization</code> = <code>Bearer {key}</code>, request body JSON with <code>steps</code>, <code>weight</code>, <code>sleepHours</code> (numbers).
          </li>
        </ol>
      </details>
      <details>
        <summary className="pl-muted">Android: an automation app</summary>
        <ol className="pl-steps">
          <li>In an app like HTTP Shortcuts, Tasker or Automate, make a POST request to <code>{url}</code>.</li>
          <li>
            Header <code>Authorization: Bearer {key}</code>, body JSON <code>{'{"steps": …, "weight": …, "sleepHours": …}'}</code> (from Health Connect or Google Fit).
          </li>
          <li>Run it once a day in the evening. Add <code>"day": "YYYY-MM-DD"</code> to send an earlier day (up to 14 days back).</li>
        </ol>
      </details>
      <details>
        <summary className="pl-muted">Test it from a computer</summary>
        <code className="pl-code">{curl}</code>
        <div className="pl-actions">
          <button className="btn small ghost" onClick={() => copy(curl)}>
            Copy
          </button>
        </div>
      </details>
    </div>
  )
}
