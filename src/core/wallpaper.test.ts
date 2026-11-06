import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALLPAPER,
  MAX_SHOW_THROUGH,
  WALLPAPERS,
  WALLPAPER_CATEGORIES,
  WALLPAPER_PHOTO_MAX_CHARS,
  cleanWallpaper,
  contrast,
  hexRgb,
  mixRgb,
  okWallpaperPhoto,
  wallpaperLook,
  wallpaperShows
} from './wallpaper'

const ART = join(__dirname, '..', 'renderer', 'src', 'wallpaper', 'art')

describe('cleanWallpaper', () => {
  it('gives the defaults for anything unreadable', () => {
    for (const raw of [null, undefined, 'x', 42, [], { id: 7 }]) expect(cleanWallpaper(raw)).toEqual(DEFAULT_WALLPAPER)
  })

  it('keeps a known picture, your own picture and none', () => {
    expect(cleanWallpaper({ id: 'ronin-moon' }).id).toBe('ronin-moon')
    expect(cleanWallpaper({ id: 'photo' }).id).toBe('photo')
    expect(cleanWallpaper({ id: 'none' }).id).toBe('none')
  })

  it('drops unknown pictures (and anything that looks like a link)', () => {
    expect(cleanWallpaper({ id: 'some-film-poster' }).id).toBe('none')
    expect(cleanWallpaper({ id: 'https://example.com/a.jpg' }).id).toBe('none')
    expect(cleanWallpaper({ id: '../../etc' }).id).toBe('none')
  })

  it('keeps numbers in range and whole', () => {
    const p = cleanWallpaper({ opacity: 400, blur: -3, dim: 33.6 })
    expect(p).toMatchObject({ opacity: 100, blur: 0, dim: 34 })
    expect(cleanWallpaper({ opacity: 2 }).opacity).toBe(10)
    expect(cleanWallpaper({ blur: 99 }).blur).toBe(20)
    expect(cleanWallpaper({ dim: 95 }).dim).toBe(80)
    expect(cleanWallpaper({ opacity: '55' }).opacity).toBe(55)
    expect(cleanWallpaper({ opacity: 'lots' }).opacity).toBe(DEFAULT_WALLPAPER.opacity)
    expect(cleanWallpaper({ opacity: NaN }).opacity).toBe(DEFAULT_WALLPAPER.opacity)
  })

  it('reads where, light/dark and motion strictly', () => {
    expect(cleanWallpaper({ where: 'today' }).where).toBe('today')
    expect(cleanWallpaper({ where: 'sometimes' }).where).toBe('all')
    expect(cleanWallpaper({ followTheme: false }).followTheme).toBe(false)
    expect(cleanWallpaper({ followTheme: 'no' }).followTheme).toBe(true)
    // motion is off unless it is exactly true
    expect(cleanWallpaper({ motion: 'yes' }).motion).toBe(false)
    expect(cleanWallpaper({ motion: true }).motion).toBe(true)
  })

  it('drops extra keys', () => {
    expect(Object.keys(cleanWallpaper({ id: 'nebula', evil: '<script>' })).sort()).toEqual(Object.keys(DEFAULT_WALLPAPER).sort())
  })

  it('motion is off by default', () => {
    expect(DEFAULT_WALLPAPER.motion).toBe(false)
  })
})

