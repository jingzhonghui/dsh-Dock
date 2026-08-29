import { useEffect, useState } from 'react'
import type { Endpoint, ProbeResult, ShellState, TabState } from '@shared/ipc'

interface LandingProps {
  state: ShellState
  activeTab: TabState
}

export function Landing({ state, activeTab }: LandingProps): JSX.Element {
  const [installed, setInstalled] = useState<boolean | null>(state.installed ?? null)
  const [url, setUrl] = useState('')
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const busy = state.busy !== 'none'

  useEffect(() => {
    void window.dshShell.listEndpoints().then((s) => setEndpoints(s.endpoints))
  }, [])

  useEffect(() => {
    if (state.installed !== undefined) setInstalled(state.installed)
  }, [state.installed])

  const refresh = async (): Promise<void> => {
    const s = await window.dshShell.listEndpoints()
    setEndpoints(s.endpoints)
  }

  const doProbe = async (): Promise<void> => {
    if (!url.trim()) return
    setProbe(await window.dshShell.probe(url))
  }

  const doConnect = async (target?: string): Promise<void> => {
    setError(null)
    try {
      await window.dshShell.connectTab(activeTab.id, target ?? url)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const doInstall = async (): Promise<void> => {
    setError(null)
    const res = await window.dshShell.installDsh()
    if (!res.ok && res.message) setError(res.message)
  }

  const doStart = async (): Promise<void> => {
    setError(null)
    await window.dshShell.startLocal()
  }

  return (
    <div className="landing">
      <div className="hero">
        <div className="logo">DSH</div>
        <h1>DSH Desktop</h1>
        <p className="muted">
          {state.message ?? '连接 DeepSeek Harness（dsh）的专用桌面端'}
        </p>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="landing-grid">
        <section className="card">
          <h2>本机 DSH</h2>
          {busy && (
            <div className="busy-row">
              <div className="spinner small" />
              <span>{busyLabel(state)}</span>
            </div>
          )}
          {!busy && installed === false && (
            <>
              <p className="muted">未在本机检测到 dsh 安装（npm 全局包 @deepseek-ai/dsh）。安装后壳会自动启动并进入界面。</p>
              <button className="primary" onClick={() => void doInstall()}>
                安装 DSH（npm install -g @deepseek-ai/dsh）
              </button>
              <p className="muted small">需要本机已安装 Node.js（https://nodejs.org）。macOS / Linux 全局安装可能要求管理员权限。</p>
            </>
          )}
          {!busy && installed !== false && (
            <button className="primary" onClick={() => void doStart()}>
              启动本机 DSH
            </button>
          )}
          {state.landingReason === 'start-failed' && !busy && (
            <p className="error-text small">上次启动失败，可查看下方日志后重试，或转手动连接。</p>
          )}
        </section>

        <section className="card">
          <h2>手动连接</h2>
          <p className="muted">DSH 运行在服务器、WSL 或自定义端口时，直接输入地址。</p>
          <div className="row">
            <input
              className="text-input"
              placeholder="例如 http://192.168.1.10:3080 或 localhost:8080"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setProbe(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doConnect()
              }}
            />
            <button disabled={!url.trim() || busy} onClick={() => void doConnect()}>
              连接
            </button>
            <button disabled={!url.trim() || busy} onClick={() => void doProbe()}>
              检测
            </button>
          </div>
          {probe && <ProbeBadge result={probe} />}
        </section>

        <section className="card">
          <h2>已保存的连接</h2>
          {endpoints.length === 0 && <p className="muted small">还没有保存过连接。连接过的地址会自动出现在这里。</p>}
          {endpoints.map((ep) => (
            <div className="endpoint" key={ep.id}>
              <div className="endpoint-info">
                <div className="endpoint-label">{ep.label}</div>
                <div className="endpoint-url">{ep.url}</div>
                {ep.lastConnectedAt && <div className="endpoint-time">最近连接 {new Date(ep.lastConnectedAt).toLocaleString()}</div>}
              </div>
              <button disabled={busy} onClick={() => void doConnect(ep.url)}>
                连接
              </button>
              <button
                className="ghost danger"
                onClick={() => {
                  void window.dshShell.removeEndpoint(ep.id).then(() => refresh())
                }}
              >
                删除
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function ProbeBadge({ result }: { result: ProbeResult }): JSX.Element {
  if (result.isDsh) return <p className="badge-line ok">✓ 检测到 DSH 界面</p>
  if (result.ok) return <p className="badge-line warn">⚠ 可访问，但未识别为 DSH 界面</p>
  return <p className="badge-line err">✗ 无法访问该地址{result.status ? `（HTTP ${result.status}）` : ''}</p>
}

function busyLabel(state: ShellState): string {
  switch (state.busy) {
    case 'installing':
      return '正在安装 DSH…'
    case 'auto-starting':
      return '正在自动启动本机 DSH…'
    case 'starting':
      return '正在启动本机 DSH…'
    default:
      return '处理中…'
  }
}
