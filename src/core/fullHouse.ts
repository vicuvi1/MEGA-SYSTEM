// The weekly full house (pure): steady sleep, 3+ workouts, a clean week and
// spending under your usual, all in the same 7 days → a bonus and a recap.
export interface FullHouseInput { sleepScore: number | null; workouts: number; slips: number; spent: number; usualSpent: number }
export interface FullHouse { hit: boolean; got: string[]; missing: string[] }

export function fullHouse(i: FullHouseInput): FullHouse {
  const checks: [boolean, string, string][] = [
    [(i.sleepScore ?? 0) >= 70, 'Steady sleep', i.sleepScore == null ? 'steady sleep (log 3 nights for a score, need 70)' : `steady sleep (${i.sleepScore}/100, need 70)`],
    [i.workouts >= 3, `${i.workouts} workouts`, `${Math.max(0, 3 - i.workouts)} more workout${3 - i.workouts === 1 ? '' : 's'}`],
    [i.slips === 0, 'A clean week', 'a clean week'],
    [i.usualSpent > 0 ? i.spent <= i.usualSpent : true, 'Under budget', `spending under your usual (${Math.round(i.spent)} of ${Math.round(i.usualSpent)} lei)`]
  ]
  return { hit: checks.every(([ok]) => ok), got: checks.filter(([ok]) => ok).map(([, g]) => g), missing: checks.filter(([ok]) => !ok).map(([, , m]) => m) }
}

/** Monday of the week (for paying the bonus once a week). */
export function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
