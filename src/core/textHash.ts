// A fast fingerprint of a text: the same text always gives the same 16
// letters, on every device and on the server. It answers "is this the same
// text as before?" without keeping the old text around, and it names the
// pieces of a big synced value (core/settingParts.ts).
//
// It guards against accidents (a cut-off download, a mixed-up piece), not
// against an attacker: the server is ours and the connection is encrypted.
// NEVER change how this is computed: stored piece names depend on it. A new
// way gets a new function and a new version number in the manifest.

/** 64 bits of the text's UTF-16 units as 16 hex letters (two independent 32-bit mixes). */
export function hash64(text: string, from = 0, to = text.length): string {
  let h1 = 0xdeadbeef ^ (to - from)
  let h2 = 0x41c6ce57 ^ (to - from)
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** A text's length and fingerprint in one short word ("" for no text). */
export const textSig = (text: string | null | undefined): string => (text == null ? '' : `${text.length}.${hash64(text)}`)
