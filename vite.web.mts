// Runs the UI in a normal browser with live Turso Cloud or in-memory demo bridge,
// and produces the standalone Web / Mobile PWA distribution for Vercel.
import { join, resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
// Each build gets an id; the open app compares it with /version.json to know
// a new version was published (and offers a reload).
const BUILD_ID = String(Date.now())
// Shown next to every error in the log: package version + the commit it was built from.
const SHA = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 7)
const APP_VERSION = `${JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version}${SHA ? `+${SHA}` : ''}`
const versionFile = {
  name: 'version-file',
  generateBundle(this: any, _opts: unknown, bundle: Record<string, unknown>) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    // Everything the app needs to open offline: every built file and the embedded apps.
    const walk = (dir: string, base: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]))
    const apps = existsSync(resolve(root, 'src/renderer/public/apps')) ? walk(resolve(root, 'src/renderer/public/apps'), 'apps/') : []
    const files = [...Object.keys(bundle), ...apps].filter((f) => !/\.map$|precache\.json$|sw\.js$/.test(f) && !/(^|\/)(tests?|e2e|node_modules)\//.test(f) && !/^assets\/(?:voiceAiWorker|voiceEarWorker|voiceMicWorklet|ort-wasm)-/.test(f))
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ build: BUILD_ID, files: ['/', ...files.map((f) => `/${f}`)] }) })
  }
}

// Voice (JV1): sherpa-onnx's WebAssembly build is made for Node; in a worker it
// only needs its in-memory file system instead of Node's, and its two helper
// files must export their functions. Checked by src/renderer/src/voice/build.test.ts.
export function sherpaForBrowser() {
  return {
    name: 'sherpa-for-browser',
    transform(code: string, id: string) {
      if (id.endsWith('sherpa-onnx-wasm-nodejs.js')) {
        const a = 'if(!ENVIRONMENT_IS_NODE){throw new Error("NODERAWFS is currently only supported on Node.js environment.")}'
        const b = 'for(var _key in NODERAWFS){'
        if (!code.includes(a) || !code.includes(b)) throw new Error('sherpa-onnx changed: check the voice patch in vite.web.mts')
        return { code: code.replace(a, '').replace(b, 'if(ENVIRONMENT_IS_NODE)for(var _key in NODERAWFS){'), map: null }
      }
      if (/sherpa-onnx-(kws|vad)\.js$/.test(id)) {
        const guard = /if \(typeof process == 'object' && typeof process\.versions == 'object' &&\s*typeof process\.versions\.node == 'string'\) \{/
        if (!guard.test(code)) throw new Error('sherpa-onnx changed: check the voice patch in vite.web.mts')
        return { code: code.replace(guard, 'if (true) {'), map: null }
      }
      return null
    }
  }
}
// Voice: Transformers.js runs on ONNX Runtime's plain WebAssembly build (no
// GPU code); its .wasm is downloaded on first use, never put in the build.
const voiceAlias = [{ find: /^onnxruntime-web\/webgpu$/, replacement: resolve(root, 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs') }]

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  resolve: {
    alias: [{ find: '@core', replacement: resolve(root, 'src/core') }, { find: '@shared', replacement: resolve(root, 'src/shared') }, ...voiceAlias]
  },
  worker: { format: 'es', plugins: () => [sherpaForBrowser()] },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    // The mic's audio-thread script must be a real file (the CSP allows no data: scripts).
    assetsInlineLimit: (file: string) => (/voiceMicWorklet/.test(file) ? false : undefined)
  },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(`web ${APP_VERSION}`) },
  plugins: [react(), versionFile, sherpaForBrowser()],
  server: { port: 5180, strictPort: true }
})
