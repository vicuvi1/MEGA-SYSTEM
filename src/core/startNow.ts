// Did you ask to start a focus timer NOW? (X10, pure, tested.)
// "start", "let's go", "focus now" yes; "I'll start at 5", "going to study
// later", "start tomorrow" no: those get a ▶ button instead.
const START = /\b(start|go|begin|timer|focus now|let'?s go|incep|încep|porne|start\w*|начн|запуст|поехали)\b/i
const FUTURE = /\b(later|tomorrow|tonight|this (?:evening|afternoon)|after (?:lunch|dinner|class|school|work|this)|at \d{1,2}|by \d{1,2}|in \d+\s*(?:min|minutes|h|hours?)|will|i'?ll|going to|gonna|plan(?:ning)? to|want to|should|maybe|soon|next|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|mâine|maine|diseară|diseara|mai târziu|mai tarziu|завтра|позже|вечером)\b/i

export function startsNow(text: string): boolean {
  const t = String(text ?? '')
  if (!START.test(t)) return false
  if (/\b(now|right now|acum|сейчас)\b/i.test(t)) return true
  return !FUTURE.test(t)
}
