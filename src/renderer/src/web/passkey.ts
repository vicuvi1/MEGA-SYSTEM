// Fingerprint / face unlock in the browser (M7): a passkey made on this
// device (Settings → Security, after the PIN), then "Unlock with
// fingerprint" on the lock screen. The server checks everything (_passkey.mjs).
import { currentSession } from './session'

const ID = 'life_passkey_id'
const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const post = async (body: object) => {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Passkey failed (${r.status})`)
  return j
}

export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
export const hasPasskeyHere = () => {
  try {
    return !!localStorage.getItem(ID)
  } catch {
    return false
  }
}

export const forgetPasskeyHere = () => {
  try {
    localStorage.removeItem(ID)
  } catch {
    /* private window */
  }
}

/** Makes a passkey on this device (you are unlocked with the PIN). */
export async function setupPasskey(): Promise<void> {
  if (!passkeySupported()) throw new Error('This browser has no fingerprint / face unlock')
  const { challenge } = await post({ passkey: 'options', op: 'register' })
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(challenge),
      rp: { name: 'Life System', id: location.hostname },
      user: { id: new TextEncoder().encode('life-owner'), name: 'Life System', displayName: 'Life System' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000
    }
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Cancelled')
  const res = cred.response as AuthenticatorAttestationResponse
  const pk = res.getPublicKey?.()
  if (!pk) throw new Error('This browser is too old for passkeys')
  await post({ passkey: 'register', session: currentSession(), credentialId: b64u(cred.rawId), clientDataJSON: b64u(res.clientDataJSON), publicKey: b64u(pk), alg: res.getPublicKeyAlgorithm?.() ?? -7, authenticatorData: b64u(res.getAuthenticatorData()), label: navigator.platform || 'This device' })
  try {
    localStorage.setItem(ID, b64u(cred.rawId))
  } catch {
    /* works until the tab closes */
  }
}

/** Unlocks with the passkey: returns the new session (stored like the PIN's). */
export async function unlockWithPasskey(): Promise<string> {
  const id = localStorage.getItem(ID)
  if (!id) throw new Error('No passkey on this device yet')
  const { challenge } = await post({ passkey: 'options', op: 'login' })
  const cred = (await navigator.credentials.get({ publicKey: { challenge: fromB64u(challenge), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: fromB64u(id) }], userVerification: 'required', timeout: 60000 } })) as PublicKeyCredential | null
  if (!cred) throw new Error('Cancelled')
  const res = cred.response as AuthenticatorAssertionResponse
  let session: string
  try {
    ;({ session } = await post({ passkey: 'login', credentialId: b64u(cred.rawId), clientDataJSON: b64u(res.clientDataJSON), authenticatorData: b64u(res.authenticatorData), signature: b64u(res.signature) }))
  } catch (e) {
    // Removed on the server (this device was signed out, A3): forget it here too.
    if (/Unknown passkey/.test((e as Error).message)) forgetPasskeyHere()
    throw e
  }
  localStorage.setItem('life_web_session', session)
  return session
}
