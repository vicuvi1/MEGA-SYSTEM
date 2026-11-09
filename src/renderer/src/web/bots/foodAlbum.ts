// Several meal photos on Telegram that belong to ONE meal (the server only).
//
// Telegram sends an album (photos picked together) as separate updates with
// the same media_group_id, about at the same time, and on Vercel each one can
// land in a different function call. So the parts meet in the database, not
// in memory: each part writes one short row, the first part to arrive becomes
// the "lead" (an atomic insert), waits until no new part came for about a
// second (2–4 s in all), takes every part and reads them in ONE vision call.
// The other parts only write their row and answer nothing.
//
// "➕ Add another photo" under a photo preview opens a 60-second window: the
// photos sent in it are collected the same way, and "✅ Done, read them" reads
// the earlier photos and the new ones together (one call, one new preview).
//
// What is kept: only Telegram's file ids (a reference Telegram needs the bot
// token to open), the caption and times, in server-only rows of sys_kv
// (/api/db refuses sys_* tables). Never the picture. Rows go as soon as the
// photos are read, on Save or Cancel, and in any case after 10 minutes.
import type { Change, Param } from '../browserDb'

/** One Turso transaction (TursoHttp.writeAtomic): every statement's rows. */
export type PhotoKv = (stmts: Change[]) => Promise<Param[][][]>

/** One photo of a set: its Telegram file id, the caption, the message id, when. */
export interface PhotoPart {
  f: string
  c: string
  m: number
  at: number
}

/** Rows older than this are removed on the next photo (and never read again). */
export const SET_TTL_MS = 10 * 60_000
/** "Add another photo": photos sent this long after the tap (or the last added photo) join the meal. */
export const ADD_WINDOW_MS = 60_000
/** At most this many photos of one meal are read together (api/_vision.mjs MAX_PHOTOS). */
export const MAX_SET = 6
/** How the lead waits for the rest of an album (tests make it short). */
export const albumWait = { pollMs: 500, minPolls: 3, quietPolls: 2, maxPolls: 8 }

const TABLE: Change = { sql: 'CREATE TABLE IF NOT EXISTS sys_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)', args: [] }
const OURS = "(key LIKE 'fdp:%' OR key LIKE 'fdl:%' OR key LIKE 'fda:%' OR key LIKE 'fdd:%')"
/** Removes every photo row older than 10 minutes. */
const sweep = (now: number): Change => ({ sql: `DELETE FROM sys_kv WHERE ${OURS} AND json_valid(value) AND CAST(json_extract(value, '$.at') AS INTEGER) < ?`, args: [now - SET_TTL_MS] })
/** Message ids padded, so the keys sort in the order the photos were sent. */
const pad = (m: number) => String(Math.max(0, Math.floor(m) || 0)).padStart(12, '0')
const clean = (s: string) => String(s ?? '').replace(/[^\w-]/g, '').slice(0, 40)
const partPrefix = (chat: string, set: string) => `fdp:${clean(chat)}:${set}:`
const leadKey = (chat: string, gid: string) => `fdl:${clean(chat)}:g${clean(gid)}`
const addKey = (chat: string) => `fda:${clean(chat)}`
const draftKey = (chat: string, draft: string) => `fdd:${clean(chat)}:${clean(draft)}`
const parse = (v: Param | undefined): any => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : null
  } catch {
    return null
  }
}
const partOf = (v: Param | undefined): PhotoPart | null => {
  const o = parse(v)
  return o && typeof o.f === 'string' && o.f ? { f: o.f.slice(0, 200), c: String(o.c ?? '').slice(0, 300), m: Number(o.m) || 0, at: Number(o.at) || 0 } : null
}
const partRow = (prefix: string, p: PhotoPart): Change => ({ sql: 'INSERT OR REPLACE INTO sys_kv (key, value) VALUES (?, ?)', args: [prefix + pad(p.m), JSON.stringify({ f: p.f, c: p.c.slice(0, 300), m: p.m, at: p.at })] })
const countParts = (prefix: string): Change => ({ sql: 'SELECT COUNT(*) FROM sys_kv WHERE key >= ? AND key < ?', args: [prefix, prefix + '~'] })
const takeParts = (prefix: string): Change => ({ sql: 'DELETE FROM sys_kv WHERE key >= ? AND key < ? RETURNING key, value', args: [prefix, prefix + '~'] })
const sorted = (rows: Param[][]): PhotoPart[] =>
  rows
    .slice()
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map((r) => partOf(r[1]))
    .filter((p): p is PhotoPart => !!p)

