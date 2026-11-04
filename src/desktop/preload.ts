import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop'

const api: DesktopApi = {
  load: () => ipcRenderer.invoke('desktop:load'),
  save: (bytes) => ipcRenderer.invoke('desktop:save', bytes),
  backup: () => ipcRenderer.invoke('desktop:backup'),
  updateStatus: () => ipcRenderer.invoke('desktop:updateStatus'),
  checkUpdates: () => ipcRenderer.invoke('desktop:checkUpdates'),
  installUpdate: () => ipcRenderer.invoke('desktop:installUpdate'),
  loginGithub: () => ipcRenderer.invoke('desktop:loginGithub'),
  backupStatus: () => ipcRenderer.invoke('backups:status'),
  writeBackup: (text, day) => ipcRenderer.invoke('backups:write', text, day),
  readBackup: (where, name) => ipcRenderer.invoke('backups:read', where, name),
  chooseBackupFolder: () => ipcRenderer.invoke('backups:choose'),
  openBackupFolder: (where) => ipcRenderer.invoke('backups:open', where),
  islandState: (s) => ipcRenderer.send('island:state', s),
  onIslandAction: (cb) => void ipcRenderer.on('island:action', (_e, a) => cb(a)),
  onNavigate: (cb) => void ipcRenderer.on('app:navigate', (_e, page) => cb(page)),
  onIslandState: (cb) => void ipcRenderer.on('island:state', (_e, s) => cb(s)),
  islandAction: (a) => ipcRenderer.send('island:action', a),
  islandMode: (mode, height) => ipcRenderer.send('island:mode', mode, height),
  islandHot: (rect) => ipcRenderer.send('island:hot', rect),
  onIslandHover: (cb) => void ipcRenderer.on('island:hover', (_e, over) => cb(!!over)),
  showApp: (page) => ipcRenderer.send('island:showApp', page)
}
contextBridge.exposeInMainWorld('desktop', api)
