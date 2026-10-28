import React, { useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, ScheduleState } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import { useAction, useToast } from './ui'
import { KIND } from './pages/Schedule'
import { soundMechanicalClick, soundSuccess, soundTick } from './sound'
import './dualTimeline.css'

interface Props {
  schedule: ScheduleState | null
  onSchedule: (s: ScheduleState) => void
  onGo?: (p: any) => void
}

function parseMinutes(timeStr?: string): number {
  if (!timeStr) return 0
  const parts = timeStr.trim().split(':')
  const h = parseInt(parts[0] || '0', 10)
  const m = parseInt(parts[1] || '0', 10)
  return h * 60 + m
}

function formatHour(h: number): string {
  return `${h.toString().padStart(2, '0')}:00`
}

/**
 * Calculates side-by-side positioning for overlapping events so they never collide.
 */
function layoutOverlappingEvents<T extends { id: any; startMin: number; endMin: number }>(
  items: T[]
): (T & { leftPct: number; widthPct: number })[] {
  if (items.length === 0) return []
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin)
  )

  const clusters: T[][] = []
  let currentCluster: T[] = []
  let clusterEnd = -1

  for (const item of sorted) {
    if (currentCluster.length === 0) {
      currentCluster.push(item)
      clusterEnd = item.endMin
    } else if (item.startMin < clusterEnd) {
      currentCluster.push(item)
      clusterEnd = Math.max(clusterEnd, item.endMin)
    } else {
      clusters.push(currentCluster)
      currentCluster = [item]
      clusterEnd = item.endMin
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster)
  }

  const result: (T & { leftPct: number; widthPct: number })[] = []

  for (const cluster of clusters) {
    const columns: number[] = []
    const assignments: { item: T; col: number }[] = []

    for (const item of cluster) {
      let placed = false
      for (let c = 0; c < columns.length; c++) {
        if (columns[c] <= item.startMin) {
          columns[c] = item.endMin
          assignments.push({ item, col: c })
          placed = true
          break
        }
      }
      if (!placed) {
        columns.push(item.endMin)
        assignments.push({ item, col: columns.length - 1 })
      }
    }

    const numCols = Math.max(1, columns.length)
    const baseWidth = 100 / numCols

    for (const { item, col } of assignments) {
      const leftPct = col * baseWidth
      const widthPct = Math.max(12, baseWidth - (numCols > 1 ? 1.5 : 0))
      result.push({
        ...item,
        leftPct,
        widthPct
      })
    }
  }

  return result
}

