// Settings → Connect an AI app (MC1, MC4, MC5): personal tokens for Claude,
// ChatGPT and other MCP apps. A token is shown once; the server keeps only a
// hash. "Read only" can see your day; "Read and write" can also log things,
// each landing on the Coach page with Undo. Remove a connection any time;
// "Sign out all devices" or a new PIN ends every one.
import { useCallback, useEffect, useState } from 'react'
import bridgeSource from '../../../scripts/life-mcp.mjs?raw'
import { currentSession } from './web/session'
import { askConfirm } from './confirmSheet'
import { Row, Segmented } from './settingsUi'
import { timeAgo, useAction } from './ui'
import { Icon } from './Icon'

type Conn = { id: string; label: string; scope: 'read' | 'write'; created: number; lastUsed: number | null }
type Created = Conn & { token: string }

const LIVE = 'https://mega-system-ten.vercel.app'
/** The address AI apps use (the desktop app's own pages aren't on the web). */
export const mcpUrl = (origin = typeof location !== 'undefined' ? location.origin : '') => `${/^https?:\/\//.test(origin) ? origin : LIVE}/api/mcp`

/** The config snippets the panel shows, with the token filled in. */
export function snippets(url: string, token: string, bridgePath = 'C:/Users/you/Downloads/life-mcp.mjs') {
  return {
    claudeCode: `claude mcp add --transport http life-system ${url} --header "Authorization: Bearer ${token}"`,
    claudeCodeBridge: `claude mcp add life-system -e LIFE_MCP_TOKEN=${token} -e LIFE_MCP_URL=${url} -- node ${bridgePath}`,
    desktop: JSON.stringify({ mcpServers: { 'life-system': { command: 'node', args: [bridgePath], env: { LIFE_MCP_TOKEN: token, LIFE_MCP_URL: url } } } }, null, 2)
  }
}

async function call(body: unknown): Promise<{ tokens: Conn[]; created?: Created }> {
  const r = await fetch('/api/mcp?op=tokens', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Life System answered ${r.status}`)
  return j
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const act = useAction()
  return (
    <button type="button" className="btn small ghost" onClick={() => void act(() => navigator.clipboard.writeText(text), 'Copied')}>
      {label}
    </button>
  )
}

function Code({ text }: { text: string }) {
  return (
    <div className="ai-code">
      <pre>{text}</pre>
      <Copy text={text} />
    </div>
  )
}

export function AiAppsPanel() {
  const act = useAction()
  const [list, setList] = useState<Conn[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [label, setLabel] = useState('Claude Desktop')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [created, setCreated] = useState<Created | null>(null)
  const url = mcpUrl()
  const load = useCallback(async () => {
    try {
      setList((await call({ action: 'list' })).tokens)
      setErr(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    const r = await act(() => call({ action: 'create', label, scope }))
    if (r?.created) {
      setCreated(r.created)
      setList(r.tokens)
    }
  }
  const remove = async (c: Conn) => {
    if (!(await askConfirm(`Remove ${c.label}? It stops working right away.`, { ok: 'Remove' }))) return
    const r = await act(() => call({ action: 'revoke', id: c.id }), 'Removed')
    if (r) setList(r.tokens)
    if (created?.id === c.id) setCreated(null)
  }
  const download = () => {
    const blob = new Blob([bridgeSource], { type: 'text/javascript' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'life-mcp.mjs'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const s = snippets(url, created?.token ?? '<your token>')

  return (
    <>
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="bot" /> Connect an AI app
          </h2>
        </header>
        <p className="hint block">Let Claude, ChatGPT or another AI app see your day and, if you allow it, log things for you. Everything it changes shows on the Coach page with Undo, and earns points exactly like Ben.</p>
        <Row title="Name" hint="So you know which app it is.">
          <input className="ai-input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} aria-label="Connection name" />
        </Row>
        <Row title="What it may do" hint={scope === 'read' ? 'See your day, tasks, calendar, habits, sleep, money totals, notes.' : 'Also log water and workouts, add must-dos, tasks, expenses, notes, reminders, start focus, talk to Ben.'}>
          <Segmented
            label="Access"
            value={scope}
            options={[
              ['read', 'Read only'],
              ['write', 'Read and write']
            ]}
            onChange={setScope}
          />
        </Row>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void create()} disabled={!label.trim()}>
            Make a token
          </button>
        </div>
        {created && (
          <div className="ai-new" role="status">
            <b>Your token for {created.label}</b>
            <p className="hint small">Copy it now: it is shown only once. Treat it like a password.</p>
            <Code text={created.token} />
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="link" /> Your connections
          </h2>
        </header>
        {err && <p className="hint warn-text">{err}</p>}
        {!list && !err && <p className="hint small">Loading…</p>}
        {list && list.length === 0 && <p className="hint small">No AI apps connected yet.</p>}
        {list && list.length > 0 && (
          <ul className="ai-list">
            {list.map((c) => (
              <li key={c.id}>
                <span className="ai-name">
                  <b>{c.label}</b>
                  <small>
                    {c.scope === 'write' ? 'Read and write' : 'Read only'} · made {timeAgo(new Date(c.created).toISOString())} · {c.lastUsed ? `last used ${timeAgo(new Date(c.lastUsed).toISOString())}` : 'not used yet'}
                  </small>
                </span>
                <button type="button" className="btn small ghost" onClick={() => void remove(c)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint small">"Sign out all devices" or a new PIN also ends every connection.</p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="list" /> How to connect
          </h2>
        </header>
        <h4 className="ai-h">claude.ai or ChatGPT (also on the phone)</h4>
        <p className="hint small">Add a custom connector with this address. It asks for your PIN and whether the app may read only or also write. No token needed.</p>
        <Code text={url} />
        <h4 className="ai-h">Claude Code</h4>
        <p className="hint small">Make a token above, then run:</p>
        <Code text={s.claudeCode} />
        <h4 className="ai-h">Claude Desktop</h4>
        <p className="hint small">
          Either add the address above as a custom connector, or use the small bridge (needs Node.js): download it, then paste this into <code>claude_desktop_config.json</code> (Claude → Settings → Developer → Edit config), with the path where you saved it.
        </p>
        <div className="row">
          <button type="button" className="btn small" onClick={download}>
            Download the bridge (life-mcp.mjs)
          </button>
        </div>
        <Code text={s.desktop} />
        <p className="hint small">The bridge also works in Claude Code:</p>
        <Code text={s.claudeCodeBridge} />
      </section>
    </>
  )
}
