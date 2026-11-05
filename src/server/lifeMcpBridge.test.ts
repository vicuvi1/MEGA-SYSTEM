// MC5: the stdio ↔ HTTP bridge (scripts/life-mcp.mjs) passes messages both
// ways with the token, and answers notifications with nothing.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('life-mcp bridge', () => {
  it('forwards a request with the token and prints the answer', async () => {
    const seen: { auth?: string; body: any }[] = []
    const srv = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = JSON.parse(raw)
        seen.push({ auth: req.headers.authorization, body })
        if (body.id == null) {
          res.statusCode = 202
          return res.end()
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', echo: body.method } }))
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as any).port
    const child = spawn(process.execPath, [join(__dirname, '../../scripts/life-mcp.mjs')], { env: { ...process.env, LIFE_MCP_URL: `http://127.0.0.1:${port}/api/mcp`, LIFE_MCP_TOKEN: 'lsm_test_made_up' } })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    child.stdin.end()
    await new Promise((r) => child.on('exit', r))
    srv.close()
    const lines = out.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toEqual([{ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', echo: 'initialize' } }])
    expect(seen.map((s) => s.auth)).toEqual(['Bearer lsm_test_made_up', 'Bearer lsm_test_made_up'])
  }, 20_000)
})
