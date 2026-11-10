// Telegram food photos on their way to Photo Locker (the server side).
//
// A meal photo sent to the bot also goes into Photo Locker (and so into his
// Google Drive folder, under Food/YYYY-MM). The server never uploads to Drive:
// files go device-to-Google (DECISIONS.md, "Photo Locker"). So the server only
// HOLDS a reference: one server-only sys_kv row per photo with Telegram's file
// id (never the picture), the draft it belongs to and, after Save, the meal.
// The app (desktop or website) asks for the held photos (/api/google
// {op:'foodInbox'}), fetches each one once through the server
// ({op:'foodInboxGet'}, the bot token never leaves the server), keeps it in
// Photo Locker, uploads it to Drive and then erases the row
// ({op:'foodInboxDone'}). A row is erased after 3 days in any case.
//
// Rows: `lkh:<draft>:<n>` = {f: file id, d: draft, n, at, st: 'open'|'meal', meal?, name?, type?}.
// Cancel or "Not this meal" erases the draft's rows at once.
import type { Change } from '../browserDb'
import type { PhotoKv } from './foodAlbum'
import { lockerPhotoIds } from '@core/foodBen'

/** Held at most this long (the owner's choice: 3 days), then erased unread. */
export const HOLD_MS = 3 * 86400_000
/** A photo whose draft was neither saved nor cancelled goes to the Locker after this (the draft has closed). */
export const OPEN_GRACE_MS = 2 * 3600_000
/** What one fetch may carry (Vercel answers at most 4.5 MB; Telegram photos are far smaller). */
export const MAX_FETCH_B64 = 4_000_000

const TABLE: Change = { sql: 'CREATE TABLE IF NOT EXISTS sys_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)', args: [] }
const sweep = (now: number): Change => ({ sql: "DELETE FROM sys_kv WHERE key LIKE 'lkh:%' AND (NOT json_valid(value) OR CAST(json_extract(value, '$.at') AS INTEGER) < ?)", args: [now - HOLD_MS] })
const clean = (s: string) => String(s ?? '').replace(/[^\w-]/g, '').slice(0, 24)
const prefix = (draft: string) => `lkh:${clean(draft)}:`

export interface HeldPhoto {
  /** The Photo Locker id it gets (fp<draft>n<n>): the meal row finds it by this. */
  id: string
  at: number
  /** The meal it belongs to once saved (fd-p<draft>), its name and type. */
  meal?: string
  name?: string
  type?: string
}

/** Holds the photos behind a photo preview (Telegram file ids, in order). A photo held for an older preview moves to this one. */
export async function holdPhotos(kv: PhotoKv, draft: string, fileIds: string[], now: number): Promise<void> {
  const ids = fileIds.slice(0, 6)
  if (!ids.length) return
  await kv([
    TABLE,
    sweep(now),
    // "Add another photo" reads the earlier photos again under a new preview: one row per photo, never two.
    { sql: `DELETE FROM sys_kv WHERE key LIKE 'lkh:%' AND json_valid(value) AND json_extract(value, '$.f') IN (${ids.map(() => '?').join(',')})`, args: ids },
    ...ids.map((f, i): Change => ({ sql: 'INSERT OR REPLACE INTO sys_kv (key, value) VALUES (?, ?)', args: [`${prefix(draft)}${i + 1}`, JSON.stringify({ f: f.slice(0, 200), d: clean(draft), n: i + 1, at: now, st: 'open' })] }))
  ])
}

/** Save: the held photos now belong to the meal (its id, name and type name the file). */
export async function attachMeal(kv: PhotoKv, draft: string, meal: { id: string; name: string; type: string }): Promise<void> {
  await kv([
    TABLE,
    { sql: "UPDATE sys_kv SET value = json_set(value, '$.st', 'meal', '$.meal', ?, '$.name', ?, '$.type', ?) WHERE key >= ? AND key < ?", args: [meal.id.slice(0, 40), meal.name.slice(0, 60), meal.type.slice(0, 12), prefix(draft), prefix(draft) + '~'] }
  ])
}

