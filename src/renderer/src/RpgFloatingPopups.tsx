// The game pop-ups (+XP, level up) are gone; the calls stay harmless no-ops.
export function triggerRpgPopup(_options: { main: string; sub?: string; kind?: 'xp' | 'gold' | 'level'; x?: number; y?: number }): void {}

export function RpgFloatingPopups() {
  return null
}
