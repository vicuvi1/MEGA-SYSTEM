// One AudioContext per page (SO1): only soundKit.ts may make one. The embedded
// apps keep a local fallback for when they run on their own (SO4).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const APPS = join(__dirname, '..', 'public', 'apps')
const MAKES = /new\s*\(?\s*(?:window\.)?(?:webkit)?AudioContext\b|new\s+AudioCtx\b/

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (f === 'node_modules' || f.startsWith('.')) continue
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx|js|mjs|html)$/.test(f) && !f.endsWith('.test.ts')) out.push(p)
  }
  return out
}

describe('one sound engine', () => {
  it('no AudioContext outside soundKit.ts', () => {
    const bad = files(ROOT).filter((p) => !p.startsWith(APPS) && !p.endsWith('soundKit.ts') && MAKES.test(readFileSync(p, 'utf8')))
    expect(bad).toEqual([])
  })
  it('each embedded app sends its sounds to Life System', () => {
    for (const app of ['finance', 'man', 'sport', 'waky']) {
      const text = files(join(APPS, app)).map((p) => readFileSync(p, 'utf8')).join('\n')
      expect(/action:\s*'SOUND'/.test(text), app).toBe(true)
    }
  })
})
