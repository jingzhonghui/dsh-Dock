import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC, type DshShellApi, type Settings, type ShellState } from '../shared/ipc'

const api: DshShellApi = {
  getState: () => ipcRenderer.invoke(IPC.GetState),
  probe: (url: string) => ipcRenderer.invoke(IPC.Probe, url),
  createTab: () => ipcRenderer.invoke(IPC.CreateTab),
  closeTab: (id: string) => ipcRenderer.invoke(IPC.CloseTab, id),
  switchTab: (id: string) => ipcRenderer.invoke(IPC.SwitchTab, id),
  connectTab: (id: string, url: string) => ipcRenderer.invoke(IPC.ConnectTab, id, url),
  startLocal: () => ipcRenderer.invoke(IPC.StartLocal),
  stopLocal: () => ipcRenderer.invoke(IPC.StopLocal),
  installDsh: () => ipcRenderer.invoke(IPC.InstallDsh),
  stopInstall: () => ipcRenderer.invoke(IPC.StopInstall),
  isInstalled: () => ipcRenderer.invoke(IPC.IsInstalled),
  listEndpoints: () => ipcRenderer.invoke(IPC.ListEndpoints),
  addEndpoint: (label: string, url: string) => ipcRenderer.invoke(IPC.AddEndpoint, label, url),
  removeEndpoint: (id: string) => ipcRenderer.invoke(IPC.RemoveEndpoint, id),
  getSettings: () => ipcRenderer.invoke(IPC.GetSettings),
  setSettings: (settings: Settings) => ipcRenderer.invoke(IPC.SetSettings, settings),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OpenExternal, url),
  toggleDevTools: () => ipcRenderer.invoke(IPC.ToggleDevTools),
  reloadTab: (id: string) => ipcRenderer.invoke(IPC.ReloadTab, id),
  setChromeHeight: (height: number) => ipcRenderer.invoke(IPC.SetChromeHeight, height),
  onStateChanged: (cb: (state: ShellState) => void) => {
    const listener = (_e: IpcRendererEvent, s: ShellState): void => cb(s)
    ipcRenderer.on(IPC.StateChanged, listener)
    return () => ipcRenderer.removeListener(IPC.StateChanged, listener)
  }
}

contextBridge.exposeInMainWorld('dshShell', api)
