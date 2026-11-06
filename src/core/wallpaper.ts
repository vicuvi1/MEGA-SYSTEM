// Wallpapers for the whole app (Settings → Look → Wallpaper). Pure: the list
// of pictures, the saved choice and how strong the picture may show so text
// stays readable. The pictures themselves are original SVG art in
// src/renderer/src/wallpaper/art (drawn by scripts/wallpapers/build.mjs).
// Stored in the synced settings `look_wallpaper` (the choice) and
// `look_wallpaper_photo` (your own picture, a small data URL), so every device
// shows the same wallpaper.

export type WallpaperCategory = 'anime' | 'samurai' | 'space' | 'cyberpunk' | 'nature' | 'minimal'

/** A light effect drawn over some pictures while "Gentle motion" is on. */
export type WallpaperFx = 'rain' | 'stars' | 'petals' | 'snow' | 'leaves'

export interface WallpaperInfo {
  id: string
  name: string
  category: WallpaperCategory
  /** A bright picture (dark mode dims it more when "Match light and dark" is on). */
  light?: boolean
  fx?: WallpaperFx
  /** Its main colour, for small accents. */
  accent: string
}

export const WALLPAPER_CATEGORIES: { id: WallpaperCategory; label: string }[] = [
  { id: 'anime', label: 'Anime style' },
  { id: 'samurai', label: 'Samurai' },
  { id: 'space', label: 'Space saga' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'nature', label: 'Nature' },
  { id: 'minimal', label: 'Minimal' }
]

export const WALLPAPERS: WallpaperInfo[] = [
  { id: 'neon-rain', name: 'Neon rain street', category: 'anime', fx: 'rain', accent: '#ff3ea5' },
  { id: 'sakura-hill', name: 'Sakura hill', category: 'anime', fx: 'petals', accent: '#ec8db0' },
  { id: 'lofi-room', name: 'Late-night study', category: 'anime', accent: '#ffb066' },
  { id: 'train-crossing', name: 'Train at dusk', category: 'anime', light: true, accent: '#ff9a6a' },
  { id: 'floating-island', name: 'Floating island', category: 'anime', light: true, accent: '#3b8fe8' },
  { id: 'ronin-moon', name: 'Ronin and the moon', category: 'samurai', fx: 'leaves', accent: '#c8202a' },
  { id: 'katana-sun', name: 'Katana and red sun', category: 'samurai', light: true, accent: '#c8322a' },
  { id: 'torii-mist', name: 'Gate in the mist', category: 'samurai', light: true, accent: '#d0442c' },
  { id: 'bamboo', name: 'Bamboo forest', category: 'samurai', light: true, accent: '#5f9a4a' },
  { id: 'dojo-dawn', name: 'Dojo at dawn', category: 'samurai', accent: '#ffc98f' },
  { id: 'great-wave', name: 'Great wave', category: 'samurai', light: true, accent: '#355c94' },
  { id: 'twin-suns', name: 'Twin suns', category: 'space', accent: '#f4c27c' },
  { id: 'hyperspace', name: 'Hyperspace', category: 'space', accent: '#5aa8ff' },
  { id: 'nebula', name: 'Nebula', category: 'space', fx: 'stars', accent: '#c03a8a' },
  { id: 'ring-planet', name: 'Ringed planet', category: 'space', fx: 'stars', accent: '#e0a874' },
  { id: 'blade-duel', name: 'Glowing blades', category: 'space', accent: '#38d8ff' },
  { id: 'starfighters', name: 'Starfighter squadron', category: 'space', fx: 'stars', accent: '#7fd8ff' },
  { id: 'neon-grid', name: 'Neon grid', category: 'cyberpunk', accent: '#ff3ad0' },
  { id: 'rooftop', name: 'Rainy rooftop', category: 'cyberpunk', fx: 'rain', accent: '#2ae6ff' },
  { id: 'forest', name: 'Misty forest', category: 'nature', light: true, accent: '#3c5f52' },
  { id: 'ocean', name: 'Moonlit ocean', category: 'nature', fx: 'stars', accent: '#fff1d6' },
  { id: 'aurora', name: 'Northern lights', category: 'nature', fx: 'snow', accent: '#5affb0' },
  { id: 'mesh', name: 'Colour mesh', category: 'minimal', accent: '#6a3aff' },
  { id: 'grain', name: 'Soft grain', category: 'minimal', accent: '#8b9bb4' }
]

