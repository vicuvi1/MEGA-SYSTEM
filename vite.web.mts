// Runs the UI in a normal browser with live Turso Cloud or in-memory demo bridge,
// and produces the standalone Web / Mobile PWA distribution for Vercel.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

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
  plugins: [react()],
  server: { port: 5180, strictPort: true }
})
