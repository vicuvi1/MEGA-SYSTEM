// Settings → Quick add: the shortcuts, and which exercise "+50" counts.
import { useEffect, useState } from 'react'
import type { QuickPrefsView } from '../../../shared/desktop'
import { Icon } from '../Icon'
import { Select } from '../Select'
import { Row } from '../settingsUi'
import { readSport } from '../sportTrack'
import { quickCounter, setQuickCounter } from './quickRun'

// The same list as src/desktop/quickKeys.ts QUICK_CHOICES (the desktop checks it again).
const CHOICES = ['Alt+Space', 'Control+Shift+Space', 'Alt+Shift+Space', 'Alt+Shift+Q', '']
const label = (a: string | null) => (a ? a.replace(/Control/g, 'Ctrl') : 'Off')

export function QuickSettings() {
  const d = window.desktop
  const [prefs, setPrefs] = useState<QuickPrefsView | null>(null)
  const [counter, setCounter] = useState(quickCounter())
  const exercises: { id: string; name: string }[] = ((readSport() as any)?.exercises ?? []).map((e: any) => ({ id: String(e.id ?? e.name), name: String(e.name ?? e.id) }))

  useEffect(() => {
    void d?.quickPrefs?.().then((p) => p && setPrefs(p)).catch(() => {})
  }, [d])

  return (
    <section className="panel qa-settings">
      <header className="panel-head">
        <h2>
          <Icon name="plus" /> Quick add
        </h2>
      </header>
      <p className="hint block">
        One line, Enter, done: "50 pushups", "500 ml", "task lab report tomorrow 2h", "ate 200g chicken", "focus 25", "note …", "done read". It saves on this device at once and syncs right after; Undo stays for 5 seconds.
      </p>
      <Row title="In the app" hint="Press Ctrl+Space on any page (or the Log button at the top)." />
      {d?.quickPrefs && (
        <Row
          title="From anywhere on this PC"
          hint={
            !prefs
              ? 'Loading…'
              : !prefs.shortcut
                ? 'Off'
                : !prefs.active
                  ? `${label(prefs.shortcut)} and Ctrl+Shift+Space are both used by other apps. Pick another one.`
                  : prefs.fellBack
                    ? `${label(prefs.shortcut)} is used by another app, so ${label(prefs.active)} works instead.`
                    : `${label(prefs.active)} opens the box over any app.`
          }
        >
          <Select
            className="sx-select"
            value={prefs?.shortcut ?? 'Alt+Space'}
            aria-label="Quick add shortcut"
            onChange={(e) => void d.setQuickPrefs?.({ shortcut: String(e.target.value) }).then((p) => p && setPrefs(p))}
          >
            {CHOICES.map((c) => (
              <option key={c || 'off'} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
        </Row>
      )}
      {exercises.length > 0 && (
        <Row title='What "+50" counts' hint="A plain number with a plus adds reps to this exercise.">
          <Select
            className="sx-select"
            value={counter}
            aria-label="Default counter"
            onChange={(e) => {
              setQuickCounter(String(e.target.value))
              setCounter(String(e.target.value))
            }}
          >
            <option value="">Push-ups (or the first one)</option>
            {exercises.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Row>
      )}
    </section>
  )
}
