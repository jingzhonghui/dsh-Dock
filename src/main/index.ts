import { app, BrowserWindow, ipcMain, Menu, shell, WebContentsView, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

import { IPC, type ConnectionSource, type EndpointStoreData, type LogEntry, type Settings, type ShellState } from '../shared/ipc'
import { isAllowedUrl, isLoopback, normalizeUrl } from '../shared/url'
import { probeEndpoint } from './detector'
import { DshProcessManager, isDshInstalled } from './localDsh'
import { installDshGlobal } from './installer'
import { EndpointStore } from './endpoints'
import { SettingsStore } from './settings'
import { TabStore } from './tabs'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/** Mirror key lifecycle events to stdout for debugging / smoke tests. */
function debug(...args: unknown[]): void {
  console.log('[dsh-dock]', ...args)
}

// ── singleton ───────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// ── stateful services ───────────────────────────────────────────────────────
const store = new TabStore()
let endpoints: EndpointStore
let settings: SettingsStore
let manager: DshProcessManager
let win: BrowserWindow | null = null

// One WebContentsView per connected tab; only the active tab's view is a child.
const views = new Map<string, WebContentsView>()
let attachedTabId: string | null = null

let chromeHeight = 36 // default chrome-bar height until the renderer reports the real one
let quitting = false
let installAbort: AbortController | null = null
let settingsCache: Settings = { keepDshRunning: false }

// ── helpers ─────────────────────────────────────────────────────────────────
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sourceLabel(source: ConnectionSource): string {
  return source === 'local-external'
    ? '本机（已在运行）'
    : source === 'local-spawned'
      ? '本机（由壳启动）'
      : '远程/手动'
}

function emitState(s: ShellState = store.snapshot()): void {
  win?.webContents.send(IPC.StateChanged, s)
}

function pushDshOutput(chunk: string): void {
  let buffer = ''
  for (const line of (buffer + chunk).split(/\r?\n/)) {
    if (!line.trim()) continue
    store.log({ source: 'dsh', level: 'info', text: line.trimEnd() })
  }
}

// ── content views (one per connected tab) ───────────────────────────────────
function createView(tabId: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:dsh',
      spellcheck: true
    }
  })
  views.set(tabId, view)

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const onNavigated = (url: string): void => {
    const tab = store.getTab(tabId)
    if (tab && tab.phase === 'connected' && tab.url !== url) store.patchTab(tabId, { url })
  }
  view.webContents.on('did-navigate', (_e, url) => onNavigated(url))
  view.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) onNavigated(url)
  })

  view.webContents.on('page-title-updated', (_e, title) => {
    store.patchTab(tabId, { title: title || undefined })
  })

  view.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    if (code === -3) return // ERR_ABORTED: user-initiated navigation/cancel
    const tab = store.getTab(tabId)
    if (!tab || (tab.phase !== 'connected' && tab.phase !== 'connecting')) return
    const text = `DSH 连接中断（${code} ${desc}）`
    store.patchTab(tabId, { phase: 'error', error: text })
    store.log({ source: 'shell', level: 'error', text })
    syncViews()
  })

  return view
}

function destroyView(tabId: string): void {
  const view = views.get(tabId)
  if (!view) return
  if (attachedTabId === tabId) {
    win?.contentView.removeChildView(view)
    attachedTabId = null
  }
  view.webContents.close()
  views.delete(tabId)
}

/** Attach the active connected tab's view, detach everything else, and relayout. */
function syncViews(): void {
  if (!win) return
  if (attachedTabId) {
    const attached = views.get(attachedTabId)
    if (attached) win.contentView.removeChildView(attached)
    attachedTabId = null
  }
  const active = store.getTab(store.snapshot().activeTabId)
  if (active?.phase === 'connected') {
    const view = views.get(active.id)
    if (view) {
      win.contentView.addChildView(view)
      attachedTabId = active.id
    }
  }
  layout()
}

function layout(): void {
  if (!win || !attachedTabId) return
  const view = views.get(attachedTabId)
  if (!view) return
  const [width, height] = win.getContentSize()
  // Start 1 DIP below the chrome bar: at fractional DPI scales the native view's
  // top edge would otherwise round up and cover the bar's bottom pixel with the
  // (dark) DSH page, showing a black hairline under the bar.
  view.setBounds({ x: 0, y: chromeHeight + 1, width, height: Math.max(0, height - chromeHeight - 1) })
}

