import { describe, expect, it } from 'vitest'
import { embedPhoneCss, embedThemeCss, readTokens } from './embedTheme'

const t = readTokens((n) => ({ '--surface': '#fff', '--accent': '#123456' })[n] ?? '', true)

describe('the embedded apps in Life System’s look', () => {
  it('points each app’s own colour variables at ours', () => {
    expect(embedThemeCss('sport', t)).toContain('--card-bg: #fff')
    expect(embedThemeCss('sport', t)).toContain('--cyan-neon: #123456')
    expect(embedThemeCss('waky', t)).toContain('--surface: #fff')
    expect(embedThemeCss('man', t)).toContain('--card-bg: #fff')
  })
  it('follows light mode and gives MAN a phone layout', () => {
    expect(embedThemeCss('waky', t)).toContain('color-scheme: light')
    // Phone layouts are separate from the colours (U6): MAN and Sport Track both get one.
    expect(embedPhoneCss('man')).toContain('@media (max-width: 620px)')
    expect(embedPhoneCss('sport')).toContain('.hud-metrics')
    expect(embedPhoneCss('waky')).toBe('')
    expect(embedThemeCss('sport', t)).not.toContain('@media')
  })
  it('falls back to safe colours when a token is missing', () => {
    expect(readTokens(() => '', false).bg).toBe('#0b0d12')
  })
})