// ---- an album (media group) ----

/**
 * One part of an album arrived: its row is written, and the first part to get
 * here is the lead ('lead'). The others answer nothing ('wait'), unless the
 * lead already took the photos ('late': this one is read on its own).
 */
export async function joinAlbum(kv: PhotoKv, chat: string, gid: string, part: PhotoPart, now: number): Promise<'lead' | 'wait' | 'late'> {
  const prefix = partPrefix(chat, `g${clean(gid)}`)
  const lead = leadKey(chat, gid)
  const r = await kv([
    TABLE,
    sweep(now),
    partRow(prefix, part),
    { sql: 'INSERT INTO sys_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING RETURNING key', args: [lead, JSON.stringify({ at: now, st: 'wait' })] },
    { sql: 'SELECT value FROM sys_kv WHERE key = ?', args: [lead] }
  ])
  if (r[3]?.length) return 'lead'
  if (parse(r[4]?.[0]?.[0])?.st !== 'taken') return 'wait'
  await kv([{ sql: 'DELETE FROM sys_kv WHERE key = ?', args: [prefix + pad(part.m)] }])
  return 'late'
}

/** The lead waits until no new part came for a moment (or 10 parts, or about 4 s), then takes them all. */
export async function collectAlbum(kv: PhotoKv, chat: string, gid: string, now: () => number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms))): Promise<PhotoPart[]> {
  const prefix = partPrefix(chat, `g${clean(gid)}`)
  let last = -1
  let same = 0
  for (let i = 1; i <= albumWait.maxPolls; i++) {
    await sleep(albumWait.pollMs)
    const n = Number((await kv([countParts(prefix)]))[0]?.[0]?.[0]) || 0
    same = n === last ? same + 1 : 0
    last = n
    if (n >= 10 || (i >= albumWait.minPolls && same >= albumWait.quietPolls)) break
  }
  const r = await kv([{ sql: 'UPDATE sys_kv SET value = ? WHERE key = ?', args: [JSON.stringify({ at: now(), st: 'taken' }), leadKey(chat, gid)] }, takeParts(prefix)])
  return sorted(r[1] ?? [])
}

// ---- the photos behind an open preview, and "Add another photo" ----

/** Keeps the file ids behind a photo preview (10 minutes at most), so more photos can be added to it. */
export async function keepDraftPhotos(kv: PhotoKv, chat: string, draft: string, fileIds: string[], caption: string, now: number): Promise<void> {
  await kv([
    TABLE,
    sweep(now),
    { sql: 'DELETE FROM sys_kv WHERE key >= ? AND key < ?', args: [`fdd:${clean(chat)}:`, `fdd:${clean(chat)}:~`] },
    { sql: 'INSERT OR REPLACE INTO sys_kv (key, value) VALUES (?, ?)', args: [draftKey(chat, draft), JSON.stringify({ at: now, f: fileIds.slice(0, MAX_SET), c: caption.slice(0, 300) })] }
  ])
}

export interface AddState {
  /** The preview's draft id. */
  d: string
  /** When the window opened or the last photo joined. */
  at: number
  /** The photos already read (file ids) and their caption. */
  f: string[]
  c: string
  /** The "send the next photo" message, edited as photos come in. */
  msg: number | null
}
const addOf = (v: Param | undefined): AddState | null => {
  const o = parse(v)
  return o && typeof o.d === 'string' && Array.isArray(o.f) ? { d: o.d, at: Number(o.at) || 0, f: o.f.filter((x: unknown) => typeof x === 'string').slice(0, MAX_SET), c: String(o.c ?? ''), msg: Number(o.msg) || null } : null
}

