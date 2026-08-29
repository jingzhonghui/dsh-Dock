/**
 * IPC channel names and payload types shared by main, preload and renderer.
 * Keep this file free of any electron / node imports so it can be bundled
 * anywhere (including the sandboxed preload).
 */

export const IPC = {
  // renderer -> main (invoke)
  GetState: 'shell:get-state',
  Probe: 'shell:probe',
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
  ReloadTab: 'shell:reload-tab',
  SetChromeHeight: 'shell:set-chrome-height',
  // tabs
  CreateTab: 'shell:create-tab',
  CloseTab: 'shell:close-tab',
  SwitchTab: 'shell:switch-tab',
  ConnectTab: 'shell:connect-tab',
  // main -> renderer (event)
  StateChanged: 'shell:state-changed',
  Log: 'shell:log'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Which side of the connection a connected tab came from. */
export type ConnectionSource = 'local-external' | 'local-spawned' | 'manual'

/** A tab is either the non-deletable startup tab or a user-created one. */
export type TabKind = 'boot' | 'manual'

export type TabPhase =
  | 'probing' // boot tab while startup health-checking
  | 'landing' // boot tab when no local dsh is available (install / manual connect UI)
  | 'new' // freshly created tab awaiting a URL
  | 'connecting' // probing / loading a URL
  | 'connected' // has a live WebContentsView
  | 'error' // connection or load failed; retry in the same tab

export interface TabState {
  id: string
  kind: TabKind
  phase: TabPhase
  /** Current page URL (canonical, no trailing slash). */
  url?: string
  source?: ConnectionSource
  /** Page <title> reported by the web content, used as the tab label. */
  title?: string
  /** Human-readable failure detail for the error phase. */
  error?: string
}

export type Busy =
  | 'none'
  | 'auto-starting' // boot-time automatic start of an installed-but-stopped dsh
  | 'starting' // user-triggered start from the landing page
  | 'installing'

export type LandingReason =
  | 'not-installed'
  | 'start-failed'
  | 'disconnected'
  | 'user'
  | 'probe-failed'

export interface ShellState {
  tabs: TabState[]
  activeTabId: string
  /** id of the startup tab; never closable. */
  bootTabId: string
  busy: Busy
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
  createTab(): Promise<ShellState>
  closeTab(id: string): Promise<ShellState>
  switchTab(id: string): Promise<ShellState>
  connectTab(id: string, url: string): Promise<ShellState>
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
  reloadTab(id: string): Promise<void>
  setChromeHeight(height: number): Promise<void>
  onStateChanged(cb: (state: ShellState) => void): () => void
}
