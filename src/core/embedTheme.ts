// The embedded apps (Sport Track, Waky, MAN) in Life System's look: its
// colours (dark or light), its font, and for MAN a phone layout. Each app
// keeps its own design; only its colour variables are pointed at ours.
export type EmbedKind = 'sport' | 'waky' | 'man'
export interface Tokens { bg: string; surface: string; surface2: string; border: string; text: string; muted: string; accent: string; font: string; light: boolean }

export function embedThemeCss(kind: EmbedKind, t: Tokens): string {
  const base = `
  html { color-scheme: ${t.light ? 'light' : 'dark'}; }
  body { font-family: ${t.font} !important; background: ${t.bg} !important; color: ${t.text} !important; }
  button, input, select, textarea { font-family: inherit; }`
  // Sport Track draws itself from its --st-* colours (its own light and dark
  // design); here they point at Life's, so it matches the app and the accent.
  if (kind === 'sport')
    return `:root { --st-bg: ${t.bg}; --st-surface: ${t.surface}; --st-surface-2: ${t.surface2}; --st-border: ${t.border}; --st-text: ${t.text}; --st-muted: ${t.muted}; --st-accent: ${t.accent}; --st-accent-text: ${t.light ? `color-mix(in srgb, ${t.accent} 45%, #1a2400)` : t.accent}; --st-font: ${t.font}; ${t.light ? SPORT_LIGHT : SPORT_DARK}
    --bg-dark: ${t.bg}; --card-bg: ${t.surface}; --card-border: ${t.border}; --text-main: ${t.text}; --text-sub: ${t.muted}; --text-muted: ${t.muted}; --cyan-neon: ${t.accent}; --font: ${t.font}; }${base}`
  if (kind === 'waky')
    return `:root { --bg: ${t.bg}; --surface: ${t.surface}; --surface-2: ${t.surface2}; --line: ${t.border}; --text: ${t.text}; --muted: ${t.muted}; }${base}`
  return `:root { --bg-dark: ${t.bg}; --card-bg: ${t.surface}; --card-border: ${t.border}; --text-primary: ${t.text}; --text-secondary: ${t.muted}; --text-muted: ${t.muted}; --spartan-gold: ${t.accent}; }${base}${CALM_LOOK}
  .card { background: ${t.surface} !important; border: 1px solid ${t.border} !important; border-radius: 18px !important; box-shadow: 0 18px 40px -28px rgba(0,0,0,.6) !important; }
  .nav-tabs { background: ${t.surface2} !important; border: 1px solid ${t.border} !important; border-radius: 14px !important; }
  .nav-tab.active { background: ${t.accent} !important; color: #0b0d12 !important; border-color: transparent !important; box-shadow: none !important; }`
}

/**
 * Life System's calm look on top of the colours (V1, V2): no neon glow,
 * no glowing text, titles in normal case, Life's font. Each app keeps its
 * layout and features.
 */
const CALM_LOOK = `
  *, *::before, *::after { text-shadow: none !important; }
  h1, h2, h3, .card-title, .crest-label, .lbl, .header-title { letter-spacing: 0 !important; }
  .card-title, .lbl, .hunter-badge, .metric-pill .lbl { text-transform: none !important; }
  [class*="glow"], [class*="neon"] { box-shadow: none !important; filter: none !important; }`

/** Phone layouts (U6), applied even when the colours aren't matched. */
export function embedPhoneCss(kind: EmbedKind): string {
  return kind === 'man' ? MAN_PHONE : kind === 'sport' ? SPORT_PHONE : ''
}

/** Sport Track has its own phone layout (one column, big buttons); only no sideways scroll here. */
export const SPORT_PHONE = `
  @media (max-width: 620px) {
    html, body { overflow-x: hidden; }
  }`

/** Sport Track's light and dark details that Life's tokens don't carry. */
const SPORT_DARK = '--st-fig: var(--st-accent); --st-water: #38bdf8; --st-water-text: #7dd3fc; --st-good: #34d399; --st-warn: #fbbf24; --st-bad: #f87171; --st-soft: color-mix(in srgb, var(--st-accent) 14%, transparent); --st-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 18px 40px -30px rgba(0,0,0,.7); --st-pop: 0 18px 50px -12px rgba(0,0,0,.65); color-scheme: dark;'
const SPORT_LIGHT = '--st-fig: color-mix(in srgb, var(--st-accent) 58%, #1f2a10); --st-water: #0284c7; --st-water-text: #0369a1; --st-good: #059669; --st-warn: #b45309; --st-bad: #dc2626; --st-soft: color-mix(in srgb, var(--st-accent) 30%, transparent); --st-shadow: 0 1px 2px rgba(20,25,34,.05), 0 10px 30px -18px rgba(20,25,34,.25); --st-pop: 0 18px 50px -14px rgba(20,25,34,.35); color-scheme: light;'

/** MAN had no phone layout: one column, smaller numbers, no sideways scroll. */
export const MAN_PHONE = `
  @media (max-width: 620px) {
    html, body { overflow-x: hidden; }
    .app-container { padding: 10px !important; max-width: 100% !important; }
    [style*="grid-template-columns: 1fr 1fr"], [style*="grid-template-columns: 1.2fr 1fr"] { grid-template-columns: 1fr !important; }
    .card { padding: 14px !important; border-radius: 14px !important; }
    .streak-number { font-size: 56px !important; }
    .header { flex-wrap: wrap; gap: 8px; }
    .header-tagline { display: none; }
    .nav-tabs { overflow-x: auto; flex-wrap: nowrap !important; scrollbar-width: none; }
    .nav-tabs::-webkit-scrollbar { display: none; }
    .nav-tab { flex: 0 0 auto !important; white-space: nowrap; padding: 10px 14px !important; font-size: 13px !important; }
  }`

/** Life System's tokens, read from the page (with safe fallbacks). */
export function readTokens(get: (name: string) => string, light: boolean): Tokens {
  const v = (name: string, fallback: string) => get(name).trim() || fallback
  return {
    light,
    bg: v('--bg', light ? '#f6f7fb' : '#0b0d12'),
    surface: v('--surface', light ? '#ffffff' : '#11151d'),
    surface2: v('--surface-2', light ? '#f4f5f8' : '#151a24'),
    border: v('--border', light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.08)'),
    text: v('--text', light ? '#121418' : '#f2f4f8'),
    muted: v('--muted', light ? '#5d6472' : '#8b93a3'),
    accent: v('--accent', '#c8f135'),
    font: v('--font', '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif')
  }
}