/** Cancel / "Not this meal": the draft's photos are not kept at all. */
export async function dropHeld(kv: PhotoKv, draft: string): Promise<void> {
  await kv([TABLE, { sql: 'DELETE FROM sys_kv WHERE key >= ? AND key < ?', args: [prefix(draft), prefix(draft) + '~'] }])
}

const parse = (v: unknown): any => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : null
  } catch {
    return null
  }
}
const rowOf = (key: unknown, v: unknown): (HeldPhoto & { f: string; st: string }) | null => {
  const o = parse(v)
  if (!o || typeof o.f !== 'string' || !/^[\w-]{1,24}$/.test(String(o.d)) || !(Number(o.n) >= 1)) return null
  const id = lockerPhotoIds(String(o.d), Number(o.n))[Number(o.n) - 1]
  if (!id || String(key) !== `lkh:${o.d}:${o.n}`) return null
  return { id, f: o.f, st: String(o.st), at: Number(o.at) || 0, ...(o.meal ? { meal: String(o.meal), name: String(o.name ?? ''), type: String(o.type ?? '') } : {}) }
}

/** The photos ready for Photo Locker: saved with a meal, or older than the preview's 2 hours. Old rows are swept first. */
export async function listHeld(kv: PhotoKv, now: number): Promise<HeldPhoto[]> {
  const r = await kv([TABLE, sweep(now), { sql: "SELECT key, value FROM sys_kv WHERE key LIKE 'lkh:%' ORDER BY key LIMIT 60", args: [] }])
  return (r[2] ?? [])
    .map((row) => rowOf(row[0], row[1]))
    .filter((x): x is NonNullable<typeof x> => !!x && (x.st === 'meal' || now - x.at > OPEN_GRACE_MS))
    .map(({ f: _f, st: _st, ...h }) => h)
}

/** The Telegram file id behind a held photo (by its Locker id), or null. */
async function heldFile(kv: PhotoKv, id: string, now: number): Promise<string | null> {
  const m = /^fp([a-z0-9]{1,12})n([1-6])$/.exec(String(id))
  if (!m) return null
  const r = await kv([TABLE, sweep(now), { sql: 'SELECT key, value FROM sys_kv WHERE key = ?', args: [`lkh:${m[1]}:${m[2]}`] }])
  const row = r[2]?.[0]
  return row ? rowOf(row[0], row[1])?.f ?? null : null
}

/** Erases held photos once they are in Drive (Locker ids). */
export async function doneHeld(kv: PhotoKv, ids: string[]): Promise<number> {
  const keys = ids.map((id) => /^fp([a-z0-9]{1,12})n([1-6])$/.exec(String(id))).filter((m): m is RegExpExecArray => !!m).slice(0, 60).map((m) => `lkh:${m[1]}:${m[2]}`)
  if (!keys.length) return 0
  await kv([TABLE, { sql: `DELETE FROM sys_kv WHERE key IN (${keys.map(() => '?').join(',')})`, args: keys }])
  return keys.length
}

type Download = (token: string, fileId: string) => Promise<{ mime: string; data: string } | null>

/**
 * /api/google {op:'foodInbox' | 'foodInboxGet' | 'foodInboxDone'} (the session is
 * checked before). A file id only opens with the bot that received it, so each
 * of the server's bot tokens is tried; no token or file id ever goes back.
 */
export async function foodInboxOp(kv: PhotoKv, body: any, tokens: string[], download: Download, now = Date.now()): Promise<Record<string, unknown>> {
  const op = String(body?.op ?? '')
  if (op === 'foodInbox') return { items: await listHeld(kv, now) }
  if (op === 'foodInboxDone') return { ok: true, erased: await doneHeld(kv, Array.isArray(body?.ids) ? body.ids.map(String) : []) }
  if (op === 'foodInboxGet') {
    const f = await heldFile(kv, String(body?.id ?? ''), now)
    if (!f) return { error: 'That photo is not held any more' }
    for (const t of tokens) {
      const got = await download(t, f).catch(() => null)
      if (got && got.data.length <= MAX_FETCH_B64) return { mime: got.mime, data: got.data }
    }
    return { error: 'Telegram did not give the photo: try again later' }
  }
  return { error: 'Unknown op' }
}