describe('your own picture', () => {
  it('accepts a small image data URL only', () => {
    expect(okWallpaperPhoto('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true)
    expect(okWallpaperPhoto('data:image/webp;base64,UklGRg==')).toBe(true)
    expect(okWallpaperPhoto('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(okWallpaperPhoto('https://example.com/a.jpg')).toBe(false)
    expect(okWallpaperPhoto('data:image/png;base64,abc"onerror="x')).toBe(false)
    expect(okWallpaperPhoto(null)).toBe(false)
    expect(okWallpaperPhoto('data:image/jpeg;base64,' + 'A'.repeat(WALLPAPER_PHOTO_MAX_CHARS))).toBe(false)
  })
})

describe('wallpaperShows', () => {
  const p = cleanWallpaper({ id: 'nebula' })
  it('shows everywhere, or only on Today', () => {
    expect(wallpaperShows(p, 'calendar')).toBe(true)
    expect(wallpaperShows({ ...p, where: 'today' }, 'calendar')).toBe(false)
    expect(wallpaperShows({ ...p, where: 'today' }, 'today')).toBe(true)
  })
  it('shows nothing for none, or your picture before it is there', () => {
    expect(wallpaperShows({ ...p, id: 'none' }, 'today')).toBe(false)
    expect(wallpaperShows({ ...p, id: 'photo' }, 'today', false)).toBe(false)
    expect(wallpaperShows({ ...p, id: 'photo' }, 'today', true)).toBe(true)
  })
})

describe('readability', () => {
  // The page colour and text colour of each theme (styles.css, light.css).
  const themes = {
    dark: { bg: '#07090e', text: '#f1f5f9', worst: '#ffffff' },
    light: { bg: '#f3f4f7', text: '#151922', worst: '#000000' }
  } as const

  it('never lets more than the safe share of the picture through', () => {
    for (const theme of ['dark', 'light'] as const)
      for (const opacity of [10, 40, 70, 100])
        for (const dim of [0, 30, 80])
          for (const id of ['nebula', 'katana-sun', 'photo']) {
            const look = wallpaperLook(cleanWallpaper({ id, opacity, dim }), theme)
            expect(look.showThrough).toBeLessThanOrEqual(MAX_SHOW_THROUGH + 0.001)
            expect(look.art).toBeGreaterThan(0)
            expect(look.shade).toBeGreaterThanOrEqual(dim / 100 - 0.001)
          }
  })

  it('keeps normal text at AA (4.5 : 1) even over the worst spot of a picture', () => {
    for (const theme of ['dark', 'light'] as const) {
      const t = themes[theme]
      const look = wallpaperLook(cleanWallpaper({ id: 'photo', opacity: 100, dim: 0, followTheme: false }), theme)
      const spot = mixRgb(hexRgb(t.bg), hexRgb(t.worst), look.showThrough)
      expect(contrast(hexRgb(t.text), spot)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('shades a bright picture more in dark mode, and a dark one more in light mode', () => {
    const bright = cleanWallpaper({ id: 'katana-sun', opacity: 40, dim: 20 })
    const dark = cleanWallpaper({ id: 'nebula', opacity: 40, dim: 20 })
    expect(wallpaperLook(bright, 'dark').shade).toBeGreaterThan(wallpaperLook(bright, 'light').shade)
    expect(wallpaperLook(dark, 'light').shade).toBeGreaterThan(wallpaperLook(dark, 'dark').shade)
    // and not when "Match light and dark" is off
    expect(wallpaperLook({ ...bright, followTheme: false }, 'dark').shade).toBe(wallpaperLook({ ...bright, followTheme: false }, 'light').shade)
  })

  it('the contrast helper matches known values', () => {
    expect(contrast(hexRgb('#000'), hexRgb('#fff'))).toBeCloseTo(21, 1)
    expect(contrast(hexRgb('#777777'), hexRgb('#ffffff'))).toBeCloseTo(4.48, 1)
  })
})

describe('the gallery', () => {
  it('has 20+ pictures in every group, each with a unique id and a file', () => {
    expect(WALLPAPERS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(WALLPAPERS.map((w) => w.id)).size).toBe(WALLPAPERS.length)
    for (const c of WALLPAPER_CATEGORIES) expect(WALLPAPERS.some((w) => w.category === c.id)).toBe(true)
    const files = new Set(readdirSync(ART).map((f) => f.replace(/\.svg$/, '')))
    for (const w of WALLPAPERS) expect(files.has(w.id), w.id).toBe(true)
    for (const f of files) expect(WALLPAPERS.some((w) => w.id === f), `${f}.svg is not in WALLPAPERS`).toBe(true)
  })

  it('stays small: under 1.5 MB in all, plain SVG with no scripts, links or outside images', () => {
    let total = 0
    for (const f of readdirSync(ART)) {
      const p = join(ART, f)
      total += statSync(p).size
      const svg = readFileSync(p, 'utf8')
      expect(svg.startsWith('<svg'), f).toBe(true)
      expect(svg, f).not.toMatch(/<script|<foreignObject|on[a-z]+=|href=|xlink:|<image|url\((?!#)/i)
    }
    expect(total).toBeLessThan(1.5 * 1024 * 1024)
  })

  it('names are generic (no film, show or brand names)', () => {
    const banned = /star ?wars|jedi|sith|lightsaber|tatooine|x-?wing|tie fighter|naruto|ghibli|totoro|akira|evangelion|samurai jack|hokusai/i
    for (const w of WALLPAPERS) expect(w.name, w.id).not.toMatch(banned)
    for (const f of readdirSync(ART)) expect(readFileSync(join(ART, f), 'utf8'), f).not.toMatch(banned)
  })
})
