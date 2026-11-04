import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop'

const api: DesktopApi = {
  load: () => ipcRenderer.invoke('desktop:load'),
  save: (bytes) => ipcRenderer.invoke('desktop:save', bytes),
  backup: () => ipcRenderer.invoke('desktop:backup'),
  updateStatus: () => ipcRenderer.invoke('desktop:updateStatus'),
  checkUpdates: () => ipcRenderer.invoke('desktop:checkUpdates'),
  installUpdate: () => ipcRenderer.invoke('desktop:installUpdate'),
  loginGithub: () => ipcRenderer.invoke('desktop:loginGithub')
}
contextBridge.exposeInMainWorld('desktop', api)
