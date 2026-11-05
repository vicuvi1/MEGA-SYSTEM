// Browser-only: the plugins' Today cards and their extra Settings pieces.
// The server bundle never imports this file (it would pull in React).
import { useEffect, useState, type ComponentType } from 'react'
import { life } from '../renderer/src/bridge'
import { useLive } from '../renderer/src/live'
import { PLUGINS } from './index'
import { WeatherCard } from './weather/card'
import { GithubCard } from './github/card'
import { GmailCard } from './gmail/card'
import { HealthCard } from './health/card'
import { GmailSettings } from './gmail/settings'
import { HealthSettings } from './health/settings'
import { NotesSettings } from './notes/settings'
import './plugins.css'

export const CARDS: Record<string, ComponentType> = { weather: WeatherCard, github: GithubCard, gmail: GmailCard, health: HealthCard }
export const SETTINGS_EXTRA: Record<string, ComponentType> = { gmail: GmailSettings, health: HealthSettings, notes: NotesSettings }

/** Today: a small card for each plugin that's on and has one. */
export function PluginCards() {
  const [on, setOn] = useState<Record<string, boolean>>({})
  const load = () => void life.plugins?.state().then((s) => setOn(s.on)).catch(() => {})
  useEffect(load, [])
  useLive(load)
  const list = PLUGINS.filter((p) => on[p.id] && CARDS[p.id])
  if (!list.length) return null
  return (
    <div className="pl-cards">
      {list.map((p) => {
        const Card = CARDS[p.id]
        return <Card key={p.id} />
      })}
    </div>
  )
}
