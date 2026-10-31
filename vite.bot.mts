// Bundles the Telegram bot for the web server: src/server/telegramBot.ts →
// api/_bot/bot.mjs (run with `npm run build:bot`; the bundle is committed so
// Vercel's functions always have it).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(root, 'src/core'),
      '@shared': resolve(root, 'src/shared')
    }
  },
  build: {
    ssr: resolve(root, 'src/server/telegramBot.ts'),
    outDir: resolve(root, 'api/_bot'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: ['sql.js'],
      output: { format: 'es', entryFileNames: 'bot.mjs' }
    }
  },
  ssr: { noExternal: true, external: ['sql.js'] }
})
