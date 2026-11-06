// PL1: a widget's manifest (widgets/<id>/manifest.json). A widget is one
// small JS file that runs in a sandboxed iframe (sandbox="allow-scripts"
// only, an opaque origin, a strict CSP) and talks to the island through the
// typed bridge in bridge.ts. Pure and tested (manifest.test.ts).

export type WidgetSize = '1x1' | '2x1' | '2x2'
export const WIDGET_SIZES: WidgetSize[] = ['1x1', '2x1', '2x2']

/**
 * What a widget may ask for (PL2), each asked once at install and revocable
 * in Settings → Widgets:
 *   read     today's plan, focus, points, weather and next event (read only)
 *   network  https requests to the hosts it lists, made by the app and checked
 *   add      add a task or a note (you confirm each one)
 *   sound    play one of the app's short sounds
 */
export type WidgetPermission = 'read' | 'network' | 'add' | 'sound'
export const WIDGET_PERMISSIONS: WidgetPermission[] = ['read', 'network', 'add', 'sound']
export const PERMISSION_TEXT: Record<WidgetPermission, string> = {
  read: 'See today’s plan, focus, points, weather and next event (it cannot change them)',
  network: 'Reach these websites (through the app, checked each time)',
  add: 'Add a task or a note (asks you each time)',
  sound: 'Play a short sound'
}

export interface WidgetSetting {
  key: string
  label: string
  kind: 'text' | 'date'
  /** Shown before you type anything. */
  placeholder?: string
}

export interface WidgetManifest {
  id: string
  name: string
  version: string
  author: string
  /** One plain line. */
  about: string
  size: WidgetSize
  /** How often the island sends it fresh data (seconds, 15 … 3600). */
  refresh: number
  permissions: WidgetPermission[]
  /** With "network": the only https hosts it may reach. */
  hosts: string[]
  /** Things you set per widget (a date to count down to…). */
  settings: WidgetSetting[]
}

export const REFRESH_MIN = 15
export const REFRESH_MAX = 3600
export const WIDGET_CODE_MAX = 32 * 1024

const ID = /^[a-z][a-z0-9-]{1,31}$/
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
/** A plain public host name: letters, digits, dots and dashes; no IP address, no port, nothing local. */
export function isPublicHost(h: unknown): h is string {
  if (typeof h !== 'string' || h.length > 100) return false
  const host = h.toLowerCase()
  if (!/^(?=.{1,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return false
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|invalid|example|onion)$/.test(host)) return false
  return true
}

const text = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) : '')

export type ManifestCheck = { ok: true; manifest: WidgetManifest } | { ok: false; errors: string[] }

/** Checks a manifest strictly: anything odd is an error (a widget with a bad manifest never installs). */
export function validateManifest(m: any): ManifestCheck {
  const errors: string[] = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['The manifest is not an object'] }
  const known = new Set(['id', 'name', 'version', 'author', 'about', 'size', 'refresh', 'permissions', 'hosts', 'settings'])
  for (const k of Object.keys(m)) if (!known.has(k)) errors.push(`Unknown field "${k}"`)
  if (!ID.test(String(m.id ?? ''))) errors.push('id: 2–32 lower-case letters, digits or "-"')
  const name = text(m.name, 40)
  if (!name) errors.push('name is missing')
  if (!VERSION.test(String(m.version ?? ''))) errors.push('version must look like 1.0.0')
  const author = text(m.author, 40)
  if (!author) errors.push('author is missing')
  if (!WIDGET_SIZES.includes(m.size)) errors.push('size must be 1x1, 2x1 or 2x2')
  const refresh = Number(m.refresh)
  if (!Number.isInteger(refresh) || refresh < REFRESH_MIN || refresh > REFRESH_MAX) errors.push(`refresh: whole seconds, ${REFRESH_MIN}–${REFRESH_MAX}`)
  const perms: WidgetPermission[] = []
  if (!Array.isArray(m.permissions)) errors.push('permissions must be a list')
  else
    for (const p of m.permissions) {
      if (!WIDGET_PERMISSIONS.includes(p)) errors.push(`Unknown permission "${String(p)}"`)
      else if (!perms.includes(p)) perms.push(p)
    }
  const hosts: string[] = []
  if (m.hosts != null && !Array.isArray(m.hosts)) errors.push('hosts must be a list')
  for (const h of Array.isArray(m.hosts) ? m.hosts : []) {
    if (!isPublicHost(h)) errors.push(`Not a public host name: "${String(h).slice(0, 60)}"`)
    else if (!hosts.includes(h.toLowerCase())) hosts.push(h.toLowerCase())
  }
  if (hosts.length > 5) errors.push('At most 5 hosts')
  if (perms.includes('network') && !hosts.length) errors.push('"network" needs at least one host')
  if (!perms.includes('network') && hosts.length) errors.push('hosts without the "network" permission')
  const settings: WidgetSetting[] = []
  if (m.settings != null && !Array.isArray(m.settings)) errors.push('settings must be a list')
  for (const s of Array.isArray(m.settings) ? m.settings : []) {
    if (!s || !/^[a-z][a-zA-Z0-9]{0,19}$/.test(String(s.key)) || !['text', 'date'].includes(s.kind) || !text(s.label, 40)) errors.push('A setting needs a key, a label and kind text or date')
    else settings.push({ key: s.key, label: text(s.label, 40), kind: s.kind, ...(text(s.placeholder, 40) ? { placeholder: text(s.placeholder, 40) } : {}) })
  }
  if (settings.length > 4) errors.push('At most 4 settings')
  if (errors.length) return { ok: false, errors }
  return { ok: true, manifest: { id: m.id, name, version: m.version, author, about: text(m.about, 140), size: m.size, refresh, permissions: perms, hosts, settings } }
}

/** A widget's settings, cleaned against its manifest (unknown keys dropped, text cut short). */
export function cleanConfig(m: WidgetManifest, v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  for (const s of m.settings) {
    const raw = text(src[s.key], 80)
    if (!raw) continue
    if (s.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue
    out[s.key] = raw
  }
  return out
}
