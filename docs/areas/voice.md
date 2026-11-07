# Voice

> Wake word, push-to-talk, island voice, licences.
> Copied out of [`docs/AI_HANDOFF.md`](../AI_HANDOFF.md) on 2026-11-07, so an agent can read only its own area.
> This file is now the maintained copy for this area: update it, not the big handoff. Start at [`docs/INDEX.md`](../INDEX.md).

### Voice (`src/renderer/src/voice/`, `src/core/voice*.ts`)


Off until switched on in Settings → Voice (saved per device in localStorage `ls.voice`). Everything is free and runs on the device; nothing is in the installer or precached: each part downloads on first use into the browser cache (`life-voice-v1`, `life-voice-models`) and Settings → Voice can delete it.

- **Desktop island** (`IslandVoice.tsx`, engine `voiceEngine.ts`, flow `core/voiceFlow.ts`): "Hey Ben" (sherpa-onnx keyword spotter, WebAssembly, in `voiceEarWorker.ts`; the npm build is patched for workers in `vite.web.mts`, checked by `voice/build.test.ts`; the .wasm starts at 32 MB instead of 512 MB, `shrinkWasmMemory`), the Talk to Ben shortcut and 🎤 are push-to-talk; Silero VAD ends what you said; Moonshine/Whisper (Transformers.js in `voiceAiWorker.ts`, ONNX Runtime's plain wasm) turns it into text; `core/voiceCommands.ts` runs commands through the island's command-bar rules, the rest goes to Ben via `voiceAsk.ts` (BroadcastChannel to the app window → `life.coach.chat`). Ben answers sentence by sentence (system voices, or Kokoro). You can talk over him (barge-in); 8 s follow-up without the wake word. The mic closes entirely when voice is off, the PC is locked/idle (`src/desktop/voice.ts`), or the island is quiet, hidden, in a call or locked. The big-model worker ends after 2 minutes unused. If the wake-word model can't be downloaded, short sounds are checked by speech to text instead (at most 6 a minute).

- **Web / phone** (`CoachMic.tsx`): 🎙 push-to-talk on the Coach page (the browser's speech recognition; else on-device speech to text on a strong device with Voice on) and 🔊 read-aloud. No wake word.

- **Licences:** sherpa-onnx, Zipformer KWS, Transformers.js, Kokoro: Apache-2.0; Silero VAD, Moonshine, Whisper, ONNX Runtime: MIT. Kokoro's phonemizer (eSpeak NG) is **GPL-3.0**: never bundled; the worker imports it from jsdelivr at run time (pinned URL, allowed in the CSP's `script-src`). The CSP's `connect-src` allows `huggingface.co`, `*.hf.co`, `cdn.jsdelivr.net` for the downloads.
