import { contextBridge, ipcRenderer } from 'electron'
import type { IpcReply, LifeApi, UpdateStatus } from '@shared/api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as IpcReply<T>
  if (!reply.ok) throw new Error(reply.error)
  return reply.data
}

const api: LifeApi & { onLocked(cb: () => void): void; onUrge(cb: () => void): void; onWalletChanged(cb: () => void): void; onNavigate(cb: (page: string) => void): void; onUpdate(cb: (s: UpdateStatus) => void): void; onUiKey(cb: (key: string) => void): () => void } = {
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
    undo: (id, note) => call('wallet:undo', id, note)
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
    setBudget: (amount) => call('shop:setBudget', amount)
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
    prefs: () => call('app:prefs'),
    setPrefs: (p) => call('app:setPrefs', p)
  },
  backup: {
    status: () => call('backup:status'),
    setPassphrase: (p) => call('backup:setPassphrase', p),
    runNow: () => call('backup:runNow'),
    list: () => call('backup:list'),
    verifyLatest: () => call('backup:verifyLatest'),
    restore: (name, passphrase) => call('backup:restore', name, passphrase)
  },
  onLocked: (cb) => {
    ipcRenderer.on('auth:locked', () => cb())
  },
  onUrge: (cb) => {
    ipcRenderer.on('nav:urge', () => cb())
  },
  onWalletChanged: (cb) => {
    ipcRenderer.on('wallet:changed', () => cb())
  },
  onNavigate: (cb) => {
    ipcRenderer.on('nav:page', (_e, page: string) => cb(page))
  },
  onUpdate: (cb) => {
    ipcRenderer.on('update:event', (_e, s: UpdateStatus) => cb(s))
  },
  onUiKey: (cb) => {
    const fn = (_e: unknown, key: string) => cb(key)
    ipcRenderer.on('ui:key', fn)
    return () => ipcRenderer.removeListener('ui:key', fn)
  }
}

contextBridge.exposeInMainWorld('life', api)
