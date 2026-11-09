import { describe, expect, it } from 'vitest'
import { autoSyncLine, syncErrorText, syncedLine } from './syncLabel'

const at = (h: number, m: number) => new Date(2026, 10, 8, h, m).getTime()

describe('autoSyncLine', () => {
  it('says checking before the first check', () => {
    expect(autoSyncLine({ lastCheckAt: 0, lastOkAt: 0, fails: 0 }, at(12, 5))).toEqual({ text: 'Auto-sync on · checking…', tone: 'ok' })
  })
  it('shows the last checked time', () => {
    const r = autoSyncLine({ lastCheckAt: at(12, 4), lastOkAt: at(12, 4), fails: 0 }, at(12, 5))
    expect(r.text).toBe('Auto-sync on · last checked 12:04')
  })
  it('notes a long pause while the page was hidden', () => {
    const r = autoSyncLine({ lastCheckAt: at(12, 4), lastOkAt: at(12, 4), fails: 0 }, at(12, 30))
    expect(r.text).toContain('paused while hidden')
  })
  it('warns when checks keep failing', () => {
    const r = autoSyncLine({ lastCheckAt: at(12, 6), lastOkAt: at(12, 4), fails: 2 }, at(12, 7))
    expect(r.tone).toBe('warn')
    expect(r.text).toBe("Can't reach Todoist, retrying · last synced 12:04")
  })
  it('one failure is not yet a warning', () => {
    expect(autoSyncLine({ lastCheckAt: at(12, 4), lastOkAt: at(12, 3), fails: 1 }, at(12, 5)).tone).toBe('ok')
  })
})

describe('syncedLine and the error words', () => {
  it('says how many changes came from Todoist, only when there were some', () => {
    expect(syncedLine(at(12, 4), 0)).toBe('Synced 12:04')
    expect(syncedLine(at(12, 4), 1)).toBe('Synced 12:04 · 1 change from Todoist')
    expect(syncedLine(at(12, 4), 2)).toBe('Synced 12:04 · 2 changes from Todoist')
  })
  it('Todoist not answering has its own plain words', () => {
    expect(syncErrorText(true)).toBe("Can't reach Todoist right now.")
    expect(syncErrorText()).toBe("Couldn't sync. Check your connection.")
  })
})
