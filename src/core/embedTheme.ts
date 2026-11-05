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
  return `:root { --bg-dark: ${t.bg}; --card-bg: ${t.surface}; --card-border: ${t.border}; --text-primary: ${t.text}; --text-secondary: ${t.muted}; --text-muted: ${t.muted}; }${base}
  ${MAN_PHONE}`
}

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
