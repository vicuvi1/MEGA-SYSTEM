// Stealth mode: neutral words for the discipline challenge everywhere it can
// show up (Ben's messages, notifications, check-ins), so a glance at the
// phone or the screen gives nothing away (pure).
const SWAPS: [RegExp, string][] = [
  [/\bporn(ography)?\b/gi, 'distraction'],
  [/\bnofap\b/gi, 'the challenge'],
  [/\brelaps(e|ed|es|ing)\b/gi, 'slip'],
  [/\burge crusher\b/gi, 'focus reset'],
  [/\burges\b/gi, 'tough moments'],
  [/\burge\b/gi, 'tough moment'],
  [/\bclean streak\b/gi, 'streak'],
  [/\bclean days?\b/gi, 'good day'],
  [/\bclean\b(?= (check-?in|day|streak))/gi, 'daily'],
  [/\bMAN\b/g, 'Challenge'],
  [/\bspartan\b/gi, 'challenge'],
  [/\b(reset|resets)\b(?= (day|streak|today))/gi, 'restart']
]

export function neutral(text: string): string {
  let t = String(text ?? '')
  for (const [re, to] of SWAPS) t = t.replace(re, (m) => (m[0] === m[0].toUpperCase() && to[0] !== to[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to))
  return t
}

/** The line for Ben's prompt while stealth is on. */
export const STEALTH_NOTE = 'Stealth mode is on: never name the discipline challenge, urges, relapses, porn or MAN. Say "the challenge", "a tough moment", "your streak". Messages may be seen by others.'
