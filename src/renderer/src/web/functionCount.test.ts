// Vercel's Hobby plan runs at most 12 functions: every api/*.mjs without a
// leading "_" is one. A 13th file would make the deploy fail, so it fails here.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const api = join(__dirname, '../../../../api')

describe('Vercel functions', () => {
  it('there are at most 12 (Hobby plan)', () => {
    const fns = readdirSync(api).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    expect(fns.length, fns.join(', ')).toBeLessThanOrEqual(12)
  })
  it('the old addresses still work through rewrites (Google sign-in, bot health, OAuth metadata)', () => {
    const v = JSON.parse(readFileSync(join(api, '../vercel.json'), 'utf8'))
    const to = (src: string) => v.rewrites.find((r: any) => r.source === src)?.destination
    expect(to('/api/google-callback')).toBe('/api/google?callback=1')
    expect(to('/api/bot-health')).toBe('/api/bot-setup?health=1')
    expect(to('/.well-known/oauth-protected-resource')).toBe('/api/mcp?wk=resource')
    expect(to('/.well-known/oauth-authorization-server')).toBe('/api/mcp?wk=as')
    // Every rewrite lands on a function that exists.
    for (const r of v.rewrites) {
      const fn = /^\/api\/([a-z-]+)/.exec(r.destination)?.[1]
      expect(readdirSync(api)).toContain(`${fn}.mjs`)
    }
  })
})
