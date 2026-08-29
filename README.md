# DSH Desktop

DeepSeek Harness（dsh）的跨平台桌面壳（wrapper）—— 一个"DSH 专用浏览器"。

**设计原则：不集成 DSH 代码，只依赖 DSH 文档化的外部契约**（npm 包名 `@deepseek-ai/dsh`、`dsh --profile web` CLI 参数、HTTP 根页面标记），因此 **DSH 官方更新时本壳无需任何改动**。

## 启动行为

1. 启动后自动探测本机 DSH 是否在运行（默认 `http://127.0.0.1:3080`，用 DSH 界面标记校验，避免把端口上别的服务误认为 DSH）。
2. **在运行** → 直接打开界面。
3. **未运行但已安装**（npm 全局包存在）→ **自动启动**本机 DSH（自动挑端口、等待就绪）并进入界面。
4. **未安装** → 落地页提供：
   - **手动输入 URL**：连接服务器、WSL、自定义端口上的 DSH；
   - **安装 DSH**：`npm install -g @deepseek-ai/dsh`，实时显示输出，成功后自动启动并进入界面。

## 特性

- 内置浏览器窗口（Electron `WebContentsView`，与 DSH 官方测试的 Chromium 一致）；地址栏、前进/后退/刷新、DevTools（`Ctrl+Shift+I`）、缩放（`Ctrl+=` / `Ctrl+-` / `Ctrl+0`）。
- 端点管理器：连接过的地址自动保存，可随时切换；默认本地地址可配置。
- 由壳启动的本地 DSH 进程默认随壳退出而结束（避免孤儿进程）；可在设置中开启"保持运行"。
- 边界情况：若壳被异常终止（任务管理器强制结束、崩溃、断电），正常退出清理不会执行，由壳启动的 DSH 可能残留为后台进程。重新打开壳通常会探测并重新连上它，也可在任务管理器中手动结束。
- 持久会话（`persist:dsh` partition）：远程带登录的 DSH 无需反复登录。
- 单实例锁：重复启动会聚焦已有窗口。
- 跨平台：Windows / macOS / Linux（electron-builder 打包）。

## 开发

```bash
npm install
npm run dev        # electron-vite 开发模式
npm run typecheck  # tsc 双配置检查
npm test           # vitest 单测 + 集成测试
npm run build      # 构建产物到 out/
npm run dist       # 当前平台打包到 release/
npm run dist:win|dist:mac|dist:linux
```

## 打包说明

- 未签名的 Windows 安装包首次运行会触发 SmartScreen 提示；正式发布请配置代码签名。
- `electron-builder.yml` 已配置 `electronDownload.mirror` 为 npmmirror（国内网络加速），可按需移除。
- macOS 打包（dmg）需要在 macOS 上执行。

## 常见场景

| 场景 | 操作 |
|---|---|
| DSH 装在本机且已运行 | 启动壳 → 直接进入 |
| DSH 装在本机但未运行 | 启动壳 → 自动启动并进入 |
| DSH 在 WSL2 里 | 手动连接 `http://localhost:3080`（WSL2 自动转发 loopback） |
| DSH 在 WSL1 里 | 手动连接 WSL 虚拟机 IP，如 `http://<WSL-IP>:3080` |
| DSH 在远程服务器 | 手动连接 `http://<host>:<port>`；需要登录则正常在窗口内登录 |
| 本机 3080 端口被其他程序占用 | 壳自动换一个空闲端口启动本地 DSH |
| macOS / Linux 全局安装 DSH 权限不足 | 终端执行 `sudo npm install -g @deepseek-ai/dsh` 后重启壳 |

## 安全说明

- DSH 内容页运行在独立的 `WebContentsView` 中，**不挂 preload、无 Node 权限**、`sandbox + contextIsolation` 全开；新窗口一律拦截，仅 http/https 转交系统浏览器。
- 壳只对 loopback 地址做自动探测/自动启动；连接远程地址均需用户显式输入。
- DSH 本身是"远程代码执行"级能力的工具：请只连接你信任的实例（与 dsh 官方的 browser-trust fence 思路一致）。

## 架构速览

```
src/main/
  index.ts        # 窗口、WebContentsView、启动序列、IPC 注册
  detector.ts     # 健康检查（HTTP 根页面 + DSH 标记）
  localDsh.ts     # dsh 安装发现、进程管理、端口挑选、就绪轮询
  installer.ts    # npm install -g 流式输出
  endpoints.ts    # 连接管理器持久化（userData/endpoints.json）
  settings.ts     # keepDshRunning 等设置
  shellState.ts   # 状态机 probing → connected | landing
src/preload/      # contextBridge 暴露 window.dshShell
src/renderer/     # chrome 栏 + 落地页 UI（React）
src/shared/       # IPC 通道契约、URL 工具（三方共享）
```

所有 main 模块除 `index.ts` 外不依赖 electron，可用 vitest 直接单测。
