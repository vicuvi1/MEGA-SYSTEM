// Settings → PC & automation (AU1, AU2, AU7–AU10). Everything here is free
// and OFF until you turn it on:
// - this PC (desktop app): pause music during focus, what's playing on the
//   island, ActivityWatch, the last hour for Ben, Ben's actions (+ their log);
// - phone push by ntfy (free app, no account);
// - n8n flows: webhooks out on chosen events, one door in;
// - Ben's outside tools: your own MCP servers, the tools you tick.
// The server keeps topics, tokens and addresses; this page only sees hints.
import { useCallback, useEffect, useState } from 'react'
import type { PcActLogLine, PcExtraPrefs } from '@core/pcExtra'
import { HOOK_EVENT_LABEL, type HookEvent, type McpTool } from '@core/automation'
import { mediaLine } from '@core/pcMedia'
import { currentSession } from './web/session'
import { Row, Segmented, Switch } from './settingsUi'
import { timeAgo, useAction } from './ui'
import { Icon } from './Icon'
import { mcpUrl } from './AiAppsPanel'
import { pcAutoRefresh } from './pcAutomation'
import { AutomationsPanel } from './AutomationsPanel'

type View = {
  ntfy: { on: boolean; server: string; topicHint: string; level: 'reminders' | 'all' }
  hooks: { id: string; urlHint: string; events: HookEvent[]; on: boolean; last: { at: number; status: number | string } | null }[]
  hookEvents: HookEvent[]
  mcp: { id: string; label: string; urlHint: string; hasToken: boolean; tools: McpTool[]; at: number; error: string | null }[]
  test?: string
}

async function call(body: unknown): Promise<View> {
  const r = await fetch('/api/mcp?op=automation', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Life System answered ${r.status}`)
  return j
}

const ago = (t: number) => timeAgo(new Date(t).toISOString())

function ThisPc() {
  const desk = window.desktop
  const act = useAction()
  const [p, setP] = useState<PcExtraPrefs | null>(null)
  const [win, setWin] = useState(true)
  const [log, setLog] = useState<PcActLogLine[]>([])
  const [aw, setAw] = useState<boolean | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const load = useCallback(() => {
    desk?.pcx?.('prefs').then((r: { prefs: PcExtraPrefs; windows: boolean } | null) => r && (setP(r.prefs), setWin(r.windows))).catch(() => {})
    desk?.pcx?.('log').then((l: PcActLogLine[] | null) => setLog(l ?? [])).catch(() => {})
  }, [desk])
  useEffect(load, [load])
  if (!desk?.pcx) return <p className="hint small">Update the desktop app to get these settings.</p>
  if (!p) return <p className="hint small">Loading…</p>
  const set = async (patch: Partial<PcExtraPrefs>) => {
    const next = await desk.pcx!('setPrefs', patch)
    if (next) setP(next)
    pcAutoRefresh()
  }
  return (
    <>
      {!win && <p className="hint small">Music, typing and keys work on Windows only.</p>}
      <Row title="Pause my music when focus starts" hint="Spotify, YouTube or any player Windows shows in its volume flyout. It plays again when the focus block ends (only if it was playing and paused by this).">
        <Switch label="Pause music during focus" on={p.pauseMusic} onChange={(v) => void set({ pauseMusic: v })} />
      </Row>
      <Row title="Show what's playing on the island" hint={playing != null ? playing || 'Nothing is playing right now.' : 'Title and artist with ⏮ ⏯ ⏭ on the open island. Asked only while the island is open (every 30 s).'}>
        <div className="row">
          <button type="button" className="btn small ghost" onClick={() => void act(async () => setPlaying(mediaLine((await desk.pcx!('media', 'get'))?.now ?? null)))}>
            Check
          </button>
          <Switch label="Music on the island" on={p.islandMedia} onChange={(v) => void set({ islandMedia: v })} />
        </div>
      </Row>
      <Row title="Read ActivityWatch" hint={aw == null ? 'If the free ActivityWatch app runs on this PC (activitywatch.net), the last hour comes from it: apps and websites. Otherwise the island\'s own app sensor is used.' : aw ? 'ActivityWatch answered.' : 'ActivityWatch did not answer on this PC (is it running?).'}>
        <div className="row">
          <button type="button" className="btn small ghost" onClick={() => void act(async () => setAw(!!(await desk.pcx!('awCheck'))))}>
            Check
          </button>
          <Switch label="Read ActivityWatch" on={p.activityWatch} onChange={(v) => void set({ activityWatch: v })} />
        </div>
      </Row>
      <Row title="Ben sees my last hour" hint="Every 10 minutes: app names, website names and minutes (“35 min YouTube, 10 min VS Code”), so Ben can call out drift from your plan. Never window titles or full addresses.">
        <Switch label="Share the last hour" on={p.shareLastHour} onChange={(v) => void set({ shareLastHour: v })} />
      </Row>
      <Row title="Ben can do things on this PC" hint="Open an app or a link, type a short text, press keys, open a Windows feature. Each one waits for your Allow on the island. Never banking, passwords, Windows Security, the registry or a command line; at most 4 a minute.">
        <Switch label="Ben's PC actions" on={p.benActions} onChange={(v) => void set({ benActions: v })} />
      </Row>
      {log.length > 0 && (
        <>
          <h4 className="ai-h">What Ben did on this PC</h4>
          <ul className="ai-list">
            {log.slice(0, 12).map((l, i) => (
              <li key={`${l.at}-${i}`}>
                <span className="ai-name">
                  {l.result === 'done' ? '✅' : l.result === 'denied' ? '🙅' : '🚫'} {l.what}
                  <small>
                    {ago(l.at)}
                    {l.why ? ` · ${l.why}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn small ghost" onClick={() => void act(async () => (await desk.pcx!('clearLog'), setLog([])), 'Log cleared')}>
              Clear the log
            </button>
          </div>
        </>
      )}
    </>
  )
}

