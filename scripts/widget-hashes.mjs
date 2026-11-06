// Widgets (PL3): prints each widget's sha256 and, with --write, puts it into
// widgets/gallery.json (keeping the rest of each entry). Run it after
// changing a widget.js; a test fails when the gallery and the code differ.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'widgets')
const galleryFile = join(dir, 'gallery.json')
const gallery = JSON.parse(readFileSync(galleryFile, 'utf8'))
for (const id of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const code = join(dir, id, 'widget.js')
  if (!existsSync(code)) continue
  const sha256 = createHash('sha256').update(readFileSync(code, 'utf8'), 'utf8').digest('hex')
  const m = JSON.parse(readFileSync(join(dir, id, 'manifest.json'), 'utf8'))
  console.log(`${id}  ${sha256}`)
  const e = gallery.widgets.find((x) => x.id === id)
  if (e) Object.assign(e, { sha256, version: m.version, name: m.name, author: m.author, about: m.about })
}
if (process.argv.includes('--write')) writeFileSync(galleryFile, JSON.stringify(gallery, null, 2) + '\n')
