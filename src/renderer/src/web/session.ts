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
