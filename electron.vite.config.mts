import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
const SHA = String(process.env.GITHUB_SHA || '').slice(0, 7)
const APP_VERSION = `desktop ${JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version}${SHA ? `+${SHA}` : ''}`
const alias = {
  '@core': resolve(root, 'src/core'),
  '@shared': resolve(root, 'src/shared')
}

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    resolve: { alias },
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    plugins: [react()]
  }
})