export function PcAutomationPanel() {
  const act = useAction()
  const [v, setV] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [server, setServer] = useState('')
  const [hookUrl, setHookUrl] = useState('')
  const [hookEv, setHookEv] = useState<HookEvent[]>(['task_done', 'focus_done', 'habit_logged', 'day_closed', 'mustdo_late'])
  const [mcp, setMcp] = useState({ label: '', url: '', token: '' })
  const run = async (body: unknown, ok?: string) => {
    const r = await act(() => call(body), ok)
    if (r) setV(r)
    return r
  }
  useEffect(() => {
    call({ action: 'get' }).then((r) => (setV(r), setServer(r.ntfy.on ? r.ntfy.server : '')), (e) => setErr((e as Error).message))
  }, [])
  const door = `${mcpUrl().replace(/\/api\/mcp$/, '')}/api/hook`
  return (
    <>
      {window.desktop && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="expand" /> This PC
            </h2>
          </header>
          <ThisPc />
        </section>
      )}
      {err && <p className="hint warn-text">{err}</p>}
      {!v && !err && <p className="hint small">Loading…</p>}
      {v && (
        <>
          <section className="panel">
            <header className="panel-head">
              <h2>
                <Icon name="bell" /> Phone push by ntfy
              </h2>
            </header>
            <p className="hint block">Free, no account: install the ntfy app on your phone and subscribe to a topic only you know. Ben's reminders and urgent alerts then also arrive there (a backup for Telegram). The topic stays on the server.</p>
            <Row title="Topic" hint={v.ntfy.on ? `Saved (${v.ntfy.topicHint}). Type a new one to change it.` : 'Like life-7f3k9q2: long and hard to guess (anyone with the name can read it).'}>
              <input className="ai-input" value={topic} maxLength={64} onChange={(e) => setTopic(e.target.value.trim())} placeholder={v.ntfy.on ? v.ntfy.topicHint : 'your-secret-topic'} aria-label="ntfy topic" autoComplete="off" />
            </Row>
            <Row title="Server" hint="Leave empty for ntfy.sh, or your own ntfy server (https).">
              <input className="ai-input" value={server} maxLength={200} onChange={(e) => setServer(e.target.value.trim())} placeholder="https://ntfy.sh" aria-label="ntfy server" />
            </Row>
            <Row title="What goes there">
              <Segmented label="What goes to ntfy" value={v.ntfy.level} options={[['reminders', 'Reminders + urgent'], ['all', 'Everything Ben sends']]} onChange={(level) => v.ntfy.on && void run({ action: 'ntfySet', topic: '', server: server || v.ntfy.server, level })} />
            </Row>
            <div className="row">
              <button type="button" className="btn primary" disabled={!topic && !v.ntfy.on} onClick={() => void run({ action: 'ntfySet', topic, server, level: v.ntfy.level }, 'Saved').then((r) => r && setTopic(''))}>
                Save
              </button>
              <button type="button" className="btn small ghost" disabled={!v.ntfy.on} onClick={() => void run({ action: 'ntfyTest' })}>
                Send test
              </button>
              {v.ntfy.on && (
                <button type="button" className="btn small ghost" onClick={() => void run({ action: 'ntfySet', off: true }, 'ntfy turned off')}>
                  Turn off
                </button>
              )}
            </div>
            {v.test && <p className="hint small" role="status">{v.test}</p>}
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>
                <Icon name="link" /> n8n flows
              </h2>
            </header>
            <p className="hint block">Webhooks out: when something happens, the server sends a small JSON to your n8n (or Make, Zapier…) webhook: {'{'}event, at, day, text, points{'}'}. https only, tried twice, within a few minutes (Ben's server checks every few minutes).</p>
            {v.hooks.length > 0 && (
              <ul className="ai-list">
                {v.hooks.map((h) => (
                  <li key={h.id}>
                    <span className="ai-name">
                      {h.urlHint}
                      <small>
                        {h.events.map((e) => HOOK_EVENT_LABEL[e]).join(', ') || 'no events'}
                        {h.last ? ` · last ${ago(h.last.at)}: ${h.last.status}` : ''}
                      </small>
                    </span>
                    <Switch label="Webhook on" on={h.on} onChange={(on) => void run({ action: 'hookSet', id: h.id, on })} />
                    <button type="button" className="btn small ghost" onClick={() => void run({ action: 'hookTest', id: h.id })}>
                      Test
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => void run({ action: 'hookRemove', id: h.id }, 'Removed')}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {v.test && v.hooks.length > 0 && <p className="hint small" role="status">{v.test}</p>}
            <Row title="Webhook address" hint="Your n8n Webhook node's production URL.">
              <input className="ai-input" value={hookUrl} maxLength={500} onChange={(e) => setHookUrl(e.target.value.trim())} placeholder="https://n8n.example.com/webhook/…" aria-label="Webhook address" />
            </Row>
            <div className="row" role="group" aria-label="Events">
              {v.hookEvents.map((e) => (
                <label key={e} className="hint small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginRight: 10 }}>
                  <input type="checkbox" checked={hookEv.includes(e)} onChange={(x) => setHookEv((l) => (x.target.checked ? [...l, e] : l.filter((y) => y !== e)))} />
                  {HOOK_EVENT_LABEL[e]}
                </label>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn primary" disabled={!hookUrl || !hookEv.length} onClick={() => void run({ action: 'hookAdd', url: hookUrl, events: hookEv }, 'Webhook added').then((r) => r && setHookUrl(''))}>
                Add webhook
              </button>
            </div>
            <h4 className="ai-h">The door in (n8n → Life System)</h4>
            <p className="hint small">An HTTP Request node: POST to this address with a “read and write” token from Connect an AI app as “Authorization: Bearer …”. It lands on the Coach page with Undo; a habit pays only when logged now.</p>
            <div className="ai-code">
              <pre>{`POST ${door}\n{"action": "add_task", "text": "Call the dentist tomorrow 10:00"}\n{"action": "note", "title": "Inbox", "text": "Idea from n8n"}\n{"action": "ask_ben", "text": "How is my day going?"}\n{"action": "log_habit", "habit": "skincare"}`}</pre>
            </div>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>
                <Icon name="bot" /> Ben's outside tools (MCP)
              </h2>
            </header>
            <p className="hint block">Add a remote MCP server (Streamable HTTP, https). Tick the tools Ben may use: he calls one when it helps, gets a short answer (8 s at most) and uses it in his reply. The token stays on the server.</p>
            {v.mcp.map((s) => (
              <div key={s.id} className="ai-new">
                <b>{s.label}</b> <small className="hint">{s.urlHint}{s.hasToken ? ' · token saved' : ''}{s.at ? ` · checked ${ago(s.at)}` : ''}</small>
                {s.error && <p className="hint warn-text">{s.error}</p>}
                {s.tools.length === 0 && !s.error && <p className="hint small">No tools.</p>}
                {s.tools.map((t) => (
                  <label key={t.name} className="hint small" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '4px 0' }}>
                    <input type="checkbox" checked={t.allowed} onChange={(x) => void run({ action: 'mcpTools', id: s.id, allowed: s.tools.filter((y) => (y.name === t.name ? x.target.checked : y.allowed)).map((y) => y.name) })} />
                    <span>
                      <b>{t.name}</b> {t.description}
                    </span>
                  </label>
                ))}
                <div className="row">
                  <button type="button" className="btn small ghost" onClick={() => void run({ action: 'mcpRefresh', id: s.id }, 'Checked')}>
                    Check again
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => void run({ action: 'mcpRemove', id: s.id }, 'Removed')}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <Row title="Name">
              <input className="ai-input" value={mcp.label} maxLength={40} onChange={(e) => setMcp({ ...mcp, label: e.target.value })} placeholder="Weather" aria-label="Server name" />
            </Row>
            <Row title="Address" hint="https only; local and private addresses are refused.">
              <input className="ai-input" value={mcp.url} maxLength={500} onChange={(e) => setMcp({ ...mcp, url: e.target.value.trim() })} placeholder="https://mcp.example.com/mcp" aria-label="Server address" />
            </Row>
            <Row title="Token (optional)" hint="Sent as “Authorization: Bearer …”. Never shown again.">
              <input className="ai-input" type="password" value={mcp.token} maxLength={2000} onChange={(e) => setMcp({ ...mcp, token: e.target.value.trim() })} aria-label="Server token" autoComplete="off" />
            </Row>
            <div className="row">
              <button type="button" className="btn primary" disabled={!mcp.url} onClick={() => void run({ action: 'mcpAdd', ...mcp }, 'Connected').then((r) => r && setMcp({ label: '', url: '', token: '' }))}>
                Connect
              </button>
            </div>
          </section>
        </>
      )}
      {/* Automation hub: "When X, do Y", island buttons, flows, n8n, scripts, the run log. */}
      <AutomationsPanel />
    </>
  )
}