/** "none", "photo" (your own picture) or one of WALLPAPERS. */
export type WallpaperId = string

export interface WallpaperPrefs {
  id: WallpaperId
  /** How strongly the picture shows, 10–100 %. */
  opacity: number
  /** Soft focus, 0–20 px. */
  blur: number
  /** A shade over the picture, 0–80 %. */
  dim: number
  /** Show it on every page, or only on Today. */
  where: 'all' | 'today'
  /** Dark mode darkens bright pictures, light mode lightens dark ones. */
  followTheme: boolean
  /** A slow drift and, on some pictures, rain, stars or petals. Off by default. */
  motion: boolean
}

export const DEFAULT_WALLPAPER: WallpaperPrefs = { id: 'none', opacity: 70, blur: 0, dim: 30, where: 'all', followTheme: true, motion: false }

/** Your own picture may take at most this many characters (about 520 KB). */
export const WALLPAPER_PHOTO_MAX_CHARS = 700_000

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : fallback
}

export function wallpaperInfo(id: string): WallpaperInfo | null {
  return WALLPAPERS.find((w) => w.id === id) ?? null
}

/** A picture we accept as your own wallpaper: an image data URL, not too big. */
export function okWallpaperPhoto(v: unknown): v is string {
  return typeof v === 'string' && v.length <= WALLPAPER_PHOTO_MAX_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
}

/** Whatever is stored, as a safe choice (unknown pictures fall back to none, numbers are kept in range). */
export function cleanWallpaper(raw: unknown): WallpaperPrefs {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_WALLPAPER
  const id = typeof r.id === 'string' && (r.id === 'none' || r.id === 'photo' || wallpaperInfo(r.id)) ? r.id : d.id
  return {
    id,
    opacity: num(r.opacity, 10, 100, d.opacity),
    blur: num(r.blur, 0, 20, d.blur),
    dim: num(r.dim, 0, 80, d.dim),
    where: r.where === 'today' ? 'today' : 'all',
    followTheme: typeof r.followTheme === 'boolean' ? r.followTheme : d.followTheme,
    motion: r.motion === true
  }
}

/** Does the wallpaper show on this page? */
export function wallpaperShows(p: WallpaperPrefs, page: string, hasPhoto = true): boolean {
  if (p.id === 'none') return false
  if (p.id === 'photo' && !hasPhoto) return false
  return p.where === 'all' || page === 'today'
}

/**
 * At most this much of the picture shows through (after the shade). With the
 * page colour over the rest, even a pure white spot in dark mode (or black in
 * light mode) keeps normal text above 4.5 : 1 (WCAG AA); see wallpaper.test.ts.
 */
export const MAX_SHOW_THROUGH = 0.4

export interface WallpaperLook {
  /** Opacity of the picture layer, 0–1. */
  art: number
  /** Opacity of the page-coloured shade over it, 0–1. */
  shade: number
  /** CSS blur in px. */
  blur: number
  /** The share of the picture that shows through in the end (art × (1 − shade)). */
  showThrough: number
}

/** How to draw it: the picture's opacity and the shade over it, with the readability floor. */
export function wallpaperLook(p: WallpaperPrefs, theme: 'dark' | 'light', info: WallpaperInfo | null = wallpaperInfo(p.id)): WallpaperLook {
  const art = p.opacity / 100
  let shade = p.dim / 100
  // A bright picture in dark mode (or a dark one in light mode) gets a stronger shade.
  if (p.followTheme && info) {
    const mismatch = theme === 'dark' ? !!info.light : !info.light
    if (mismatch) shade = 1 - (1 - shade) * 0.7
  }
  // Never let more than MAX_SHOW_THROUGH of the picture reach the text.
  if (art * (1 - shade) > MAX_SHOW_THROUGH) shade = 1 - MAX_SHOW_THROUGH / art
  const r2 = (x: number) => Math.round(x * 1000) / 1000
  return { art: r2(art), shade: r2(shade), blur: p.blur, showThrough: r2(art * (1 - shade)) }
}

// ---------- Contrast (WCAG 2.x), for the readability tests ----------

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}
export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
/** The colour of one spot: the page colour with `share` of the picture's colour mixed in. */
export function mixRgb(page: [number, number, number], art: [number, number, number], share: number): [number, number, number] {
  return [0, 1, 2].map((i) => page[i] * (1 - share) + art[i] * share) as [number, number, number]
}
