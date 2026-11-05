// Settings: the list of sections (LT11). Each section's body is its own file
// in src/renderer/src/settings/, sharing state from useSettingsState.
import { UpdatePanel } from '../updates'
import { features } from '../bridge'
import { PcPrivacyPanel } from '../PcPrivacyPanel'
import { IslandEyesPanel } from '../IslandEyesPanel'
import { IslandSettingsPanel } from '../IslandSettingsPanel'
import { HealthPanel } from '../HealthPanel'
import { AiAppsPanel } from '../AiAppsPanel'
import { PcAutomationPanel } from '../PcAutomationPanel'
import { SettingsShell, type SettingsGroup } from '../SettingsShell'
import { NotifSettings } from '../NotifSettings'
import { PluginsPanel } from '../../../plugins/PluginsPanel'
import { useSettingsState, type SettingsProps } from '../settings/useSettingsState'
import { GeneralSection } from '../settings/general'
import { LookSection } from '../settings/look'
import { SoundSection } from '../settings/sound'
import { VoiceSettings } from '../voice/VoiceSettings'
import { BenSection } from '../settings/ben'
import { ConnectionsSection } from '../settings/connections'
import { RewardsSection } from '../settings/rewards'
import { BackupsSection } from '../settings/backups'
import { DiagnosticsSection } from '../settings/diagnostics'

export function Settings(props: SettingsProps) {
  const s = useSettingsState(props)
  const { update, onUpdate } = s

  const groups: SettingsGroup[] = [
    {
      id: 'general',
      label: 'General',
      icon: 'lock',
      hint: 'PIN, this device and start-up',
      keywords: 'pin lock security password trusted device remember start windows background tray',
      body: <GeneralSection s={s} />
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: 'bell',
      hint: 'Pop-ups, sound, quiet hours',
      keywords: 'notification notifications popup pop-up windows sound chime quiet hours focus disturb alert',
      body: <NotifSettings />
    },
    {
      id: 'look',
      label: 'Look',
      icon: 'sun',
      hint: 'Theme, colors and your Today screen',
      keywords: 'appearance theme dark light color colour today sections layout name',
      body: <LookSection s={s} />
    },
    {
      id: 'sound',
      label: 'Sound',
      icon: 'bell',
      hint: 'Volume, kinds of sounds, theme, focus background, phone buzz',
      keywords: 'sound sounds volume mute audio theme arcade glass soft focus background brown noise rain tick gong haptics vibrate buzz',
      body: <SoundSection />
    },
    {
      id: 'voice',
      label: 'Voice',
      icon: 'bot',
      hint: 'Talk to Ben: "Hey Ben", speech to text, his voice',
      keywords: 'voice mic microphone speak talk hey ben wake word dictation speech text tts read aloud kokoro whisper moonshine',
      body: <VoiceSettings />
    },
    {
      id: 'ben',
      label: 'Ben',
      icon: 'spark',
      hint: 'Your coach: his brain (model & cost), tone, rhythm',
      keywords: 'coach ai tone style length nudges rhythm model angry brain openrouter price cost usage claude gpt',
      body: <BenSection s={s} />
    },
    {
      id: 'rewards',
      label: 'Rewards',
      icon: 'gift',
      hint: 'Your monthly fun budget, what a point is worth, leftover to savings',
      keywords: 'rewards fun budget money points value lei shop treat savings leftover goal finance entertainment',
      body: <RewardsSection />
    },
    {
      id: 'connections',
      label: 'Connections',
      icon: 'link',
      hint: 'Google, Todoist, Telegram, Sporty',
      keywords: 'google calendar todoist telegram bots bot token sporty sport connect',
      body: <ConnectionsSection s={s} />
    },
    {
      id: 'plugins',
      label: 'Plugins',
      icon: 'spark',
      hint: 'Weather, GitHub, Gmail, bank import, phone numbers, notes',
      keywords: 'plugins weather rain sunset github ctf gmail mail deadlines bank csv statement import phone shortcut steps weight sleep health obsidian notion notes vault',
      body: <PluginsPanel />
    },
    {
      id: 'ai-apps',
      label: 'Connect an AI app',
      icon: 'bot',
      hint: 'Claude, ChatGPT and other AI apps',
      keywords: 'ai app claude chatgpt mcp connector token connect desktop code phone',
      body: <AiAppsPanel />
    },
    {
      id: 'automation',
      label: 'PC & automation',
      icon: 'link',
      hint: 'Music during focus, ActivityWatch, Ben on your PC, phone push, n8n, outside tools',
      keywords: 'automation pc music spotify pause media activitywatch actions ntfy push phone n8n webhook zapier make mcp tools server',
      body: <PcAutomationPanel />
    },
    ...(window.desktop
      ? [
    {
      id: 'desktop',
      label: 'Desktop & island',
      icon: 'expand',
      hint: 'The island at the edge of your screen',
      keywords: 'island dynamic size look see-through shortcut sound sections tray',
      body: <IslandSettingsPanel />
    },
    {
      id: 'pc',
      label: 'Ben on this PC',
      icon: 'shield',
      hint: 'What the desktop app may see, and what it saw today',
      keywords: 'privacy pc computer app activity focus distraction clipboard idle sensors block sites do not disturb shortcuts',
      body: <PcPrivacyPanel />
    },
    {
      id: 'eyes',
      label: 'Island eyes',
      icon: 'search',
      hint: 'Let the island read the window in front (off until you turn it on)',
      keywords: 'eyes read screen window text ocr caption florence model download privacy pause private list what the eyes saw',
      body: <IslandEyesPanel />
    },
        ]
      : []),
    {
      id: 'backups',
      label: 'Backups & data',
      icon: 'shield',
      hint: 'Daily backups, restore, export',
      keywords: 'backup restore export import google drive folder snapshot data',
      body: <BackupsSection s={s} />
    },
    ...(features.updates
      ? [
          {
            id: 'updates',
            label: 'Updates',
            icon: 'refresh',
            hint: 'Version and new releases',
            keywords: 'update version release restart new',
            body: <UpdatePanel status={update} onStatus={onUpdate} />
          }
        ]
      : []),
    {
      id: 'health',
      label: 'System health',
      icon: 'chart',
      hint: 'Is every part working',
      keywords: 'health status errors working broken keys',
      body: <HealthPanel />
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      icon: 'list',
      hint: 'Island taps and logs',
      keywords: 'logs diagnostics island tap debug',
      advanced: true,
      body: <DiagnosticsSection s={s} />
    },
  ]

  return (
    <div className="settings">
      <SettingsShell groups={groups} />
    </div>
  )
}
