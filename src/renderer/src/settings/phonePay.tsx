// Settings → Phone payments: a key per phone for MacroDroid, the exact
// MacroDroid setup, "Send test", and the last 5 notifications received with
// what was read from each. The payments wait in "to sort" (money_tosort)
// until you pick a category; nothing goes into Finance Helper before that.
import { useEffect, useState } from 'react'
import type { ToSortItem } from '@core/moneyToSort'
import { life } from '../bridge'
import { askConfirm } from '../confirmSheet'
import { Icon } from '../Icon'
import { timeAgo, useAction } from '../ui'

type Key = { id: string; label: string; created: number; lastUsed: number | null }

const APPS = 'maib, Google Wallet, Revolut, Paynet'
const BODY = '{"app": "[app_name]", "title": "[notification_title]", "text": "[notification]", "time": "[hour]:[minute]"}'

const SOURCE: Record<string, string> = { maib: 'maib', gwallet: 'Google Wallet', revolut: 'Revolut', paynet: 'Paynet', unknown: 'Other app' }

function resultLine(it: ToSortItem): string {
  const from = (it.sources ?? [it.source]).map((s) => SOURCE[s] ?? s).join(' + ')
  if (it.kind === 'ignore') return `${from} · ${it.state === 'new' ? 'Not read' : 'Skipped'}: ${it.reason ?? 'not a payment'}`
  const amt = `${(it.amount / 100).toFixed(2).replace('.', ',')} ${it.currency}`
  const state = it.state === 'new' ? 'to sort' : it.state === 'sorted' ? 'sorted' : 'dismissed'
  return `${from} · ${it.kind === 'refund' ? 'Refund ' : ''}${amt}${it.merchant ? ` · ${it.merchant}` : ''} · ${state}${it.test ? ' (test)' : ''}`
}

export function PhonePaySection() {
  const act = useAction()
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [recent, setRecent] = useState<ToSortItem[]>([])
  const [label, setLabel] = useState('My phone')
  const [fresh, setFresh] = useState<string | null>(null)
  const api = life.plugins?.phonePay
  const load = () => {
    void api?.({ op: 'list' }).then((r) => setKeys(r.keys ?? [])).catch(() => setKeys([]))
    void api?.({ op: 'recent' }).then((r) => setRecent(r.recent ?? [])).catch(() => setRecent([]))
  }
  useEffect(load, [])
  if (!api) return <section className="panel"><p className="hint">Phone payments work in the app signed in to your server.</p></section>
  const url = `${location.origin}/api/cron?job=pay`
  const key = fresh ?? '<your key>'
  const make = async () => {
    const r = await act(() => api({ op: 'new', label }), 'Key made: copy it now')
    if (r?.key) {
      setFresh(r.key)
      load()
    }
  }
  const drop = async (k: Key) => {
    if (!(await askConfirm(`Remove the key "${k.label}"? That phone stops sending payments until you give it a new key.`, { ok: 'Remove' }))) return
    await act(() => api({ op: 'drop', id: k.id }), 'Removed')
    load()
  }
  const test = async () => {
    const r = await act(() => api({ op: 'test', ...(fresh ? { key: fresh } : {}) }), (x) => `Test sent: ${x.what ?? x.status ?? 'done'}`)
    if (r) load()
  }
  const copy = (t: string) => void act(() => navigator.clipboard.writeText(t), 'Copied')
  return (
    <section className="panel pp" data-testid="phone-pay">
      <header className="panel-head">
        <h2>
          <Icon name="coin" /> Phone payments
        </h2>
      </header>
      <p className="hint block">
        Pay with your phone as usual. MacroDroid (free, Android) sends each payment notification from {APPS} here. It is saved at once and waits in <b>To sort</b> until you tap what it was for; only then does it go into Finance Helper. One payment that two apps tell about (maib and Google Wallet) is kept once. Auto-saved payments pay no points; they count as logged only when you sort them the same day.
      </p>

      <h3 className="pl-sub">Keys</h3>
      <div className="pl-fields">
        <div className="pl-muted">Each phone gets its own key. Only a fingerprint of it is kept on the server, so it's shown once. Remove a key and that phone stops at once.</div>
        {keys?.length ? (
          <ul className="pl-list" data-testid="pp-keys">
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
            <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} data-testid="pp-label" />
          </label>
          <button className="btn small primary" style={{ alignSelf: 'end' }} onClick={() => void make()}>
            Make a key
          </button>
        </div>
        {fresh && (
          <>
            <span className="pl-muted">Your new key (copy it now; it won't be shown again):</span>
            <code className="pl-code" data-testid="pp-key">{fresh}</code>
            <div className="pl-actions">
              <button className="btn small" onClick={() => copy(fresh)}>
                Copy key
              </button>
            </div>
          </>
        )}
      </div>

      <h3 className="pl-sub">Set up MacroDroid</h3>
      <ol className="pl-steps" data-testid="pp-steps">
        <li>Install <b>MacroDroid</b> from Google Play and open it. Tap <b>Add macro</b>.</li>
        <li>
          <b>Trigger</b>: tap +, search <b>Notification</b>, pick <b>Notification received</b>. Choose <b>Select application(s)</b> and tick {APPS}. Text content: <b>Any</b>. Allow MacroDroid to read notifications when it asks.
        </li>
        <li>
          <b>Action</b>: tap +, search <b>HTTP request</b>. Method <b>POST</b>, URL <code>{url}</code>
        </li>
        <li>
          In the request, add the header <code>Authorization</code> with the value <code>Bearer {key}</code>
        </li>
        <li>
          Body (content type <b>text/plain</b>): <code>{BODY}</code>. Insert each [name] with the magic text button (…) so MacroDroid fills it in; the names in brackets are what it calls the notification's app name, title and text.
        </li>
        <li>Name the macro "Life payments" and save it. Pay something small, then check "Last received" below.</li>
      </ol>
      <div className="pl-actions">
        <button className="btn small ghost" onClick={() => copy(url)}>
          Copy URL
        </button>
        <button className="btn small ghost" onClick={() => copy(BODY)}>
          Copy body
        </button>
        <button className="btn small" onClick={() => void test()} data-testid="pp-test">
          Send test
        </button>
      </div>
      <p className="pl-muted">Send test posts a made-up 1,00 MDL payment {fresh ? 'with your new key, the way MacroDroid will' : 'from this app'}. It shows in To sort marked "test" and never goes into Finance Helper.</p>

      <h3 className="pl-sub">Last received</h3>
      {recent.length ? (
        <ul className="pl-list" data-testid="pp-recent">
          {recent.map((it) => (
            <li key={it.id}>
              <span className="pl-muted">{timeAgo(new Date(it.at).toISOString())}</span> · {resultLine(it)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pl-muted">Nothing yet.</p>
      )}
    </section>
  )
}
