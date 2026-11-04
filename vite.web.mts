// Runs the UI in a normal browser with live Turso Cloud or in-memory demo bridge,
// and produces the standalone Web / Mobile PWA distribution for Vercel.
import { join, resolve } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
// Each build gets an id; the open app compares it with /version.json to know
// a new version was published (and offers a reload).
const BUILD_ID = String(Date.now())
const versionFile = {
  name: 'version-file',
  generateBundle(this: any, _opts: unknown, bundle: Record<string, unknown>) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    // Everything the app needs to open offline: every built file and the embedded apps.
    const walk = (dir: string, base: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]))
    const apps = existsSync(resolve(root, 'src/renderer/public/apps')) ? walk(resolve(root, 'src/renderer/public/apps'), 'apps/') : []
    const files = [...Object.keys(bundle), ...apps].filter((f) => !/\.map$|precache\.json$|sw\.js$/.test(f) && !/(^|\/)(tests?|e2e|node_modules)\//.test(f))
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ build: BUILD_ID, files: ['/', ...files.map((f) => `/${f}`)] }) })
  }
}

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  resolve: {
    alias: {
      '@core': resolve(root, 'src/core'),
      '@shared': resolve(root, 'src/shared')
    }
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true
  },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), versionFile],
  server: { port: 5180, strictPort: true }
})
