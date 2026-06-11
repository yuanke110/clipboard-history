import { contextBridge, ipcRenderer } from 'electron'

export interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

const windowShowCallbacks: (() => void)[] = []
ipcRenderer.on('window:show', () => {
  windowShowCallbacks.forEach((cb) => cb())
})

const newRecordCallbacks: (() => void)[] = []
ipcRenderer.on('clipboard:new-record', () => {
  newRecordCallbacks.forEach((cb) => cb())
})

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    setMode: (mode: 'compact' | 'fullscreen') => ipcRenderer.invoke('window:setMode', mode),
    setAlwaysOnTop: (enable: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', enable)
  },
  clipboard: {
    copyText: (text: string) => ipcRenderer.invoke('clipboard:copyText', text),
    copyImage: (imagePath: string) => ipcRenderer.invoke('clipboard:copyImage', imagePath)
  },
  db: {
    query: (limit: number, offset: number, type: string) =>
      ipcRenderer.invoke('db:query', limit, offset, type),
    search: (keyword: string) =>
      ipcRenderer.invoke('db:search', keyword),
    delete: (id: number) =>
      ipcRenderer.invoke('db:delete', id),
    deleteAll: () =>
      ipcRenderer.invoke('db:deleteAll'),
    togglePin: (id: number) =>
      ipcRenderer.invoke('db:togglePin', id)
  },
  app: {
    setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('app:setAutoLaunch', enable),
    getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:set', settings)
  },
  dialog: {
    selectImage: () => ipcRenderer.invoke('dialog:selectImage')
  },
  events: {
    onWindowShow: (callback: () => void): (() => void) => {
      windowShowCallbacks.push(callback)
      return () => {
        const idx = windowShowCallbacks.indexOf(callback)
        if (idx >= 0) windowShowCallbacks.splice(idx, 1)
      }
    },
    onNewRecord: (callback: () => void): (() => void) => {
      newRecordCallbacks.push(callback)
      return () => {
        const idx = newRecordCallbacks.indexOf(callback)
        if (idx >= 0) newRecordCallbacks.splice(idx, 1)
      }
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
