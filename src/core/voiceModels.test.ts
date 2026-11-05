import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EAR_PACK, ORT_FILE, ORT_VERSION, SHERPA_VERSION, PHONEMIZER_URL, STT_MODELS, downloadPlan, shrinkWasmMemory, sizeText } from './voiceModels'

/** A tiny valid wasm: one memory of `min` pages, exported. */
function wasmWithMemory(minLeb: number[]): Uint8Array {
  const mem = [0x01, 0x00, ...minLeb]
  const exp = [0x01, 0x01, 0x6d, 0x02, 0x00]
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, mem.length, ...mem, 0x07, exp.length, ...exp])
}

describe('voice downloads', () => {
  it('everything comes from the allowed hosts (the CSP lets only these in)', () => {
    const urls = [...EAR_PACK.files.flatMap((f) => f.urls), ...ORT_FILE.urls, PHONEMIZER_URL]
    for (const u of urls) expect(u).toMatch(/^https:\/\/(?:huggingface\.co|cdn\.jsdelivr\.net)\//)
    for (const m of Object.values(STT_MODELS)) expect(m.repo).toMatch(/^onnx-community\//)
  })
  it('the runtime version is the one Transformers.js really uses', () => {
    const lock = JSON.parse(readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8'))
    expect(lock.packages['node_modules/onnxruntime-web']?.version).toBe(ORT_VERSION)
    // The wake-word engine's .wasm is downloaded for the same version its glue code is bundled from.
    expect(lock.packages['node_modules/sherpa-onnx']?.version).toBe(SHERPA_VERSION)
  })
  it('the plan lists only what your choices need', () => {
    expect(downloadPlan({ wake: false, stt: 'moonshine-tiny', tts: 'system' }).map((x) => x.part)).toEqual(['stt'])
    expect(downloadPlan({ wake: true, stt: 'whisper-base', tts: 'kokoro' }).map((x) => x.part)).toEqual(['ear', 'stt', 'tts'])
  })
  it('sizes read plainly', () => {
    expect(sizeText(31_000_000)).toBe('31 MB')
    expect(sizeText(1_807_524)).toBe('1.8 MB')
    expect(sizeText(300_000)).toBe('300 KB')
  })
})

describe('shrinkWasmMemory', () => {
  it('lowers the starting memory without moving anything', async () => {
    // 8192 pages (512 MB) as LEB128: 0x80 0x40.
    const big = wasmWithMemory([0x80, 0x40])
    const small = shrinkWasmMemory(big, 512)
    expect(small.length).toBe(big.length)
    const instance = await WebAssembly.instantiate(new WebAssembly.Module(small as Uint8Array<ArrayBuffer>))
    expect((instance.exports.m as WebAssembly.Memory).buffer.byteLength).toBe(512 * 65536)
  })
  it('leaves other files alone', () => {
    const tiny = wasmWithMemory([0x10])
    expect(shrinkWasmMemory(tiny, 512)).toBe(tiny)
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(shrinkWasmMemory(junk)).toBe(junk)
  })
})
