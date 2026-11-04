// The desktop app must start on Windows: once an `else` before
// app.whenReady() made it start everywhere except Windows (it sat in the
// background with no window). This guards the startup line.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, 'main.ts'), 'utf8')

describe('desktop startup', () => {
  it('starts the app on every platform, only behind the single-copy lock', () => {
    const line = src.split('\n').find((l) => l.includes('app.whenReady()'))
    expect(line).toBeDefined()
    expect(line!.trim()).toMatch(/^if \(firstCopy\) void app\.whenReady\(\)/)
  })
  it('has no platform check in front of the startup', () => {
    const lines = src.split('\n')
    const i = lines.findIndex((l) => l.includes('app.whenReady()'))
    expect(lines[i - 1]).not.toMatch(/platform/)
    expect(lines[i]).not.toMatch(/^\s*else\b/)
  })
})
