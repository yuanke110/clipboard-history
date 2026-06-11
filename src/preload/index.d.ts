export interface HistoryRecord {
  id: number
  content: string | null
  type: 'text' | 'image'
  image_path: string | null
  summary: string | null
  timestamp: string
  is_pinned: number
}

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>
    close: () => Promise<void>
    setMode: (mode: 'compact' | 'fullscreen') => Promise<void>
    setAlwaysOnTop: (enable: boolean) => Promise<void>
  }
  clipboard: {
    copyText: (text: string) => Promise<void>
    copyImage: (imagePath: string) => Promise<void>
  }
  db: {
    query: (limit: number, offset: number, type: string) => Promise<HistoryRecord[]>
    search: (keyword: string) => Promise<HistoryRecord[]>
    delete: (id: number) => Promise<void>
    deleteAll: () => Promise<number>
    togglePin: (id: number) => Promise<number>
  }
  app: {
    setAutoLaunch: (enable: boolean) => Promise<void>
    getAutoLaunch: () => Promise<boolean>
  }
  settings: {
    get: () => Promise<Record<string, unknown>>
    set: (settings: Record<string, unknown>) => Promise<void>
  }
  dialog: {
    selectImage: () => Promise<string | null>
  }
  events: {
    onWindowShow: (callback: () => void) => () => void
    onNewRecord: (callback: () => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
