// apps/sport/sportkit.js is src/core/sportKit.ts bundled for the embedded
// Sport Track page. This fails when it is out of date: run `npm run build:sport`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
// The build settings live in vite.sport.mts (imported at run time: tsc doesn't check .mts imports).
const config = '../../vite.sport.mts'

const committed = resolve(__dirname, '../renderer/public/apps/sport/sportkit.js')

describe('sportkit.js bundle', () => {
  it('is up to date (npm run build:sport)', async () => {
    const { sportKitBuild } = await import(/* @vite-ignore */ config)
    const out: any = await build({ configFile: false, publicDir: false, logLevel: 'silent', build: { ...sportKitBuild, write: false } })
    const code = (Array.isArray(out) ? out[0] : out).output[0].code as string
    const norm = (s: string) => s.replace(/\r\n/g, '\n').trim()
    expect(norm(readFileSync(committed, 'utf8')) === norm(code), 'sportkit.js is stale: run npm run build:sport').toBe(true)
  }, 30000)

  it('exposes what the page uses as window.SportKit', () => {
    const src = readFileSync(committed, 'utf8')
    const g: any = {}
    new Function('window', src + '\nwindow.SportKit = SportKit;')(g)
    for (const k of ['MOVES', 'GROUPS', 'FAMILIES', 'moveById', 'moveOf', 'frameAt', 'stillFrame', 'boxOf', 'suggestHarder', 'ladderOf', 'loggedMoves', 'levelOf', 'computeBadges', 'newBadges']) expect(g.SportKit[k], k).toBeDefined()
    expect(g.SportKit.moveOf({ name: 'Push-ups' }).id).toBe('pushup')
  })
})
