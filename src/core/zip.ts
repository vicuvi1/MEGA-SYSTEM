// A small, dependency-free .zip writer and reader for backup files and
// "Export everything". Any zip tool (Windows Explorer, 7-Zip, macOS) opens
// what this writes. Compression is passed in (Node zlib in the desktop main
// process; none or CompressionStream in the app), so this stays pure.

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(u8: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export const utf8 = (s: string) => new TextEncoder().encode(s)
export const fromUtf8 = (u8: Uint8Array) => new TextDecoder().decode(u8)

/** DOS date and time of a JS date (zip headers). */
function dosTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return [time & 0xffff, date & 0xffff]
}

/**
 * One zip file. `deflate` (raw deflate) compresses an entry when it helps;
 * without it every entry is stored as is.
 */
export function makeZip(entries: ZipEntry[], deflate?: (u8: Uint8Array) => Uint8Array, when = new Date()): Uint8Array {
  const [time, date] = dosTime(when)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = utf8(e.name.replace(/\\/g, '/'))
    const crc = crc32(e.data)
    let body = e.data
    let method = 0
    if (deflate && e.data.length > 64) {
      const packed = deflate(e.data)
      if (packed.length < e.data.length) {
        body = packed
        method = 8
      }
    }
    if (body.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('A backup file over 4 GB is not supported')
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // names are UTF-8
    lv.setUint16(8, method, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...locals, ...centrals, end]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export interface ZipItem {
  name: string
  method: number
  crc: number
  /** The stored bytes (compressed when method is 8). */
  raw: Uint8Array
}

/** The entries of a zip (from its central directory); throws when it is not a zip. */
export function listZip(u8: Uint8Array): ZipItem[] {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let end = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('This file is not a zip')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const out: ZipItem[] = []
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('This zip is damaged')
    const method = v.getUint16(p + 10, true)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extra = v.getUint16(p + 30, true)
    const comment = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = fromUtf8(u8.subarray(p + 46, p + 46 + nameLen))
    const lName = v.getUint16(local + 26, true)
    const lExtra = v.getUint16(local + 28, true)
    const start = local + 30 + lName + lExtra
    out.push({ name, method, crc, raw: u8.subarray(start, start + size) })
    p += 46 + nameLen + extra + comment
  }
  return out
}

/** One entry's bytes, checked against its CRC. `inflate` (raw) is needed for compressed entries. */
export async function readZipEntry(item: ZipItem, inflate?: (u8: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<Uint8Array> {
  let data: Uint8Array
  if (item.method === 0) data = item.raw
  else if (item.method === 8) {
    if (!inflate) throw new Error('This zip needs unpacking')
    data = await inflate(item.raw)
  } else throw new Error(`Unknown zip packing (${item.method})`)
  if (crc32(data) !== item.crc) throw new Error(`${item.name} in the zip is damaged`)
  return data
}

/** True when the bytes start like a zip file. */
export const looksLikeZip = (u8: Uint8Array) => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4
