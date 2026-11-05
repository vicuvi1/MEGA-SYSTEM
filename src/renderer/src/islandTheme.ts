// IP4: the island's "Match the app" look. The app window reads its own colours
// (light or dark, accent, surface, text) and sends them to the desktop, which
// passes them to the island with its settings. Sent again when they change.
import type { IslandTheme } from '../../shared/desktop'

export function readAppTheme(root: HTMLElement = document.documentElement): IslandTheme {
  const css = getComputedStyle(root)
  const v = (name: string, d: string) => css.getPropertyValue(name).trim() || d
  const dark = root.dataset.theme !== 'light'
  return {
    dark,
    accent: v('--accent', '#c8f135'),
    accentText: v('--accent-text', dark ? '#c8f135' : '#4d6a00'),
    surface: v('--surface', dark ? '#0f131b' : '#ffffff'),
    text: v('--text', dark ? '#f5f5f6' : '#141922')
  }
}

let started = false
/** Watches the app's theme (html[data-theme], its style and classes) and keeps the island in step. */
export function startIslandThemeSync(): void {
  const send = window.desktop?.islandTheme
  if (started || !send || typeof MutationObserver === 'undefined') return
  started = true
  let last = ''
  const push = () => {
    try {
      const t = readAppTheme()
      const key = JSON.stringify(t)
      if (key === last) return
      last = key
      send(t)
    } catch {
      /* not critical */
    }
  }
  push()
  let timer = 0
  new MutationObserver(() => {
    clearTimeout(timer)
    timer = window.setTimeout(push, 150)
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
}
