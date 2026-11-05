// The bridge between Life System and its embedded apps, as typed messages.
// In: apps post {type:'LIFE_SYSTEM_BRIDGE', action, payload} (website) or
// log "LIFE_SYSTEM_BRIDGE:<ACTION>:<json>" (desktop webview); both are read
// here, only from our own origin and only for known actions. Out: Life
// System sends {action, ...} to MAN's one entry point (window.__lifeHost);
// the data is JSON, so no code is ever built from it.
export const BRIDGE_ACTIONS = ['MAN_CHECKIN', 'MAN_OATH', 'MAN_RESET', 'MAN_SET_STREAK', 'MAN_DIARY', 'MAN_INIT', 'SPORT_WORKOUT_LOGGED', 'WAKY_CHECKIN_LOGGED'] as const
export type BridgeAction = (typeof BRIDGE_ACTIONS)[number]
export interface BridgeMsg { action: BridgeAction; payload: Record<string, unknown> }

const known = (a: unknown): a is BridgeAction => typeof a === 'string' && (BRIDGE_ACTIONS as readonly string[]).includes(a)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** A window message from an embedded app, or null (wrong origin, unknown action, bad shape). */
export function parseBridgeMessage(data: unknown, origin: string, ownOrigin: string): BridgeMsg | null {
  if (origin !== ownOrigin || !data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.type === 'LIFE_SYSTEM_BRIDGE' && known(d.action)) return { action: d.action, payload: obj(d.payload) }
  // Older Sport Track / Waky builds post the action as the type.
  if (known(d.type)) return { action: d.type, payload: obj(d.payload ?? (d.workout ? { workout: d.workout } : {})) }
  return null
}

/** A console line from the desktop webview, or null. */
export function parseBridgeLine(line: string): BridgeMsg | null {
  const m = /^LIFE_SYSTEM_BRIDGE:([A-Z_]+):([\s\S]*)$/.exec(String(line || ''))
  if (!m || !known(m[1])) return null
  try {
    return { action: m[1], payload: obj(m[2] ? JSON.parse(m[2]) : {}) }
  } catch {
    return { action: m[1], payload: {} }
  }
}

export type HostMsg = { action: 'state' } | { action: 'checkin'; today: string; streak: number } | { action: 'oath'; today: string } | { action: 'set-streak'; streak: number }

/** The one line run inside MAN: its entry point with the message as JSON data. */
export const hostCall = (msg: HostMsg) => `window.__lifeHost ? window.__lifeHost(${JSON.stringify(msg)}) : null`