// ── connect / disconnect ────────────────────────────────────────────────────
async function connectTab(tabId: string, rawUrl: string, source?: ConnectionSource): Promise<void> {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new Error('URL 无效')

  // Dedupe: if another tab already targets this URL, switch to it instead of
  // opening a second connection. A fresh empty tab is closed in that case.
  const existing = store.findTabByUrl(url, tabId)
  if (existing) {
    const tab = store.getTab(tabId)
    if (tab && tab.phase === 'new') {
      destroyView(tabId)
      store.closeTab(tabId)
    }
    store.setActive(existing.id)
    store.log({ source: 'shell', level: 'info', text: `已有标签页连接 ${url}，已切换过去。` })
    syncViews()
    emitState()
    return
  }

  const resolvedSource = source ?? (isLoopback(url) ? 'local-external' : 'manual')
  store.patchTab(tabId, { phase: 'connecting', url, error: undefined })
  emitState()
  try {
    const probe = await probeEndpoint(url, 5000)
    if (!probe.ok) throw new Error(`无法连接 ${url}：服务未响应。`)
    if (!probe.isDsh) {
      store.log({ source: 'shell', level: 'warn', text: `提示：${url} 未检测到 DSH 界面标记，可能不是 DeepSeek Harness。` })
    }

    const view = views.get(tabId) ?? createView(tabId)
    store.patchTab(tabId, { phase: 'connected', url, source: resolvedSource, title: undefined })
    syncViews()
    await view.webContents.loadURL(url)
    view.webContents.focus()
    void endpoints.touchEndpoint(url)
    store.log({ source: 'shell', level: 'info', text: `已连接 ${url}（${sourceLabel(resolvedSource)}）` })
    debug('connectTab: connected', tabId, url)
    emitState()
  } catch (err) {
    const message = errMsg(err)
    store.patchTab(tabId, { phase: 'error', url, error: message })
    store.log({ source: 'shell', level: 'error', text: `连接失败：${message}` })
    syncViews()
    emitState()
  }
}

function handleDshExit(code: number | null, signal: NodeJS.Signals | null): void {
  store.log({ source: 'dsh', level: 'error', text: `dsh 进程已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）` })
  // Mark every tab that used the shell-spawned instance as failed.
  for (const t of store.snapshot().tabs) {
    if (t.phase === 'connected' && t.source === 'local-spawned') {
      store.patchTab(t.id, { phase: 'error', error: '本机 dsh 进程已退出，请重新启动或连接其他实例。' })
    }
  }
  syncViews()
  emitState()
}

async function autoStart(targetTabId: string): Promise<void> {
  try {
    const res = await manager.start({
      onOutput: pushDshOutput,
      onExit: handleDshExit
    })
    debug('autoStart: dsh ready at', res.url, 'alreadyRunning =', res.alreadyRunning)
    await connectTab(targetTabId, res.url, res.alreadyRunning ? 'local-external' : 'local-spawned')
  } catch (err) {
    const message = errMsg(err)
    store.log({ source: 'shell', level: 'error', text: `启动失败：${message}` })
    debug('autoStart: FAILED ->', message)
    store.patchTab(targetTabId, { phase: 'landing' })
    store.setGlobal({ landingReason: 'start-failed', message })
    syncViews()
    emitState()
  }
}

