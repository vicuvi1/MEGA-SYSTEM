import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createUsageReader } from './usageFiles'
import { readHw } from './collect'

// Made-up log files in a throwaway folder.
const dir = mkdtempSync(join(tmpdir(), 'usage-'))
process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
process.env.CODEX_HOME = join(dir, 'codex')
process.env.HOME = dir
process.env.USERPROFILE = dir
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const line = (id: string, req: string, at: number, i: number) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), requestId: req, message: { id, model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: i, output_tokens: 10 } } }) + '\n'

describe('reading the logs', () => {
  it('reads new lines only, counts a message once, and skips half-written lines', async () => {
    const now = Date.now()
    const p = join(dir, 'claude', 'projects', 'proj-a')
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 's1.jsonl'), line('m1', 'r1', now - 60_000, 100) + line('m2', 'r2', now - 30_000, 200))
    // The same message again in a resumed session's file.
    writeFileSync(join(p, 's2.jsonl'), line('m2', 'r2', now - 30_000, 200) + '{"half": ')
    const r = createUsageReader()
    let got = await r.read(0)
    expect(got.claude?.length).toBe(2)
    expect(got.codex).toBeNull()
    appendFileSync(join(p, 's1.jsonl'), line('m3', 'r3', now - 10_000, 300))
    got = await r.read(0)
    expect(got.claude?.map((e) => e.t.input).sort()).toEqual([100, 200, 300])
    expect(JSON.stringify(got)).not.toContain('hello')
  })
})

describe('hardware sensors', () => {
  it('picks CPU, GPU and SSD temperatures and the power draw', () => {
    const r = readHw([
      ['Temperature', 'CPU Package', '/intelcpu/0/temperature/0', 61],
      ['Temperature', 'GPU Core', '/gpu-nvidia/0/temperature/0', 55],
      ['Temperature', 'Temperature', '/nvme/0/temperature/0', 41],
      ['Power', 'CPU Package', '/intelcpu/0/power/0', 22.5],
      ['Power', 'GPU Package', '/gpu-nvidia/0/power/0', 30]
    ])
    expect(r).toEqual({ temps: { cpu: 61, gpu: 55, ssd: 41 }, power: 52.5 })
    expect(readHw([])).toEqual({ temps: { cpu: null, gpu: null, ssd: null }, power: null })
  })
})
