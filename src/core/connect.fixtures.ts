// Test data in the shape of the real apps' files, with made-up values.
export const WAKY = JSON.stringify({
  version: 2,
  settings: { weekday: '06:30', weekend: '07:30', grace: 10, sleepGoal: 420 },
  days: {
    '2026-10-24': { time: '06:45', target: '06:30', mode: 'button' },
    '2026-10-25': { time: '06:32', target: '06:30', mode: 'button' },
    'junk': { time: 'x' }
  },
  nights: { '2026-10-25': { time: '23:20', target: '23:30' }, '2026-10-24': { time: '00:40', target: '23:30' } }
})

export const FINANCE = (savedAt: number) => JSON.stringify({
  app: 'finance-helper',
  schema: 3,
  savedAt,
  data: {
    settings: { currency: 'MDL', categories: [{ id: 'food', name: 'Food' }, { id: 'home', name: 'Rent' }] },
    tx: [
      { id: 'a', type: 'expense', amount: 12000, base: 12000, date: '2026-10-24', category: 'food' },
      { id: 'b', type: 'expense', amount: 500000, date: '2026-10-24', category: 'home' },
      { id: 'c', type: 'income', amount: 900000, date: '2026-10-01', category: 'salary' },
      { id: 'd', type: 'expense', amount: 7000, date: '2026-10-25', category: 'food' },
      { id: 'gone', type: 'expense', amount: 99999, date: '2026-10-25', category: 'food' }
    ],
    deleted: { gone: 1 }
  }
})
