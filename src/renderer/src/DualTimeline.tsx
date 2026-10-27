import React, { useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, ScheduleState } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import { useAction } from './ui'
import { KIND } from './pages/Schedule'
import { soundMechanicalClick, soundSuccess, soundTick } from './sound'
import './dualTimeline.css'

interface Props {
  schedule: ScheduleState | null
  onSchedule: (s: ScheduleState) => void
  onGo: (p: any) => void
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

export function DualTimeline({ schedule, onSchedule, onGo }: Props) {
  const act = useAction()
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'stream'>('grid')
  const [full24h, setFull24h] = useState(false)
  const [nowDate, setNowDate] = useState(() => new Date())

  // Refresh calendar events
  const refreshCal = () => {
    life.calendar
      .events()
      .then((evs) => setCalEvents(evs))
      .catch(() => {})
  }

  useEffect(() => {
    refreshCal()
    const timer = setInterval(() => {
      setNowDate(new Date())
    }, 30000)
    return () => clearInterval(timer)
  }, [])

  const blocks = schedule && schedule.day === schedule.today ? schedule.blocks : []
  const running = blocks.find((b) => b.status === 'running')

  // Separate all-day vs timed calendar events
  const allDayEvents = useMemo(() => calEvents.filter((e) => e.allDay), [calEvents])
  const timedCalEvents = useMemo(() => {
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
  const timedBlocks = useMemo(() => {
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

  // Set of conflicting block IDs and event IDs for fast badge rendering
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

    return { startHour: minH, endHour: maxH }
  }, [full24h, timedBlocks, timedCalEvents])

  const totalHours = endHour - startHour
  const HOUR_HEIGHT = 52
  const totalHeight = totalHours * HOUR_HEIGHT
  const startMinutes = startHour * 60
  const totalMinutes = totalHours * 60

  // Calculate live NOW position
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  const nowVisible = nowMinutes >= startMinutes && nowMinutes <= endHour * 60
  const nowTop = nowVisible ? ((nowMinutes - startMinutes) / totalMinutes) * totalHeight : null

  // Start block action
  const handleStartBlock = async (e: React.MouseEvent, blockId: number) => {
    e.stopPropagation()
    soundMechanicalClick()
    const s = await act(() => life.schedule.start(blockId))
    if (s) {
      soundSuccess()
      onSchedule(s)
      onGo('schedule')
    }
  }

  // Merged stream items sorted by time
  const streamItems = useMemo(() => {
    type StreamItem =
      | { type: 'schedule'; item: (typeof timedBlocks)[0]; startMin: number; hasConflict: boolean }
      | { type: 'calendar'; item: (typeof timedCalEvents)[0]; startMin: number; hasConflict: boolean }

    const combined: StreamItem[] = [
      ...timedBlocks.map((b) => ({ type: 'schedule' as const, item: b, startMin: b.startMin, hasConflict: conflictingBlockIds.has(b.id) })),
      ...timedCalEvents.map((e) => ({ type: 'calendar' as const, item: e, startMin: e.startMin, hasConflict: conflictingEventIds.has(e.id) }))
    ]

    return combined.sort((a, b) => a.startMin - b.startMin)
  }, [timedBlocks, timedCalEvents, conflictingBlockIds, conflictingEventIds])

  return (
    <div className="dual-timeline-container">
      {/* Header */}
      <div className="dual-timeline-header">
        <div className="timeline-title-wrap">
          <span style={{ fontSize: 18 }}>📅</span>
          <div>
            <h2>
              SCHEDULE & CALENDAR DUAL TIMELINE
            </h2>
            <span className="timeline-sub-tag">
              [ Solo Leveling Blocks × Google Calendar ]
            </span>
          </div>
        </div>

        <div className="timeline-header-actions">
          <button
            className={`timeline-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setViewMode('grid')
            }}
          >
            Dual Track
          </button>
          <button
            className={`timeline-toggle-btn ${viewMode === 'stream' ? 'active' : ''}`}
            onClick={() => {
              soundTick()
              setViewMode('stream')
            }}
          >
            Stream
          </button>
          {viewMode === 'grid' && (
            <button
              className={`timeline-toggle-btn ${full24h ? 'active' : ''}`}
              onClick={() => {
                soundTick()
                setFull24h(!full24h)
              }}
              title="Toggle full 24-hour mode or active day hours"
            >
              {full24h ? '24h Full' : 'Active Day'}
            </button>
          )}
          <button className="timeline-toggle-btn" onClick={() => onGo('schedule')}>
            Open Schedule ↗
          </button>
        </div>
      </div>

      {/* Conflict Alert Banner */}
      {conflicts.length > 0 && (
        <div className="conflict-alert-banner">
          <div className="conflict-alert-info">
            <span className="warn-icon">⚠️</span>
            <span>
              {conflicts.length} Direct Schedule Conflict{conflicts.length > 1 ? 's' : ''} Detected!
            </span>
            <span style={{ fontWeight: 400, color: '#fecaca', fontSize: 11 }}>
              (e.g. "{conflicts[0].block.title}" overlaps "{conflicts[0].event.title}")
            </span>
          </div>
          <span className="conflict-count-badge">ACTION NEEDED</span>
        </div>
      )}

      {/* All-Day Events Ribbon */}
      {allDayEvents.length > 0 && (
        <div className="allday-ribbon">
          <span className="allday-label">🌐 ALL-DAY:</span>
          <div className="allday-items">
            {allDayEvents.map((ev) => (
              <span key={ev.id} className="allday-chip" title={ev.description || ev.title}>
                {ev.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 1: Dual Track 24-Hour Visual Grid */}
      {viewMode === 'grid' ? (
        <>
          {/* Lane Column Headers */}
          <div className="timeline-lanes-header">
            <span>TIME</span>
            <span className="lane-col-title schedule">
              <Icon name="check" size={13} /> SYSTEM BLOCKS ({timedBlocks.length})
            </span>
            <span className="lane-col-title calendar">
              <Icon name="calendar" size={13} /> GOOGLE CALENDAR ({timedCalEvents.length})
            </span>
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
                        borderColor: hasConflict ? '#ef4444' : color
                      }}
                      onClick={() => onGo('schedule')}
                      title={`Schedule Block: ${b.title} (${b.start} - ${b.minutes} min)`}
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

              {/* Lane 2: Google Calendar Events */}
              <div className="track-lane">
                {timedCalEvents.map((ev) => {
                  const top = ((ev.startMin - startMinutes) / totalMinutes) * totalHeight
                  const height = Math.max(34, (ev.duration / totalMinutes) * totalHeight - 3)
                  const hasConflict = conflictingEventIds.has(ev.id)

                  return (
                    <div
                      key={ev.id}
                      className={`timeline-card calendar-card ${hasConflict ? 'has-conflict' : ''}`}
                      style={{ top, height }}
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
            </div>
          </div>
        </>
      ) : (
        /* VIEW 2: Chronological Merged Stream */
        <div className="chrono-stream-list">
          {streamItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)', fontSize: 13 }}>
              No schedule blocks or calendar events for today.
            </div>
          ) : (
            streamItems.map((entry, idx) => {
              if (entry.type === 'schedule') {
                const b = entry.item
                return (
                  <div key={`sched-${b.id}`} className={`stream-item ${entry.hasConflict ? 'conflict' : ''}`}>
                    <div className="stream-left">
                      <span className="stream-source-tag schedule">Schedule</span>
                      <div className="stream-details">
                        <div className="stream-title-row">
                          <span className="stream-title">{b.title}</span>
                          {entry.hasConflict && (
                            <span className="stream-conflict-badge">⚠️ OVERLAPS APPOINTMENT</span>
                          )}
                        </div>
                        <div className="stream-meta">
                          <span>Kind: {KIND[b.kind]?.label || b.kind}</span>
                          <span>Duration: {b.minutes} min</span>
                          <span>Status: {b.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="stream-right">
                      <span className="stream-time">{b.start}</span>
                      {b.status === 'pending' && !running && (
                        <button
                          className="card-action-btn"
                          onClick={(e) => handleStartBlock(e, b.id)}
                        >
                          Start
                        </button>
                      )}
                    </div>
                  </div>
                )
              } else {
                const ev = entry.item
                return (
                  <div key={`cal-${ev.id}-${idx}`} className={`stream-item ${entry.hasConflict ? 'conflict' : ''}`}>
                    <div className="stream-left">
                      <span className="stream-source-tag calendar">Google Cal</span>
                      <div className="stream-details">
                        <div className="stream-title-row">
                          <span className="stream-title">{ev.title}</span>
                          {entry.hasConflict && (
                            <span className="stream-conflict-badge">⚠️ OVERLAPS SCHEDULE BLOCK</span>
                          )}
                        </div>
                        <div className="stream-meta">
                          {ev.location && <span>📍 {ev.location}</span>}
                          <span>All-day: No</span>
                        </div>
                      </div>
                    </div>
                    <div className="stream-right">
                      <span className="stream-time">
                        {ev.startTime} - {ev.endTime}
                      </span>
                    </div>
                  </div>
                )
              }
            })
          )}
        </div>
      )}
    </div>
  )
}
