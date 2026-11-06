import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanGallery, matchesPin, sha256Hex } from './gallery'
import { validateManifest } from './manifest'
import { installWidget, DEFAULT_WIDGETS } from './settings'

const dir = join(__dirname, '..', '..', '..', 'widgets')
const gallery = JSON.parse(readFileSync(join(dir, 'gallery.json'), 'utf8'))

describe('widget gallery and hash pinning (PL3)', () => {
  it('lists the four example widgets', () => {
    expect(cleanGallery(gallery).map((e) => e.id).sort()).toEqual(['countdown', 'pomodoro', 'quote', 'streak'])
  })
  it('every gallery hash is the sha256 of that widget.js (run scripts/widget-hashes.mjs --write after a change)', async () => {
    for (const e of cleanGallery(gallery)) {
      const code = readFileSync(join(dir, e.id, 'widget.js'), 'utf8').replace(/\r\n/g, '\n')
      expect(await sha256Hex(code), e.id).toBe(e.sha256)
      expect(createHash('sha256').update(code).digest('hex')).toBe(e.sha256)
      const m = JSON.parse(readFileSync(join(dir, e.id, 'manifest.json'), 'utf8'))
      expect(m.version, `${e.id} version`).toBe(e.version)
      expect(existsSync(join(dir, e.screenshot)), `${e.id} screenshot`).toBe(true)
    }
  })
  it('pinned code runs; changed code does not', async () => {
    const code = 'widget.root.textContent = "hi"'
    const pin = await sha256Hex(code)
    expect(await matchesPin(code, pin)).toBe(true)
    expect(await matchesPin(code + ' ', pin)).toBe(false)
    expect(await matchesPin(code, 'not-a-hash')).toBe(false)
    expect(await matchesPin(code, '')).toBe(false)
  })
  it('installs are pinned to the gallery hash; a bad hash never installs', () => {
    const m = (validateManifest(JSON.parse(readFileSync(join(dir, 'streak', 'manifest.json'), 'utf8'))) as any).manifest
    const e = cleanGallery(gallery).find((x) => x.id === 'streak')!
    const s = installWidget(DEFAULT_WIDGETS, m, e.sha256, 'fun', new Date(0))
    expect(s.installed[0]).toMatchObject({ id: 'streak', sha256: e.sha256, page: 'fun', grants: { read: true, network: [], add: false, sound: false } })
    expect(installWidget(DEFAULT_WIDGETS, m, 'abc', 'fun', new Date(0)).installed).toEqual([])
  })
  it('drops broken gallery entries', () => {
    expect(cleanGallery({ widgets: [{ id: 'x', sha256: 'zz', version: '1.0.0' }, { id: 'Bad', sha256: 'a'.repeat(64), version: '1.0.0' }, { id: 'ok-one', sha256: 'a'.repeat(64), version: '1.0.0', screenshot: '../../etc.png' }] })).toEqual([
      { id: 'ok-one', name: 'ok-one', author: '', version: '1.0.0', sha256: 'a'.repeat(64), screenshot: '', about: '' }
    ])
  })
})
