// sherpa-onnx's WebAssembly build has no types; the ear worker uses only these.
declare module 'sherpa-onnx/sherpa-onnx-wasm-nodejs.js' {
  const factory: (moduleArg: Record<string, unknown>) => Promise<any>
  export default factory
}
declare module 'sherpa-onnx/sherpa-onnx-kws.js' {
  export function createKws(Module: any, config: Record<string, unknown>): any
}
declare module 'sherpa-onnx/sherpa-onnx-vad.js' {
  export function createVad(Module: any, config: Record<string, unknown>): any
}
