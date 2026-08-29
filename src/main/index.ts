import { app, BrowserWindow, ipcMain, Menu, shell, WebContentsView, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

import { IPC, type ConnectionSource, type EndpointStoreData, type LogEntry, type Settings, type ShellState } from '../shared/ipc'
import { isAllowedUrl, isLoopback, normalizeUrl } from '../shared/url'
import { probeEndpoint } from './detector'
import { DshProcessManager, isDshInstalled } from './localDsh'
import { installDshGlobal } from './installer'
import { EndpointStore } from './endpoints'
import { SettingsStore } from './settings'
import { ShellStateMachine } from './shellState'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/** Mirror key lifecycle events to stdout for debugging / smoke tests. */
function debug(...args: unknown[]): void {
  console.log('[dsh-desktop]', ...args)
}

// ── singleton ───────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// ── stateful services ───────────────────────────────────────────────────────
const state = new ShellStateMachine()
let endpoints: EndpointStore
let settings: SettingsStore
let manager: DshProcessManager
let win: BrowserWindow | null = null
let contentView: WebContentsView | null = null
let contentAttached = false
let chromeHeight = 48 // default chrome-bar height until the renderer reports the real one
let quitting = false
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

function emitState(s: ShellState = state.snapshot()): void {
  win?.webContents.send(IPC.StateChanged, s)
}

function pushDshOutput(chunk: string): void {
  let buffer = ''
  for (const line of (buffer + chunk).split(/\r?\n/)) {
    if (!line.trim()) continue
    state.log({ source: 'dsh', level: 'info', text: line.trimEnd() })
  }
}

// ── content view (the DSH page) ─────────────────────────────────────────────
function createContentView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:dsh',
      spellcheck: true
    }
  })

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  view.webContents.on('did-navigate', (_e, url) => onNavigated(url))
  view.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) onNavigated(url)
  })

  view.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    if (code === -3) return // ERR_ABORTED: user-initiated navigation/cancel
    const s = state.snapshot()
    if (s.phase === 'connected') {
      state.log({ source: 'shell', level: 'error', text: `DSH 连接中断（${code} ${desc}）` })
      setLanding('disconnected', `DSH 连接中断：${desc}`)
    }
  })

  return view
}

function onNavigated(url: string): void {
  const s = state.snapshot()
  if (s.phase === 'connected' && s.connection && s.connection.url !== url) {
    state.transition({ connection: { ...s.connection, url } })
    emitState()
  }
}

function attachContentView(): void {
  if (!win || !contentView || contentAttached) return
  win.contentView.addChildView(contentView)
  contentAttached = true
  layout()
}

function detachContentView(): void {
  if (!win || !contentView || !contentAttached) return
  win.contentView.removeChildView(contentView)
  contentAttached = false
}

function layout(): void {
  if (!win || !contentView || !contentAttached) return
  const [width, height] = win.getContentSize()
  contentView.setBounds({ x: 0, y: chromeHeight, width, height: Math.max(0, height - chromeHeight) })
}

// ── state transitions ───────────────────────────────────────────────────────
function setLanding(reason: ShellState['landingReason'], message: string): void {
  detachContentView()
  state.transition({ phase: 'landing', busy: 'none', landingReason: reason, message, connection: undefined })
  emitState()
}

async function connectTo(url: string, source: ConnectionSource): Promise<void> {
  const probe = await probeEndpoint(url, 5000)
  if (!probe.ok) throw new Error(`无法连接 ${url}：服务未响应。`)
  if (!probe.isDsh) {
    state.log({ source: 'shell', level: 'warn', text: `提示：${url} 未检测到 DSH 界面标记，可能不是 DeepSeek Harness。` })
  }

  state.transition({
    phase: 'connected',
    busy: 'none',
    connection: { source, url },
    landingReason: undefined,
    message: undefined
  })
  attachContentView()
  await contentView!.webContents.loadURL(url)
  contentView!.webContents.focus()
  void endpoints.touchEndpoint(url)
  state.log({ source: 'shell', level: 'info', text: `已连接 ${url}（${sourceLabel(source)}）` })
  debug('connectTo: connected to', url, `(${source})`)
  emitState()
}

function handleDshExit(code: number | null, signal: NodeJS.Signals | null): void {
  state.log({ source: 'dsh', level: 'error', text: `dsh 进程已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）` })
  const s = state.snapshot()
  if (s.phase === 'connected' && s.connection?.source === 'local-spawned') {
    setLanding('disconnected', '本机 dsh 进程已退出，请重新启动或连接其他实例。')
  }
}

async function autoStart(): Promise<void> {
  try {
    const res = await manager.start({
      onOutput: pushDshOutput,
      onExit: handleDshExit
    })
    debug('autoStart: dsh ready at', res.url, 'alreadyRunning =', res.alreadyRunning)
    await connectTo(res.url, res.alreadyRunning ? 'local-external' : 'local-spawned')
  } catch (err) {
    const message = errMsg(err)
    state.log({ source: 'shell', level: 'error', text: `启动失败：${message}` })
    debug('autoStart: FAILED ->', message)
    setLanding('start-failed', message)
    emitState()
  }
}

