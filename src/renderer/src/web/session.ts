// The web app's login with the server (api/login.mjs): the PIN is checked
// there and a 30-day session comes back. The Turso and Telegram keys stay on
// the server; the page only ever holds this session.
const KEY = 'life_web_session'

export class NetworkError extends Error {}

const store = () => (typeof localStorage !== 'undefined' ? localStorage : null)

export const getSession = (): string => {
  try {
    return store()?.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export const clearSession = () => {
  try {
    store()?.removeItem(KEY)
  } catch {
    /* private window */
  }
}

/** A session that hasn't expired yet (the server checks the signature). */
export function sessionValid(token = getSession(), now = Date.now()): boolean {
  try {
    const data = token.split('.')[0]
    if (!data) return false
    const json = JSON.parse(atob(data.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' && json.exp > now
  } catch {
    return false
  }
}

/** Logs in with the PIN; throws the server's message ("Wrong PIN", "Wait 60 s"). */
export async function serverLogin(pin: string): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
  } catch {
    throw new NetworkError('No connection to the server')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.session) {
    if (res.status >= 500 && res.status !== 503) throw new NetworkError(body.error || `Server error ${res.status}`)
    throw new Error(body.error || `Login failed (${res.status})`)
  }
  try {
    store()?.setItem(KEY, body.session)
  } catch {
    /* private window: works until the tab closes */
  }
  memory = body.session
}

// Fallback when localStorage can't keep it.
let memory = ''
export const currentSession = () => getSession() || memory

// ---- "Don't ask for the PIN on this device" -------------------------------
const TRUST = 'life_no_pin'
export const remembered = (): boolean => {
  try {
    return store()?.getItem(TRUST) === '1'
  } catch {
    return false
  }
}
export const setRememberedFlag = (on: boolean) => {
  try {
    if (on) store()?.setItem(TRUST, '1')
    else store()?.removeItem(TRUST)
  } catch {
    /* private window: the PIN is asked */
  }
}

/** A remembered device swaps its session for a fresh 30-day one when it has under 20 days left. */
export async function renewSession(now = Date.now()): Promise<void> {
  const token = currentSession()
  if (!sessionValid(token, now)) return
  try {
    const exp = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp
    if (exp - now > 20 * 86400_000) return
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renew: token }) })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.session) {
      store()?.setItem(KEY, body.session)
      memory = body.session
    }
  } catch {
    /* offline: next start tries again */
  }
}

/** "Sign out all other devices": every other session ends; this device gets a fresh one. */
export async function signOutOthers(): Promise<void> {
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signOutAll: currentSession() }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.session) throw new Error(body.error || `Sign-out failed (${res.status})`)
  try {
    store()?.setItem(KEY, body.session)
  } catch {
    /* private window */
  }
  memory = body.session
}

export interface DeviceList {
  devices: { sid: string; label: string; created: number; lastSeen: number }[]
  passkeys: { id: string; label: string; created: number }[]
  current: string | null
}
/** Your devices and passkeys; optionally sign one device out or remove a passkey first (A6). */
export async function deviceCall(op: { revokeDevice?: string; revokePasskey?: string } = {}): Promise<DeviceList> {
  const s = currentSession()
  const payload = op.revokeDevice || op.revokePasskey ? { ...op, session: s } : { devices: s }
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Could not load devices (${res.status})`)
  return { devices: body.devices ?? [], passkeys: body.passkeys ?? [], current: body.current ?? null }
}
