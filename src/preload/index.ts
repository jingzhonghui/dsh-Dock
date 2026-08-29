import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC, type DshShellApi, type LogEntry, type Settings, type ShellState } from '../shared/ipc'

const api: DshShellApi = {
  getState: () => ipcRenderer.invoke(IPC.GetState),
  probe: (url: string) => ipcRenderer.invoke(IPC.Probe, url),
  connect: (url: string) => ipcRenderer.invoke(IPC.Connect, url),
  startLocal: () => ipcRenderer.invoke(IPC.StartLocal),
  stopLocal: () => ipcRenderer.invoke(IPC.StopLocal),
  installDsh: () => ipcRenderer.invoke(IPC.InstallDsh),
  isInstalled: () => ipcRenderer.invoke(IPC.IsInstalled),
  listEndpoints: () => ipcRenderer.invoke(IPC.ListEndpoints),
  addEndpoint: (label: string, url: string) => ipcRenderer.invoke(IPC.AddEndpoint, label, url),
  removeEndpoint: (id: string) => ipcRenderer.invoke(IPC.RemoveEndpoint, id),
  getSettings: () => ipcRenderer.invoke(IPC.GetSettings),
  setSettings: (settings: Settings) => ipcRenderer.invoke(IPC.SetSettings, settings),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OpenExternal, url),
  toggleDevTools: () => ipcRenderer.invoke(IPC.ToggleDevTools),
  goBack: () => ipcRenderer.invoke(IPC.GoBack),
  goForward: () => ipcRenderer.invoke(IPC.GoForward),
  reload: () => ipcRenderer.invoke(IPC.Reload),
  goHome: () => ipcRenderer.invoke(IPC.GoHome),
  setChromeHeight: (height: number) => ipcRenderer.invoke(IPC.SetChromeHeight, height),
  onStateChanged: (cb: (state: ShellState) => void) => {
    const listener = (_e: IpcRendererEvent, s: ShellState): void => cb(s)
    ipcRenderer.on(IPC.StateChanged, listener)
    return () => ipcRenderer.removeListener(IPC.StateChanged, listener)
  },
  onLog: (cb: (entry: LogEntry) => void) => {
    const listener = (_e: IpcRendererEvent, entry: LogEntry): void => cb(entry)
    ipcRenderer.on(IPC.Log, listener)
    return () => ipcRenderer.removeListener(IPC.Log, listener)
  }
}

contextBridge.exposeInMainWorld('dshShell', api)
