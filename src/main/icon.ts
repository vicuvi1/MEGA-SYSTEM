import { deflateSync } from 'node:zlib'

// Draws the app mark (a lime disc with a dark core) as a PNG, so the tray
// and window icon need no image files until a real icon is designed.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function appIconPng(size = 32): Buffer {
  const rows: Buffer[] = []
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4) // filter byte 0 + RGBA pixels
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2)
      const o = 1 + x * 4
      // Soft edge: alpha fades over the last pixel of the disc.
      const edge = Math.max(0, Math.min(1, (1 - d) * size * 0.5))
      if (d < 0.34) row.set([0x1b, 0x21, 0x05, 255], o)
      else row.set([0xc8, 0xf1, 0x35, Math.round(edge * 255)], o)
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}
