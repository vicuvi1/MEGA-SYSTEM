// Makes Sport Track's photo demos: for each move in src/core/sportPhotos.ts,
// the two frames (start, end) from the Free Exercise DB (public domain, the
// Unlicense), cropped to 5:4 and saved as 480 × 384 WebP next to the page
// (src/renderer/public/apps/sport/photos/<move>-0.webp, -1.webp).
//
//   node --experimental-strip-types scripts/sport-photos.mjs [--from <folder>]
//
// --from: a folder with the original frames already downloaded, named
// <Exercise_Folder>-0.jpg and -1.jpg. Without it they are fetched from
// raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/.
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { PHOTOS, PHOTO_W, PHOTO_H } = await import(pathToFileURL(join(repo, 'src/core/sportPhotos.ts')).href)
const out = join(repo, 'src/renderer/public/apps/sport/photos')
const fromArg = process.argv.indexOf('--from')
const from = fromArg > 0 ? resolve(process.argv[fromArg + 1]) : null
const BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
mkdirSync(out, { recursive: true })

async function original(src, i) {
  if (from) {
    const p = join(from, `${src}-${i}.jpg`)
    if (!existsSync(p)) throw new Error(`missing ${p}`)
    return readFileSync(p)
  }
  const r = await fetch(`${BASE}${src}/${i}.jpg`)
  if (!r.ok) throw new Error(`${src}/${i}.jpg: HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

let total = 0
for (const [id, p] of Object.entries(PHOTOS)) {
  for (const i of [0, 1]) {
    const buf = await original(p.src, i)
    const img = sharp(buf)
    const { width, height } = await img.metadata()
    const w = Math.min(width, Math.round(p.crop[2] * width))
    const h = Math.min(height, Math.round(w / (PHOTO_W / PHOTO_H)))
    const left = Math.max(0, Math.min(width - w, Math.round(p.crop[0] * width)))
    const top = Math.max(0, Math.min(height - h, Math.round(p.crop[1] * height)))
    let pipe = sharp(buf).extract({ left, top, width: w, height: h }).resize(PHOTO_W, PHOTO_H, { fit: 'cover' })
    if (p.flip) pipe = pipe.flop()
    const info = await pipe.webp({ quality: 72, effort: 6 }).toFile(join(out, `${id}-${i}.webp`))
    total += info.size
  }
}
console.log(`${Object.keys(PHOTOS).length * 2} frames, ${(total / 1024).toFixed(0)} KB in ${out}`)
