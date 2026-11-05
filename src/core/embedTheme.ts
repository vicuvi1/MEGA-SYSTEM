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
  if (kind === 'sport')
    return `:root { --bg-dark: ${t.bg}; --card-bg: ${t.surface}; --card-border: ${t.border}; --text-main: ${t.text}; --text-sub: ${t.muted}; --text-muted: ${t.muted}; --cyan-neon: ${t.accent}; --font: ${t.font}; }${base}`
  if (kind === 'waky')
    return `:root { --bg: ${t.bg}; --surface: ${t.surface}; --surface-2: ${t.surface2}; --line: ${t.border}; --text: ${t.text}; --muted: ${t.muted}; }${base}`
  return `:root { --bg-dark: ${t.bg}; --card-bg: ${t.surface}; --card-border: ${t.border}; --text-primary: ${t.text}; --text-secondary: ${t.muted}; --text-muted: ${t.muted}; }${base}`
}

/** Phone layouts (U6), applied even when the colours aren't matched. */
export function embedPhoneCss(kind: EmbedKind): string {
  return kind === 'man' ? MAN_PHONE : kind === 'sport' ? SPORT_PHONE : ''
}

/** Sport Track on a phone: the hero card wraps instead of running off the right edge. */
export const SPORT_PHONE = `
  @media (max-width: 620px) {
    html, body { overflow-x: hidden; }
    .container { padding: 10px !important; max-width: 100% !important; }
    .hunter-hud { padding: 14px !important; gap: 12px !important; }
    .hud-profile { flex-wrap: wrap; gap: 12px !important; min-width: 0; }
    .profile-info { min-width: 0; flex: 1 1 180px; }
    .profile-info h1 { font-size: 22px !important; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .profile-info .hunter-badge { font-size: 10px !important; }
    .xp-meter-wrap { flex-wrap: wrap; gap: 6px; }
    .hud-metrics { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 10px !important; width: 100%; }
    .metric-pill { min-width: 0; }
    .metric-pill .val { font-size: 18px !important; }
    .card { max-width: 100%; overflow: hidden; padding: 14px !important; }
    .card-header { flex-wrap: wrap; gap: 8px !important; }
    .card-header h2, .card-header h3 { font-size: 17px !important; line-height: 1.25; min-width: 0; overflow-wrap: anywhere; }
    .card-header > div, .card-header .actions { flex-wrap: wrap; gap: 8px; }
    .card button { max-width: 100%; white-space: normal; }
    /* Cards in a flex column grew to their longest line: let them shrink. */
    .glass-card, .glass-card > *, [style*="flex-direction: column"] > * { min-width: 0; max-width: 100%; }
    .glass-card { overflow: hidden; }
    [style*="grid-template-columns"], .dashboard-grid { grid-template-columns: minmax(0, 1fr) !important; }
    .dashboard-grid > * { min-width: 0; }
    .card-title { white-space: normal !important; flex-wrap: wrap; font-size: 18px !important; }
    .routine-top-actions, .card-header { flex-wrap: wrap !important; }
    .chip-btn { white-space: normal; }
  }`

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
