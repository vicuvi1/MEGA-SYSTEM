import { contextBridge, ipcRenderer } from 'electron'
import type { IpcReply, LifeApi, UpdateStatus } from '@shared/api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as IpcReply<T>
  if (!reply.ok) throw new Error(reply.error)
  return reply.data
}

const api: LifeApi & { onLocked(cb: () => void): void; onUrge(cb: () => void): void; onWalletChanged(cb: () => void): void; onNavigate(cb: (page: string) => void): void; onUpdate(cb: (s: UpdateStatus) => void): void; onUiKey(cb: (key: string) => void): () => void; onFullScreen(cb: (on: boolean) => void): () => void } = {
  auth: {
    status: () => call('auth:status'),
    setPin: (pin, currentPin) => call('auth:setPin', pin, currentPin),
    unlock: (pin) => call('auth:unlock', pin),
    lock: () => call('auth:lock')
  },
  wallet: {
    summary: () => call('wallet:summary'),
    history: (limit) => call('wallet:history', limit),
    award: (ruleId, note) => call('wallet:award', ruleId, note),
    undo: (id, note) => call('wallet:undo', id, note),
    quests: () => call('wallet:quests'),
    claimQuests: () => call('wallet:claimQuests')
  },
  rules: {
    list: () => call('rules:list'),
    save: (rule) => call('rules:save', rule)
  },
  shop: {
    state: () => call('shop:state'),
    save: (r) => call('shop:save', r),
    archive: (id) => call('shop:archive', id),
    redeem: (id) => call('shop:redeem', id),
    openChest: (level) => call('shop:openChest', level),
    setBudget: (amount) => call('shop:setBudget', amount),
    setCurrency: (cur) => call('shop:setCurrency', cur)
  },
  tasks: {
    state: () => call('tasks:state'),
    save: (t) => call('tasks:save', t),
    archive: (id) => call('tasks:archive', id),
    complete: (id) => call('tasks:complete', id),
    uncomplete: (id) => call('tasks:uncomplete', id),
    saveCategory: (c) => call('tasks:saveCategory', c)
  },
  schedule: {
    state: (day) => call('schedule:state', day),
    save: (b) => call('schedule:save', b),
    archive: (id) => call('schedule:archive', id),
    start: (id) => call('schedule:start', id),
    finish: (id) => call('schedule:finish', id),
    skip: (id) => call('schedule:skip', id)
  },
  discipline: {
    state: () => call('discipline:state'),
    setStart: (day) => call('discipline:setStart', day),
    checkIn: () => call('discipline:checkIn'),
    oath: () => call('discipline:oath'),
    reset: () => call('discipline:reset'),
    claim: (days) => call('discipline:claim', days),
    startUrge: () => call('discipline:startUrge'),
    finishUrge: () => call('discipline:finishUrge'),
    cancelUrge: () => call('discipline:cancelUrge'),
    setStealth: (on) => call('discipline:setStealth', on)
  },
  body: {
    state: () => call('body:state'),
    logWorkout: (input) => call('body:logWorkout', input),
    deleteWorkout: (id) => call('body:deleteWorkout', id),
    logMetric: (input) => call('body:logMetric', input),
    saveExercise: (ex) => call('body:saveExercise', ex)
  },
  connections: {
    state: () => call('connections:state'),
    connect: (kind) => call('connections:connect', kind),
    disconnect: (kind) => call('connections:disconnect', kind),
    sync: () => call('connections:sync'),
    choosePath: (kind) => call('connections:choosePath', kind),
    setDailyBudget: (amount) => call('connections:setDailyBudget', amount)
  },
  updates: {
    status: () => call('update:status'),
    check: () => call('update:check'),
    run: () => call('update:run')
  },
  apps: {
    info: () => call('apps:info'),
    startWaky: () => call('apps:startWaky')
  },
  app: {
    toggleFullScreen: () => call('app:toggleFullScreen'),
    reportError: (message, detail) => call('app:reportError', message, detail),
    recentErrors: () => call('app:recentErrors'),
    openLogs: () => call('app:openLogs'),
    prefs: () => call('app:prefs'),
    setPrefs: (p) => call('app:setPrefs', p)
  },
  telegram: {
    config: () => call('telegram:config'),
    saveConfig: (c) => call('telegram:saveConfig', c),
    test: () => call('telegram:test')
  },
  backup: {
    status: () => call('backup:status'),
    chooseDir: () => call('backup:chooseDir'),
    setPassphrase: (p) => call('backup:setPassphrase', p),
    runNow: () => call('backup:runNow'),
    list: () => call('backup:list'),
    verifyLatest: () => call('backup:verifyLatest'),
    restore: (name, passphrase) => call('backup:restore', name, passphrase)
  },
  sleep: {
    state: () => call('sleep:state'),
    logWake: (time, quality) => call('sleep:logWake', time, quality),
    logBed: (time) => call('sleep:logBed', time),
    setTargets: (weekday, weekend, bedtime) => call('sleep:setTargets', weekday, weekend, bedtime)
  },
  money: {
    state: () => call('money:state'),
    addExpense: (amountBani, category, note) => call('money:addExpense', amountBani, category, note),
    deleteExpense: (id) => call('money:deleteExpense', id),
    setBudget: (budgetBani) => call('money:setBudget', budgetBani),
    setCurrency: (cur) => call('money:setCurrency', cur)
  },
  shields: {
    count: () => call('shields:count'),
    buy: () => call('shields:buy')
  },
  data: {
    exportJson: () => call('data:exportJson'),
    exportCsv: (kind) => call('data:exportCsv', kind)
  },
    economy: {
    summary: () => call('economy:summary'),
    goals: () => call('economy:goals'),
    saveGoal: (g) => call('economy:saveGoal', g),
    deleteGoal: (id) => call('economy:deleteGoal', id),
    pinGoal: (id) => call('economy:pinGoal', id),
    depositCoins: (goalId, amount) => call('economy:depositCoins', goalId, amount),
    depositVault: (goalId, amount) => call('economy:depositVault', goalId, amount),
    claimGoal: (goalId) => call('economy:claimGoal', goalId),
    creditVault: (amount, note) => call('economy:creditVault', amount, note),
    setExchangeRate: (rate) => call('economy:setExchangeRate', rate),
    setCurrency: (cur) => call('economy:setCurrency', cur),
    openChest: (level) => call('economy:openChest', level)
  },
  bots: {
    config: () => call('bots:config'),
    saveConfig: (c) => call('bots:saveConfig', c),
    status: () => call('bots:status'),
    logs: () => call('bots:logs'),
    clearLogs: () => call('bots:clearLogs'),
    test: () => call('bots:test'),
    startPolling: () => call('bots:startPolling'),
    stopPolling: () => call('bots:stopPolling')
  },
  ai: {
    config: () => call('ai:config'),
    saveConfig: (c) => call('ai:saveConfig', c),
    test: (provider) => call('ai:test', provider),
    generateRewards: (userPrompt) => call('ai:generateRewards', userPrompt),
    performanceReport: () => call('ai:performanceReport'),
    askCoach: (msg, history) => call('ai:askCoach', msg, history),
    decomposeTask: (title, notes, category) => call('ai:decomposeTask', title, notes, category)
  },
  calendar: {
    config: () => call('calendar:config'),
    saveConfig: (c) => call('calendar:saveConfig', c),
    sync: () => call('calendar:sync'),
    events: (day) => call('calendar:events', day),
    clear: () => call('calendar:clear')
  },
  onLocked: (cb) => {
    ipcRenderer.on('auth:locked', () => cb())
  },
  onUrge: (cb) => {
    ipcRenderer.on('discipline:urge', () => cb())
  },
  onWalletChanged: (cb) => {
    ipcRenderer.on('wallet:changed', () => cb())
  },
  onNavigate: (cb) => {
    ipcRenderer.on('app:navigate', (_, page: string) => cb(page))
  },
  onUpdate: (cb) => {
    ipcRenderer.on('update:status', (_, s: UpdateStatus) => cb(s))
  },
  onUiKey: (cb) => {
    const handler = (_: unknown, key: string) => cb(key)
    ipcRenderer.on('app:uikey', handler)
    return () => {
      ipcRenderer.removeListener('app:uikey', handler)
    }
  },
  onFullScreen: (cb) => {
    const handler = (_: unknown, on: boolean) => cb(on)
    ipcRenderer.on('app:fullscreen', handler)
    return () => {
      ipcRenderer.removeListener('app:fullscreen', handler)
    }
  }
}

contextBridge.exposeInMainWorld('life', api)
