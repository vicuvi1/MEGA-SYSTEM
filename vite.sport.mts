// Bundles Sport Track's tested logic (exercise library, demos, ladders,
// badges) for the embedded page: src/core/sportKit.ts →
// src/renderer/public/apps/sport/sportkit.js, as window.SportKit.
// Run `npm run build:sport` after changing those files and commit the result.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export const sportKitBuild = {
  outDir: resolve(root, 'src/renderer/public/apps/sport'),
  emptyOutDir: false,
  copyPublicDir: false,
  minify: false,
  target: 'es2020',
  lib: { entry: resolve(root, 'src/core/sportKit.ts'), name: 'SportKit', formats: ['iife' as const], fileName: () => 'sportkit.js' }
}

export default defineConfig({ publicDir: false, logLevel: 'warn', build: sportKitBuild })
