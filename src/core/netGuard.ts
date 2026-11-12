// AU8–AU10: the server only calls addresses YOU gave it (n8n webhooks, an
// ntfy server, MCP servers) when they are public https: never localhost, a
// private network, a link-local or cloud metadata address, or a bare word.
// The name is checked here; the server also checks every address the name
// resolves to (src/server/automation.ts) and never follows redirects.
// Pure and tested.

/** Is this IP (v4 or v6 text) private, local, link-local, multicast or otherwise not public? */
export function privateIp(ip: string): boolean {
  const s = String(ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  if (s.includes(':')) {
    const g = ipv6Groups(s)
    if (!g) return true // not a valid address: refused
    const [first, second] = g
    // ::/96 (unspecified, loopback, IPv4-compatible like ::7f00:1 or ::169.254.169.254)
    // and ::ffff:0:0/96 (IPv4-mapped): an IPv4 address in disguise, never needed here.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) return true
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true // multicast
    if (first === 0x64) return true // 64:ff9b::/96 NAT64 (an IPv4 address inside)
    if (first === 0x2001 && (second === 0 || second === 0xdb8)) return true // Teredo, documentation
    if (first === 0x2002) return privateIp(`${second >> 8}.${second & 255}.${g[2] >> 8}.${g[2] & 255}`) // 6to4: the IPv4 inside
    return false
  }
  return true
}

/** The 8 groups of an IPv6 address (a dotted IPv4 tail allowed), or null when it isn't one. */
function ipv6Groups(s: string): number[] | null {
  let text = s.replace(/%.*$/, '')
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (tail) {
    const b = tail.slice(1).map(Number)
    if (b.some((n) => n > 255)) return null
    text = text.slice(0, tail.index) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const part = (h: string) => (h ? h.split(':') : [])
  const head = part(halves[0])
  const back = halves.length === 2 ? part(halves[1]) : []
  const fill = 8 - head.length - back.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...back]
  if (all.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null
  return all.map((x) => parseInt(x, 16))
}

const isIpLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')

/**
 * A URL the server may call, or why not: https only, a real public name or
 * address, no sign-in details in it, no odd ports.
 */
export function urlProblem(raw: string): string | null {
  let u: URL
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    return 'Not a web address'
  }
  if (u.protocol !== 'https:') return 'Only https:// addresses'
  if (u.username || u.password) return 'No user name or password in the address'
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return 'No host'
  if (isIpLiteral(host)) return privateIp(host) ? 'Not a private or local address' : null
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host)) return 'Not a private or local address'
  if (/^metadata\.|\.internal$/.test(host)) return 'Not a private or local address'
  if (u.port && !['443', '8443'].includes(u.port)) return 'Use the normal https port'
  if (raw.length > 500) return 'Address too long'
  return null
}

/** "https://n8n.example.com/webhook/abc123…" → "n8n.example.com/…c123" (what pages see after saving). */
export function urlHint(raw: string): string {
  try {
    const u = new URL(raw)
    const tail = (u.pathname + u.search).replace(/\/+$/, '')
    return `${u.hostname}${tail ? `/…${tail.slice(-4)}` : ''}`
  } catch {
    return '?'
  }
}
