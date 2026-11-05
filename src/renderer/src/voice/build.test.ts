// The wake-word engine (sherpa-onnx's WebAssembly build) runs in a browser
// worker only after the small build patch in vite.web.mts. This runs the real
// file, patched, the way a worker sees it (not Node), with its memory shrunk.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { sherpaForBrowser } from '../../../../vite.web.mjs'
import { shrinkWasmMemory } from '@core/voiceModels'

const DIR = resolve(__dirname, '../../../../node_modules/sherpa-onnx')
const patch = (file: string) => {
  const out = sherpaForBrowser().transform(readFileSync(resolve(DIR, file), 'utf8'), resolve(DIR, file))
  if (!out) throw new Error('not patched')
  return out.code
}
const asModule = (code: string): any => {
  const m = { exports: {} as any }
  new Function('module', 'exports', 'require', code)(m, m.exports, createRequire(__filename))
  return m.exports
}

describe('voice build: sherpa-onnx in a worker', () => {
  it('the helpers export their functions', () => {
    expect(typeof asModule(patch('sherpa-onnx-kws.js')).createKws).toBe('function')
    expect(typeof asModule(patch('sherpa-onnx-vad.js')).createVad).toBe('function')
  })
  it('the engine starts outside Node with its in-memory files and a 32 MB start', async () => {
    const proc = process as any
    const before = { type: proc.type, wgs: (globalThis as any).WorkerGlobalScope, self: (globalThis as any).self, loc: (globalThis as any).location }
    // What a worker looks like to it: not Node.
    proc.type = 'renderer'
    ;(globalThis as any).WorkerGlobalScope = function () {}
    ;(globalThis as any).self = globalThis
    ;(globalThis as any).location ??= { href: 'https://app.test/assets/voiceEarWorker.js' }
    try {
      const factory = asModule(patch('sherpa-onnx-wasm-nodejs.js'))
      const wasm = shrinkWasmMemory(new Uint8Array(readFileSync(resolve(DIR, 'sherpa-onnx-wasm-nodejs.wasm'))), 512)
      const M = await factory({ wasmBinary: wasm, print: () => {}, printErr: () => {} })
      expect(M.HEAPU8.length).toBe(512 * 65536)
      M.FS.writeFile('/hello.txt', 'hey ben')
      expect(M.FS.readFile('/hello.txt', { encoding: 'utf8' })).toBe('hey ben')
      expect(typeof M._SherpaOnnxCreateKeywordSpotter).toBe('function')
      expect(typeof M._SherpaOnnxCreateVoiceActivityDetector).toBe('function')
    } finally {
      proc.type = before.type
      ;(globalThis as any).WorkerGlobalScope = before.wgs
      ;(globalThis as any).self = before.self
    }
  }, 30_000)
})
