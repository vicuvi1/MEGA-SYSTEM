// Runs the UI in a normal browser with live Turso Cloud or in-memory demo bridge,
// and produces the standalone Web / Mobile PWA distribution for Vercel.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
// Each build gets an id; the open app compares it with /version.json to know
// a new version was published (and offers a reload).
const BUILD_ID = String(Date.now())
const versionFile = {
  name: 'version-file',
  generateBundle(this: any) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
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
