// Island eyes (EY3): one-line captions of the window in front with
// Florence-2 (base, int8), in a worker of the desktop app's window. The
// library and the model were downloaded when you turned captions on
// (Settings → Island eyes) and are served by the desktop app itself from
// /eyes-files/ (nothing is asked from the internet here). One thread, no
// GPU, so it stays light; the app stops this worker after 2 idle minutes.
// The picture arrives as raw RGB in memory and is dropped after each job.
const MODEL = 'onnx-community/Florence-2-base-ft'
const TASK = '<CAPTION>'
let T = null
let model = null
let processor = null
let tokenizer = null
let loading = null

async function load() {
  const at = (p) => new URL(p, self.location.href).href
  T = await import(at('/eyes-files/lib/transformers.min.js'))
  const env = T.env
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = at('/eyes-files/models/')
  env.useBrowserCache = false
  env.backends.onnx.wasm.wasmPaths = at('/eyes-files/lib/')
  env.backends.onnx.wasm.numThreads = 1
  env.backends.onnx.wasm.proxy = false
  model = await T.Florence2ForConditionalGeneration.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' })
  processor = await T.AutoProcessor.from_pretrained(MODEL)
  tokenizer = await T.AutoTokenizer.from_pretrained(MODEL)
}

self.onmessage = async (e) => {
  const job = e.data || {}
  try {
    if (!model) {
      loading = loading || load()
      await loading
    }
    const image = new T.RawImage(new Uint8ClampedArray(job.rgb), job.w, job.h, 3)
    const prompts = processor.construct_prompts(TASK)
    const inputs = await processor(image, prompts)
    const ids = await model.generate({ ...inputs, max_new_tokens: 40 })
    const raw = tokenizer.batch_decode(ids, { skip_special_tokens: false })[0]
    const out = processor.post_process_generation(raw, TASK, image.size)
    self.postMessage({ id: job.id, ok: true, text: String((out && out[TASK]) || '').trim().slice(0, 300) })
  } catch (err) {
    loading = null
    self.postMessage({ id: job.id, ok: false, error: String((err && err.message) || err).slice(0, 160) })
  }
}
