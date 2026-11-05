// Is a short message with a number really money? (X2, pure, tested.)
// "exam on 12 december", "woke up at 7 am", "run 30 min" have a number but
// are not expenses: they go to the brain (or other rules), never to −12 lei.
const MONEY = /\b(lei|mdl|ron|usd|eur|euro|dollars?|bani|spent|paid|pay|bought|cost|costs|price|cash|card|maib|vb|victoriabank|cheltuit|plătit|platit|потратил|заплатил|руб)\b|[$€£₽]/iu
const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|январ\p{L}*|феврал\p{L}*|март\p{L}*|апрел\p{L}*|ма[йя]|июн\p{L}*|июл\p{L}*|август\p{L}*|сентябр\p{L}*|октябр\p{L}*|ноябр\p{L}*|декабр\p{L}*)\b/iu
const TIME = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)|\b(at|by|until|till|from|la|ora|в)\s+\d{1,2}\b|\bo'?clock\b/iu
const DURATION = /\b\d+(?:[.,]\d+)?\s*(min(ute)?s?|h|hrs?|hours?|ore|минут\p{L}*|час\p{L}*|km|meters?|metres?|kg|kgs?|lbs?|reps?|sets?|cups?|glasses|pages?|days?|weeks?|times?|x)\b/iu
const EVENT = /\b(exam|test|deadline|meeting|appointment|class|lecture|lab|due|tomorrow|today|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|woke|wake|slept|sleep|bed|nap|up at|examen|mâine|maine|azi|экзамен|завтра|сегодня)\b/iu

/** True when the number in this message is clearly not an amount of money. */
export function notMoney(text: string): boolean {
  const t = String(text ?? '').trim()
  if (!t || t.startsWith('/')) return false
  if (MONEY.test(t)) return false
  return MONTH.test(t) || TIME.test(t) || DURATION.test(t) || EVENT.test(t)
}
