import { contextBridge, ipcRenderer } from 'electron'
import type { IpcReply, LifeApi } from '@shared/api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as IpcReply<T>
  if (!reply.ok) throw new Error(reply.error)
  return reply.data
}

const api: LifeApi & { onLocked(cb: () => void): void } = {
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
  }
}

contextBridge.exposeInMainWorld('life', api)
