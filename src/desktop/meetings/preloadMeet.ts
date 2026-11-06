// Meetings on the island (MT1–MT3, AI17): the narrow methods the island page gets (preload).
import type { IpcRenderer } from 'electron'
import type { MeetApi } from '../../shared/meetings'

export function meetPreload(ipc: IpcRenderer): MeetApi {
  return {
    status: (title) => ipc.invoke('meet', 'status', title ?? null),
    start: (title) => ipc.invoke('meet', 'start', title ?? null),
    stop: () => ipc.invoke('meet', 'stop'),
    transcript: () => ipc.invoke('meet', 'transcript'),
    readReply: () => ipc.invoke('meet', 'readReply'),
    onState: (cb) => void ipc.on('meet:state', (_e, s) => cb(s))
  }
}
