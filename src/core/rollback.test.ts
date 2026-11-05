import { describe, expect, it } from 'vitest'
import { compareVersions, isSkipped, previousRelease } from './rollback'

const rel = (tag: string, names: string[], extra = {}) => ({ tag_name: tag, assets: names.map((n, i) => ({ name: n, url: `https://api.github.com/a/${tag}/${i}` })), ...extra })

describe('go back one version', () => {
  it('compares versions by number, not text', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1)
    expect(compareVersions('v1.4.0', '1.4.0')).toBe(0)
    expect(compareVersions('1.3.9', '1.4.0')).toBe(-1)
  })
  it('picks the newest older release that has a Windows installer', () => {
    const list = [
      rel('v1.5.0', ['Life-System-Setup-1.5.0.exe']),
      rel('v1.4.0', ['Life-System-Setup-1.4.0.exe', 'Life-System-Setup-1.4.0.exe.blockmap']),
      rel('v1.3.2', ['Life-System-Setup-1.3.2.exe'], { draft: true }),
      rel('v1.3.1', ['latest.yml']),
      rel('v1.3.0', ['Life-System-Setup-1.3.0.exe'])
    ]
    expect(previousRelease(list, '1.5.0')).toEqual({ version: '1.4.0', asset: { name: 'Life-System-Setup-1.4.0.exe', url: 'https://api.github.com/a/v1.4.0/0' } })
    expect(previousRelease(list, '1.4.0')?.version).toBe('1.3.0') // draft and installer-less skipped
    expect(previousRelease(list, '1.3.0')).toBeNull()
  })
  it('the version you went back from is not offered again, a newer one is', () => {
    expect(isSkipped('1.5.0', '1.5.0')).toBe(true)
    expect(isSkipped('1.5.1', '1.5.0')).toBe(false)
    expect(isSkipped('1.5.0', null)).toBe(false)
  })
})
