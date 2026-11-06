// Every Settings section has its own icon (two bells or three sparkles in the list were confusing).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Settings icons', () => {
  it('no two sections share an icon', () => {
    const src = readFileSync(join(__dirname, 'pages/Settings.tsx'), 'utf8')
    const icons = [...src.matchAll(/icon: '(\w+)'/g)].map((m) => m[1])
    expect(icons.length).toBeGreaterThan(15)
    const dupes = icons.filter((x, i) => icons.indexOf(x) !== i)
    expect(dupes).toEqual([])
  })
})
