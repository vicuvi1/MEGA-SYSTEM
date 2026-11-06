import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanConfig, isPublicHost, validateManifest } from './manifest'

const good = { id: 'my-widget', name: 'Mine', version: '1.2.3', author: 'Someone', about: 'Does a thing', size: '2x1', refresh: 60, permissions: ['read', 'network'], hosts: ['api.weather.example.org'.replace('example.org', 'test-site.io')] }

describe('widget manifests (PL1)', () => {
  it('accepts a good manifest', () => {
    const r = validateManifest(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.manifest).toMatchObject({ id: 'my-widget', size: '2x1', permissions: ['read', 'network'], hosts: ['api.weather.test-site.io'] })
  })
  it('refuses anything odd', () => {
    const bad = (patch: Record<string, unknown>) => validateManifest({ ...good, ...patch })
    expect(bad({ id: 'Bad Id' }).ok).toBe(false)
    expect(bad({ version: '1' }).ok).toBe(false)
    expect(bad({ size: '3x3' }).ok).toBe(false)
    expect(bad({ refresh: 1 }).ok).toBe(false)
    expect(bad({ refresh: 99999 }).ok).toBe(false)
    expect(bad({ permissions: ['read', 'database'] }).ok).toBe(false)
    expect(bad({ permissions: ['read', 'pin'] }).ok).toBe(false)
    expect(bad({ hosts: [] }).ok).toBe(false) // network without hosts
    expect(bad({ permissions: ['read'] }).ok).toBe(false) // hosts without network
    expect(bad({ hosts: ['127.0.0.1'] }).ok).toBe(false)
    expect(bad({ hosts: ['localhost'] }).ok).toBe(false)
    expect(bad({ hosts: ['printer.local'] }).ok).toBe(false)
    expect(bad({ hosts: ['evil.com:8080'] }).ok).toBe(false)
    expect(bad({ hosts: ['https://evil.com'] }).ok).toBe(false)
    expect(bad({ script: 'x' }).ok).toBe(false) // unknown field
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest([]).ok).toBe(false)
  })
  it('public hosts only', () => {
    expect(isPublicHost('api.open-meteo.com')).toBe(true)
    for (const h of ['10.0.0.1', '[::1]', 'localhost', 'router.lan', 'a', 'x.internal', 'my.test', '']) expect(isPublicHost(h)).toBe(false)
  })
  it('cleans settings against the manifest', () => {
    const r = validateManifest({ ...good, permissions: [], hosts: [], settings: [{ key: 'date', label: 'Date', kind: 'date' }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(cleanConfig(r.manifest, { date: '2026-12-01', other: 'x' })).toEqual({ date: '2026-12-01' })
    expect(cleanConfig(r.manifest, { date: 'soon' })).toEqual({})
  })
  it('every widget in the repo has a valid manifest whose id is its folder', () => {
    const dir = join(__dirname, '..', '..', '..', 'widgets')
    const ids = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    expect(ids.length).toBeGreaterThanOrEqual(4)
    for (const id of ids) {
      const r = validateManifest(JSON.parse(readFileSync(join(dir, id, 'manifest.json'), 'utf8')))
      expect(r.ok, `${id}: ${r.ok ? '' : r.errors.join('; ')}`).toBe(true)
      if (r.ok) expect(r.manifest.id).toBe(id)
    }
  })
})
