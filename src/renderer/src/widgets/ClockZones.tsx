// Settings → Widgets → Island look → Clock time zones: up to 5 other zones,
// your own time always first. A tap on the island's clock goes through them
// (core/worldClock.ts). Saved in the synced look, so every PC has the same.
import { useEffect, useMemo, useState } from 'react'
import { allZones, cityOf, localZone, searchZones, ZONE_LABEL_MAX, ZONES_MAX, type ClockZone } from '@core/worldClock'

const nice = (tz: string) => tz.replace(/_/g, ' ').replace(/\//g, ' / ')

export function ClockZones({ zones, onChange }: { zones: ClockZone[]; onChange: (z: ClockZone[]) => void }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => allZones(), [])
  const here = useMemo(() => localZone(), [])
  const hits = useMemo(() => (q.trim() ? searchZones(q, all, 9).filter((tz) => !zones.some((z) => z.tz === tz)).slice(0, 8) : []), [q, all, zones])
  const full = zones.length >= ZONES_MAX
  const add = (tz: string) => {
    if (full || zones.some((z) => z.tz === tz)) return
    onChange([...zones, { tz, label: '' }])
    setQ('')
  }
  const move = (i: number, by: number) => {
    const j = i + by
    if (j < 0 || j >= zones.length) return
    const next = [...zones]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="sx-row wg-zones-row">
      <div className="sx-label">
        <b>Clock time zones</b>
        <small>Tap the clock on the island to see the next one: your time, then each zone here, then your time again. Up to {ZONES_MAX}.</small>
      </div>
      <div className="wg-zones">
        <ol className="wg-zone-list">
          <li className="wg-zone here">
            <span className="wg-zone-name"><b>Local</b><small>{here ? nice(here) : 'This computer’s time'}</small></span>
            <small className="wg-zone-fixed">Always first</small>
          </li>
          {zones.map((z, i) => (
            <li key={z.tz} className="wg-zone">
              <span className="wg-zone-name"><b>{cityOf(z.tz)}</b><small>{nice(z.tz)}</small></span>
              <ZoneLabel z={z} onSave={(label) => onChange(zones.map((x) => (x.tz === z.tz ? { ...x, label } : x)))} />
              <span className="wg-zone-btns">
                <button type="button" className="btn small ghost" aria-label={`Move ${cityOf(z.tz)} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn small ghost" aria-label={`Move ${cityOf(z.tz)} down`} disabled={i === zones.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn small ghost" aria-label={`Remove ${cityOf(z.tz)}`} onClick={() => onChange(zones.filter((x) => x.tz !== z.tz))}>Remove</button>
              </span>
            </li>
          ))}
        </ol>
        {full ? (
          <small className="hint">That’s the most: remove one to add another.</small>
        ) : (
          <div className="wg-zone-pick">
            <input
              type="search"
              className="wg-zone-search"
              placeholder="Add a time zone: type a city, like Tokyo"
              aria-label="Find a time zone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hits[0]) {
                  e.preventDefault()
                  add(hits[0])
                }
                if (e.key === 'Escape') setQ('')
              }}
            />
            {q.trim() !== '' && (
              <ul className="wg-zone-hits" role="listbox" aria-label="Time zones">
                {hits.length ? (
                  hits.map((tz) => (
                    <li key={tz}>
                      <button type="button" role="option" aria-selected={false} onClick={() => add(tz)}>
                        <b>{cityOf(tz)}</b> <small>{nice(tz)}</small>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="wg-zone-none"><small>No time zone has that name</small></li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A zone's short name on the clock ("NYC"): saved when you leave the box or press Enter. */
function ZoneLabel({ z, onSave }: { z: ClockZone; onSave: (label: string) => void }) {
  const [v, setV] = useState(z.label)
  useEffect(() => setV(z.label), [z.label])
  const save = () => {
    const label = v.replace(/\s+/g, ' ').trim().slice(0, ZONE_LABEL_MAX)
    if (label !== z.label) onSave(label)
  }
  return (
    <input
      className="wg-zone-label"
      placeholder={cityOf(z.tz)}
      maxLength={ZONE_LABEL_MAX}
      aria-label={`Short name for ${cityOf(z.tz)}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
