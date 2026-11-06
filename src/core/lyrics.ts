// MU: synced lyrics and cover art for the Music views, the pure part.
// Lyrics come from LRCLIB (lrclib.net, free, no key): the song's title,
// artist and length are sent there, nothing else. Cover art for players on
// the PC (Spotify, a browser…) comes from Apple's free iTunes search when the
// player's own picture can't be read. Tested in lyrics.test.ts.

export interface LyricLine { t: number; text: string }

/** "[01:02.50] words" lines → timed lines, in order (several stamps on one line count for each). */
export function parseLrc(lrc: unknown): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of String(lrc ?? '').split(/\r?\n/).slice(0, 2000)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0
      out.push({ t: Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac, text })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/** The line playing at `ms` (-1 before the first). */
export function lineAt(lines: LyricLine[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= ms + 150) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/**
 * A title as players show it → the song and the artist to look up:
 * "Artist - Song (Official Video) [HD]" → { title: "Song", artist: "Artist" }.
 */
export function songOf(title: string, artist: string): { title: string; artist: string } {
  let t = String(title ?? '').replace(/\s*[[(【](?:official|lyrics?|audio|video|hd|hq|4k|visuali[sz]er|free download|out now|prod[^)\]]*)[^)\]】]*[)\]】]/gi, '').trim()
  let a = String(artist ?? '').replace(/\s*-\s*topic$/i, '').trim()
  const dash = /^(.{1,80}?)\s+[-–—]\s+(.{1,120})$/.exec(t)
  if (dash) {
    a = dash[1].trim()
    t = dash[2].trim()
  }
  t = t.replace(/\s*\((?:feat|ft)\.?[^)]*\)/i, '').trim()
  return { title: t.slice(0, 120), artist: a.slice(0, 80) }
}

/** LRCLIB's exact lookup (with the length when known, as LRCLIB asks). */
export function lrclibGetUrl(song: { title: string; artist: string }, durMs: number): string | null {
  if (!song.title || !song.artist) return null
  const q = new URLSearchParams({ track_name: song.title, artist_name: song.artist })
  if (durMs > 0) q.set('duration', String(Math.round(durMs / 1000)))
  return `https://lrclib.net/api/get?${q.toString()}`
}
/** LRCLIB's search (when the exact lookup finds nothing, or there's no artist). */
export function lrclibSearchUrl(song: { title: string; artist: string }): string | null {
  if (!song.title) return null
  const q = new URLSearchParams({ track_name: song.title })
  if (song.artist) q.set('artist_name', song.artist)
  return `https://lrclib.net/api/search?${q.toString()}`
}

/** LRCLIB's answer (one record or a search list) → timed lines, or null when it has none. */
export function lyricsFrom(j: unknown, durMs = 0): LyricLine[] | null {
  const list: any[] = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : []
  // Prefer a record of about the same length.
  const ok = list.filter((r) => r && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim() && !r.instrumental)
  if (!ok.length) return null
  const near = durMs > 0 ? ok.find((r) => Math.abs(Number(r.duration) * 1000 - durMs) < 5000) : null
  const lines = parseLrc((near ?? ok[0]).syncedLyrics).filter((l, i, a) => l.text || (a[i - 1] && a[i - 1].text))
  return lines.length >= 2 ? lines : null
}

/** Apple's free search for a song's cover. */
export function itunesUrl(song: { title: string; artist: string }): string | null {
  const term = [song.artist, song.title].filter(Boolean).join(' ').trim()
  if (!term) return null
  return `https://itunes.apple.com/search?${new URLSearchParams({ term: term.slice(0, 160), entity: 'song', limit: '1' }).toString()}`
}
/** Only Apple's own image host, made big (600 px). */
export function itunesArt(j: unknown): string {
  const u = String((j as any)?.results?.[0]?.artworkUrl100 ?? '')
  return /^https:\/\/is\d-ssl\.mzstatic\.com\/[\w./%-]{1,300}\/100x100bb\.(jpg|png)$/.test(u) ? u.replace(/100x100bb\.(jpg|png)$/, '600x600bb.$1') : ''
}
export const safeCover = (u: unknown) => {
  const s = String(u ?? '')
  return /^https:\/\/(i\d?\.sndcdn\.com|is\d-ssl\.mzstatic\.com)\/[\w./%-]{1,300}$/.test(s) ? s : ''
}
