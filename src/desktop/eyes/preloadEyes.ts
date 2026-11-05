// Island eyes: the narrow methods the app window and the island get (preload).
import type { IpcRenderer } from 'electron'
import type { EyesApi } from '../../shared/eyes'

export function eyesPreload(ipc: IpcRenderer): EyesApi {
  return {
    get: () => ipc.invoke('eyes:get'),
    set: (patch) => ipc.invoke('eyes:set', patch),
    pause: (choice) => ipc.invoke('eyes:pause', choice),
    readScreen: () => ipc.invoke('eyes:readScreen'),
    captionNow: () => ipc.invoke('eyes:captionNow'),
    clearLog: () => ipc.invoke('eyes:clearLog'),
    modelDownload: () => ipc.invoke('eyes:modelDownload'),
    modelCancel: () => ipc.invoke('eyes:modelCancel'),
    modelDelete: () => ipc.invoke('eyes:modelDelete'),
    onState: (cb) => void ipc.on('eyes:state', (_e, s) => cb(s)),
    onSeen: (cb) => void ipc.on('eyes:seen', (_e, s) => cb(s)),
    onCaptionJob: (cb) => void ipc.on('eyes:captionJob', (_e, j) => cb(j)),
    captionDone: (id, r) => ipc.send('eyes:captionDone', String(id), { ok: !!r?.ok, text: String(r?.text ?? '').slice(0, 400), error: String(r?.error ?? '').slice(0, 200) }),
    onCaptionUnload: (cb) => void ipc.on('eyes:captionUnload', () => cb())
  }
}
