/**
 * IPC channel names and payload types shared by main, preload and renderer.
 * Keep this file free of any electron / node imports so it can be bundled
 * anywhere (including the sandboxed preload).
 */

export const IPC = {
  // renderer -> main (invoke)
  GetState: 'shell:get-state',
  Probe: 'shell:probe',
  Connect: 'shell:connect',
  StartLocal: 'shell:start-local',
  StopLocal: 'shell:stop-local',
  InstallDsh: 'shell:install-dsh',
  IsInstalled: 'shell:is-installed',
  ListEndpoints: 'shell:list-endpoints',
  AddEndpoint: 'shell:add-endpoint',
  RemoveEndpoint: 'shell:remove-endpoint',
  GetSettings: 'shell:get-settings',
  SetSettings: 'shell:set-settings',
  OpenExternal: 'shell:open-external',
  ToggleDevTools: 'shell:toggle-devtools',
  GoBack: 'shell:go-back',
  GoForward: 'shell:go-forward',
  Reload: 'shell:reload',
  GoHome: 'shell:go-home',
  SetChromeHeight: 'shell:set-chrome-height',
  // main -> renderer (event)
  StateChanged: 'shell:state-changed',
  Log: 'shell:log'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Which side of the connection a connected state came from. */
export type ConnectionSource = 'local-external' | 'local-spawned' | 'manual'

export type Phase = 'probing' | 'connected' | 'landing'

export type Busy =
  | 'none'
  | 'auto-starting' // boot-time automatic start of an installed-but-stopped dsh
  | 'starting' // user-triggered start from the landing page
  | 'installing'
  | 'connecting' // user-entered URL being connected

export type LandingReason =
  | 'not-installed'
  | 'start-failed'
  | 'disconnected'
  | 'user'
  | 'probe-failed'

export interface ConnectionInfo {
  source: ConnectionSource
  url: string
}

export interface ShellState {
  phase: Phase
  busy: Busy
  connection?: ConnectionInfo
  landingReason?: LandingReason
  /** Short human-readable explanation shown in the UI (e.g. failure cause). */
  message?: string
  /** DSH is installed (npm global @deepseek-ai/dsh resolvable). */
  installed?: boolean
  /** Recent unified log lines (process + install + shell), oldest first. */
  logs: LogEntry[]
}

export interface LogEntry {
  source: 'dsh' | 'npm' | 'shell'
  level: 'info' | 'warn' | 'error'
  text: string
  ts: number
}

export interface ProbeResult {
  ok: boolean
  isDsh: boolean
  status?: number
}

export interface Endpoint {
  id: string
  label: string
  url: string
  lastConnectedAt?: string
}

export interface EndpointStoreData {
  version: 1
  defaultLocalUrl: string
  endpoints: Endpoint[]
}

/** API exposed on window.dshShell by the preload script. */
export interface Settings {
  /** Keep the shell-spawned dsh process alive after the shell quits. */
  keepDshRunning: boolean
}

/** API exposed on window.dshShell by the preload script. */
export interface DshShellApi {
  getState(): Promise<ShellState>
  probe(url: string): Promise<ProbeResult>
  connect(url: string): Promise<ShellState>
  startLocal(): Promise<ShellState>
  stopLocal(): Promise<void>
  installDsh(): Promise<{ ok: boolean; message?: string }>
  isInstalled(): Promise<boolean>
  listEndpoints(): Promise<EndpointStoreData>
  addEndpoint(label: string, url: string): Promise<EndpointStoreData>
  removeEndpoint(id: string): Promise<EndpointStoreData>
  getSettings(): Promise<Settings>
  setSettings(settings: Settings): Promise<Settings>
  openExternal(url: string): Promise<void>
  toggleDevTools(): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  goHome(): Promise<void>
  setChromeHeight(height: number): Promise<void>
  onStateChanged(cb: (state: ShellState) => void): () => void
  onLog(cb: (entry: LogEntry) => void): () => void
}