// ── boot sequence ───────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  const bootTab = store.createTab('boot')
  store.setGlobal({ busy: 'none' })
  store.log({ source: 'shell', level: 'info', text: '正在检测本机 DSH…' })
  emitState()
  debug('boot: probing local DSH')

  const loaded = await endpoints.load()
  const candidates: string[] = []
  const push = (u?: string): void => {
    const n = normalizeUrl(u ?? '')
    if (n && !candidates.includes(n)) candidates.push(n)
  }
  push(loaded.defaultLocalUrl)
  const lastUsed = [...loaded.endpoints].sort((a, b) =>
    (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? '')
  )[0]
  push(lastUsed?.url)
  debug('boot: candidates =', candidates)

  for (const url of candidates) {
    const r = await probeEndpoint(url, 3000)
    if (r.ok && r.isDsh) {
      store.log({ source: 'shell', level: 'info', text: `检测到 DSH 正在运行：${url}` })
      debug('boot: DSH already running at', url)
      try {
        await connectTab(bootTab.id, url)
        return
      } catch (err) {
        store.log({ source: 'shell', level: 'warn', text: `连接 ${url} 失败：${errMsg(err)}` })
      }
    }
  }

  if (await isDshInstalled()) {
    store.log({ source: 'shell', level: 'info', text: 'DSH 已安装但未运行，正在自动启动…' })
    debug('boot: installed but not running -> auto-start')
    store.setGlobal({ installed: true, busy: 'auto-starting' })
    emitState()
    await autoStart(bootTab.id)
    return
  }

  debug('boot: dsh not installed -> landing')
  store.patchTab(bootTab.id, { phase: 'landing' })
  store.setGlobal({ installed: false, landingReason: 'not-installed', message: '未在本机检测到 dsh。你可以安装它，或连接一个远程 / WSL 上的实例。' })
  emitState()
}

