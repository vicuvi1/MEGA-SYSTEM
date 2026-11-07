import { describe, expect, it } from 'vitest'
import { createChangeWatch, createTodayList } from './todoRefresh'

/** A made-up Todoist: a list of tasks and a change counter behind a sync token. */
function fakeTodoist() {
  const tasks = [{ id: 't1', content: 'Pay the internet bill' }]
  let version = 1
  let fail = false
  return {
    add(content: string) {
      tasks.push({ id: `t${tasks.length + 1}`, content })
      version++
    },
    breakIt(on: boolean) {
      fail = on
    },
    changes: async (token: string) => {
      if (fail) throw new Error('Todoist 503')
      const since = token === '*' ? version : Number(token)
      return { token: String(version), changed: version - since }
    },
    today: async () => {
      if (fail) throw new Error('Todoist 503')
      return tasks.map((t) => ({ ...t }))
    }
  }
}

describe("today's Todoist tasks stay fresh", () => {
  it('a task added in Todoist after the first read shows up on the next check', async () => {
    const td = fakeTodoist()
    const watch = createChangeWatch(td.changes)
    const list = createTodayList(td.today)
    expect((await list.refresh()).map((t) => t.content)).toEqual(['Pay the internet bill'])
    expect(await watch.check()).toBe(false) // the first check only starts the count
    expect(await watch.check()).toBe(false) // nothing new
    td.add('Email the lab partner')
    expect(await watch.check()).toBe(true)
    expect((await list.refresh()).map((t) => t.content)).toEqual(['Pay the internet bill', 'Email the lab partner'])
    expect(await watch.check()).toBe(false)
  })

  it('a failed read keeps the last list instead of emptying it', async () => {
    const td = fakeTodoist()
    const list = createTodayList(td.today)
    await list.refresh()
    td.breakIt(true)
    expect((await list.refresh()).length).toBe(1)
    expect(await createChangeWatch(td.changes).check()).toBe(false)
    td.breakIt(false)
    td.add('Book the dentist')
    expect((await list.refresh()).length).toBe(2)
  })

  it('with no list yet, a failed read says so', async () => {
    const td = fakeTodoist()
    td.breakIt(true)
    await expect(createTodayList(td.today).refresh()).rejects.toThrow('503')
  })
})
