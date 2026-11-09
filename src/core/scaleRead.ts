// Scale screenshot import: the hand-written check on what the AI read from a
// smart-scale result screen (Xiaomi Home / Mi Fitness). Pure, no network.
//
// The AI (api/ai.mjs op "foodPhoto" with kind "scale", api/_vision.mjs) answers
// with JSON: weightKg, bodyFatPct, muscleKg, waterPct, proteinPct, boneKg,
// visceralFat, bmr, bmi, heartRate, bodyScore, measuredAt. Nothing is trusted:
// - every number must be in its range (body_comp's COMP_RANGES); one outside it
//   is dropped and listed, never stored ("Water 140 % is not possible");
// - a % over 100 is dropped; 0 means "not measured";
// - muscle must be less than the weight;
// - no weight → refused with a plain message (weight is the one needed field);
// - measuredAt is kept only when it is a real time, not in the future and
//   within the last 60 days.
// The owner then checks every field on the review screen and taps Save.
import { COMP_RANGES, type CompField } from './bodyComp'

export type ScaleKey = 'weightKg' | 'bodyFatPct' | 'muscleKg' | 'waterPct' | 'proteinPct' | 'boneKg' | 'visceralFat' | 'bmr' | 'bmi' | 'heartRate' | 'bodyScore'

/** Each screenshot field, its body_comp column, its label and unit. */
export const SCALE_FIELDS: { key: ScaleKey; col: 'weight_kg' | CompField; label: string; unit: string; step: string }[] = [
  { key: 'weightKg', col: 'weight_kg', label: 'Weight', unit: 'kg', step: '0.1' },
  { key: 'bodyFatPct', col: 'body_fat_pct', label: 'Body fat', unit: '%', step: '0.1' },
  { key: 'muscleKg', col: 'muscle_kg', label: 'Muscle', unit: 'kg', step: '0.1' },
  { key: 'waterPct', col: 'water_pct', label: 'Water', unit: '%', step: '0.1' },
  { key: 'proteinPct', col: 'protein_pct', label: 'Protein', unit: '%', step: '0.1' },
  { key: 'boneKg', col: 'bone_kg', label: 'Bone mass', unit: 'kg', step: '0.1' },
  { key: 'visceralFat', col: 'visceral_fat', label: 'Visceral fat', unit: '', step: '1' },
  { key: 'bmr', col: 'bmr', label: 'BMR', unit: 'kcal', step: '1' },
  { key: 'bmi', col: 'bmi', label: 'BMI', unit: '', step: '0.1' },
  { key: 'heartRate', col: 'heart_rate', label: 'Heart rate', unit: 'bpm', step: '1' },
  { key: 'bodyScore', col: 'body_score', label: 'Body score', unit: '', step: '1' }
]

export type ScaleRead = Record<ScaleKey, number | null> & { measuredAt: string | null }

export type ScaleCheck =
  | { ok: true; read: ScaleRead; found: ScaleKey[]; dropped: { key: ScaleKey; why: string }[] }
  | { ok: false; error: string }

const r2 = (n: number) => Math.round(n * 100) / 100

/** A number from the AI: 72.4, "72.4", "72,4 kg"; null when empty or not a number. */
export function scaleNum(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /-?\d+(?:[.,]\d+)?/.exec(v)
  return m ? Number(m[0].replace(',', '.')) : null
}

/** The JSON object in the answer (an object, or the first {...} in text), or null. */
function readJson(raw: unknown): any {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return null
  const s = raw.replace(/```(?:json)?/gi, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(s.slice(a, b + 1))
  } catch {
    return null
  }
}

/** measuredAt as an ISO time, or null (not a time, in the future, or older than 60 days). */
export function cleanMeasuredAt(v: unknown, now = new Date()): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return null
  const t = new Date(s.length === 10 ? `${s}T08:00` : s)
  if (!Number.isFinite(t.getTime())) return null
  if (t.getTime() > now.getTime() + 10 * 60_000) return null
  if (t.getTime() < now.getTime() - 60 * 86400_000) return null
  return t.toISOString()
}

/** Checks the AI's answer for a scale screenshot. */
export function validateScale(raw: unknown, now = new Date()): ScaleCheck {
  const o = readJson(raw)
  if (!o) return { ok: false, error: "The AI's answer could not be read. Try again, or type the numbers." }
  const read = { measuredAt: cleanMeasuredAt(o.measuredAt, now) } as ScaleRead
  const found: ScaleKey[] = []
  const dropped: { key: ScaleKey; why: string }[] = []
  for (const f of SCALE_FIELDS) {
    read[f.key] = null
    const n = scaleNum(o[f.key])
    if (n == null || n === 0) continue
    const [lo, hi, name] = COMP_RANGES[f.col]
    if (n < lo || n > hi) {
      dropped.push({ key: f.key, why: `${name} ${n}${f.unit ? ` ${f.unit}` : ''} is not possible (${lo}–${hi}), so it was left out.` })
      continue
    }
    read[f.key] = r2(n)
    found.push(f.key)
  }
  if (read.weightKg == null) return { ok: false, error: dropped.some((d) => d.key === 'weightKg') ? 'The weight on the screenshot did not look right. Type it, or try a clearer screenshot.' : 'No weight was found on the screenshot. Use the scale app\'s result screen, or type the numbers.' }
  if (read.muscleKg != null && read.muscleKg >= read.weightKg) {
    dropped.push({ key: 'muscleKg', why: `Muscle ${read.muscleKg} kg is not less than the weight, so it was left out.` })
    read.muscleKg = null
    found.splice(found.indexOf('muscleKg'), 1)
  }
  return { ok: true, read, found, dropped }
}
