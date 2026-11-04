import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/desktop/main.ts'), output: { entryFileNames: 'index.js' } } } },
  preload: { build: { rollupOptions: { input: resolve('src/desktop/preload.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {}
})