// ── boot sequence ───────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  state.transition({ phase: 'probing', busy: 'none' })
  state.log({ source: 'shell', level: 'info', text: '正在检测本机 DSH…' })
  emitState()
  debug('boot: probing local DSH')

  const store = await endpoints.load()
  const candidates: string[] = []
  const push = (u?: string): void => {
    const n = normalizeUrl(u ?? '')
    if (n && !candidates.includes(n)) candidates.push(n)
  }
  push(store.defaultLocalUrl)
  const lastUsed = [...store.endpoints].sort((a, b) =>
    (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? '')
  )[0]
  push(lastUsed?.url)
  debug('boot: candidates =', candidates)

  for (const url of candidates) {
    const r = await probeEndpoint(url, 3000)
    if (r.ok && r.isDsh) {
      state.log({ source: 'shell', level: 'info', text: `检测到 DSH 正在运行：${url}` })
      debug('boot: DSH already running at', url)
      try {
        await connectTo(url, isLoopback(url) ? 'local-external' : 'manual')
        return
      } catch (err) {
        state.log({ source: 'shell', level: 'warn', text: `连接 ${url} 失败：${errMsg(err)}` })
      }
    }
  }

  if (await isDshInstalled()) {
    state.log({ source: 'shell', level: 'info', text: 'DSH 已安装但未运行，正在自动启动…' })
    debug('boot: installed but not running -> auto-start')
    state.transition({ busy: 'auto-starting' })
    emitState()
    await autoStart()
    return
  }

  debug('boot: dsh not installed -> landing')
  setLanding('not-installed', '未在本机检测到 dsh。你可以安装它，或连接一个远程 / WSL 上的实例。')
}

// ── IPC ─────────────────────────────────────────────────────────────────────
function registerIpc(): void {
  const guard = (e: IpcMainInvokeEvent): boolean => !!win && e.sender === win.webContents
  const denied = (): never => {
    throw new Error('forbidden')
  }

  ipcMain.handle(IPC.GetState, (e) => (guard(e) ? state.snapshot() : denied()))
  ipcMain.handle(IPC.Probe, async (e, url: string) => (guard(e) ? await probeEndpoint(url, 5000) : denied()))
  ipcMain.handle(IPC.IsInstalled, async (e) => (guard(e) ? await isDshInstalled() : denied()))

  ipcMain.handle(IPC.Connect, async (e, rawUrl: string) => {
    if (!guard(e)) return denied()
    const url = normalizeUrl(rawUrl)
    if (!url) throw new Error('URL 无效')
    state.transition({ busy: 'connecting' })
    emitState()
    try {
      await connectTo(url, isLoopback(url) ? 'local-external' : 'manual')
    } catch (err) {
      setLanding('probe-failed', errMsg(err))
      emitState()
    }
    return state.snapshot()
  })

  ipcMain.handle(IPC.StartLocal, async (e) => {
    if (!guard(e)) return denied()
    if (state.snapshot().busy !== 'none') return state.snapshot()
    state.transition({ busy: 'starting' })
    emitState()
    await autoStart()
    return state.snapshot()
  })

  ipcMain.handle(IPC.StopLocal, async (e) => {
    if (!guard(e)) return denied()
    await manager.stop()
    return state.snapshot()
  })

  ipcMain.handle(IPC.InstallDsh, async (e) => {
    if (!guard(e)) return denied()
    if (state.snapshot().busy !== 'none') return { ok: false, message: '已有任务进行中' }
    state.transition({ busy: 'installing', message: '正在安装 dsh…' })
    state.log({ source: 'shell', level: 'info', text: 'npm install -g @deepseek-ai/dsh@latest' })
    emitState()

    const res = await installDshGlobal({
      onOutput: (line) => state.log({ source: 'npm', level: 'info', text: line })
    })

    if (res.ok) {
      state.log({ source: 'npm', level: 'info', text: '安装成功，正在启动本机 DSH…' })
      state.transition({ busy: 'auto-starting', message: '安装成功，正在启动本机 DSH…' })
      emitState()
      await autoStart()
      return { ok: true }
    }
    const message = res.hint ?? `npm 安装失败（exit code ${res.code ?? 'unknown'}）`
    state.log({ source: 'npm', level: 'error', text: `安装失败：${message}` })
    state.transition({ busy: 'none', message })
    emitState()
    return { ok: false, message }
  })

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

  ipcMain.handle(IPC.ToggleDevTools, (e) => {
    if (!guard(e)) return denied()
    if (contentView) contentView.webContents.toggleDevTools()
  })

  ipcMain.handle(IPC.GoBack, (e) => {
    if (!guard(e)) return denied()
    contentView?.webContents.navigationHistory.goBack()
  })
  ipcMain.handle(IPC.GoForward, (e) => {
    if (!guard(e)) return denied()
    contentView?.webContents.navigationHistory.goForward()
  })
  ipcMain.handle(IPC.Reload, (e) => {
    if (!guard(e)) return denied()
    contentView?.webContents.reload()
  })
  ipcMain.handle(IPC.GoHome, (e) => {
    if (!guard(e)) return denied()
    setLanding('user', '已断开连接。')
    emitState()
  })

  ipcMain.handle(IPC.SetChromeHeight, (e, height: number) => {
    if (!guard(e)) return denied()
    chromeHeight = Math.max(0, Math.round(height))
    layout()
  })

  // push events
  state.onChange((s) => win?.webContents.send(IPC.StateChanged, s))
  state.onLog((entry: LogEntry) => win?.webContents.send(IPC.Log, entry))
}

// ── window & menu ───────────────────────────────────────────────────────────
function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'DSH Desktop',
    backgroundColor: '#0d1117',
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

  contentView = createContentView()

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
          label: 'DSH Desktop',
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
