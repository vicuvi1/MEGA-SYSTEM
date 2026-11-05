// Today: what today's mail asks of you (proposals; Ben adds them only when you say yes).
import { Icon } from '../../renderer/src/Icon'
import { usePluginData } from '../usePluginData'
import { itemText, type GmailData } from './gmail'
import { calendarDay } from '../../core/dates'

export function GmailCard() {
  const d = usePluginData<GmailData>('plugin_gmail_data')
  const today = calendarDay()
  if (!d || d.day !== today || !d.items.length) return null
  return (
    <section className="pl-card" aria-label="From your mail">
      <div className="pl-card-head">
        <Icon name="bell" size={14} />
        <b>From your mail</b>
        <span className="pl-spacer" />
        <span>{d.items.length}</span>
      </div>
      <ul className="pl-list">
        {d.items.map((x, i) => (
          <li key={i}>{itemText(x)}</li>
        ))}
      </ul>
      <div className="pl-muted">Tell Ben "add 1" to put one in Todoist or your calendar.</div>
    </section>
  )
}
