import { describe, expect, it } from 'vitest'
import { join, resolve, sep } from 'node:path'
import { readFileSync } from 'node:fs'
import { appFile, rendererRoot, soundFallbackRoute } from './appFiles'

describe('the desktop page files (dev and installed)', () => {
  const dev = resolve('/repo/out/main')
  const prod = resolve('/Users/x/AppData/Local/Programs/life-system/resources/app.asar/out/main')
  it('out/main → out/renderer in both', () => {
    expect(rendererRoot(dev)).toBe(resolve('/repo/out/renderer'))
    expect(rendererRoot(prod)).toBe(resolve('/Users/x/AppData/Local/Programs/life-system/resources/app.asar/out/renderer'))
  })
  it('serves the page and its files, the island page too', () => {
    for (const root of [rendererRoot(dev), rendererRoot(prod)]) {
      expect(appFile(root, '/')).toBe(join(root, 'index.html'))
      expect(appFile(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'))
      expect(appFile(root, '/widgets/frame.html')).toBe(join(root, 'widgets', 'frame.html'))
      expect(appFile(root, '/my%20file.png')).toBe(join(root, 'my file.png'))
    }
  })
  it('never leaves the page folder', () => {
    const root = rendererRoot(dev)
    expect(appFile(root, '/../main/index.js')).toBeNull()
    expect(appFile(root, '/%2e%2e/%2e%2e/secret')).toBeNull()
    expect(appFile(root, '/%E0%A4%A')).toBeNull()
    expect(appFile(root, '/a%00b')).toBeNull()
    expect(appFile(root, '/..' + sep + 'x')).toBeNull()
  })
})

describe('the island sound fallback', () => {
  it('the app window first, a system beep only without one', () => {
    expect(soundFallbackRoute(true)).toBe('app window')
    expect(soundFallbackRoute(false)).toBe('system beep')
  })
})

describe('packaging', () => {
  it('the island needs no sound files: every kit sound is synthesized, and the build ships out/**', () => {
    const kit = readFileSync(resolve(__dirname, '../renderer/src/soundKit.ts'), 'utf8')
    expect(kit).not.toMatch(/\.(mp3|wav|ogg)\b/)
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
    expect(pkg.build.files).toContain('out/**')
  })
  it('the island window plays without a click, and the app sets the switch before ready', () => {
    const island = readFileSync(resolve(__dirname, 'island.ts'), 'utf8')
    expect(island).toMatch(/autoplayPolicy: 'no-user-gesture-required'/)
    const main = readFileSync(resolve(__dirname, 'main.ts'), 'utf8')
    const sw = main.indexOf("appendSwitch('autoplay-policy', 'no-user-gesture-required')")
    expect(sw).toBeGreaterThan(0)
    expect(sw).toBeLessThan(main.indexOf('app.whenReady'))
  })
})
