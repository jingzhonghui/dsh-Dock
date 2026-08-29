import type { DshShellApi } from '../shared/ipc'

declare global {
  interface Window {
    dshShell: DshShellApi
  }
}

export {}
