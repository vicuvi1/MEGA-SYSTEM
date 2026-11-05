#!/usr/bin/env node
// Life System as a local MCP server for Claude Desktop / Claude Code (MC5):
// a tiny stdio ↔ HTTP bridge. It reads JSON-RPC messages (one per line) on
// stdin, sends each to your Life System (/api/mcp) with your personal token,
// and writes the answers to stdout. Nothing is stored; no dependencies.
//
//   LIFE_MCP_TOKEN  the token from Life System → Settings → Connect an AI app
//   LIFE_MCP_URL    optional, default https://mega-system-ten.vercel.app/api/mcp
//
// Claude Code:   claude mcp add life-system -e LIFE_MCP_TOKEN=<token> -- node /path/to/life-mcp.mjs
// Claude Desktop (claude_desktop_config.json):
//   { "mcpServers": { "life-system": { "command": "node", "args": ["/path/to/life-mcp.mjs"], "env": { "LIFE_MCP_TOKEN": "<token>" } } } }
import { createInterface } from 'node:readline'

const URL_ = (process.env.LIFE_MCP_URL || 'https://mega-system-ten.vercel.app/api/mcp').trim()
const TOKEN = (process.env.LIFE_MCP_TOKEN || '').trim()
const log = (...a) => process.stderr.write(`[life-mcp] ${a.join(' ')}\n`)
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const fail = (id, code, message) => out({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

if (!TOKEN) log('LIFE_MCP_TOKEN is not set: make a token in Life System (Settings → Connect an AI app).')

let version = ''
let pending = 0
let closed = false

async function forward(msg) {
  const ids = (Array.isArray(msg) ? msg : [msg]).filter((m) => m && m.id != null).map((m) => m.id)
  if (!TOKEN) {
    for (const id of ids) fail(id, -32001, 'LIFE_MCP_TOKEN is not set: make a token in Life System (Settings → Connect an AI app)')
    return
  }
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(version ? { 'Mcp-Protocol-Version': version } : {}) },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 202) return
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    if (body && (body.jsonrpc || Array.isArray(body))) {
      // Remember the version the server picked (sent on later requests).
      const init = (Array.isArray(body) ? body : [body]).find((b) => b?.result?.protocolVersion)
      if (init) version = init.result.protocolVersion
      // A 401/429/503 answer carries id null: give it the request's id.
      if (!Array.isArray(body) && body.error && body.id == null && ids.length) for (const id of ids) out({ ...body, id })
      else out(body)
      return
    }
    for (const id of ids) fail(id, -32000, `Life System answered ${res.status}`)
  } catch (e) {
    log('request failed:', e?.message || e)
    for (const id of ids) fail(id, -32000, `Can't reach Life System (${e?.name === 'TimeoutError' ? 'timed out' : 'offline?'})`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const t = line.trim()
  if (!t) return
  let msg
  try {
    msg = JSON.parse(t)
  } catch {
    return fail(null, -32700, 'Parse error')
  }
  pending++
  forward(msg).finally(() => {
    pending--
    if (closed && !pending) process.exit(0)
  })
})
rl.on('close', () => {
  closed = true
  if (!pending) process.exit(0)
})