export function DualTimeline({ schedule, onSchedule, onGo }: Props) {
  const act = useAction()
  const toast = useToast()
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'stream'>('grid')
  const [full24h, setFull24h] = useState(false)
  const [showCalendar, setShowCalendar] = useState(true)
  const [showBlocks, setShowBlocks] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [nowDate, setNowDate] = useState(() => new Date())

  const targetDay = schedule?.day || new Date().toISOString().slice(0, 10)

  // Refresh calendar events for the active day
  const refreshCal = () => {
    life.calendar
      .events(targetDay)
      .then((evs) => setCalEvents(evs))
      .catch(() => {})
  }

  useEffect(() => {
    refreshCal()
  }, [targetDay])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowDate(new Date())
    }, 30000)
    return () => clearInterval(timer)
  }, [])

  const handleManualSync = async () => {
    setSyncing(true)
    soundTick()
    try {
      const res = await life.calendar.sync()
      if (res.error) {
        toast(`Calendar: ${res.error}`, 'bad')
      } else {
        toast(`✨ Synced ${res.count} calendar appointments!`, 'good')
        refreshCal()
      }
    } catch {
      toast('Failed to sync calendar feed', 'bad')
    } finally {
      setSyncing(false)
    }
  }

  const blocks = schedule?.blocks || []
  const running = blocks.find((b) => b.status === 'running')

  // Separate all-day vs timed calendar events
  const allDayEvents = useMemo(() => calEvents.filter((e) => e.allDay), [calEvents])
  const rawTimedCalEvents = useMemo(() => {
    return calEvents
      .filter((e) => !e.allDay)
      .map((e) => {
        const startMin = parseMinutes(e.startTime)
        let endMin = parseMinutes(e.endTime)
        if (endMin <= startMin) endMin = startMin + 60
        return {
          ...e,
          startMin,
          endMin,
          duration: endMin - startMin
        }
      })
  }, [calEvents])

  // Process schedule blocks with minute intervals
  const rawTimedBlocks = useMemo(() => {
    return blocks.map((b) => {
      const startMin = parseMinutes(b.start)
      const endMin = startMin + b.minutes
      return {
        ...b,
        startMin,
        endMin
      }
    })
  }, [blocks])

  // Apply overlap calculation to both sets so cards sit neatly side-by-side
  const timedCalEvents = useMemo(() => layoutOverlappingEvents(rawTimedCalEvents), [rawTimedCalEvents])
  const timedBlocks = useMemo(() => layoutOverlappingEvents(rawTimedBlocks), [rawTimedBlocks])

  // Conflict Detection between Schedule Blocks and Google Calendar Appointments
  const conflicts = useMemo(() => {
    const list: { block: (typeof timedBlocks)[0]; event: (typeof timedCalEvents)[0]; overlapMin: number }[] = []
    for (const b of timedBlocks) {
      for (const e of timedCalEvents) {
        if (b.startMin < e.endMin && b.endMin > e.startMin) {
          const overlapMin = Math.min(b.endMin, e.endMin) - Math.max(b.startMin, e.startMin)
          list.push({ block: b, event: e, overlapMin })
        }
      }
    }
    return list
  }, [timedBlocks, timedCalEvents])

  const conflictingBlockIds = useMemo(() => new Set(conflicts.map((c) => c.block.id)), [conflicts])
  const conflictingEventIds = useMemo(() => new Set(conflicts.map((c) => c.event.id)), [conflicts])

  // Determine timeline hours range
  const { startHour, endHour } = useMemo(() => {
    if (full24h) return { startHour: 0, endHour: 24 }

    let minH = 7
    let maxH = 22

    for (const b of timedBlocks) {
      const h1 = Math.floor(b.startMin / 60)
      const h2 = Math.ceil(b.endMin / 60)
      if (h1 < minH) minH = Math.max(0, h1 - 1)
      if (h2 > maxH) maxH = Math.min(24, h2 + 1)
    }

    for (const e of timedCalEvents) {
      const h1 = Math.floor(e.startMin / 60)
      const h2 = Math.ceil(e.endMin / 60)
      if (h1 < minH) minH = Math.max(0, h1 - 1)
      if (h2 > maxH) maxH = Math.min(24, h2 + 1)
    }

    return { startHour: Math.max(0, minH), endHour: Math.min(24, Math.max(maxH, minH + 6)) }
  }, [full24h, timedBlocks, timedCalEvents])

  const totalHours = endHour - startHour
  const totalMinutes = totalHours * 60
  const startMinutes = startHour * 60
  const hourHeight = 52
  const totalHeight = totalHours * hourHeight

  // Current time marker position
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  const isCurrentDay = schedule?.day === schedule?.today || !schedule?.day
  const nowTop =
    isCurrentDay && nowMinutes >= startMinutes && nowMinutes <= endHour * 60
      ? ((nowMinutes - startMinutes) / totalMinutes) * totalHeight
      : null

  // Chronological unified list for Agenda/Stream view
  const unifiedStream = useMemo(() => {
    const list: {
      type: 'block' | 'event'
      id: string
      title: string
      timeStr: string
      startMin: number
      endMin: number
      color: string
      conflict: boolean
      raw: any
    }[] = []

    if (showBlocks) {
      for (const b of timedBlocks) {
        list.push({
          type: 'block',
          id: `b-${b.id}`,
          title: b.title,
          timeStr: `${b.start} (${b.minutes}m)`,
          startMin: b.startMin,
          endMin: b.endMin,
          color: KIND[b.kind]?.color || '#7cc4ff',
          conflict: conflictingBlockIds.has(b.id),
          raw: b
        })
      }
    }

    if (showCalendar) {
      for (const e of timedCalEvents) {
        list.push({
          type: 'event',
          id: `e-${e.id}`,
          title: e.title,
          timeStr: `${e.startTime} - ${e.endTime}`,
          startMin: e.startMin,
          endMin: e.endMin,
          color: '#38bdf8',
          conflict: conflictingEventIds.has(e.id),
          raw: e
        })
      }
    }

    return list.sort((a, b) => a.startMin - b.startMin)
  }, [showBlocks, showCalendar, timedBlocks, timedCalEvents, conflictingBlockIds, conflictingEventIds])

  const handleStartBlock = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    soundMechanicalClick()
    const s = await act(() => life.schedule.start(id), 'Focus timer started!')
    if (s) {
      soundSuccess()
      onSchedule(s)
    }
  }

  return (
    <div className="dual-timeline-container">
      {/* Header Controls */}
      <div className="dual-timeline-header">
        <div className="timeline-title-wrap">
          <h2>
            <span>🗓️</span>
            <span>SCHEDULE & CALENDAR DUAL TIMELINE</span>
          </h2>
          <span className="timeline-sub-tag">
            {targetDay} · {conflicts.length > 0 ? `⚠️ ${conflicts.length} Overlap(s)` : 'All Clear'}
          </span>
        </div>

        <div className="timeline-header-actions">
          {/* View Mode Toggle */}
          <button
            className={`timeline-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            Dual Track
          </button>
          <button
            className={`timeline-toggle-btn ${viewMode === 'stream' ? 'active' : ''}`}
            onClick={() => setViewMode('stream')}
          >
            Agenda Stream
          </button>

          {/* Daytime vs 24h */}
          <button
            className={`timeline-toggle-btn ${full24h ? 'active' : ''}`}
            onClick={() => setFull24h((f) => !f)}
          >
            {full24h ? '24 Hours' : 'Active Day'}
          </button>

          {/* Sync Button */}
          <button
            className="timeline-toggle-btn"
            onClick={handleManualSync}
            disabled={syncing}
            title="Sync latest events from Google Calendar feed"
          >
            {syncing ? 'Syncing...' : '🔄 Sync Cal'}
          </button>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button
          className={`timeline-toggle-btn ${showBlocks ? 'active' : ''}`}
          onClick={() => setShowBlocks((s) => !s)}
          style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <span style={{ color: showBlocks ? '#7cc4ff' : 'var(--muted)' }}>●</span>
          <span>System Blocks ({timedBlocks.length})</span>
        </button>

        <button
          className={`timeline-toggle-btn ${showCalendar ? 'active' : ''}`}
          onClick={() => setShowCalendar((s) => !s)}
          style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <span style={{ color: showCalendar ? '#38bdf8' : 'var(--muted)' }}>●</span>
          <span>Google Calendar ({timedCalEvents.length})</span>
        </button>

        {allDayEvents.length > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '6px' }}>
            📅 {allDayEvents.length} All-Day event(s)
          </span>
        )}
      </div>

      {/* All-Day Events Strip */}
      {allDayEvents.length > 0 && (
        <div className="all-day-events-strip">
          <span className="all-day-label">ALL-DAY:</span>
          {allDayEvents.map((ev) => (
            <span
              key={ev.id}
              className="all-day-pill"
              onClick={() => setSelectedEvent(ev)}
              title={ev.title}
            >
              {ev.title}
            </span>
          ))}
        </div>
      )}

      {/* Conflict Alert Banner */}
      {conflicts.length > 0 && (
        <div className="conflict-alert-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#fca5a5' }}>
              SCHEDULE CONFLICT DETECTED: {conflicts[0].block.title} overlaps with &quot;{conflicts[0].event.title}&quot; by {conflicts[0].overlapMin} min
            </span>
          </div>
        </div>
      )}

      {/* VIEW 1: DUAL TRACK 24H GRID */}
      {viewMode === 'grid' ? (
        <div className="timeline-grid-wrapper">
          <div className="timeline-lanes-header">
            <span>TIME</span>
            {showBlocks && (
              <span className="lane-col-title schedule">
                <Icon name="check" size={13} /> SYSTEM BLOCKS ({timedBlocks.length})
              </span>
            )}
            {showCalendar && (
              <span className="lane-col-title calendar">
                <Icon name="calendar" size={13} /> GOOGLE CALENDAR ({timedCalEvents.length})
              </span>
            )}
          </div>

          <div className="dual-track-scroll">
            <div className="dual-track-grid" style={{ height: totalHeight }}>
              {/* NOW live line */}
              {nowTop !== null && (
                <div className="timeline-now-line" style={{ top: nowTop }}>
                  <span className="timeline-now-dot">
                    ● {nowDate.toTimeString().slice(0, 5)} NOW
                  </span>
                </div>
              )}

              {/* Time Axis */}
              <div className="timeline-hours-axis">
                {Array.from({ length: totalHours }, (_, i) => startHour + i).map((h) => (
                  <div key={h} className="hour-slot-label">
                    {formatHour(h)}
                  </div>
                ))}
              </div>

              {/* Lane 1: System Schedule Blocks */}
              {showBlocks && (
                <div className="track-lane">
                  {timedBlocks.map((b) => {
                    const top = ((b.startMin - startMinutes) / totalMinutes) * totalHeight
                    const height = Math.max(34, ((b.endMin - b.startMin) / totalMinutes) * totalHeight - 3)
                    const hasConflict = conflictingBlockIds.has(b.id)
                    const color = KIND[b.kind]?.color || '#7cc4ff'

                    return (
                      <div
                        key={b.id}
                        className={`timeline-card schedule-card ${b.status} ${hasConflict ? 'has-conflict' : ''}`}
                        style={{
                          top,
                          height,
                          left: `${b.leftPct}%`,
                          width: `${b.widthPct}%`,
                          borderColor: hasConflict ? '#ef4444' : color
                        }}
                        title={`Schedule Block: ${b.title} (${b.start} - ${b.minutes}m)`}
                      >
                        <div className="card-top-row">
                          <span className="card-title">{b.title}</span>
                          <span className="card-time-badge">
                            {b.start} ({b.minutes}m)
                          </span>
                        </div>

                        {hasConflict && (
                          <span className="card-conflict-pill">
                            ⚠️ Overlaps Calendar
                          </span>
                        )}

                        {b.status === 'pending' && !running && (
                          <button
                            className="card-action-btn"
                            onClick={(e) => handleStartBlock(e, b.id)}
                          >
                            ▶ Start
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Lane 2: Google Calendar Events with Non-Overlapping Columns */}
              {showCalendar && (
                <div className="track-lane">
                  {timedCalEvents.map((ev) => {
                    const top = ((ev.startMin - startMinutes) / totalMinutes) * totalHeight
                    const height = Math.max(34, (ev.duration / totalMinutes) * totalHeight - 3)
                    const hasConflict = conflictingEventIds.has(ev.id)

                    return (
                      <div
                        key={ev.id}
                        className={`timeline-card calendar-card ${hasConflict ? 'has-conflict' : ''}`}
                        style={{
                          top,
                          height,
                          left: `${ev.leftPct}%`,
                          width: `${ev.widthPct}%`
                        }}
                        onClick={() => setSelectedEvent(ev)}
                        title={`Google Calendar: ${ev.title} (${ev.startTime} - ${ev.endTime})${ev.location ? ` @ ${ev.location}` : ''}`}
                      >
                        <div className="card-top-row">
                          <span className="card-title">{ev.title}</span>
                          <span className="card-time-badge">
                            {ev.startTime} - {ev.endTime}
                          </span>
                        </div>

                        {hasConflict && (
                          <span className="card-conflict-pill">
                            ⚠️ Overlaps Schedule
                          </span>
                        )}

                        {ev.location && (
                          <span style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            📍 {ev.location}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* VIEW 2: AGENDA STREAM */
        <div className="chrono-stream-list">
          {unifiedStream.length === 0 ? (
            <div className="empty" style={{ padding: '30px' }}>
              <p>Nothing planned or scheduled for this day.</p>
            </div>
          ) : (
            unifiedStream.map((item) => (
              <div
                key={item.id}
                className={`stream-item ${item.conflict ? 'conflict' : ''}`}
                onClick={() => {
                  if (item.type === 'event') setSelectedEvent(item.raw)
                }}
              >
                <div className="stream-left">
                  <span className={`stream-source-tag ${item.type}`}>
                    {item.type === 'block' ? 'Focus Block' : 'Google Cal'}
                  </span>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff', fontSize: '13px' }}>
                      {item.title}
                    </span>
                    {item.raw.location && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        📍 {item.raw.location}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', color: item.color, fontWeight: 700 }}>
                    {item.timeStr}
                  </span>
                  {item.conflict && (
                    <span className="card-conflict-pill">⚠️ Overlap</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Event Details Sheet/Modal */}
      {selectedEvent && (
        <div className="sheet" role="dialog" aria-label="Event Details" onClick={() => setSelectedEvent(null)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                📅 Google Calendar Appointment
              </span>
              <button className="icon-btn" onClick={() => setSelectedEvent(null)}>
                ✕
              </button>
            </div>

            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#fff' }}>
              {selectedEvent.title}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#cbd5e1' }}>
              <div>
                <b>⏰ Time:</b> {selectedEvent.startTime} - {selectedEvent.endTime} {selectedEvent.allDay ? '(All Day)' : ''}
              </div>
              <div>
                <b>📅 Date:</b> {selectedEvent.day}
              </div>
              {selectedEvent.location && (
                <div>
                  <b>📍 Location:</b> {selectedEvent.location}
                </div>
              )}
              {selectedEvent.description && (
                <div style={{ marginTop: '8px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '12px', color: '#94a3b8' }}>
                  {selectedEvent.description}
                </div>
              )}
            </div>

            <div className="sheet-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary small" onClick={() => setSelectedEvent(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
