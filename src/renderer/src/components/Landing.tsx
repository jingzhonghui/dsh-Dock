import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ProbeResult, ShellState, TabState } from '@shared/ipc'

interface LandingProps {
  state: ShellState
  activeTab: TabState
}

export function Landing({ state, activeTab }: LandingProps): JSX.Element {
  const [installed, setInstalled] = useState<boolean | null>(state.installed ?? null)
  const [url, setUrl] = useState('')
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = state.busy !== 'none'
  const logRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  // True while the user pressed "stop" on an install; suppresses the red
  // "安装已停止" banner (the log panel still stays open).
  const [stopped, setStopped] = useState(false)
  const stoppedRef = useRef(false)
  // Show the log stream while working, and keep it after an install/start failure.
  const showLogs =
    state.logs.length > 0 &&
    (busy || error !== null || stopped || state.landingReason === 'start-failed')
  // Vertical offsets for the cards block:
  // - centered by default: the block sits in the middle of the space below the
  //   hero; centerShift lifts it by half the hero height so the CARDS' center
  //   (not the block's) aligns with the page center.
  // - while installing: rise lifts the block up to just under the hero so the
  //   log panel can unfold underneath.
  const [rise, setRise] = useState(0)
  const [centerShift, setCenterShift] = useState(0)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.logs.length, showLogs])

  useEffect(() => {
    if (state.installed !== undefined) setInstalled(state.installed)
  }, [state.installed])

  useLayoutEffect(() => {
    const main = mainRef.current
    const hero = heroRef.current
    if (!main || !hero) return
    const update = (): void => {
      if (!showLogs) {
        setRise(0)
        setCenterShift(Math.max(0, Math.round(hero.offsetHeight / 2) - 12))
        return
      }
      setCenterShift(0)
      const gap = main.offsetTop - (hero.offsetTop + hero.offsetHeight)
      setRise(Math.max(0, gap - 16))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(main)
    const landing = main.parentElement
    if (landing) ro.observe(landing)
    return () => ro.disconnect()
  }, [showLogs])

  const doProbe = async (): Promise<void> => {
    if (!url.trim()) return
    setProbe(await window.dshShell.probe(url))
  }

  const doConnect = async (target?: string): Promise<void> => {
    setError(null)
    try {
      await window.dshShell.connectTab(activeTab.id, target ?? url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const doInstall = async (): Promise<void> => {
    setError(null)
    setStopped(false)
    stoppedRef.current = false
    const res = await window.dshShell.installDsh()
    if (!res.ok && res.message && !stoppedRef.current) setError(res.message)
  }

  const doStopInstall = (): void => {
    stoppedRef.current = true
    setStopped(true)
    void window.dshShell.stopInstall()
  }

  const doStart = async (): Promise<void> => {
    setError(null)
    await window.dshShell.startLocal()
  }

  const shift = showLogs ? rise : centerShift

  return (
    <div className="landing">
      <header className="hero" ref={heroRef}>
        <img className="logo" src="/icon.png" alt="DSHDock" />
        <h1>DSHDock</h1>
        <p className="tagline">连接 DeepSeek Harness 的桌面入口</p>
        {error && <p className="error-text">{error}</p>}
      </header>

      <div
        className="landing-main"
        ref={mainRef}
        style={shift > 0 ? { transform: `translateY(-${shift}px)` } : undefined}
      >
        <div className="landing-grid">
          <section className="card frost-card dock-card">
            <div className="card-head">
              <h2>本机 DSH</h2>
              <div className="endpoint-token">
                <span className="signal" />
                <span>127.0.0.1:3080</span>
              </div>
            </div>

            <p className="dock-copy">{dockCopy(installed)}</p>

            <div className={state.busy === 'installing' ? 'cta-area cta-static' : 'cta-area'} key={state.busy}>
              {state.busy === 'installing' ? (
                <button className="dock-cta stop" onClick={() => void doStopInstall()}>
                  停止安装
                </button>
              ) : busy ? (
                <div className="busy-row">
                  <div className="spinner small" />
                  <span>{busyLabel(state)}</span>
                </div>
              ) : installed === false ? (
                <button className="primary dock-cta" onClick={() => void doInstall()}>
                  安装 DSH
                </button>
              ) : (
                <button className="primary dock-cta" onClick={() => void doStart()}>
                  启动本机 DSH
                </button>
              )}
            </div>
            {installed === false && (
              <p className="dock-note">需要 Node.js（https://nodejs.org）。macOS / Linux 全局安装可能要求管理员权限。</p>
            )}
            {state.landingReason === 'start-failed' && !busy && (
              <p className="error-text small">上次启动失败，可查看下方日志后重试。</p>
            )}
          </section>

          <section className="card frost-card">
            <h2>手动连接</h2>
            <p className="connect-copy">DSH 运行在服务器、WSL 或自定义端口时，直接输入地址。</p>
            <div className="row connect-row">
              <input
                className="text-input"
                placeholder="例如 localhost:8080 或 http://192.168.1.10:3080"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setProbe(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doConnect()
                }}
              />
              <button className="primary" disabled={!url.trim() || busy} onClick={() => void doConnect()}>
                连接
              </button>
            </div>
            <div className="row probe-row">
              <button className="ghost" disabled={!url.trim() || busy} onClick={() => void doProbe()}>
                检测
              </button>
              {probe && <ProbeBadge result={probe} />}
            </div>
          </section>
        </div>

        {showLogs && (
          <section className="card log-card">
            <h2>运行日志</h2>
            <div className="log-viewer" ref={logRef}>
              {state.logs.slice(-80).map((entry, i) => (
                <div key={i} className={`log-line log-${entry.level}`}>
                  <span className="log-source">[{entry.source}]</span>
                  <span className="log-text">{entry.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function dockCopy(installed: boolean | null): string {
  if (installed === false) return '未在本机检测到 dsh。安装后会自动启动，并带你进入界面。'
  if (installed === true) return '本机已安装 dsh，但尚未运行。启动后会自动进入界面。'
  return '正在确认本机状态…'
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
