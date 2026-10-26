// Renders build/icon.svg and build/tray.svg to the PNGs the app and the
// installer use:  node scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const render = (svg, size) => new Resvg(readFileSync(join(root, svg), 'utf8'), { fitTo: { mode: 'width', value: size } }).render().asPng()

const assets = join(root, 'src', 'main', 'assets')
mkdirSync(assets, { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), render('build/icon.svg', 512)) // installer + exe icon
writeFileSync(join(assets, 'icon.png'), render('build/icon.svg', 256)) // window, notifications
writeFileSync(join(assets, 'tray.png'), render('build/tray.svg', 32))
writeFileSync(join(assets, 'tray@2x.png'), render('build/tray.svg', 64))
console.log('icons written')