/** "Add another photo" on a preview: opens the window. null when the preview's photos are gone (older than 10 minutes). */
export async function startAdd(kv: PhotoKv, chat: string, draft: string, now: number): Promise<AddState | null> {
  const r = await kv([TABLE, sweep(now), { sql: 'SELECT value FROM sys_kv WHERE key = ?', args: [draftKey(chat, draft)] }])
  const kept = parse(r[2]?.[0]?.[0])
  if (!kept || !Array.isArray(kept.f) || !kept.f.length) return null
  const st: AddState = { d: clean(draft), at: now, f: kept.f.slice(0, MAX_SET), c: String(kept.c ?? ''), msg: null }
  // A new window starts empty (photos of an older, unfinished one are dropped).
  await kv([takeParts(`fdp:${clean(chat)}:a`), { sql: 'INSERT OR REPLACE INTO sys_kv (key, value) VALUES (?, ?)', args: [addKey(chat), JSON.stringify(st)] }])
  return st
}

/** Remembers the "send the next photo" message (it shows how many came). */
export async function setAddMsg(kv: PhotoKv, chat: string, msg: number): Promise<void> {
  await kv([{ sql: "UPDATE sys_kv SET value = json_set(value, '$.msg', ?) WHERE key = ?", args: [msg, addKey(chat)] }])
}

/** The open "add another photo" window, or null (none, or more than 60 s since the tap or the last photo). */
export async function openAdd(kv: PhotoKv, chat: string, now: number): Promise<AddState | null> {
  const r = await kv([TABLE, { sql: 'SELECT value FROM sys_kv WHERE key = ?', args: [addKey(chat)] }])
  const st = addOf(r[1]?.[0]?.[0])
  return st && now - st.at <= ADD_WINDOW_MS && now >= st.at - 60_000 ? st : null
}

/** A photo sent in the window joins the meal; says how many new photos there are now. */
export async function addPart(kv: PhotoKv, chat: string, st: AddState, part: PhotoPart, now: number): Promise<number> {
  const prefix = partPrefix(chat, `a${st.d}`)
  const r = await kv([partRow(prefix, part), { sql: "UPDATE sys_kv SET value = json_set(value, '$.at', ?) WHERE key = ?", args: [now, addKey(chat)] }, countParts(prefix)])
  return Number(r[2]?.[0]?.[0]) || 0
}

/** How many new photos came in the window for this preview (0 when none, or the window is for another one). */
export async function addedCount(kv: PhotoKv, chat: string, draft: string): Promise<{ st: AddState | null; n: number }> {
  const r = await kv([TABLE, { sql: 'SELECT value FROM sys_kv WHERE key = ?', args: [addKey(chat)] }, countParts(partPrefix(chat, `a${clean(draft)}`))])
  const st = addOf(r[1]?.[0]?.[0])
  return st && st.d === clean(draft) ? { st, n: Number(r[2]?.[0]?.[0]) || 0 } : { st: null, n: 0 }
}

/** "Done, read them": closes the window and takes the new photos (the earlier ones are in the state). */
export async function takeAdd(kv: PhotoKv, chat: string, draft: string): Promise<{ st: AddState; parts: PhotoPart[] } | null> {
  const r = await kv([{ sql: 'DELETE FROM sys_kv WHERE key = ? RETURNING value', args: [addKey(chat)] }, takeParts(partPrefix(chat, `a${clean(draft)}`))])
  const st = addOf(r[0]?.[0]?.[0])
  if (!st || st.d !== clean(draft)) return null
  return { st, parts: sorted(r[1] ?? []) }
}

/** Removes every photo row of this chat (on Save, Cancel or "Stop adding"). */
export async function dropChatPhotos(kv: PhotoKv, chat: string): Promise<void> {
  const c = clean(chat)
  await kv([
    TABLE,
    { sql: 'DELETE FROM sys_kv WHERE key = ?', args: [addKey(chat)] },
    { sql: 'DELETE FROM sys_kv WHERE key >= ? AND key < ?', args: [`fdd:${c}:`, `fdd:${c}:~`] },
    { sql: 'DELETE FROM sys_kv WHERE key >= ? AND key < ?', args: [`fdp:${c}:a`, `fdp:${c}:a~`] }
  ])
}
