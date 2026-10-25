// Runs only the UI in a normal browser with the in-memory demo bridge,
// for quick design work and screenshots. The real app is `npm run dev`.
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
  plugins: [react()],
  server: { port: 5180, strictPort: true }
})
