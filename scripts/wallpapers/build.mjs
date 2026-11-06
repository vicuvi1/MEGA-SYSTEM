// Draws the wallpapers (Settings → Look → Wallpaper) into
// src/renderer/src/wallpaper/art/<id>.svg. Run: node scripts/wallpapers/build.mjs [id…]
// Original vector art made from code; no characters, logos or franchise names.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anime } from './anime.mjs'
import { samurai } from './samurai.mjs'
import { space } from './space.mjs'
import { more } from './more.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'src/renderer/src/wallpaper/art')
const scenes = { ...anime, ...samurai, ...space, ...more }
const only = process.argv.slice(2)
mkdirSync(out, { recursive: true })
let total = 0
for (const [id, draw] of Object.entries(scenes)) {
  if (only.length && !only.includes(id)) continue
  const text = draw()
  writeFileSync(join(out, `${id}.svg`), text)
  total += text.length
  console.log(`${id.padEnd(18)} ${(text.length / 1024).toFixed(1)} KB`)
}
console.log(`total ${(total / 1024).toFixed(1)} KB`)
