// The microphone, on the audio thread: 16 kHz mono frames of 512 samples
// (32 ms) go straight to the ear worker through a port (the page's main
// thread never touches the audio); the page only gets the level, for the wave.
class LifeMic extends AudioWorkletProcessor {
  constructor() {
    super()
    this.out = null
    this.ratio = sampleRate / 16000
    this.pos = 0
    this.frame = new Float32Array(512)
    this.n = 0
    this.on = true
    this.port.onmessage = (e) => {
      if (e.data && e.data.port) this.out = e.data.port
      if (e.data && e.data.stop) this.on = false
    }
  }
  process(inputs) {
    if (!this.on) return false
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    // Downsample (box average over each 16 kHz step).
    let i = this.pos
    while (i < ch.length) {
      const a = Math.floor(i)
      const b = Math.min(ch.length, Math.floor(i + this.ratio))
      let s = 0
      for (let k = a; k < Math.max(a + 1, b); k++) s += ch[k]
      this.frame[this.n++] = s / Math.max(1, b - a)
      if (this.n === 512) {
        let e = 0
        for (let k = 0; k < 512; k++) e += this.frame[k] * this.frame[k]
        const level = Math.sqrt(e / 512)
        if (this.out) {
          const f = this.frame
          this.out.postMessage({ type: 'audio', samples: f, level }, [f.buffer])
          this.frame = new Float32Array(512)
        }
        this.port.postMessage(level)
        this.n = 0
      }
      i += this.ratio
    }
    this.pos = i - ch.length
    return true
  }
}
registerProcessor('life-mic', LifeMic)
