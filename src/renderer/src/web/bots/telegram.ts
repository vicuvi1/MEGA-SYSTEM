// Telegram's Bot API for the bots (browser and server): send, edit, files.
// Split out of webBots.ts (LT6).

export const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))

/** Telegram's Bot API, small and with a timeout so a hung call can't stall the app. */
export async function tg(token: string, method: string, body?: unknown): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
    return json
  } finally {
    clearTimeout(t)
  }
}

/**
 * A voice note or photo from Telegram, as base64 for Gemini (up to 15 MB;
 * Telegram voice notes are OGG/Opus, photos JPEG).
 */
export async function downloadFile(token: string, fileId: string, kind: 'voice' | 'photo'): Promise<{ kind: 'voice' | 'photo'; mime: string; data: string } | null> {
  try {
    const info = await tg(token, `getFile?file_id=${encodeURIComponent(fileId)}`)
    const path = info?.result?.file_path
    if (!info?.ok || !path || (info.result.file_size ?? 0) > 15_000_000) return null
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    const ext = String(path).split('.').pop()?.toLowerCase()
    const mime = kind === 'photo' ? (ext === 'png' ? 'image/png' : 'image/jpeg') : ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : 'audio/ogg'
    return { kind, mime, data: btoa(bin) }
  } catch {
    return null
  }
}

/** A small text file sent on Telegram (a bank CSV), read in memory. */
export async function downloadText(token: string, fileId: string): Promise<string | null> {
  try {
    const info = await tg(token, `getFile?file_id=${encodeURIComponent(fileId)}`)
    const path = info?.result?.file_path
    if (!info?.ok || !path || (info.result.file_size ?? 0) > 2_000_000) return null
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    // Most banks export UTF-8; older ones Windows-1252/1250. Fall back when UTF-8 shows broken letters.
    const utf = new TextDecoder('utf-8').decode(buf)
    return utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf
  } catch {
    return null
  }
}