// ── IPC ─────────────────────────────────────────────────────────────────────
function registerIpc(): void {
  const guard = (e: IpcMainInvokeEvent): boolean => !!win && e.sender === win.webContents
  const denied = (): never => {
    throw new Error('forbidden')
  }

  ipcMain.handle(IPC.GetState, (e) => (guard(e) ? store.snapshot() : denied()))
  ipcMain.handle(IPC.Probe, async (e, url: string) => (guard(e) ? await probeEndpoint(url, 5000) : denied()))
  ipcMain.handle(IPC.IsInstalled, async (e) => (guard(e) ? await isDshInstalled() : denied()))

  // ── tabs ──
  ipcMain.handle(IPC.CreateTab, (e): ShellState => {
    if (!guard(e)) return denied()
    store.createTab('manual')
    syncViews()
    emitState()
    return store.snapshot()
  })

  ipcMain.handle(IPC.CloseTab, (e, id: string): ShellState => {
    if (!guard(e)) return denied()
    destroyView(id)
    store.closeTab(id)
    syncViews()
    emitState()
    return store.snapshot()
  })

  ipcMain.handle(IPC.SwitchTab, (e, id: string): ShellState => {
    if (!guard(e)) return denied()
    store.setActive(id)
    syncViews()
    emitState()
    return store.snapshot()
  })

  ipcMain.handle(IPC.ConnectTab, async (e, id: string, rawUrl: string): Promise<ShellState> => {
    if (!guard(e)) return denied()
    await connectTab(id, rawUrl)
    return store.snapshot()
  })

  // ── local / install ──
  ipcMain.handle(IPC.StartLocal, async (e): Promise<ShellState> => {
    if (!guard(e)) return denied()
    const s = store.snapshot()
    if (s.busy !== 'none') return s
    const targetTabId = store.getTab(s.activeTabId)?.id ?? s.bootTabId
    store.setGlobal({ busy: 'starting' })
    emitState()
    await autoStart(targetTabId)
    return store.snapshot()
  })

  ipcMain.handle(IPC.StopLocal, async (e) => {
    if (!guard(e)) return denied()
    await manager.stop()
    return store.snapshot()
  })

  ipcMain.handle(IPC.InstallDsh, async (e) => {
    if (!guard(e)) return denied()
    if (store.snapshot().busy !== 'none') return { ok: false, message: '已有任务进行中' }
    store.setGlobal({ busy: 'installing', message: '正在安装 dsh…' })
    store.log({ source: 'shell', level: 'info', text: 'npm install -g @deepseek-ai/dsh@latest' })
    emitState()

    const ac = new AbortController()
    installAbort = ac
    try {
      const res = await installDshGlobal({
        signal: ac.signal,
        onOutput: (line) => store.log({ source: 'npm', level: 'info', text: line })
      })

      if (ac.signal.aborted) {
        store.log({ source: 'npm', level: 'warn', text: '安装已停止。' })
        store.setGlobal({ busy: 'none', message: '安装已停止。' })
        emitState()
        return { ok: false }
      }

      if (res.ok) {
        store.log({ source: 'npm', level: 'info', text: '安装成功，正在启动本机 DSH…' })
        store.setGlobal({ installed: true, busy: 'auto-starting', message: '安装成功，正在启动本机 DSH…' })
        emitState()
        const s = store.snapshot()
        const targetTabId = store.getTab(s.activeTabId)?.id ?? s.bootTabId
        await autoStart(targetTabId)
        return { ok: true }
      }
      const message = res.hint ?? `npm 安装失败（exit code ${res.code ?? 'unknown'}）`
      store.log({ source: 'npm', level: 'error', text: `安装失败：${message}` })
      store.setGlobal({ busy: 'none', message })
      emitState()
      return { ok: false, message }
    } finally {
      if (installAbort === ac) installAbort = null
    }
  })

  ipcMain.handle(IPC.StopInstall, (e) => {
    if (!guard(e)) return denied()
    installAbort?.abort()
    return store.snapshot()
  })

  // ── endpoints / settings ──
  ipcMain.handle(IPC.ListEndpoints, async (e): Promise<EndpointStoreData> => (guard(e) ? await endpoints.load() : denied()))

  ipcMain.handle(IPC.AddEndpoint, async (e, label: string, url: string): Promise<EndpointStoreData> => {
    if (!guard(e)) return denied()
    return await endpoints.upsertEndpoint(label, url)
  })

  ipcMain.handle(IPC.RemoveEndpoint, async (e, id: string): Promise<EndpointStoreData> => {
    if (!guard(e)) return denied()
    return await endpoints.removeEndpoint(id)
  })

  ipcMain.handle(IPC.GetSettings, async (e): Promise<Settings> => {
    if (!guard(e)) return denied()
    settingsCache = await settings.load()
    return settingsCache
  })

  ipcMain.handle(IPC.SetSettings, async (e, next: Settings): Promise<Settings> => {
    if (!guard(e)) return denied()
    const clean: Settings = { keepDshRunning: next?.keepDshRunning === true }
    await settings.save(clean)
    settingsCache = clean
    return clean
  })

  ipcMain.handle(IPC.OpenExternal, async (e, url: string) => {
    if (!guard(e)) return denied()
    if (isAllowedUrl(url)) await shell.openExternal(url)
  })

  // ── active tab chrome actions ──
  ipcMain.handle(IPC.ToggleDevTools, (e) => {
    if (!guard(e)) return denied()
    const id = store.snapshot().activeTabId
    const view = views.get(id)
    view?.webContents.toggleDevTools()
  })

  ipcMain.handle(IPC.ReloadTab, (e, id: string) => {
    if (!guard(e)) return denied()
    const view = views.get(id)
    view?.webContents.reload()
  })

  ipcMain.handle(IPC.SetChromeHeight, (e, height: number) => {
    if (!guard(e)) return denied()
    chromeHeight = Math.max(0, Math.round(height))
    layout()
  })

  // push events
  store.onChange((s) => win?.webContents.send(IPC.StateChanged, s))
  store.onLog((entry: LogEntry) => win?.webContents.send(IPC.Log, entry))
}

// ── window & menu ───────────────────────────────────────────────────────────
function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'DSHDock',
    backgroundColor: '#f6f7f9',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('resize', layout)
  win.on('closed', () => {
    win = null
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: '文件',
      submenu: isMac ? [{ role: 'close' }] : [{ role: 'quit' }]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' } as MenuItemConstructorOptions] : [])]
    },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        {
          label: 'DSHDock',
          click: () => {
            void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness')
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── lifecycle ───────────────────────────────────────────────────────────────
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('before-quit', (e) => {
  if (quitting || !manager?.hasSpawnedChild) return
  if (settingsCache.keepDshRunning) return
  e.preventDefault()
  quitting = true
  void manager.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

void app.whenReady().then(() => {
  endpoints = new EndpointStore(join(app.getPath('userData'), 'endpoints.json'))
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  manager = new DshProcessManager()

  void settings.load().then((s) => {
    settingsCache = s
  })

  buildMenu()
  createWindow()
  registerIpc()
  void boot()
})
