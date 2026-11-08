// Custom Center reminder cards on the island: the small, pure parts the
// island window itself needs (it never loads the Center's own code; the app
// window builds the cards, core/islandCenter.ts). Tested in islandCenter.test.ts.

/** A custom reminder card on the island ("custom:<rule>:<when>"). */
export const isCenterReminder = (a: { kind: string; id: string }) => a.kind === 'remind' && a.id.startsWith('custom:')
export const centerRuleOf = (alertId: string) => alertId.split(':')[1] ?? ''

/** How long a fired custom reminder card stays (it then waits as a dot, like the body cards). */
export const CENTER_CARD_MS = 3 * 60_000
/** "In 10 min": the rule comes back once after this. */
export const CENTER_LATER_MIN = 10

/**
 * Does a custom reminder ring? Only when it shows as a card (not a dot), it
 * didn't ring already, the island's sounds are on and nothing asks for
 * silence (a call, quiet, a focus timer, a class, after bed, the system).
 */
export function centerReminderSound(o: { gate: 'peek' | 'silent' | 'drop'; played: boolean; islandSound: boolean; volume: number; hush: string | null; quiet: boolean; call: boolean; blocked: string | null }): { ring: boolean; why: string | null } {
  const no = (why: string) => ({ ring: false, why })
  if (o.gate !== 'peek') return no(o.gate === 'drop' ? 'not shown' : 'waits as a dot')
  if (o.played) return no('already rang')
  if (!o.islandSound) return no('island sounds are off')
  if (!(o.volume > 0)) return no('reminder volume is 0')
  if (o.call) return no('in a call')
  if (o.quiet) return no('quiet')
  if (o.hush) return no(o.hush)
  if (o.blocked) return no(o.blocked)
  return { ring: true, why: null }
}

