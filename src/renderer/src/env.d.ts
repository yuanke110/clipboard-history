/// <reference types="vite/client" />

interface Window {
  electronAPI: import('../../preload/index.d.ts').ElectronAPI
}
