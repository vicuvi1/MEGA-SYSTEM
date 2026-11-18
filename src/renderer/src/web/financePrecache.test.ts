// Finance Helper's offline list (public/apps/finance/sw.js SHELL) is kept by
// hand. A script or style sheet that is not in it is missing the first time
// Money opens without a connection (two were: 2026-11-18). This fails when a
// file is added to the app and not to the list, or the list names a file that
// is gone (one missing file makes the whole install fail).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../public/apps/finance')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}
const shell = () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8')
  const list = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')))
  return [...list.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1])
}

describe('Finance Helper works offline: its precache list is complete', () => {
  it('every script and style sheet of the app is in sw.js SHELL', () => {
    const listed = new Set(shell())
    const needed = ['js', 'css'].flatMap((d) => files(join(root, d))).filter((p) => /\.(js|css)$/.test(p)).map((p) => relative(root, p).split('\\').join('/'))
    expect(needed.length).toBeGreaterThan(100)
    expect(needed.filter((f) => !listed.has(f))).toEqual([])
  })

  it('every file the list names exists (one missing file fails the whole install)', () => {
    expect(shell().filter((f) => f && !existsSync(join(root, f)))).toEqual([])
  })

  it('no file is listed twice', () => {
    const list = shell()
    expect(list.filter((f, i) => list.indexOf(f) !== i)).toEqual([])
  })
})
