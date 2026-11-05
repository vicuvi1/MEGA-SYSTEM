// MC11: distraction minutes from the browser's own history (pure, tested).
// Off by default (Settings → Ben on this PC). The desktop copies the history
// file of Chrome, Edge or Brave to a temporary file, reads only visits to the
// sites on your list, and keeps nothing but minutes per site name: never full
// addresses, never other sites. Ben gets one line ("2 h on YouTube yesterday").

export interface HistoryFile { browser: 'Chrome' | 'Edge' | 'Brave'; path: string }

const PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3']

/** Where Chrome, Edge and Brave keep each profile's History file, per system. */
export function historyFiles(platform: string, home: string, env: Record<string, string | undefined> = {}): HistoryFile[] {
  const win = platform === 'win32'
  const sep = win ? '\\' : '/'
  const join = (...p: string[]) => p.join(sep)
  const roots: [HistoryFile['browser'], string][] = win
    ? (() => {
        const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
        return [
          ['Chrome', join(local, 'Google', 'Chrome', 'User Data')],
          ['Edge', join(local, 'Microsoft', 'Edge', 'User Data')],
          ['Brave', join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')]
        ]
      })()
    : platform === 'darwin'
      ? [
          ['Chrome', join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
          ['Edge', join(home, 'Library', 'Application Support', 'Microsoft Edge')],
          ['Brave', join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')]
        ]
      : (() => {
          const cfg = env.XDG_CONFIG_HOME || join(home, '.config')
          return [
            ['Chrome', join(cfg, 'google-chrome')],
            ['Edge', join(cfg, 'microsoft-edge')],
            ['Brave', join(cfg, 'BraveSoftware', 'Brave-Browser')]
          ]
        })()
  return roots.flatMap(([browser, root]) => PROFILES.map((p) => ({ browser, path: join(root, p, 'History') })))
}

/** Chromium stores times as microseconds since 1601-01-01 (UTC). */
const EPOCH_DIFF_MS = 11644473600000
export const toChromeTime = (ms: number) => (ms + EPOCH_DIFF_MS) * 1000
export const fromChromeTime = (us: number) => us / 1000 - EPOCH_DIFF_MS

/** The site of an address ("www.youtube.com/watch?v=…" → "youtube.com"); null for non-web addresses. */
export function domainOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** The list entry a site falls under ("m.youtube.com" → "youtube.com"), or null. */
export function listedSite(host: string, list: string[]): string | null {
  const h = host.toLowerCase().replace(/^www\./, '')
  return list.find((s) => h === s || h.endsWith(`.${s}`)) ?? null
}

export interface Visit { url: string; at: number; durMs: number }

const MAX_VISIT_MS = 30 * 60_000
const GAP_CAP_MS = 5 * 60_000

/**
 * Minutes per listed site for visits in [from, to). A visit counts its own
 * duration when the browser kept one (at most 30 min), else the time until
 * the next visit (at most 5 min). Only listed sites are kept.
 */
export function distractMinutes(visits: Visit[], list: string[], from: number, to: number): Record<string, number> {
  const sorted = visits.filter((v) => Number.isFinite(v.at)).sort((a, b) => a.at - b.at)
  const ms: Record<string, number> = {}
  sorted.forEach((v, i) => {
    if (v.at < from || v.at >= to) return
    const host = domainOf(v.url)
    const site = host ? listedSite(host, list) : null
    if (!site) return
    const next = sorted[i + 1]?.at
    const own = v.durMs > 0 ? Math.min(v.durMs, MAX_VISIT_MS) : next ? Math.min(Math.max(0, next - v.at), GAP_CAP_MS) : 60_000
    ms[site] = (ms[site] ?? 0) + Math.min(own, to - v.at)
  })
  return Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v / 60_000)]).filter(([, m]) => (m as number) > 0))
}

const NAMES: Record<string, string> = { 'youtube.com': 'YouTube', 'reddit.com': 'Reddit', 'tiktok.com': 'TikTok', 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'x.com': 'X', 'twitter.com': 'X', 'netflix.com': 'Netflix', 'twitch.tv': 'Twitch' }
export const siteName = (site: string) => NAMES[site] ?? site.replace(/\.[a-z]+$/, '').replace(/^./, (c) => c.toUpperCase())

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 >= 10 ? ` ${m % 60} min` : ''}` : `${m} min`)

/** One line for Ben: "2 h on YouTube, 25 min on Reddit yesterday" (5+ min only, top 3). */
export function historyLine(perSite: Record<string, number>, when: 'today' | 'yesterday'): string {
  const merged = new Map<string, number>()
  for (const [site, m] of Object.entries(perSite)) merged.set(siteName(site), (merged.get(siteName(site)) ?? 0) + m)
  const top = [...merged].filter(([, m]) => m >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3)
  return top.length ? `${top.map(([n, m]) => `${dur(m)} on ${n}`).join(', ')} ${when}` : ''
}
