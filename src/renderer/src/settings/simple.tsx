// Settings → Simple mode (feature freeze, 2026-11-11; core/simpleMode.ts, core/notifyBudget.ts).
// On by default: the unused game parts are hidden (nothing is deleted) and at most 4 pushes a day.
// Which parts of the app exist at all is Settings → Modules (core/modules.ts).
import { useEffect, useState } from 'react'
import { DEFAULT_SIMPLE, HIDDEN_MODULES, type SimpleMode } from '@core/simpleMode'
import { DAILY_PUSH_CAP, SLOT_TIME, type BudgetLedger, type PushSlot } from '@core/notifyBudget'
import { life } from '../bridge'
import { Row, Switch } from '../settingsUi'
import { Icon } from '../Icon'

const SLOT_NAME: Record<PushSlot, string> = { morning: 'your 3 must-dos', afternoon: 'afternoon nudge', weekly: 'the week', plan: "pick tomorrow's 3", winddown: 'wind down (23:15)', lastcall: 'midnight sleep reminder' }

export function SimpleModeSettings() {
  const [m, setM] = useState<SimpleMode>(DEFAULT_SIMPLE)
  const [led, setLed] = useState<BudgetLedger | null>(null)
  useEffect(() => {
    void life.notifications?.simple?.().then(setM).catch(() => {})
    void life.notifications?.budget?.().then(setLed).catch(() => {})
  }, [])
  const save = async (p: Partial<SimpleMode>) => {
    const next = await life.notifications?.saveSimple?.(p).catch(() => null)
    if (next) setM(next)
  }
  return (
    <section className="panel" data-testid="simple-mode">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Simple mode
        </h2>
        <span className={`chip ${m.on ? 'ok' : ''}`}>{m.on ? 'On' : 'Off'}</span>
      </header>
      <p className="hint block">Hidden inside the parts that are on: {HIDDEN_MODULES.map((x) => x.label.toLowerCase()).join(', ')}. Nothing is deleted; turn Simple mode off to bring them back. To turn whole parts of the app on or off, use Settings → Modules.</p>
      <Row title="Simple mode" hint={m.on ? 'On: the unused parts are hidden.' : 'Off: everything shows again, with all its data.'}>
        <Switch on={m.on} label="Simple mode" onChange={(v) => void save({ on: v })} />
      </Row>
      <Row title={`At most ${DAILY_PUSH_CAP} pushes a day`} hint={`${SLOT_TIME.morning} your 3 must-dos · ${SLOT_TIME.plan} pick tomorrow's 3 · ${SLOT_TIME.winddown} wind down · Sunday ${SLOT_TIME.weekly} your week. Everything else waits quietly in the bell.`}>
        <Switch on={m.budget} label="Daily push budget" onChange={(v) => void save({ budget: v })} />
      </Row>
      <Row title={`Afternoon nudge (${SLOT_TIME.afternoon})`} hint='One short "2 of 3 done" in the afternoon. Off by default.'>
        <Switch on={m.afternoon} label="Afternoon nudge" onChange={(v) => void save({ afternoon: v })} />
      </Row>
      <p className="hint" data-testid="push-count">
        Pushes today: {led?.sent.length ?? 0} of {DAILY_PUSH_CAP}
        {led?.sent.length ? ` (${led.sent.map((s) => SLOT_NAME[s]).join(', ')})` : ''}
      </p>
    </section>
  )
}
