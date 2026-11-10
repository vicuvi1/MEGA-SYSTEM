// Telegram food photos in Photo Locker (made-up data, pinned clock): the Drive
// folder and file name, the Food filter, and a folder change moving the app's
// own sub-folders with the files.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanFolderPath, filterItems, folderMovePlan, foodFolderPath, foodPhotoName, foodPhotoNumber, type RemoteFile } from './vaultSync'

afterEach(() => vi.useRealTimers())

describe('food photos in Photo Locker', () => {
  it('go to Food/YYYY-MM, named by date, time and meal (safe on every OS)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-03-12T13:05:00'))
    const at = Date.now()
    expect(foodFolderPath(at)).toBe('Food/2030-03')
    expect(foodPhotoName(at, 'lunch', 'White rice, chicken')).toBe('2030-03-12 13-05 Lunch - White rice, chicken.jpg')
    expect(foodPhotoName(at, 'dinner', 'Pasta: "big" bowl/2', 2)).toBe('2030-03-12 13-05 Dinner - Pasta big bowl 2 (2).jpg')
    expect(foodPhotoName(at)).toBe('2030-03-12 13-05 Meal.jpg')
    expect(foodPhotoNumber('fpab12n3')).toBe(3)
    expect(foodPhotoNumber('v123')).toBe(0)
    expect(cleanFolderPath('Food/2030-03')).toBe('Food/2030-03')
    expect(cleanFolderPath('../etc')).toBeNull()
    expect(cleanFolderPath('a/b/c/d')).toBeNull()
  })

  it('the Food filter shows food photos only', () => {
    const items = [
      { kind: 'photo' as const, name: 'a', tags: ['food', 'lunch'], takenAt: 2 },
      { kind: 'photo' as const, name: 'b', tags: ['progress'], takenAt: 1 }
    ]
    expect(filterItems(items, 'food', '').map((x) => x.name)).toEqual(['a'])
    expect(filterItems(items, 'all', '#lunch').map((x) => x.name)).toEqual(['a'])
  })

  it('a folder change moves the app files and its Food sub-folder (the photos inside go with it), nothing else', () => {
    const f = (fileId: string, lsApp: string | null, parents = ['old']): RemoteFile => ({ fileId, name: fileId, mime: lsApp === 'locker-sub' ? 'application/vnd.google-apps.folder' : 'image/jpeg', sizeBytes: 1, parents, appProperties: lsApp ? (lsApp === 'locker' ? { lsApp, lsId: `id-${fileId}` } : { lsApp }) : {} })
    expect(folderMovePlan([f('p1', 'locker'), f('food', 'locker-sub'), f('other', null)], 'old', 'new')).toEqual([
      { fileId: 'p1', from: 'old' },
      { fileId: 'food', from: 'old' }
    ])
  })
})
