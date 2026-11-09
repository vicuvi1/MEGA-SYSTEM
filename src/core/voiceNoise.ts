// Speech-to-text models (Whisper and friends) "hear" stock sign-offs in silence
// or background noise: "Thanks for watching.", "Thanks for your time today.
// Nice meeting you. Bye." Nobody says only that to Ben, so a transcript made
// ONLY of such lines is treated as nothing heard: it is never shown, never
// sent to Ben and never turns into a message or a card. Pure, tested.

const SIGN_OFFS: RegExp[] = [
  /^(ok |okay |well )?(thanks|thank you|thank you very much|thanks a lot)( so much| all| guys| everyone)?( for (watching|listening|your time|having me|joining( us)?|coming))?( today| again)?$/,
  /^(it was )?(really )?(nice|great|good) (meeting|to meet|talking to|to see|seeing) you( all)?( today)?$/,
  /^(ok |okay )?(bye|bye bye|bye now|goodbye|good bye|see you|see ya|see you (later|soon|next time|tomorrow)|take care|have a (nice|good|great) (day|one))$/,
  /^(please )?(like and )?subscribe( to (my|the|our) channel)?$/,
  /^(subtitles|captions|transcribed) by .*$/,
  /^you$/
]

/** True when every sentence of `text` is a stock sign-off (or the text is empty). */
export function isNoiseTranscript(text: string): boolean {
  const parts = String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[.!?…\n]+/)
    .map((s) => s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return parts.every((p) => SIGN_OFFS.some((re) => re.test(p)))
}
