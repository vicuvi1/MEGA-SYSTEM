// Copies the embedded apps into apps/ from their own projects.
//
//   node scripts/sync-apps.mjs --finance <Finance-Helper-App checkout> --man <MAN desktop index.html>
//
// Waky is not copied: Life System runs your installed Waky so its alarm,
// wake task and self-update keep working.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(
  process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1]]] : out), [])
)

if (args.finance) {
  const src = resolve(args.finance)
  const out = join(root, 'apps', 'finance')
  if (!existsSync(join(src, 'index.html'))) throw new Error(`No Finance Helper app at ${src}`)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, 'electron'), { recursive: true })
  for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'LICENSE', 'css', 'js', 'icons', 'fonts']) {
    if (existsSync(join(src, p))) cpSync(join(src, p), join(out, p), { recursive: true })
  }
  // Only the desktop helpers the page talks to; their own main.cjs is replaced by src/main/apps/finance.ts.
  for (const f of ['preload.cjs', 'folder.cjs', 'gdrive.cjs', 'binance.cjs', 'telegram.cjs']) cpSync(join(src, 'electron', f), join(out, 'electron', f))
  const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
  writeFileSync(join(out, 'version.json'), JSON.stringify({ version }, null, 2) + '\n')
  console.log(`Finance Helper ${version} copied`)
}

if (args.man) {
  const src = resolve(args.man)
  if (!existsSync(src)) throw new Error(`No MAN page at ${src}`)
  mkdirSync(join(root, 'apps', 'man'), { recursive: true })
  cpSync(src, join(root, 'apps', 'man', 'index.html'))
  console.log('MAN copied')
}
