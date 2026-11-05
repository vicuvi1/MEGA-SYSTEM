// Voice downloads: kept in this device's browser cache (in the desktop app,
// inside its own user-data folder), never in the installer. Works in a page
// and in a worker. Settings → Voice shows them and can delete them all.
import type { VoiceFile } from '@core/voiceModels'

/** Our own files (engines, the wake word, the speech detector, voices). */
export const FILE_CACHE = 'life-voice-v1'
/** The Transformers.js models (speech to text, Kokoro). */
export const MODEL_CACHE = 'life-voice-models'

export type Progress = (p: { file: string; loaded: number; total: number }) => void

async function open(name: string): Promise<Cache | null> {
  try {
    return typeof caches !== 'undefined' ? await caches.open(name) : null
  } catch {
    return null
  }
}

/** The file's bytes: from the cache, else downloaded (each mirror in turn) and kept. */
export async function getFile(f: VoiceFile, onProgress?: Progress, signal?: AbortSignal): Promise<Uint8Array> {
  const cache = await open(FILE_CACHE)
  const key = `https://voice.local/${f.name}`
  const hit = await cache?.match(key).catch(() => undefined)
  if (hit) return new Uint8Array(await hit.arrayBuffer())
  let last: unknown = null
  for (const url of f.urls) {
    try {
      const r = await fetch(url, { signal, credentials: 'omit' })
      if (!r.ok || !r.body) throw new Error(`${r.status}`)
      const total = Number(r.headers.get('content-length')) || f.bytes
      const reader = r.body.getReader()
      const parts: Uint8Array[] = []
      let loaded = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        parts.push(value)
        loaded += value.length
        onProgress?.({ file: f.name, loaded, total: Math.max(total, loaded) })
      }
      const out = new Uint8Array(loaded)
      let at = 0
      for (const p of parts) (out.set(p, at), (at += p.length))
      await cache?.put(key, new Response(out, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {})
      return out
    } catch (e) {
      if (signal?.aborted) throw e
      last = e
    }
  }
  throw new Error(`Could not download ${f.name} (${String((last as Error)?.message ?? last)})`)
}

export async function hasFile(name: string): Promise<boolean> {
  const cache = await open(FILE_CACHE)
  return !!(await cache?.match(`https://voice.local/${name}`).catch(() => undefined))
}

/** Is this Transformers.js model (any of its files) already here? */
export async function hasModel(repo: string): Promise<boolean> {
  const cache = await open(MODEL_CACHE)
  if (!cache) return false
  const keys = await cache.keys().catch(() => [] as readonly Request[])
  return keys.some((k) => k.url.includes(`/${repo}/`) && /\.onnx/.test(k.url))
}

/** Bytes used by voice downloads on this device (when the browser can tell). */
export async function voiceBytes(): Promise<number> {
  let n = 0
  for (const name of [FILE_CACHE, MODEL_CACHE]) {
    const cache = await open(name)
    if (!cache) continue
    for (const k of await cache.keys().catch(() => [] as readonly Request[])) {
      const r = await cache.match(k).catch(() => undefined)
      const len = Number(r?.headers.get('content-length'))
      n += len > 0 ? len : (await r?.clone().arrayBuffer().catch(() => null))?.byteLength ?? 0
    }
  }
  return n
}

/** Delete every voice download from this device. */
export async function deleteVoiceDownloads(): Promise<void> {
  try {
    await caches.delete(FILE_CACHE)
    await caches.delete(MODEL_CACHE)
  } catch {
    /* nothing to delete */
  }
}
