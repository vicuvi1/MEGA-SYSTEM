// TV3 (optional): Ben's voice from Voicebox, an open-source local voice studio
// (github.com/jamiepine/voicebox, MIT). Its README documents a local REST API
// on 127.0.0.1:17493: GET /profiles lists voice profiles, POST /speak
// {text, profile} speaks in that voice (Voicebox plays the audio itself), with
// an X-Voicebox-Client-Id header. Desktop only: the desktop app makes the
// calls (the page's CSP never reaches localhost). If it isn't running, Ben
// falls back to his normal voice without a word. Pure, tested.

export const VOICEBOX_ORIGIN = 'http://127.0.0.1:17493'
export const VOICEBOX_CLIENT = 'life-system'
/** The probe gives up quickly: a missing app must not slow anything down. */
export const PROBE_MS = 600
export const SPEAK_MS = 4_000
/** One request at most this long (Voicebox chunks long text itself). */
export const MAX_SPEAK_CHARS = 1_500

/** /profiles' answer → profile names (it may be a list, or {profiles: […]}, of strings or objects). */
export function profileNames(j: unknown): string[] {
  const list = Array.isArray(j) ? j : Array.isArray((j as any)?.profiles) ? (j as any).profiles : []
  const out: string[] = []
  for (const p of list) {
    const n = typeof p === 'string' ? p : typeof p?.name === 'string' ? p.name : typeof p?.id === 'string' ? p.id : ''
    if (n && !out.includes(n)) out.push(n.slice(0, 60))
  }
  return out.slice(0, 50)
}

/** The /speak request body (profile left out = Voicebox's default voice). */
export function speakBody(text: string, profile = ''): { text: string; profile?: string } {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SPEAK_CHARS)
  return profile.trim() ? { text: t, profile: profile.trim().slice(0, 60) } : { text: t }
}

/** About how long Voicebox will talk (for the island's "speaking" state): ~2.6 words a second. */
export const speakMs = (text: string) => Math.min(60_000, Math.max(1_200, Math.round(((String(text).match(/\S+/g) ?? []).length / 2.6) * 1000)))
